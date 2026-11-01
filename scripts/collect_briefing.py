#!/usr/bin/env python3
"""Collect the event calendar and daily news for the performance dashboard.

This does not read inboud-map. inboud-map's JSON is produced outside that
repository (a private Excel workbook for news, and researched event lists
committed by an external agent). The sources below are the public ones that
process actually cites, fetched on a schedule by GitHub Actions.

Events
  - Japan holidays: Cabinet Office CSV (same office as the map's holiday link)
  - Hong Kong general holidays: GovHK
  - China, Korea, Taiwan, Britain: Nager.Date public-holiday API
  - Thailand Songkran: fixed public dates when no feed is available
  - Large concerts and sports: Tokyo Dome and Kyocera Dome Osaka schedules

News
  - RSS from the trade sites that account for most of the map's source links:
    TRAICY, Aviation Wire, Travel Voice, Sky-Budget, Kankokeizai, Skift

If every source fails, the previous data/briefing.json is left untouched.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "briefing.json"
JST = ZoneInfo("Asia/Tokyo")
UA = "perf-dashboard-briefing/1.0 (+https://github.com/100nao/perf-dashboard)"
WEEKDAYS = "月火水木金土日"

JP_CSV = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv"
JP_PAGE = "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html"
HK_PAGE = "https://www.gov.hk/en/about/abouthk/holiday/{year}.htm"
NAGER = "https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"


def nager_template(country: str) -> str:
    return NAGER.replace("{country}", country)
TOKYO_DOME = "https://www.tokyo-dome.co.jp/dome/event/?date={ym}-01"
KYOCERA = "https://www.kyoceradome-osaka.jp/schedule/?yearId={year}&monthId={month}"

FEEDS = [
    ("トラシー", "industry", "https://www.traicy.com/feed"),
    ("Aviation Wire", "industry", "https://aviationwire.jp/feed"),
    ("トラベルボイス", "industry", "https://www.travelvoice.jp/feed"),
    ("スカイバジェット", "industry", "https://sky-budget.com/feed"),
    ("観光経済新聞", "industry", "https://www.kankokeizai.com/feed"),
    ("Skift", "ota", "https://skift.com/feed"),
]

# League games repeat all season. The calendar is for demand spikes.
LEAGUE_RE = re.compile(
    r"公式戦|(?:巨人|ジャイアンツ|オリックス|バファローズ|タイガース|カープ|ドラゴンズ|"
    r"スワローズ|マリーンズ|ファイターズ|イーグルス|ホークス|ライオンズ|ベイスターズ)"
    r".{0,16}(?:対|vs\.?|VS)"
)
SPORTS_RE = re.compile(
    r"野球|試合|選手権|マラソン|相撲|グランプリ|サッカー|ラグビー|バスケ|格闘|プロレス|"
    r"ファンフェスタ|チャンピオン|ワールドカップ|駅伝|フィギュア|オリンピック"
)
SHOW_RE = re.compile(r"展示|見本市|フェア|コミックマーケット|万博")
FEST_RE = re.compile(r"花火|まつり|祭り|フェスティバル|祇園|ねぶた|祭典")

FLIGHT_RE = re.compile(
    r"就航|増便|減便|新路線|運休|国際線|航空|エアライン|LCC|フライト|"
    r"airline|airlines|flight|route launch",
    re.I,
)
OPENING_RE = re.compile(r"開業|グランドオープン|ホテル開業|opens a hotel|hotel opening", re.I)
OTA_RE = re.compile(
    r"Booking(?:\.com)?|Expedia|Agoda|Airbnb|Trip\.com|トリップドットコム|"
    r"Hotelbeds|じゃらん|楽天トラベル|一休|Klook|KKday",
    re.I,
)
COMPANY_RE = re.compile(
    r"じゃらん|楽天トラベル|一休|JTB|HIS|エイチ・アイ・エス|Expedia|エクスペディア|"
    r"Booking|Agoda|Trip\.com|トリップドットコム|Airbnb|エアビー|Klook|KKday|"
    r"Hotelbeds|近畿日本ツーリスト|日本旅行|阪急交通社|クラブツーリズム",
    re.I,
)
# Drop local notices that are not travel-trade news. If too few items match,
# the collector keeps the unfiltered list so the panel is not empty.
KEEP_RE = re.compile(
    r"ホテル|航空|就航|空港|訪日|インバウンド|旅行|観光|予約|開業|エアライン|"
    r"じゃらん|楽天トラベル|一休|JTB|HIS|Expedia|Booking|Agoda|Airbnb|Trip\.com|"
    r"airline|hotel|tourism|travel|airport|booking",
    re.I,
)

KR_NAMES = {
    "New Year's Day": "新年",
    "Lunar New Year": "ソルラル",
    "Independence Movement Day": "三・一節",
    "Labour Day": "労働節",
    "Constitution Day": "制憲節",
    "Liberation Day": "光復節",
    "Chuseok": "秋夕",
    "National Foundation Day": "開天節",
    "Hangul Day": "ハングルの日",
    "Christmas Day": "クリスマス",
}
# label, days before, days after, and the month/day the rule applies to.
# None means any date (lunar new year moves).
CN_EXPAND = {
    "Chinese New Year (Spring Festival)": ("春節", -1, 6, None, None),
    "Labour Day": ("労働節", 0, 4, 5, 1),
    "National Day": ("国慶節", 0, 6, 10, 1),
}
TW_NAMES = {
    "New Year's Day": "中華民国開国記念日",
    "Chinese New Year (Spring Festival)": "春節",
    "National Day": "双十節",
}
GB_NAMES = {
    "Christmas Day": "クリスマス",
    "Boxing Day": "クリスマス",
    "Good Friday": "イースター",
    "Easter Monday": "イースター",
}
HK_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}
SKIP_JP_LABELS = {"休日", "振替休日", "国民の休日"}


def today_jst() -> date:
    return datetime.now(JST).date()


def window_for(today: date) -> tuple[date, date]:
    start = date(today.year, today.month, 1)
    month_index = start.month - 1 + 12
    end_year = start.year + month_index // 12
    end_month = month_index % 12 + 1
    end = date(end_year, end_month, 1) - timedelta(days=1)
    return start, end


def fetch(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def overlaps(a: date, b: date, start: date, end: date) -> bool:
    return a <= end and b >= start


def slug(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


def event_item(
    *,
    kind: str,
    name: str,
    start: date,
    end: date,
    category: str,
    source: str,
    prefecture: str = "",
    venue: str = "",
    country: str = "",
    status: str = "",
    note: str = "",
    scale: str = "",
) -> dict:
    return {
        "id": f"{kind}-{start.isoformat()}-{slug(name + '|' + venue + '|' + country)}",
        "date_start": start.isoformat(),
        "date_end": end.isoformat(),
        "name": name,
        "category": category,
        "prefecture": prefecture,
        "venue": venue,
        "scale": scale,
        "source_country": country,
        "source": source,
        "announced_date": "",
        "status": status,
        "note": note,
    }


def parse_jp_csv(text: str) -> list[tuple[date, str]]:
    rows = []
    for line in text.splitlines()[1:]:
        line = line.strip()
        if not line or "," not in line:
            continue
        raw_date, name = line.split(",", 1)
        parts = raw_date.strip().split("/")
        if len(parts) != 3:
            continue
        y, m, d = (int(p) for p in parts)
        rows.append((date(y, m, d), name.strip()))
    return rows


def is_off(day: date, holidays: set[date]) -> bool:
    return day.weekday() >= 5 or day in holidays


def expand_off(day: date, holidays: set[date]) -> tuple[date, date]:
    start = day
    while is_off(start - timedelta(days=1), holidays):
        start -= timedelta(days=1)
    end = day
    while is_off(end + timedelta(days=1), holidays):
        end += timedelta(days=1)
    return start, end


def holiday_label(names: list[str]) -> str:
    cleaned = []
    for name in names:
        if name in SKIP_JP_LABELS or name in cleaned:
            continue
        cleaned.append(name)
    if len(cleaned) == 1:
        return cleaned[0]
    if not cleaned:
        return "連休"
    return "・".join(cleaned)


def long_weekends(
    holidays: list[tuple[date, str]],
    start: date,
    end: date,
) -> list[tuple[date, date, str]]:
    by_day: dict[date, list[str]] = {}
    for day, name in holidays:
        by_day.setdefault(day, []).append(name)
    holiday_days = set(by_day)
    seen: set[date] = set()
    blocks = []
    for day in sorted(holiday_days):
        if day in seen:
            continue
        block_start, block_end = expand_off(day, holiday_days)
        inside = [d for d in by_day if block_start <= d <= block_end]
        for d in inside:
            seen.add(d)
        if (block_end - block_start).days + 1 < 3:
            continue
        if not overlaps(block_start, block_end, start, end):
            continue
        names: list[str] = []
        for d in sorted(inside):
            names.extend(by_day[d])
        label = holiday_label(names)
        length = (block_end - block_start).days + 1
        if label != "連休":
            label = f"{label}のある3連休" if length == 3 else f"{label}のある連休"
        blocks.append((block_start, block_end, label))
    return blocks


def years_in(start: date, end: date) -> list[int]:
    return list(range(start.year, end.year + 1))


def clip_items(items: list[dict], start: date, end: date) -> list[dict]:
    kept = []
    for item in items:
        a = date.fromisoformat(item["date_start"])
        b = date.fromisoformat(item["date_end"])
        if overlaps(a, b, start, end):
            kept.append(item)
    return kept


def japan_events(rows: list[tuple[date, str]], start: date, end: date) -> list[dict]:
    blocks = long_weekends(rows, start, end)
    # Golden Week and the year-end period are travel peaks even when a
    # weekday sits in the middle, so they replace the smaller weekend blocks.
    covered: list[tuple[date, date, str, str]] = []
    for year in years_in(start, end):
        names = {day: name for day, name in rows if day.year == year}
        if date(year, 4, 29) in names and date(year, 5, 5) in names:
            covered.append((date(year, 4, 29), date(year, 5, 5), "ゴールデンウィーク", ""))
        if date(year, 1, 1) in names:
            covered.append((date(year - 1, 12, 29), date(year, 1, 3), "年末年始", ""))
        covered.append((date(year, 8, 13), date(year, 8, 16), "お盆", "祝日ではありません。帰省で宿泊需要が増える慣例の期間です。"))

    def swallowed(block: tuple[date, date, str]) -> bool:
        a, b, _ = block
        return any(s <= a and b <= e for s, e, _, _ in covered)

    items = []
    for a, b, label in blocks:
        if swallowed((a, b, label)):
            continue
        items.append(
            event_item(
                kind="jp",
                name=label,
                start=a,
                end=b,
                category="祝日・連休",
                source=JP_PAGE,
                country="日本",
            )
        )
    for a, b, label, note in covered:
        if not overlaps(a, b, start, end):
            continue
        items.append(
            event_item(
                kind="jp",
                name=label,
                start=a,
                end=b,
                category="祝日・連休",
                source=JP_PAGE,
                country="日本",
                note=note,
            )
        )
    return items


def named_weekends(
    holidays: list[tuple[date, str]],
    names: dict[str, str],
    start: date,
    end: date,
    country: str,
    source: str,
    kind: str,
    status: str = "",
) -> list[dict]:
    mapped = [(day, names[en]) for day, en in holidays if en in names]
    # Same Japanese label on disconnected dates must stay separate.
    # long_weekends keys only by date, so the label can be shared.
    by_label: dict[str, list[tuple[date, str]]] = {}
    for day, label in mapped:
        by_label.setdefault(label, []).append((day, label))
    items = []
    for label, rows in by_label.items():
        for a, b, _block_label in long_weekends(rows, start, end):
            # long_weekends appends のある3連休. Prefer the short festival name
            # when every holiday in the block shares that name.
            src = source.format(year=a.year) if "{year}" in source else source
            items.append(
                event_item(
                    kind=kind,
                    name=label,
                    start=a,
                    end=b,
                    category="祝日・連休",
                    source=src,
                    country=country,
                    status=status,
                )
            )
    return items


def expanded_events(
    holidays: list[tuple[date, str]],
    expansions: dict[str, tuple[str, int, int, int | None, int | None]],
    start: date,
    end: date,
    country: str,
    source: str,
    kind: str,
) -> tuple[list[dict], set[date]]:
    items = []
    used: set[date] = set()
    for day, en in holidays:
        if en not in expansions:
            continue
        label, before, after, month, day_num = expansions[en]
        if month is not None and (day.month, day.day) != (month, day_num):
            continue
        a = day + timedelta(days=before)
        b = day + timedelta(days=after)
        used.add(day)
        if overlaps(a, b, start, end):
            src = source.format(year=day.year) if "{year}" in source else source
            items.append(
                event_item(
                    kind=kind,
                    name=label,
                    start=a,
                    end=b,
                    category="祝日・連休",
                    source=src,
                    country=country,
                    status="予定",
                    note="連休の長さは例年の日数です。その年の正式発表前です。",
                )
            )
    return items, used


def parse_hk(page: str, year: int) -> list[tuple[date, str]]:
    rows = re.findall(
        r'<td class="desc"[^>]*>(.*?)</td>\s*<td class="date"[^>]*>(.*?)</td>',
        page,
        re.S | re.I,
    )
    found = []
    for raw_name, raw_date in rows:
        name = re.sub(r"<[^>]+>", " ", html.unescape(raw_name))
        name = re.sub(r"\s+", " ", name).strip()
        date_text = re.sub(r"<[^>]+>", " ", html.unescape(raw_date))
        date_text = re.sub(r"\s+", " ", date_text).strip().lower()
        match = re.search(r"(\d{1,2})\s+([a-z]+)", date_text)
        if not match:
            continue
        month = HK_MONTHS.get(match.group(2))
        if not month:
            continue
        label = hk_label(name)
        if not label:
            continue
        found.append((date(year, month, int(match.group(1))), label))
    return found


def hk_label(name: str) -> str:
    text = name.lower()
    if "lunar new year" in text:
        return "旧正月"
    if "christmas" in text or "boxing" in text:
        return "クリスマス"
    if "easter" in text or "good friday" in text:
        return "イースター"
    if "national day" in text:
        return "国慶日"
    if "chung yeung" in text:
        return "重陽節"
    if "first day of january" in text or text in {"new year", "new year's day"}:
        return "新年"
    return ""


def classify_show(name: str, hint: str = "") -> str:
    text = f"{name} {hint}"
    if LEAGUE_RE.search(text):
        return ""
    if SPORTS_RE.search(text) or "野球" in hint or "スポーツ" in hint:
        return "スポーツ"
    if SHOW_RE.search(text):
        return "展示会"
    if FEST_RE.search(text):
        return "祭り"
    return "コンサート"


def parse_tokyo_dome(page: str, year: int, month: int) -> list[dict]:
    items = []
    for chunk in page.split('<li class="m-link-event__item">')[1:]:
        title = re.search(r'm-link-event__titleText">(.*?)</span>', chunk, re.S)
        if not title:
            continue
        name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", title.group(1)))).strip()
        if not name:
            continue
        day_match = re.search(r'm-link-event__dateText">\s*(\d{1,2})月(\d{1,2})日', chunk)
        if not day_match:
            continue
        m = int(day_match.group(1))
        d = int(day_match.group(2))
        if m != month:
            continue
        href = re.search(r'm-link-event__title" href="([^"]+)"', chunk)
        url = href.group(1) if href else TOKYO_DOME.format(ym=f"{year:04d}-{month:02d}")
        if url.startswith("/"):
            url = "https://www.tokyo-dome.co.jp" + url
        category = classify_show(name)
        if not category:
            continue
        when = date(year, month, d)
        items.append(
            {
                "date": when,
                "name": name,
                "url": url,
                "category": category,
                "venue": "東京ドーム",
                "prefecture": "東京都",
            }
        )
    return items


def parse_kyocera(page: str) -> list[dict]:
    items = []
    for chunk in re.split(r'<section class="event-box', page)[1:]:
        ident = re.search(r'id="event(\d{4}-\d{2}-\d{2})"', chunk)
        title = re.search(r"<h2>\s*<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", chunk, re.S)
        if not ident or not title:
            continue
        name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", title.group(2)))).strip()
        if not name:
            continue
        hint = ""
        span = re.search(r"</h2>\s*<span>(.*?)</span>", chunk, re.S)
        if span:
            hint = re.sub(r"<[^>]+>", "", span.group(1))
        category = classify_show(name, hint)
        if not category:
            continue
        url = html.unescape(title.group(1))
        if url.startswith("/"):
            url = "https://www.kyoceradome-osaka.jp" + url
        items.append(
            {
                "date": date.fromisoformat(ident.group(1)),
                "name": name,
                "url": url,
                "category": category,
                "venue": "京セラドーム大阪",
                "prefecture": "大阪府",
            }
        )
    return items


def merge_runs(rows: list[dict]) -> list[dict]:
    rows = sorted(rows, key=lambda r: (r["venue"], r["name"], r["date"]))
    merged: list[dict] = []
    for row in rows:
        if (
            merged
            and merged[-1]["name"] == row["name"]
            and merged[-1]["venue"] == row["venue"]
            and row["date"] <= merged[-1]["end"] + timedelta(days=1)
        ):
            merged[-1]["end"] = row["date"]
            continue
        merged.append({**row, "end": row["date"]})
    items = []
    for row in merged:
        items.append(
            event_item(
                kind="dome",
                name=row["name"],
                start=row["date"],
                end=row["end"],
                category=row["category"],
                source=row["url"],
                prefecture=row["prefecture"],
                venue=row["venue"],
                scale="ドーム",
            )
        )
    return items


def tokyo_months(page: str) -> list[str]:
    found = re.findall(r'<option[^>]*value="(\d{4}-\d{2})"', page)
    seen = []
    for ym in found:
        if ym not in seen:
            seen.append(ym)
    return seen


def strip_html(value: str) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"投稿 .+に最初に表示されました。?", "", text).strip()
    text = re.sub(r"\s*The post .+? first appeared on .+$", "", text, flags=re.I).strip()
    text = re.sub(r"\[\s*…\s*\]|\[\s*\.\.\.\s*\]", "", text).strip()
    if len(text) > 320:
        text = text[:320].rstrip() + "…"
    return text


def theme_of(title: str, body: str, feed: str) -> tuple[str, str, str]:
    text = f"{title}\n{body}"
    if OPENING_RE.search(text) and not FLIGHT_RE.search(title):
        return "openings", "新規開業ホテル", "🏨 ホテル"
    if FLIGHT_RE.search(text):
        return "flights", "新規フライト情報", "✈️ 国際線"
    if feed == "ota" or OTA_RE.search(text):
        return "overseas", "海外OTA", "🌐 海外OTA"
    return "domestic", "旅行業界", "旅行業界"


def host_label(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def parse_rss(xml_text: str, feed_label: str, feed: str, limit: int = 12) -> list[dict]:
    root = ET.fromstring(xml_text)
    items = []
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] != "item":
            continue
        fields: dict[str, str] = {}
        for child in list(node):
            key = child.tag.rsplit("}", 1)[-1]
            if key not in fields and child.text:
                fields[key] = child.text.strip()
            elif key == "encoded" and child.text and "description" not in fields:
                fields["description"] = child.text.strip()
        title = re.sub(r"\s+", " ", html.unescape(fields.get("title") or "")).strip()
        link = (fields.get("link") or "").strip()
        if not title or not link.startswith("http"):
            continue
        try:
            published = parsedate_to_datetime(fields.get("pubDate") or "")
        except (TypeError, ValueError, IndexError):
            continue
        if published.tzinfo is None:
            published = published.replace(tzinfo=JST)
        day = published.astimezone(JST).date()
        body = strip_html(fields.get("description") or "")
        theme, theme_label, category = theme_of(title, body, feed)
        companies = theme in {"overseas", "domestic"} and bool(COMPANY_RE.search(f"{title}\n{body}"))
        if theme == "overseas":
            companies = True
        items.append(
            {
                "id": "news-" + slug(link),
                "date": day.isoformat(),
                "dateLabel": f"{day.month}/{day.day}（{WEEKDAYS[day.weekday()]}）",
                "weekday": WEEKDAYS[day.weekday()],
                "feed": feed,
                "feedLabel": feed_label,
                "category": category,
                "categoryLabel": category,
                "theme": theme,
                "themeLabel": theme_label,
                "highlight": False,
                "headline": title,
                "body": body,
                "note": "",
                "noteLabel": "",
                "sources": [{"url": link, "label": host_label(link)}],
                "companies": companies,
            }
        )
        if len(items) >= limit:
            break
    return items


def dedupe_news(items: list[dict], today: date, keep_days: int = 21, maximum: int = 60) -> list[dict]:
    fresh_after = today - timedelta(days=keep_days)
    recent = [it for it in items if date.fromisoformat(it["date"]) >= fresh_after]
    relevant = [it for it in recent if KEEP_RE.search(it["headline"])]
    pool = relevant if len(relevant) >= 8 else recent
    seen_url = set()
    seen_title = set()
    chosen = []
    for item in sorted(pool, key=lambda it: (it["date"], it["headline"]), reverse=True):
        url = item["sources"][0]["url"].split("?")[0].rstrip("/")
        title = unicodedata.normalize("NFKC", item["headline"]).casefold()
        if url in seen_url or title in seen_title:
            continue
        seen_url.add(url)
        seen_title.add(title)
        chosen.append(item)
        if len(chosen) >= maximum:
            break
    return chosen


def nager_holidays(payload: list[dict], keep_names: set[str] | None = None) -> list[tuple[date, str]]:
    rows = []
    for row in payload:
        types = row.get("types") or []
        if types and "Public" not in types:
            continue
        name = row.get("name") or ""
        # England-only bank holidays are still the ones that move outbound demand.
        if row.get("global") is False and not (keep_names and name in keep_names):
            continue
        rows.append((date.fromisoformat(row["date"]), name))
    return rows


def safe_fetch(url: str, warnings: list[str], label: str) -> bytes | None:
    try:
        return fetch(url)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        warnings.append(f"{label}を取得できませんでした")
        print(f"warn {label}: {exc}", file=sys.stderr)
        return None


def taiwan_fallback(items: list[dict], start: date, end: date) -> list[dict]:
    """Taiwan is not in the Nager.Date country list. Approximate the three
    travel peaks the calendar cares about, and mark them as provisional."""
    extra = []
    spring = next((it for it in items if it["source_country"] == "中国" and it["name"] == "春節"), None)
    if spring:
        extra.append(
            event_item(
                kind="tw",
                name="春節",
                start=date.fromisoformat(spring["date_start"]),
                end=date.fromisoformat(spring["date_end"]),
                category="祝日・連休",
                source="https://www.dgpa.gov.tw/",
                country="台湾",
                status="予定",
                note="台湾の休日表は自動取得できないため、春節は旧正月の日付に合わせています。",
            )
        )
    holidays: list[tuple[date, str]] = []
    for year in years_in(start, end):
        holidays.append((date(year, 1, 1), "New Year's Day"))
        national = date(year, 10, 10)
        holidays.append((national, "National Day"))
        if national.weekday() == 6:
            holidays.append((national + timedelta(days=1), "National Day"))
    extra.extend(
        named_weekends(
            holidays,
            {key: value for key, value in TW_NAMES.items() if key != "Chinese New Year (Spring Festival)"},
            start,
            end,
            "台湾",
            "https://www.dgpa.gov.tw/",
            "tw",
            status="予定",
        )
    )
    return extra


def collect_events(start: date, end: date, warnings: list[str]) -> list[dict]:
    items: list[dict] = []
    raw = safe_fetch(JP_CSV, warnings, "内閣府の祝日")
    if raw:
        items.extend(japan_events(parse_jp_csv(raw.decode("cp932")), start, end))

    hk_rows: list[tuple[date, str]] = []
    for year in years_in(start, end):
        page = safe_fetch(HK_PAGE.format(year=year), warnings, f"香港政府の休日（{year}）")
        if page:
            hk_rows.extend(parse_hk(page.decode("utf-8", "replace"), year))
        time.sleep(0.2)
    if hk_rows:
        # Labels are already Japanese. Feed them through as the English key.
        identity = {label: label for _day, label in hk_rows}
        items.extend(
            named_weekends(
                [(day, label) for day, label in hk_rows],
                identity,
                start,
                end,
                "香港",
                HK_PAGE,
                "hk",
            )
        )

    def load_nager(country: str, label: str, keep_names: set[str] | None = None) -> list[tuple[date, str]]:
        rows: list[tuple[date, str]] = []
        for year in years_in(start, end):
            raw_year = safe_fetch(NAGER.format(year=year, country=country), warnings, f"{label}（{year}）")
            if raw_year is not None and not raw_year.strip():
                # 204 No Content. Taiwan is not in this API; the caller fills that gap.
                if country != "TW":
                    warnings.append(f"{label}（{year}）は公開されていません")
                continue
            if not raw_year:
                continue
            try:
                rows.extend(nager_holidays(json.loads(raw_year.decode("utf-8")), keep_names))
            except json.JSONDecodeError:
                warnings.append(f"{label}（{year}）の形式を読めませんでした")
            time.sleep(0.2)
        return rows

    cn = load_nager("CN", "中国の祝日")
    if cn:
        expanded, _used = expanded_events(
            cn,
            CN_EXPAND,
            start,
            end,
            "中国",
            nager_template("CN"),
            "cn",
        )
        items.extend(expanded)
    kr = load_nager("KR", "韓国の祝日")
    if kr:
        items.extend(
            named_weekends(kr, KR_NAMES, start, end, "韓国", nager_template("KR"), "kr")
        )
    tw = load_nager("TW", "台湾の祝日")
    if tw:
        expanded, used_days = expanded_events(
            tw,
            {"Chinese New Year (Spring Festival)": CN_EXPAND["Chinese New Year (Spring Festival)"]},
            start,
            end,
            "台湾",
            nager_template("TW"),
            "tw",
        )
        items.extend(expanded)
        rest = [(day, name) for day, name in tw if day not in used_days and name != "Chinese New Year (Spring Festival)"]
        items.extend(
            named_weekends(
                rest,
                {key: value for key, value in TW_NAMES.items() if key != "Chinese New Year (Spring Festival)"},
                start,
                end,
                "台湾",
                nager_template("TW"),
                "tw",
            )
        )
    if not tw:
        items.extend(taiwan_fallback(items, start, end))
    gb = load_nager("GB", "英国の祝日", set(GB_NAMES))
    if gb:
        items.extend(
            named_weekends(gb, GB_NAMES, start, end, "欧米", nager_template("GB"), "gb")
        )

    for year in years_in(start, end):
        a, b = date(year, 4, 13), date(year, 4, 15)
        if overlaps(a, b, start, end):
            items.append(
                event_item(
                    kind="th",
                    name="ソンクラーン",
                    start=a,
                    end=b,
                    category="祝日・連休",
                    source="https://www.thaigov.go.th/",
                    country="タイ",
                    status="予定",
                    note="例年4月13日から15日です。その年の正式発表は別途確認してください。",
                )
            )

    shows: list[dict] = []
    landing_ym = f"{start.year:04d}-{start.month:02d}"
    landing = safe_fetch(TOKYO_DOME.format(ym=landing_ym), warnings, "東京ドーム")
    months = tokyo_months(landing.decode("utf-8", "replace")) if landing else []
    if landing_ym not in months:
        months.insert(0, landing_ym)
    seen_months: set[str] = set()
    for ym in months:
        if ym in seen_months:
            continue
        seen_months.add(ym)
        year_s, month_s = ym.split("-")
        if ym == landing_ym and landing is not None:
            page: bytes | None = landing
            landing = None
        else:
            page = safe_fetch(TOKYO_DOME.format(ym=ym), warnings, f"東京ドーム {ym}")
            time.sleep(0.25)
        if page:
            shows.extend(parse_tokyo_dome(page.decode("utf-8", "replace"), int(year_s), int(month_s)))

    empty_kyocera = 0
    cursor = start
    for _ in range(8):
        url = KYOCERA.format(year=cursor.year, month=cursor.month)
        page = safe_fetch(url, warnings, f"京セラドーム {cursor.year}-{cursor.month:02d}")
        found = parse_kyocera(page.decode("utf-8", "replace")) if page else []
        shows.extend(found)
        empty_kyocera = empty_kyocera + 1 if not found else 0
        if empty_kyocera >= 2:
            break
        year = cursor.year + (1 if cursor.month == 12 else 0)
        month = 1 if cursor.month == 12 else cursor.month + 1
        cursor = date(year, month, 1)
        time.sleep(0.25)

    items.extend(merge_runs(shows))
    items = clip_items(items, start, end)
    items.sort(key=lambda it: (it["date_start"], it["category"], it["name"]))
    # Drop duplicate ids if two sources describe the same span and name.
    uniq = []
    seen = set()
    for item in items:
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        uniq.append(item)
    return uniq


def collect_news(today: date, warnings: list[str]) -> list[dict]:
    found: list[dict] = []
    for label, feed, url in FEEDS:
        raw = safe_fetch(url, warnings, label)
        if not raw:
            continue
        try:
            found.extend(parse_rss(raw.decode("utf-8", "replace"), label, feed))
        except ET.ParseError:
            warnings.append(f"{label}のRSSを読めませんでした")
        time.sleep(0.2)
    return dedupe_news(found, today)


def build(today: date | None = None) -> dict:
    today = today or today_jst()
    start, end = window_for(today)
    warnings: list[str] = []
    events = collect_events(start, end, warnings)
    news = collect_news(today, warnings)
    return {
        "updated": today.isoformat(),
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "warnings": warnings,
        "events": {
            "updated": today.isoformat(),
            "note": "ドームの公演・試合と、日本および主な訪日市場の連休です。",
            "items": events,
        },
        "news": {
            "updated": today.isoformat(),
            "note": "旅行・航空・OTAの公開RSSです。手書きの実務メモはありません。",
            "filters": [
                {"id": "all", "label": "すべて"},
                {"id": "openings", "label": "新規開業ホテル"},
                {"id": "flights", "label": "新規フライト情報"},
            ],
            "items": news,
        },
    }


def main() -> int:
    document = build()
    if not document["events"]["items"] and not document["news"]["items"]:
        print("出典からイベントもニュースも取得できませんでした。既存のファイルは残します。", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(OUT)
    print(
        f"wrote {OUT} events={len(document['events']['items'])} "
        f"news={len(document['news']['items'])} warnings={len(document['warnings'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
