#!/usr/bin/env python3
"""Offline checks for the briefing collector. No network."""

from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_briefing as cb


JP_CSV = """国民の祝日・休日月日,国民の祝日・休日名称
2026/11/3,文化の日
2026/11/23,勤労感謝の日
2027/1/1,元日
2027/1/11,成人の日
2027/3/21,春分の日
2027/3/22,休日
2027/4/29,昭和の日
2027/5/3,憲法記念日
2027/5/4,みどりの日
2027/5/5,こどもの日
2027/7/19,海の日
2027/8/11,山の日
2027/9/20,敬老の日
2027/9/23,秋分の日
2027/10/11,スポーツの日
"""

TOKYO = """
<li class="m-link-event__item">
  <span class="m-link-event__dateText">11月6日（金）</span>
  <a class="m-link-event__title" href="https://example.com/sk">
    <span class="m-link-event__titleText">Stray Kids</span>
  </a>
</li>
<li class="m-link-event__item">
  <span class="m-link-event__dateText">11月7日（土）</span>
  <a class="m-link-event__title" href="https://example.com/sk">
    <span class="m-link-event__titleText">Stray Kids</span>
  </a>
</li>
<li class="m-link-event__item">
  <span class="m-link-event__dateText">11月9日（月）</span>
  <a class="m-link-event__title" href="/dome/event/1">
    <span class="m-link-event__titleText">読売ジャイアンツ 対 阪神</span>
  </a>
</li>
<li class="m-link-event__item">
  <span class="m-link-event__dateText">12月1日（火）</span>
  <a class="m-link-event__title" href="https://example.com/other">
    <span class="m-link-event__titleText">別の月</span>
  </a>
</li>
"""

KYOCERA = """
<section class="event-box " id="event2026-11-01">
  <h2><a href="https://example.com/baseball">第51回社会人野球日本選手権大会</a></h2><span>野球</span>
</section>
<section class="event-box " id="event2026-11-02">
  <h2><a href="https://example.com/baseball">第51回社会人野球日本選手権大会</a></h2><span>野球</span>
</section>
"""

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>エミレーツ航空、ホーチミン線を増便</title>
  <link>https://www.traicy.com/posts/1/</link>
  <pubDate>Sun, 01 Nov 2026 00:15:57 +0000</pubDate>
  <description><![CDATA[<p>11月1日から1日1往復を追加する。</p>]]></description>
</item>
<item>
  <title>同じ記事</title>
  <link>https://www.traicy.com/posts/1/?utm=1</link>
  <pubDate>Sun, 01 Nov 2026 01:00:00 +0000</pubDate>
  <description><![CDATA[<p>重複</p>]]></description>
