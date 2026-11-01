/* Event calendar and the inbound-map news summary for the performance dashboard.
   The encrypted page stays as it is. After the password unlocks it, this
   script adds one tab. The calendar reads data/briefing.json on this site.
   The news reads the inbound map's news.json and hotel_openings.json. */
(function () {
  "use strict";

  var COLORS = {
    "コンサート": "#6d28d9",
    "スポーツ": "#0f766e",
    "展示会": "#c2410c",
    "祭り": "#be123c",
    "祝日・連休": "#1d4ed8"
  };
  var WEEK = ["日", "月", "火", "水", "木", "金", "土"];
  var PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];

  if (window.__PD_BRIEF_BOOTED) return;
  window.__PD_BRIEF_BOOTED = true;

  function pageBase() {
    if (window.__PD_BRIEF_BASE) return window.__PD_BRIEF_BASE;
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute("src") || "";
      if (/briefing\.js(?:\?|$)/.test(src)) return src.replace(/briefing\.js(?:\?.*)?$/, "");
    }
    var path = location.pathname;
    if (/\/$/.test(path)) return path;
    if (/\.[a-z0-9]+$/i.test(path)) return path.replace(/[^/]*$/, "");
    return path + "/";
  }
  var base = pageBase();
  if (!window.__PD_MENU_SWIPE) {
    var swipe = document.createElement("script");
    swipe.src = base + "menu-swipe.js";
    (document.body || document.documentElement).appendChild(swipe);
  }
  var dataUrl = window.__PD_BRIEF_URL || (base + "data/briefing.json?v=" + stamp());
  var doc = null;
  var failed = false;
  var month = "";
  var day = 1;
  var pref = "";
  var opened = false;
  var activeClass = "";
  var panel = null;
  var button = null;

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) {
    try {
      var x = new URL(u, location.href);
      if (x.protocol === "http:" || x.protocol === "https:") return x.href;
    } catch (e) {}
    return "";
  }
  function shift(ym, delta) {
    var p = ym.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1 + delta, 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }
  function dim(ym) {
    var p = ym.split("-").map(Number);
    return new Date(p[0], p[1], 0).getDate();
  }
  function iso(ym, d) { return ym + "-" + pad(d); }
  function onDay(it, dayIso) {
    return it.date_start && it.date_start <= dayIso && (it.date_end || it.date_start) >= dayIso;
  }
  function isHol(it) { return it.category === "祝日・連休" || !it.prefecture; }
  function sortEv(a, b) {
    return (isHol(a) ? 0 : 1) - (isHol(b) ? 0 : 1)
      || String(a.date_start || "").localeCompare(String(b.date_start || ""))
      || String(a.name || "").localeCompare(String(b.name || ""), "ja");
  }
  function holLabel(it) {
    var country = it.source_country || "";
    var name = it.name || "祝日・連休";
    return country ? country + "・" + name : name;
  }
  function visible(it) {
    if (isHol(it)) return true;
    return !pref || it.prefecture === pref;
  }

  function findTabs() {
    var nav = document.getElementById("tabs");
    if (nav) {
      return Array.prototype.filter.call(nav.querySelectorAll("button[data-tab]"), function (el) {
        return !el.getAttribute("data-pd-tab");
      });
    }
    var out = [];
    var nodes = document.querySelectorAll("a, button, [role='tab']");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-pd-tab")) continue;
      var blob = "";
      for (var a = 0; a < el.attributes.length; a++) blob += " " + el.attributes[a].value;
      if (/tab=/.test(blob) || el.getAttribute("role") === "tab" || el.hasAttribute("data-tab")) out.push(el);
    }
    return out;
  }

  function detectActiveClass(tabs) {
    var selected = null;
    for (var i = 0; i < tabs.length; i++) {
      var el = tabs[i];
      if (el.getAttribute("aria-selected") === "true" || el.classList.contains("on") || el.classList.contains("active") || el.classList.contains("is-active")) {
        selected = el;
        break;
      }
    }
    if (!selected) return "";
    var classes = selected.className.split(/\s+/);
    for (var c = 0; c < classes.length; c++) {
      var name = classes[c];
      if (!name) continue;
      var shared = false;
      for (var j = 0; j < tabs.length; j++) {
        if (tabs[j] !== selected && tabs[j].classList.contains(name)) shared = true;
      }
      if (!shared) return name;
    }
    return "";
  }

  function sampleColor(el) {
    if (!el) return "";
    var cs = getComputedStyle(el);
    var candidates = [cs.borderBottomColor, cs.backgroundColor, cs.color];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") continue;
      if (c === "rgb(255, 255, 255)" || c === "rgb(0, 0, 0)") continue;
      return c;
    }
    return "";
  }

  function applyChrome() {
    var tabs = findTabs();
    var accent = sampleColor(tabs[0]) || sampleColor(document.querySelector("a, button")) || "#1f4b99";
    panel.style.setProperty("--pd-accent", accent);
    var bg = getComputedStyle(document.body).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") panel.style.setProperty("--pd-bg", bg);
    var font = getComputedStyle(document.body).fontFamily;
    if (font) panel.style.fontFamily = font;
  }

  function ensurePanel() {
    var existing = document.getElementById("pd-briefing");
    if (existing) return existing;
    var el = document.createElement("div");
    el.id = "pd-briefing";
    el.hidden = true;
    el.innerHTML = '<div class="pd-wrap"><div class="pd-head"><div><h1>イベント・ニュース</h1><p class="pd-asof">読み込み中…</p></div></div><p class="pd-warn" hidden></p><div class="pd-cols"><div class="pd-card" id="pd-cal"><h2>イベントカレンダー</h2><p class="pd-empty">読み込み中…</p></div><div id="pd-news"></div></div></div>';
    document.body.appendChild(el);
    return el;
  }

  function ensureTab() {
    var tabs = findTabs();
    if (tabs.length) {
      var bar = tabs[0].parentElement;
      var existing = bar.querySelector("[data-pd-tab='brief']");
      if (!existing) {
        existing = tabs[0].cloneNode(false);
        existing.textContent = "イベント・ニュース";
        existing.className = "";
        existing.removeAttribute("id");
        existing.removeAttribute("href");
        existing.removeAttribute("onclick");
        existing.removeAttribute("data-tab");
        existing.setAttribute("data-pd-tab", "brief");
        existing.setAttribute("type", "button");
        existing.setAttribute("aria-pressed", "false");
        bar.appendChild(existing);
        existing.addEventListener("click", onTabClick);
      }
      syncMobile();
      var fallback = document.getElementById("pd-brief-fallback");
      if (fallback) fallback.remove();
      activeClass = detectActiveClass(tabs);
      return existing;
    }
    var box = document.getElementById("pd-brief-fallback");
    if (!box) {
      box = document.createElement("div");
      box.id = "pd-brief-fallback";
      box.innerHTML = '<button type="button" data-pd-tab="brief" aria-pressed="false">イベント・ニュース</button>';
      document.body.appendChild(box);
      box.querySelector("button").addEventListener("click", onTabClick);
    }
    return box.querySelector("button");
  }

  function syncMobile() {
    var box = document.getElementById("mTabs");
    if (!box || box.querySelector("[data-pd-tab='brief']")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-pd-tab", "brief");
    b.textContent = "イベント・ニュース";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      document.body.classList.remove("mopen");
      openPanel();
    });
    box.appendChild(b);
  }

  function place() {
    if (!panel || !button) return;
    var header = document.querySelector("header");
    var anchor = header || button.closest("header, nav") || button.parentElement;
    if (anchor.id === "pd-brief-fallback") {
      panel.style.top = "56px";
      return;
    }
    var rect = anchor.getBoundingClientRect();
    panel.style.top = Math.max(rect.bottom, 0) + "px";
  }

  function paintTabs(on) {
    var name = activeClass || "active";
    findTabs().forEach(function (tab) { tab.classList.remove(name); });
    document.querySelectorAll("[data-pd-tab='brief']").forEach(function (tab) {
      tab.classList.toggle(name, on);
      tab.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (!on) {
      var current = (location.hash.match(/(?:^#|&)tab=([A-Za-z0-9_-]+)/) || [])[1] || "";
      findTabs().forEach(function (tab) {
        tab.classList.toggle(name, tab.getAttribute("data-tab") === current);
      });
    }
  }

  function openPanel() {
    opened = true;
    panel.hidden = false;
    if (button) button.setAttribute("aria-pressed", "true");
    paintTabs(true);
    place();
  }

  function closePanel() {
    opened = false;
    if (panel) panel.hidden = true;
    if (button) button.setAttribute("aria-pressed", "false");
    paintTabs(false);
  }

  function onTabClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (opened) closePanel();
    else openPanel();
  }

  function failMessage() {
    return '<p class="pd-fail">イベントカレンダーを読み込めませんでした。時間をおいて、もう一度開いてください。</p><button type="button" class="pd-retry">再読み込み</button>';
  }

  function render() {
    var asof = panel.querySelector(".pd-asof");
    var warn = panel.querySelector(".pd-warn");
    var cal = document.getElementById("pd-cal");
    if (!doc) {
      asof.textContent = "読み込めませんでした";
      warn.hidden = true;
      cal.innerHTML = '<h2>イベントカレンダー</h2>' + failMessage();
      cal.querySelectorAll(".pd-retry").forEach(function (b) { b.onclick = load; });
      return;
    }
    asof.textContent = "最終更新日 " + jpDate(doc.updated);
    if (doc.warnings && doc.warnings.length) {
      warn.hidden = false;
      warn.textContent = "一部の出典を取得できませんでした。取得できた内容だけ表示しています。";
    } else warn.hidden = true;
    renderCalendar(cal);
  }

  function jpDate(isoDay) {
    var p = String(isoDay || "").split("-");
    if (p.length < 3) return isoDay || "";
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return p[0] + "年" + Number(p[1]) + "月" + Number(p[2]) + "日（" + WEEK[dt.getDay()] + "）";
  }

  function events() { return (doc.events && doc.events.items) || []; }

  function renderCalendar(root) {
    var items = events().filter(visible);
    var prefs = [];
    events().forEach(function (it) {
      if (it.prefecture && prefs.indexOf(it.prefecture) < 0) prefs.push(it.prefecture);
    });
    prefs.sort(function (a, b) { return PREFS.indexOf(a) - PREFS.indexOf(b); });
    var bounds = monthBounds();
    if (!month) month = initialMonth(bounds);
    if (month < bounds.min) month = bounds.min;
    if (month > bounds.max) month = bounds.max;
    if (day > dim(month)) day = dim(month);
    var parts = month.split("-").map(Number);
    var y = parts[0], m = parts[1];
    var first = new Date(y, m - 1, 1).getDay();
    var html = '<div class="pd-cardhead"><div><h2>イベントカレンダー</h2><p class="pd-sub">ドームの公演・試合と、移動が増える連休</p></div></div>';
    html += '<div class="pd-tools"><button type="button" class="pd-nav" data-dir="-1"' + (month <= bounds.min ? " disabled" : "") + '>‹</button><span class="pd-month">' + esc(y + "年" + m + "月") + '</span><button type="button" class="pd-nav" data-dir="1"' + (month >= bounds.max ? " disabled" : "") + '>›</button>';
    html += '<select class="pd-pref" aria-label="都道府県"><option value="">全国</option>' + prefs.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === pref ? " selected" : "") + ">" + esc(p) + "</option>";
    }).join("") + "</select></div>";
    html += '<div class="pd-legend">' + Object.keys(COLORS).map(function (name) {
      return "<span><i style=\"background:" + COLORS[name] + "\"></i>" + esc(name) + "</span>";
    }).join("") + "</div>";
    html += '<div class="pd-note">祝日・連休は都道府県に関係なく表示します。</div>';
    html += '<div class="pd-cal">';
    WEEK.forEach(function (w, i) {
      html += '<div class="pd-wd' + (i === 0 ? " sun" : i === 6 ? " sat" : "") + '">' + w + "</div>";
    });
    for (var i = 0; i < first; i++) html += '<div class="pd-cell out"></div>';
    for (var d = 1; d <= dim(month); d++) {
      var dayIso = iso(month, d);
      var dow = new Date(y, m - 1, d).getDay();
      var list = items.filter(function (it) { return onDay(it, dayIso); }).sort(sortEv);
      var hols = list.filter(isHol);
      var shows = list.filter(function (it) { return !isHol(it); });
      var shown = shows.slice(0, 2);
      var more = shows.length - shown.length;
      var holHtml = hols.slice(0, 2).map(function (it) {
        var lab = holLabel(it);
        return '<span class="pd-hol" title="' + esc(lab) + '">' + esc(lab) + "</span>";
      }).join("") + (hols.length > 2 ? '<span class="pd-hol">ほか' + (hols.length - 2) + "件</span>" : "");
      var nameHtml = shown.map(function (it) {
        return '<span class="pd-ev" style="background:' + (COLORS[it.category] || "#3e4f6d") + '">' + esc(it.name) + "</span>";
      }).join("") + (more > 0 ? '<span class="pd-more">+' + more + "</span>" : "");
      var extra = shows.length - Math.min(shows.length, 4);
      var dots = shows.slice(0, 4).map(function (it) {
        return '<i class="pd-dot" style="background:' + (COLORS[it.category] || "#3e4f6d") + '"></i>';
      }).join("") + (extra > 0 ? '<span class="pd-count">+' + extra + "</span>" : "");
      html += '<button type="button" class="pd-cell' + (d === day ? " on" : "") + '" data-d="' + d + '"><span class="pd-num' + (dow === 0 ? " sun" : dow === 6 ? " sat" : "") + '">' + d + "</span>" + holHtml + '<span class="pd-names">' + nameHtml + '</span><span class="pd-dots">' + dots + "</span></button>";
    }
    html += "</div>";
    html += dayDetail(items);
    root.innerHTML = html;
    root.querySelectorAll(".pd-nav").forEach(function (b) {
      b.onclick = function () {
        if (b.disabled) return;
        month = shift(month, Number(b.getAttribute("data-dir")));
        render();
      };
    });
    root.querySelector(".pd-pref").onchange = function (e) { pref = e.target.value; render(); };
    root.querySelectorAll(".pd-cell[data-d]").forEach(function (b) {
      b.onclick = function () { day = Number(b.getAttribute("data-d")); render(); };
    });
  }

  function monthBounds() {
    var min = "9999-99", max = "0000-00";
    events().forEach(function (it) {
      var a = String(it.date_start || "").slice(0, 7);
      var b = String(it.date_end || it.date_start || "").slice(0, 7);
      if (a && a < min) min = a;
      if (b && b > max) max = b;
    });
    if (min === "9999-99") {
      var now = new Date();
      min = max = now.getFullYear() + "-" + pad(now.getMonth() + 1);
    }
    return { min: min, max: max };
  }

  function initialMonth(bounds) {
    var now = new Date();
    var cur = now.getFullYear() + "-" + pad(now.getMonth() + 1);
    if (cur < bounds.min) return bounds.min;
    if (cur > bounds.max) return bounds.max;
    day = now.getDate();
    return cur;
  }

  function dayDetail(items) {
    var parts = month.split("-").map(Number);
    var dayIso = iso(month, day);
    var dow = WEEK[new Date(parts[0], parts[1] - 1, day).getDay()];
    var list = items.filter(function (it) { return onDay(it, dayIso); }).sort(sortEv);
    var scope = pref || "全国";
    var body = list.length ? list.map(detailRow).join("") : '<p class="pd-empty">この日のイベントはありません。</p>';
    return '<div class="pd-daybox"><h3>' + parts[0] + "年" + parts[1] + "月" + day + "日（" + dow + "）<span>" + esc(scope) + " · " + list.length + "件</span></h3>" + body + "</div>";
  }

  function detailRow(it) {
    var href = safeUrl(it.source);
    var bits = [];
    if (it.date_start) bits.push(rangeLabel(it.date_start, it.date_end));
    if (it.prefecture) bits.push(it.prefecture);
    if (it.venue) bits.push(it.venue);
    if (it.source_country) bits.push(it.source_country);
    if (it.note) bits.push(it.note);
    var plan = it.status === "予定" ? '<span class="pd-plan">予定</span>' : "";
    var link = href ? ' <a href="' + esc(href) + '" target="_blank" rel="noopener">出典</a>' : "";
    return '<div class="pd-row"><span class="pd-tag" style="background:' + (COLORS[it.category] || "#3e4f6d") + '">' + esc(it.category || "") + "</span>" + plan + " <b>" + esc(it.name) + "</b>" + link + '<span class="pd-meta">' + esc(bits.join(" · ")) + "</span></div>";
  }

  function rangeLabel(a, b) {
    b = b || a;
    function p(s) { var x = s.split("-"); return { m: Number(x[1]), d: Number(x[2]) }; }
    var A = p(a), B = p(b);
    if (a === b) return A.m + "/" + A.d;
    return A.m + "/" + A.d + "–" + B.m + "/" + B.d;
  }

  /* News summary. Same items and rules as the inbound map's ニュースまとめ.
     The map publishes news.json and hotel_openings.json on GitHub Pages
     (access-control-allow-origin: *). A minute stamp plus no-store keeps a
     reload from showing yesterday's copy; the Pages edge cache is about 10 minutes. */
  function startNews(root) {
    if (!root || root.getAttribute("data-ready")) return;
    root.setAttribute("data-ready", "1");
    root.innerHTML = '<div class="nw-top"><div class="nw-title"><h2>ニュースまとめ</h2><p class="nw-meta" id="pdNwMeta">読み込み中…</p></div><button type="button" class="nw-filt" id="pdNwFilt" aria-expanded="false">絞り込み</button><div class="nw-tools" id="pdNwTools"><input id="pdNwQ" type="search" placeholder="キーワードで検索（見出し・本文・メモ・出典）" autocomplete="off" enterkeyhint="search"><select id="pdNwMonth" class="nw-month" aria-label="期間"><option value="all">すべての期間</option></select><button type="button" class="nw-co" id="pdNwCo" aria-pressed="false">他旅行会社動向</button><button type="button" class="nw-clear" id="pdNwClear" hidden>解除</button><p id="pdNwCount" class="nw-count" aria-live="polite"></p><button type="button" class="nw-all" id="pdNwToggle">すべて開く</button></div><div id="pdNwChips" class="nw-chips"></div><p class="nw-legend"><span class="up">▲+</span> は増加、<span class="dn">▼</span> は減少。出典は新しいタブで開きます。</p></div><div class="nw-scroll" id="pdNwScroll"><div id="pdHo" class="ho" hidden><div class="ho-card"><h2>全国の新規開業ホテル<small>2026年10月以降</small></h2><p class="ho-asof" id="pdHoAsof"></p><p class="ho-count" id="pdHoCount" aria-live="polite"></p><p class="ho-note">カテゴリは当サイトの独自分類で、公式の格付けではありません。</p><div class="ho-filters"><input id="pdHoQ" type="search" placeholder="ホテル名・ブランド・運営・エリア" autocomplete="off" enterkeyhint="search"><select id="pdHoPref" aria-label="都道府県"></select><select id="pdHoMonth" aria-label="開業年月"></select><select id="pdHoStatus" aria-label="ステータス"></select><select id="pdHoCat" aria-label="カテゴリ"></select><select id="pdHoSort" aria-label="並び順"></select></div><div id="pdHoList"></div></div></div><div id="pdNwBody" class="nw-wrap"></div></div>';

    var meta = document.getElementById("pdNwMeta");
    var chips = document.getElementById("pdNwChips");
    var body = document.getElementById("pdNwBody");
    var countEl = document.getElementById("pdNwCount");
    var toggle = document.getElementById("pdNwToggle");
    var input = document.getElementById("pdNwQ");
    var monthSel = document.getElementById("pdNwMonth");
    var coBtn = document.getElementById("pdNwCo");
    var clearBtn = document.getElementById("pdNwClear");
    var hoPanel = document.getElementById("pdHo");
    var hoAsof = document.getElementById("pdHoAsof");
    var hoCount = document.getElementById("pdHoCount");
    var hoList = document.getElementById("pdHoList");
    var hoQ = document.getElementById("pdHoQ");
    var hoPref = document.getElementById("pdHoPref");
    var hoMonth = document.getElementById("pdHoMonth");
    var hoStatus = document.getElementById("pdHoStatus");
    var hoCat = document.getElementById("pdHoCat");
    var hoSortEl = document.getElementById("pdHoSort");
    var filtBtn = document.getElementById("pdNwFilt");

    var data = null, loading = false, failed = false, filter = "all", query = "", companies = false, nwMonthV = "all";
    var openDates = new Set(), openItems = new Set();
    var hotels = null, hoLoading = false, hoFailed = false, hoQuery = "", hoPrefV = "all", hoMonthV = "all", hoStatusV = "all", hoCatV = "all", hoSort = "date", hoDir = 1, hoReady = false;
    var REGIONS = [["北海道",["北海道"]],["東北",["青森県","岩手県","宮城県","秋田県","山形県","福島県"]],["関東",["茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県"]],["中部",["新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県"]],["近畿",["滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県"]],["中国",["鳥取県","島根県","岡山県","広島県","山口県"]],["四国",["徳島県","香川県","愛媛県","高知県"]],["九州・沖縄",["福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]]];
    var PREF_ORDER = [];
    var REGION_OF = {};
    REGIONS.forEach(function (pair) {
      pair[1].forEach(function (p) { PREF_ORDER.push(p); REGION_OF[p] = pair[0]; });
    });
    var COMPANY_RE = /(?:じゃらん|楽天トラベル|楽天スーパー|楽天「|一休|Relux|(?<![A-Za-z0-9])JTB(?![A-Za-z0-9])|(?<![A-Za-z])HIS(?![A-Za-z])|エイチ・アイ・エス|(?<![A-Za-z])KNT(?![A-Za-z])|近畿日本ツーリスト|近ツー|(?<!訪日)日本旅行(?!料金|者|業)|エアトリ|skyticket|スカイチケット|阪急交通社|阪急トラベル|東武トップツアーズ|クラブツーリズム|農協観光|名鉄観光|読売旅行|ビッグホリデー|旅工房|はとバス|ジャルパック|(?<![A-Za-z])JALPAK(?![A-Za-z])|ミキ・ツーリスト|Miki\s*Travel|ランドオペレータ(?:ー)?|ホールセラー|ホールセール|ベッドバンク|[Bb]edbank|Hotelbeds|(?<![A-Za-z])HBX(?![A-Za-z])|Web[Bb]eds|Rate[Hh]awk|Emerging Travel|(?<![A-Za-z])ETG(?![A-Za-z])|(?<![A-Za-z])TAAP(?![A-Za-z])|Bedsonline|Cloudbeds|Virtuoso|(?<![A-Za-z])B2B(?![A-Za-z])|Expedia|エクスペディア|(?<![A-Za-z])Vrbo(?![A-Za-z])|Booking|Agoda|Trip\.com|トリップドットコム|Airbnb|エアビー|Klook|KKday|Veltra|ベルトラ|Viator|Tiqets|GetYourGuide|Traveloka|MakeMyTrip|(?<![A-Za-z])Ctrip(?![A-Za-z])|携程|Fliggy|サイトコントローラ(?:ー)?|(?<![A-Za-z])Dida(?![A-Za-z])|SiteMinder|DerbySoft|手間いらず|ねっぱん|TL-Lincoln|大手旅行会社|旅行会社)/;
    var FLIGHT_TAGS = ["新規", "増便", "再開", "減便", "運休", "変更"];

    function mapFile(name) {
      var origin = window.__PD_NEWS_BASE || "https://100nao.github.io/inboud-map/";
      if (origin.charAt(origin.length - 1) !== "/") origin += "/";
      var d = new Date();
      var v = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes());
      return origin + name + "?v=" + v;
    }
    function colorize(s) {
      return esc(s).replace(/▲\s*[+＋]/g, '<span class="up">▲+</span>').replace(/▼/g, '<span class="dn">▼</span>');
    }
    function rich(s) {
      var out = [], lis = [];
      function flush() {
        if (!lis.length) return;
        out.push("<ul>" + lis.map(function (t) { return "<li>" + colorize(t) + "</li>"; }).join("") + "</ul>");
        lis = [];
      }
      String(s || "").split("\n").forEach(function (line) {
        var t = line.trim();
        if (!t) { flush(); return; }
        var b = t.match(/^[・•●]\s*(.*)$/);
        if (b) lis.push(b[1]);
        else { flush(); out.push("<p>" + colorize(t) + "</p>"); }
      });
      flush();
      return out.join("");
    }
    function fmtDate(iso, wd) {
      var p = String(iso || "").split("-");
      if (p.length < 3) return iso || "";
      return p[0] + "年" + Number(p[1]) + "月" + Number(p[2]) + "日" + (wd ? "（" + wd + "）" : "");
    }
    function words() { return query.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean); }
    function angleNote(it) { return !!(it && it.noteLabel === "話題の切り口"); }
    function hit(it) {
      var ws = words();
      if (!ws.length) return true;
      var hide = angleNote(it);
      var blob = [it.headline, it.body, hide ? "" : it.note, it.category, it.categoryLabel, it.theme, it.themeLabel, it.feedLabel, hide ? "" : it.noteLabel].concat((it.sources || []).reduce(function (a, s) { a.push(s.label, s.url); return a; }, [])).join("\n").normalize("NFKC").toLowerCase();
      return ws.every(function (w) { return blob.indexOf(w) >= 0; });
    }
    function isCompany(it) {
      if (typeof it.companies === "boolean") return it.companies;
      if (it.theme === "overseas" || it.theme === "domestic") return true;
      var text = [it.headline, it.category, it.categoryLabel].join("\n").normalize("NFKC");
      if (COMPANY_RE.test(text)) return true;
      var lead = String(it.body || "").normalize("NFKC").replace(/^[\s・　]+/, "").split(/[\n。]/)[0].trim();
      var m = lead.match(COMPANY_RE);
      return !!(m && m.index <= 2);
    }
    function inMonth(it) { return nwMonthV === "all" || String(it.date || "").slice(0, 7) === nwMonthV; }
    function passes(it, theme) {
      var id = theme == null ? filter : theme;
      if (id === "all") { if (it.theme === "flights") return false; }
      else if (it.theme !== id) return false;
      if (companies && !isCompany(it)) return false;
      if (!inMonth(it)) return false;
      return hit(it);
    }
    function visibleGroups() {
      if (!data) return [];
      var map = new Map();
      data.items.forEach(function (it) {
        if (!passes(it)) return;
        if (!map.has(it.date)) map.set(it.date, { date: it.date, weekday: it.weekday, items: [] });
        map.get(it.date).items.push(it);
      });
      return Array.from(map.values());
    }
    function visibleItems() { return visibleGroups().reduce(function (a, g) { return a.concat(g.items); }, []); }
    function retarget() {
      if (nwMonthV !== "all") { openItems = new Set(); return; }
      var groups = visibleGroups();
      if (filter === "all" && !words().length && !companies) {
        openDates = new Set(groups[0] ? [groups[0].date] : []);
      } else openDates = new Set(groups.map(function (g) { return g.date; }));
    }
    function chipCount(id) { return data.items.filter(function (it) { return passes(it, id); }).length; }
    function newsMonthName(ym) {
      var p = String(ym || "").split("-");
      return p.length >= 2 ? p[0] + "年" + Number(p[1]) + "月" : ym || "";
    }
    function syncFilters() {
      coBtn.classList.toggle("on", companies);
      coBtn.setAttribute("aria-pressed", companies ? "true" : "false");
      if (data) {
        var yms = [];
        data.items.forEach(function (it) {
          var ym = String(it.date || "").slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(ym) && yms.indexOf(ym) < 0) yms.push(ym);
        });
        yms.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
        var key = yms.join(",");
        if (monthSel.dataset.months !== key) {
          monthSel.dataset.months = key;
          monthSel.innerHTML = '<option value="all">すべての期間</option>' + yms.map(function (ym) {
            return '<option value="' + esc(ym) + '">' + esc(newsMonthName(ym)) + "</option>";
          }).join("");
        }
        if (!Array.prototype.some.call(monthSel.options, function (o) { return o.value === nwMonthV; })) nwMonthV = "all";
        monthSel.value = nwMonthV;
      }
      clearBtn.hidden = !(companies || nwMonthV !== "all");
    }
    function fmtOpen(h) {
      var d = h["開業日"], p = h["開業日の精度"];
      if (p === "日") { var a = d.split("-"); return a[0] + "年" + Number(a[1]) + "月" + Number(a[2]) + "日"; }
      if (p === "月") { var b = d.split("-"); return b[0] + "年" + Number(b[1]) + "月"; }
      if (p === "年") return /^\d{4}$/.test(d) ? d + "年" : d;
      var c = String(d).split("-");
      return c.length === 2 ? c[0] + "年" + c[1] : d;
    }
    function fmtAnn(iso) {
      var a = String(iso || "").split("-");
      return a.length === 3 ? a[0] + "年" + Number(a[1]) + "月" + Number(a[2]) + "日" : "";
    }
    function openKey(h) {
      var d = String(h["開業日"] || ""), p = h["開業日の精度"];
      var prec = p === "日" ? "0" : p === "月" ? "1" : p === "季節" ? "2" : "3";
      var key = "9999-99-99";
      if (p === "日" && /^\d{4}-\d{2}-\d{2}$/.test(d)) key = d;
      else if (p === "月" && /^\d{4}-\d{2}$/.test(d)) key = d + "-32";
      else if (p === "年") {
        var y = d.slice(0, 4);
        if (d.slice(-3) === "年以降") key = y + "-13-50";
        else if (d.slice(-2) === "年度") key = String(+y + 1) + "-03-40";
        else if (/^\d{4}$/.test(d)) key = d + "-13-00";
      } else if (p === "季節") {
        var yy = d.slice(0, 4), s = d.slice(5);
        var seasons = { "春": yy + "-05-32", "夏": yy + "-08-32", "秋": yy + "-11-32", "冬": String(+yy + 1) + "-02-32", "Q1": yy + "-03-32", "Q2": yy + "-06-32", "Q4": yy + "-12-32", "後半": yy + "-12-32", "前半": yy + "-06-32", "末": yy + "-12-40", "初頭": yy + "-01-32" };
        if (seasons[s]) key = seasons[s];
      }
      return key + "|" + prec + "|" + d;
    }
    function monthKey(h) {
      var d = String(h["開業日"] || ""), p = h["開業日の精度"];
      if ((p === "日" || p === "月") && /^\d{4}-\d{2}/.test(d)) return "m:" + d.slice(0, 7);
      return "d:" + d;
    }
    function monthLabel(k) {
      if (k.indexOf("m:") === 0) { var a = k.slice(2).split("-"); return a[0] + "年" + Number(a[1]) + "月"; }
      var rest = k.slice(2);
      return fmtOpen({ "開業日": rest, "開業日の精度": rest.indexOf("-") >= 0 && rest.split("-")[1].length === 2 ? "月" : "季節" });
    }
    function roomNum(h) { var m = String(h["客室数"] || "").match(/(\d+)/); return m ? +m[1] : -1; }
    function hoWords() { return hoQuery.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean); }
    function hoHit(h) {
      var ws = hoWords();
      if (!ws.length) return true;
      var blob = [h["ホテル名"], h["ブランド"], h["運営会社"], h["都道府県"], h["市区町村"], h["最寄駅・エリア"], h["カテゴリ"], h["備考"], h["ステータス"]].join("\n").normalize("NFKC").toLowerCase();
      return ws.every(function (w) { return blob.indexOf(w) >= 0; });
    }
    function hoMatch(h) {
      if (!hoHit(h)) return false;
      if (hoStatusV !== "all" && h["ステータス"] !== hoStatusV) return false;
      if (hoCatV !== "all" && h["カテゴリ"] !== hoCatV) return false;
      if (hoPrefV !== "all") {
        if (hoPrefV.indexOf("r:") === 0) { if (REGION_OF[h["都道府県"]] !== hoPrefV.slice(2)) return false; }
        else if (h["都道府県"] !== hoPrefV) return false;
      }
      if (hoMonthV !== "all" && monthKey(h) !== hoMonthV) return false;
      return true;
    }
    function hoCmp(a, b) {
      var c = 0;
      if (hoSort === "date") {
        var ua = a["ステータス"] === "開業済" ? 1 : 0, ub = b["ステータス"] === "開業済" ? 1 : 0;
        c = hoDir === 1 ? (ua - ub) || openKey(a).localeCompare(openKey(b)) : (ub - ua) || openKey(b).localeCompare(openKey(a));
      } else if (hoSort === "name") c = a["ホテル名"].localeCompare(b["ホテル名"], "ja");
      else if (hoSort === "pref") c = (PREF_ORDER.indexOf(a["都道府県"]) - PREF_ORDER.indexOf(b["都道府県"])) || a["ホテル名"].localeCompare(b["ホテル名"], "ja");
      else if (hoSort === "rooms") c = roomNum(a) - roomNum(b);
      else if (hoSort === "ann") {
        var aa = a["発表日"] || "", bb = b["発表日"] || "";
        c = !aa && bb ? -1 : !bb && aa ? 1 : aa.localeCompare(bb);
      } else if (hoSort === "status") c = String(a["ステータス"]).localeCompare(String(b["ステータス"]), "ja");
      else if (hoSort === "cat") c = String(a["カテゴリ"]).localeCompare(String(b["カテゴリ"]), "ja");
      if (hoSort !== "date" && hoDir < 0) c = -c;
      return c || a["ホテル名"].localeCompare(b["ホテル名"], "ja");
    }
    function stClass(s) { return s === "開業済" ? "ho-st ho-st-open" : s === "延期" ? "ho-st ho-st-delay" : "ho-st ho-st-plan"; }
    function buildHotelControls() {
      if (hoReady || !hotels) return;
      var prefs = {};
      hotels.items.forEach(function (h) { prefs[h["都道府県"]] = true; });
      var months = [], seen = {};
      hotels.items.forEach(function (h) { var k = monthKey(h); if (!seen[k]) { seen[k] = true; months.push(k); } });
      months.sort(function (a, b) {
        var sa = hotels.items.filter(function (h) { return monthKey(h) === a; })[0];
        var sb = hotels.items.filter(function (h) { return monthKey(h) === b; })[0];
        return openKey(sa).localeCompare(openKey(sb));
      });
      var monthOpts = months.map(function (k) {
        var sample = hotels.items.filter(function (h) { return monthKey(h) === k; })[0];
        var label = k.indexOf("m:") === 0 ? monthLabel(k) : fmtOpen(sample);
        return '<option value="' + esc(k) + '">' + esc(label) + "</option>";
      }).join("");
      hoPref.innerHTML = '<option value="all">すべての都道府県</option><optgroup label="地方">' + REGIONS.map(function (pair) {
        return '<option value="r:' + esc(pair[0]) + '">' + esc(pair[0]) + "</option>";
      }).join("") + '</optgroup><optgroup label="都道府県">' + PREF_ORDER.filter(function (p) { return prefs[p]; }).map(function (p) {
        return '<option value="' + esc(p) + '">' + esc(p) + "</option>";
      }).join("") + "</optgroup>";
      hoMonth.innerHTML = '<option value="all">すべての開業年月</option>' + monthOpts;
      hoStatus.innerHTML = '<option value="all">すべてのステータス</option>' + ["開業予定", "開業済", "延期"].map(function (s) {
        return '<option value="' + s + '">' + s + "</option>";
      }).join("");
      var cats = [];
      hotels.items.forEach(function (h) { if (cats.indexOf(h["カテゴリ"]) < 0) cats.push(h["カテゴリ"]); });
      cats.sort(function (a, b) { return a.localeCompare(b, "ja"); });
      hoCat.innerHTML = '<option value="all">すべてのカテゴリ</option>' + cats.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
      }).join("");
      hoSortEl.innerHTML = '<option value="date:1">開業日（予定が先・早い順）</option><option value="date:-1">開業日（新しい順）</option><option value="name:1">ホテル名</option><option value="pref:1">都道府県</option><option value="rooms:-1">客室数（多い順）</option><option value="ann:-1">発表日（新しい順）</option>';
      hoReady = true;
    }
    function renderHotels() {
      if (filter !== "openings") { hoPanel.hidden = true; return; }
      hoPanel.hidden = false;
      if (hoLoading && !hotels) {
        hoAsof.textContent = "";
        hoCount.textContent = "";
        hoList.innerHTML = '<div class="ho-status">開業リストを読み込み中…</div>';
        return;
      }
      if (hoFailed || !hotels) {
        hoAsof.textContent = "";
        hoCount.textContent = "";
        hoList.innerHTML = '<div class="ho-status">開業リストを読み込めませんでした。<div><button type="button" class="nw-retry" id="pdHoRetry">再読み込み</button></div></div>';
        return;
      }
      buildHotelControls();
      var rows = hotels.items.filter(hoMatch).sort(hoCmp);
      var total = hotels.items.length;
      var bits = {};
      hotels.items.forEach(function (h) { bits[h["ステータス"]] = (bits[h["ステータス"]] || 0) + 1; });
      hoAsof.textContent = "最終更新日 " + fmtDate(hotels.updated);
      hoCount.textContent = rows.length === total
        ? total + "件（開業予定 " + (bits["開業予定"] || 0) + "・開業済 " + (bits["開業済"] || 0) + "・延期 " + (bits["延期"] || 0) + "）"
        : rows.length + "件を表示（全" + total + "件）";
      var cols = [["date", "開業日"], ["ann", "発表日"], ["status", "ステータス"], ["name", "ホテル名"], ["pref", "場所"], ["rooms", "客室数"], ["cat", "カテゴリ"]];
      var head = cols.map(function (pair) {
        var k = pair[0], lab = pair[1];
        var on = hoSort === k;
        var sort = on ? (hoDir > 0 ? "ascending" : "descending") : "none";
        return '<th data-k="' + k + '" aria-sort="' + sort + '">' + lab + "</th>";
      }).join("");
      var html = rows.map(function (h) {
        var href = safeUrl(h["出典URL"]);
        var name = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(h["ホテル名"]) + "</a>" : esc(h["ホテル名"]);
        var sub = [h["ブランド"], h["運営会社"], h["最寄駅・エリア"]].filter(Boolean).map(esc).join(" · ");
        var memo = h["備考"] ? '<div class="ho-memo">' + esc(h["備考"]) + "</div>" : "";
        var ann = fmtAnn(h["発表日"]);
        var rooms = h["客室数"] ? esc(h["客室数"]) : "";
        var place = esc(h["都道府県"]) + (h["市区町村"] ? "<br>" + esc(h["市区町村"]) : "");
        return "<tr><td data-label=\"開業日\">" + esc(fmtOpen(h)) + '</td><td data-label="発表日"' + (ann ? "" : ' class="ho-blank"') + ">" + (ann ? esc(ann) : "") + '</td><td data-label="ステータス"><span class="' + stClass(h["ステータス"]) + '">' + esc(h["ステータス"]) + '</span></td><td class="ho-name" data-label="ホテル名">' + name + (sub ? '<div class="ho-sub">' + sub + "</div>" : "") + memo + '</td><td data-label="場所">' + place + '</td><td data-label="客室数"' + (rooms ? "" : ' class="ho-blank"') + ">" + (rooms || "—") + '</td><td data-label="カテゴリ">' + esc(h["カテゴリ"]) + "</td></tr>";
      }).join("");
      hoList.innerHTML = rows.length
        ? '<div class="ho-table-wrap"><table class="ho-table"><thead><tr>' + head + "</tr></thead><tbody>" + html + "</tbody></table></div>"
        : '<div class="ho-status">該当するホテルはありません。</div>';
    }
    function ensureHotels(force) {
      if (hotels && !force) { renderHotels(); return; }
      if (hoLoading) return;
      hoLoading = true;
      hoFailed = false;
      renderHotels();
      fetch(mapFile("hotel_openings.json"), { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }).then(function (j) {
        if (!j || !Array.isArray(j.items)) throw new Error("items");
        hotels = j;
        hoLoading = false;
        hoFailed = false;
        hoReady = false;
        renderHotels();
      }).catch(function () {
        hotels = null;
        hoLoading = false;
        hoFailed = true;
        renderHotels();
      });
    }
    function sourcesHtml(it) {
      var links = (it.sources || []).map(function (s) {
        var href = safeUrl(s.url);
        return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label || href) + "</a>" : "";
      }).filter(Boolean);
      if (!links.length) return '<div class="nw-src"><span class="nw-none">出典リンクなし</span></div>';
      return '<div class="nw-src"><span class="lb">出典</span>' + links.join("") + "</div>";
    }
    function flightClauses(headline, body) {
      var parts = [];
      String(headline || "").split(/[　\s]*／[　\s]*|　+|・/).forEach(function (chunk) {
        var text = chunk.normalize("NFKC").replace(/^[ 　・]+|[ 　・]+$/g, "");
        if (text) parts.push(text);
      });
      String(body || "").split(/[\n。]/).forEach(function (line) {
        var text = line.normalize("NFKC").replace(/^[ 　・]+|[ 　・]+$/g, "");
        if (text) parts.push(text);
      });
      return parts;
    }
    function flightClauseTags(clause) {
      if (/従来発表|別掲/.test(clause)) return [];
      var text = clause.replace(/新規開業/g, "");
      var tags = new Set();
      if (/運休(?!していた|していました|後|前)|欠航|路線廃止|運航を休止|を休止/.test(text)) tags.add("運休");
      if (/(?<!増)減便(?!がない|はない|せず)|往復減|都市が外れた/.test(text)) tags.add("減便");
      if (/再開|復便|\d+年(?:半)?ぶり/.test(text)) tags.add("再開");
      var launchOff = /(?:開設|就航|開始).{0,16}(?:延期|取りやめ)|(?:延期|取りやめ).{0,12}(?:開設|就航)/.test(text);
      var aircraftDebut = /初就航/.test(text) && /A3\d{2}|787|737|A330/.test(text) && !/新規開設|新規就航|を開設|線を開設|で開設/.test(text);
      var pastLaunch = /として開設し|開設し最大|開設したが|開設していた|就航したが/.test(text);
      if (launchOff || aircraftDebut || /延期/.test(text)) tags.add("変更");
      if (!launchOff && !aircraftDebut && !pastLaunch && !/滑走路|誘導路|駐機場/.test(text) && /新規就航|新規開設|新規路線|路線を新設|(?<!新規)開設|就航(?!先|都市)/.test(text)) tags.add("新規");
      if (!pastLaunch && /増便|デイリー化|ダブルデイリー|増やす|が増え|を増や(?!した)|追加便|往復を足|を足して|往復追加|臨時便|1日[2-9]往復に|1日[2-9]往復へ|週7へ|1日最大[2-9]往復|最大週\d+往復/.test(text)) tags.add("増便");
      if (/移管|に移し|に移す|小型化|ワイドボディ|時刻を変更|時刻が変わる|ダイヤが(?:一部)?変わ|運航曜日を変更|燃油サーチャージ(?:の)?引き上げ|サーチャージ引き上げ|追加販売|出発時刻/.test(text)) tags.add("変更");
      return Array.from(tags);
    }
    function deriveFlightTags(headline, body) {
      var found = new Set();
      flightClauses(headline, body).forEach(function (clause) {
        flightClauseTags(clause).forEach(function (tag) { found.add(tag); });
      });
      return FLIGHT_TAGS.filter(function (label) { return found.has(label); });
    }
    function flightTagList(it) {
      if (!it || it.theme !== "flights") return [];
      var raw = Array.isArray(it.flightTags) ? it.flightTags : deriveFlightTags(it.headline || "", "");
      var known = FLIGHT_TAGS.filter(function (tag) { return raw.indexOf(tag) >= 0; });
      var extra = raw.filter(function (tag) { return FLIGHT_TAGS.indexOf(tag) < 0; });
      return known.concat(extra);
    }
    function flightTagsHtml(it) {
      var tags = flightTagList(it);
      if (!tags.length) return "";
      return '<span class="nw-ftags">' + tags.map(function (tag) {
        return '<span class="nw-ftag" data-flight-tag="' + esc(tag) + '">' + esc(tag) + "</span>";
      }).join("") + "</span>";
    }
    function flightLegendHtml() {
      if (filter !== "flights") return "";
      return '<p class="nw-ftag-legend">便の種類 ' + FLIGHT_TAGS.map(function (tag) {
        return '<span class="nw-ftag" data-flight-tag="' + esc(tag) + '">' + esc(tag) + "</span>";
      }).join("") + "</p>";
    }
    function cardHtml(it) {
      var feed = it.feed === "ota" ? "海外OTAニュース" : "旅行業界ニュース";
      var note = it.note && !angleNote(it) ? '<div class="nw-note"><b>' + esc(it.noteLabel || "メモ") + "</b>" + rich(it.note) + "</div>" : "";
      return '<article class="nw-card' + (it.highlight ? " yoten" : "") + '"><div class="nw-kicker">' + flightTagsHtml(it) + '<span class="nw-cat">' + esc(it.category || it.categoryLabel) + '</span><span class="nw-feed">' + feed + "</span></div><h2>" + colorize(it.headline) + "</h2>" + rich(it.body) + note + sourcesHtml(it) + "</article>";
    }
    function firstSource(it) {
      var list = it.sources || [];
      for (var i = 0; i < list.length; i++) {
        var href = safeUrl(list[i].url);
        if (href) return { href: href, label: list[i].label || href };
      }
      return null;
    }
    function detailHtml(it) {
      var note = it.note && !angleNote(it) ? '<div class="nw-note"><b>' + esc(it.noteLabel || "メモ") + "</b>" + rich(it.note) + "</div>" : "";
      return '<div class="nw-sumb">' + rich(it.body) + note + sourcesHtml(it) + "</div>";
    }
    function summaryHtml(items) {
      var name = newsMonthName(nwMonthV);
      var head = '<p class="nw-sumhead">' + esc(name) + "のまとめ<span>" + items.length + "件</span></p>";
      if (!items.length) return head + '<div class="nw-empty">該当するニュースはありません。</div>';
      var lis = items.map(function (it) {
        var open = openItems.has(it.id);
        var src = firstSource(it);
        var link = src ? '<a class="nw-suma" href="' + esc(src.href) + '" target="_blank" rel="noopener noreferrer">出典</a>' : "";
        var date = it.dateLabel || fmtDate(it.date, it.weekday);
        return '<li class="nw-sumi"><div class="nw-sumrow"><button type="button" class="nw-sumh" data-id="' + esc(it.id) + '" aria-expanded="' + open + '"><span class="dot" aria-hidden="true">•</span><span class="nw-sumd">' + esc(date) + '</span><span class="nw-sumtag">' + esc(it.themeLabel || "") + "</span>" + flightTagsHtml(it) + '<span class="nw-sumt">' + colorize(it.headline) + "</span></button>" + link + "</div>" + (open ? detailHtml(it) : "") + "</li>";
      }).join("");
      return head + '<ul class="nw-sum">' + lis + "</ul>";
    }
    function renderNews(toTop) {
      if (!data) {
        meta.textContent = failed ? "読み込めませんでした" : "読み込み中…";
        countEl.textContent = "";
        chips.innerHTML = "";
        toggle.hidden = true;
        body.innerHTML = failed
          ? '<div class="nw-status">ニュースを読み込めませんでした。<div><button type="button" class="nw-retry" id="pdNwRetry">再読み込み</button></div></div>'
          : '<div class="nw-status">読み込み中…</div>';
        return;
      }
      toggle.hidden = false;
      syncFilters();
      var wd = (data.items.filter(function (it) { return it.date === data.updated; })[0] || {}).weekday || "";
      meta.textContent = "最終更新日 " + fmtDate(data.updated, wd);
      var filters = data.filters || [];
      chips.innerHTML = '<div class="nw-cluster">' + filters.map(function (f) {
        return '<button type="button" class="nw-chip' + (f.id === filter ? " on" : "") + '" data-f="' + esc(f.id) + '" aria-pressed="' + (f.id === filter) + '">' + esc(f.label) + '<span class="n">' + chipCount(f.id) + "</span></button>";
      }).join("") + "</div>";
      var groups = visibleGroups();
      var items = visibleItems();
      var shown = items.length;
      var universe = data.items.filter(function (it) { return filter === "all" ? it.theme !== "flights" : it.theme === filter; });
      var total = universe.length;
      var days = {};
      universe.forEach(function (it) { days[it.date] = true; });
      var totalDays = Object.keys(days).length;
      if (nwMonthV !== "all") {
        var everyItem = items.length > 0 && items.every(function (it) { return openItems.has(it.id); });
        toggle.textContent = everyItem ? "箇条書きに戻す" : "すべて開く";
        toggle.disabled = !items.length;
        countEl.textContent = shown + "件を箇条書きで表示（" + newsMonthName(nwMonthV) + "）";
        body.innerHTML = flightLegendHtml() + summaryHtml(items);
      } else {
        countEl.textContent = shown + "件・" + groups.length + "日分を表示（全" + total + "件・" + totalDays + "日分）";
        var every = groups.length > 0 && groups.every(function (g) { return openDates.has(g.date); });
        toggle.textContent = every ? "日付を折りたたむ" : "すべての日付を開く";
        toggle.disabled = !groups.length;
        var latest = groups[0] ? groups[0].date : "";
        body.innerHTML = flightLegendHtml() + (groups.length ? groups.map(function (g) {
          var open = openDates.has(g.date);
          return '<div class="nw-day"><button type="button" class="nw-dayh" data-date="' + esc(g.date) + '" aria-expanded="' + open + '"><span class="nw-dayt">' + esc(fmtDate(g.date, g.weekday)) + "</span>" + (g.date === latest ? '<span class="nw-new">最新</span>' : "") + '<span class="nw-dayn">' + g.items.length + '件</span><span class="ch" aria-hidden="true">▼</span></button>' + (open ? '<div class="nw-dayb">' + g.items.map(cardHtml).join("") + "</div>" : "") + "</div>";
        }).join("") : '<div class="nw-empty">該当するニュースはありません。</div>');
      }
      if (toTop) {
        var host = root.closest("#pd-briefing");
        if (host && !host.hidden) root.scrollIntoView({ block: "start" });
      }
      if (filter === "openings") ensureHotels(false);
      else hoPanel.hidden = true;
    }
    function loadNews(force) {
      if (data && !force) { renderNews(false); return; }
      if (loading) return;
      loading = true;
      failed = false;
      renderNews(false);
      fetch(mapFile("news.json"), { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }).then(function (j) {
        if (!j || !Array.isArray(j.items)) throw new Error("items");
        data = j;
        loading = false;
        failed = false;
        var latest = (data.items.filter(function (it) { return it.theme !== "flights"; })[0] || {}).date || null;
        openDates = new Set(latest ? [latest] : []);
        openItems = new Set();
        filter = "all";
        query = "";
        companies = false;
        nwMonthV = "all";
        input.value = "";
        renderNews(true);
      }).catch(function () {
        data = null;
        loading = false;
        failed = true;
        renderNews(false);
      });
    }

    root.addEventListener("click", function (e) {
      var retry = e.target.closest && e.target.closest("#pdNwRetry");
      if (retry) { loadNews(true); return; }
      var hoRetry = e.target.closest && e.target.closest("#pdHoRetry");
      if (hoRetry) { hoFailed = false; ensureHotels(true); return; }
      var chip = e.target.closest && e.target.closest(".nw-chip");
      if (chip && data) { filter = chip.getAttribute("data-f") || "all"; retarget(); renderNews(true); return; }
      var sum = e.target.closest && e.target.closest(".nw-sumh");
      if (sum) {
        var id = sum.getAttribute("data-id");
        if (openItems.has(id)) openItems.delete(id); else openItems.add(id);
        renderNews(false);
        return;
      }
      var day = e.target.closest && e.target.closest(".nw-dayh");
      if (day) {
        var d = day.getAttribute("data-date");
        if (openDates.has(d)) openDates.delete(d); else openDates.add(d);
        renderNews(false);
        return;
      }
      var th = e.target.closest && e.target.closest("th");
      if (th && hotels && th.closest("#pdHoList")) {
        var k = th.getAttribute("data-k");
        if (!k) return;
        if (hoSort === k) hoDir = -hoDir;
        else { hoSort = k; hoDir = (k === "rooms" || k === "ann") ? -1 : 1; }
        var v = hoSort + ":" + hoDir;
        if (Array.prototype.some.call(hoSortEl.options, function (o) { return o.value === v; })) hoSortEl.value = v;
        renderHotels();
      }
    });
    toggle.addEventListener("click", function () {
      if (nwMonthV !== "all") {
        var items = visibleItems();
        var every = items.length && items.every(function (it) { return openItems.has(it.id); });
        openItems = new Set(every ? [] : items.map(function (it) { return it.id; }));
        renderNews(false);
        return;
      }
      var groups = visibleGroups();
      var everyDay = groups.length && groups.every(function (g) { return openDates.has(g.date); });
      openDates = new Set(everyDay ? (groups[0] ? [groups[0].date] : []) : groups.map(function (g) { return g.date; }));
      renderNews(false);
    });
    monthSel.addEventListener("change", function () {
      nwMonthV = monthSel.value || "all";
      if (nwMonthV !== "all") openItems = new Set();
      retarget();
      renderNews(true);
    });
    coBtn.addEventListener("click", function () { companies = !companies; retarget(); renderNews(true); });
    clearBtn.addEventListener("click", function () {
      if (!companies && nwMonthV === "all") return;
      companies = false;
      nwMonthV = "all";
      openItems = new Set();
      retarget();
      renderNews(true);
    });
    var timer = 0;
    input.addEventListener("input", function () {
      query = input.value;
      clearTimeout(timer);
      timer = setTimeout(function () { if (!data) return; retarget(); renderNews(true); }, 120);
    });
    hoPref.addEventListener("change", function () { hoPrefV = hoPref.value; renderHotels(); });
    hoMonth.addEventListener("change", function () { hoMonthV = hoMonth.value; renderHotels(); });
    hoStatus.addEventListener("change", function () { hoStatusV = hoStatus.value; renderHotels(); });
    hoCat.addEventListener("change", function () { hoCatV = hoCat.value; renderHotels(); });
    hoSortEl.addEventListener("change", function () {
      var parts = hoSortEl.value.split(":");
      hoSort = parts[0];
      hoDir = +parts[1] || 1;
      renderHotels();
    });
    var hoTimer = 0;
    hoQ.addEventListener("input", function () {
      hoQuery = hoQ.value;
      clearTimeout(hoTimer);
      hoTimer = setTimeout(renderHotels, 120);
    });
    filtBtn.addEventListener("click", function () {
      var on = root.classList.toggle("nw-tools-open");
      filtBtn.setAttribute("aria-expanded", on ? "true" : "false");
    });
    loadNews(false);
  }

  function load() {
    failed = false;
    if (!doc && panel) {
      var asof = panel.querySelector(".pd-asof");
      if (asof) asof.textContent = "読み込み中…";
      var cal = document.getElementById("pd-cal");
      if (cal) cal.innerHTML = "<h2>イベントカレンダー</h2><p class=\"pd-empty\">読み込み中…</p>";
    }
    var url = window.__PD_BRIEF_URL || dataUrl;
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (json) {
        if (!json || !json.events) throw new Error("shape");
        doc = json;
        failed = false;
        month = "";
        render();
      })
      .catch(function () {
        doc = null;
        failed = true;
        render();
      });
  }

  function boot() {
    try {
      panel = ensurePanel();
      button = ensureTab();
      applyChrome();
      startNews(document.getElementById("pd-news"));
      load();
      document.addEventListener("click", function (e) {
        var tab = e.target.closest && e.target.closest("button, a");
        if (!tab || tab.getAttribute("data-pd-tab")) return;
        var inBar = tab.closest("#tabs, #mTabs");
        if (!inBar) return;
        if (tab.hasAttribute("data-tab") || tab.hasAttribute("data-t")) closePanel();
      }, true);
      window.addEventListener("resize", place);
      if (window.MutationObserver) {
        var obs = new MutationObserver(function () {
          button = ensureTab();
          syncMobile();
          if (opened) place();
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () { obs.disconnect(); }, 4000);
      }
    } catch (err) {
      /* The dashboard itself must keep working. */
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