</item>
</channel></rss>
"""

HK = """
<tr><td class="desc">Lunar New Year&rsquo;s Day</td><td class="date">6 February</td><td>Saturday</td></tr>
<tr><td class="desc">The third day of Lunar New Year</td><td class="date">8 February</td><td>Monday</td></tr>
<tr><td class="desc">The fourth day of Lunar New Year</td><td class="date">9 February</td><td>Tuesday</td></tr>
<tr><td class="desc">National Day</td><td class="date">1 October</td><td>Friday</td></tr>
"""


class CollectorTest(unittest.TestCase):
    def test_japan_travel_peaks(self):
        rows = cb.parse_jp_csv(JP_CSV)
        items = cb.japan_events(rows, date(2026, 11, 1), date(2027, 10, 31))
        by_name = {item["name"]: (item["date_start"], item["date_end"]) for item in items}
        self.assertEqual(by_name["勤労感謝の日のある3連休"], ("2026-11-21", "2026-11-23"))
        self.assertNotIn("文化の日のある3連休", by_name)
        self.assertEqual(by_name["年末年始"], ("2026-12-29", "2027-01-03"))
        self.assertEqual(by_name["成人の日のある3連休"], ("2027-01-09", "2027-01-11"))
        self.assertEqual(by_name["春分の日のある3連休"], ("2027-03-20", "2027-03-22"))
        self.assertEqual(by_name["ゴールデンウィーク"], ("2027-04-29", "2027-05-05"))
        self.assertEqual(by_name["海の日のある3連休"], ("2027-07-17", "2027-07-19"))
        self.assertEqual(by_name["お盆"], ("2027-08-13", "2027-08-16"))
        self.assertEqual(by_name["敬老の日のある3連休"], ("2027-09-18", "2027-09-20"))
        self.assertEqual(by_name["スポーツの日のある3連休"], ("2027-10-09", "2027-10-11"))
        self.assertTrue(all(item["source"].startswith("https://www8.cao.go.jp/") for item in items))
        self.assertTrue(all(item["category"] == "祝日・連休" for item in items))

    def test_china_spring_festival_uses_customary_length(self):
        holidays = [(date(2027, 2, 6), "Chinese New Year (Spring Festival)"), (date(2027, 5, 1), "Labour Day")]
        items, used = cb.expanded_events(
            holidays, cb.CN_EXPAND, date(2026, 11, 1), date(2027, 10, 31), "中国", "https://date.nager.at/", "cn"
        )
        by_name = {item["name"]: item for item in items}
        self.assertEqual(by_name["春節"]["date_start"], "2027-02-05")
        self.assertEqual(by_name["春節"]["date_end"], "2027-02-12")
        self.assertEqual(by_name["春節"]["status"], "予定")
        self.assertEqual(by_name["労働節"]["date_end"], "2027-05-05")
        self.assertEqual(used, {date(2027, 2, 6), date(2027, 5, 1)})

    def test_hong_kong_groups_lunar_new_year(self):
        rows = cb.parse_hk(HK, 2027)
        items = cb.named_weekends(
            rows, {label: label for _day, label in rows}, date(2026, 11, 1), date(2027, 10, 31), "香港", "https://www.gov.hk/", "hk"
        )
        lunar = next(item for item in items if item["name"] == "旧正月")
        self.assertEqual((lunar["date_start"], lunar["date_end"]), ("2027-02-06", "2027-02-09"))
        national = next(item for item in items if item["name"] == "国慶日")
        self.assertEqual((national["date_start"], national["date_end"]), ("2027-10-01", "2027-10-03"))

    def test_dome_schedule_merges_and_skips_league_games(self):
        tokyo = cb.parse_tokyo_dome(TOKYO, 2026, 11)
        kyocera = cb.parse_kyocera(KYOCERA)
        merged = cb.merge_runs(tokyo + kyocera)
        names = {(item["name"], item["date_start"], item["date_end"], item["category"]) for item in merged}
        self.assertIn(("Stray Kids", "2026-11-06", "2026-11-07", "コンサート"), names)
        self.assertIn(("第51回社会人野球日本選手権大会", "2026-11-01", "2026-11-02", "スポーツ"), names)
        self.assertFalse(any("ジャイアンツ" in item["name"] for item in merged))
        stray = next(item for item in merged if item["name"] == "Stray Kids")
        self.assertEqual(stray["prefecture"], "東京都")
        self.assertEqual(stray["source"], "https://example.com/sk")

    def test_rss_classifies_flights_and_dedupes(self):
        parsed = cb.parse_rss(RSS, "トラシー", "industry")
        self.assertEqual(parsed[0]["theme"], "flights")
        self.assertEqual(parsed[0]["date"], "2026-11-01")
        self.assertEqual(parsed[0]["weekday"], "日")
        self.assertIn("往復", parsed[0]["body"])
        self.assertNotIn("<p>", parsed[0]["body"])
        kept = cb.dedupe_news(parsed, date(2026, 11, 1))
        self.assertEqual(len(kept), 1)

    def test_taiwan_fallback_when_the_api_has_no_calendar(self):
        spring = {
            "source_country": "中国",
            "name": "春節",
            "date_start": "2027-02-05",
            "date_end": "2027-02-12",
        }
        items = cb.taiwan_fallback([spring], date(2026, 11, 1), date(2027, 10, 31))
        by_name = {item["name"]: item for item in items}
        self.assertEqual(by_name["春節"]["source_country"], "台湾")
        self.assertEqual(by_name["春節"]["status"], "予定")
        self.assertEqual((by_name["中華民国開国記念日"]["date_start"], by_name["中華民国開国記念日"]["date_end"]), ("2027-01-01", "2027-01-03"))
        self.assertEqual((by_name["双十節"]["date_start"], by_name["双十節"]["date_end"]), ("2027-10-09", "2027-10-11"))

    def test_news_filter_drops_unrelated_local_items(self):
        def item(headline, url):
            return {
                "date": "2026-11-01",
                "headline": headline,
                "body": "",
                "sources": [{"url": url, "label": "example.com"}],
            }
        rows = [item(f"ホテル開業 {i}", f"https://example.com/{i}") for i in range(8)]
        rows.append(item("湿原ノロッコ号の最終運転", "https://example.com/local"))
        kept = cb.dedupe_news(rows, date(2026, 11, 1))
        self.assertEqual(len(kept), 8)
        self.assertFalse(any("ノロッコ" in it["headline"] for it in kept))

    def test_failed_collection_would_not_be_empty_success(self):
        self.assertEqual(cb.theme_of("ヒルトンが大阪に開業", "", "industry")[0], "openings")
        self.assertTrue(cb.theme_of("Expediaの手数料", "", "industry")[2].startswith("🌐"))


if __name__ == "__main__":
    unittest.main()
