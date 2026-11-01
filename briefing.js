/* Event calendar and daily news for the performance dashboard.
   The encrypted page stays as it is. After the password unlocks it, this
   script adds one tab and reads data/briefing.json from this site. */
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
  var dataUrl = window.__PD_BRIEF_URL || (base + "data/briefing.json?v=" + stamp());
  var doc = null;
  var failed = false;
  var month = "";
  var day = 1;
  var pref = "";
  var filter = "all";
  var query = "";
  var companies = false;
  var newsMonth = "all";
  var openDates = {};
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
  function ymLabel(ym) {
    var p = String(ym || "").split("-");
    return p.length === 2 ? p[0] + "年" + Number(p[1]) + "月" : "";
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
    el.innerHTML = '<div class="pd-wrap"><div class="pd-head"><div><h1>イベント・ニュース</h1><p class="pd-asof">読み込み中…</p></div></div><p class="pd-warn" hidden></p><div class="pd-cols"><div class="pd-card" id="pd-cal"><h2>イベントカレンダー</h2><p class="pd-empty">読み込み中…</p></div><div class="pd-card" id="pd-news"><h2>毎日のニュース</h2><p class="pd-empty">読み込み中…</p></div></div></div>';
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
    return '<p class="pd-fail">イベントとニュースを読み込めませんでした。時間をおいて、もう一度開いてください。</p><button type="button" class="pd-retry">再読み込み</button>';
  }

  function render() {
    var asof = panel.querySelector(".pd-asof");
    var warn = panel.querySelector(".pd-warn");
    var cal = document.getElementById("pd-cal");
    var news = document.getElementById("pd-news");
    if (!doc) {
      asof.textContent = "読み込めませんでした";
      warn.hidden = true;
      cal.innerHTML = '<h2>イベントカレンダー</h2>' + failMessage();
      news.innerHTML = '<h2>毎日のニュース</h2>' + failMessage();
      panel.querySelectorAll(".pd-retry").forEach(function (b) { b.onclick = load; });
      return;
    }
    asof.textContent = "最終更新日 " + jpDate(doc.updated);
    if (doc.warnings && doc.warnings.length) {
      warn.hidden = false;
      warn.textContent = "一部の出典を取得できませんでした。取得できた内容だけ表示しています。";
    } else warn.hidden = true;
    renderCalendar(cal);
    renderNews(news);
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

  function newsItems() { return (doc.news && doc.news.items) || []; }

  function passes(it, theme) {
    var id = theme == null ? filter : theme;
    if (id === "all") { if (it.theme === "flights") return false; }
    else if (it.theme !== id) return false;
    if (companies && !it.companies) return false;
    if (newsMonth !== "all" && String(it.date || "").slice(0, 7) !== newsMonth) return false;
    var words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var blob = [it.headline, it.body, it.feedLabel, it.themeLabel, it.category].join("\n").toLowerCase();
    return words.every(function (w) { return blob.indexOf(w) >= 0; });
  }

  function renderNews(root) {
    var items = newsItems();
    var filters = (doc.news && doc.news.filters) || [{ id: "all", label: "すべて" }];
    var months = [];
    items.forEach(function (it) {
      var ym = String(it.date || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym) && months.indexOf(ym) < 0) months.push(ym);
    });
    months.sort().reverse();
    var groups = [];
    var map = {};
    items.forEach(function (it) {
      if (!passes(it)) return;
      if (!map[it.date]) {
        map[it.date] = { date: it.date, weekday: it.weekday, items: [] };
        groups.push(map[it.date]);
      }
      map[it.date].items.push(it);
    });
    if (!Object.keys(openDates).length && groups[0]) openDates[groups[0].date] = true;
    var keepQ = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("pd-q");
    var html = '<div class="pd-cardhead"><div><h2>毎日のニュース</h2><p class="pd-sub">旅行・航空・OTAの公開ニュース</p></div></div>';
    html += '<div class="pd-chips">' + filters.map(function (f) {
      var n = items.filter(function (it) { return passes(it, f.id); }).length;
      return '<button type="button" class="pd-chip' + (f.id === filter ? " on" : "") + '" data-f="' + esc(f.id) + '">' + esc(f.label) + '<span class="n">' + n + "</span></button>";
    }).join("") + "</div>";
    html += '<div class="pd-searchrow"><input type="search" class="pd-q" placeholder="キーワード" value="' + esc(query) + '" aria-label="キーワード"><select class="pd-nmonth" aria-label="月"><option value="all">すべての期間</option>' + months.map(function (ym) {
      return '<option value="' + esc(ym) + '"' + (ym === newsMonth ? " selected" : "") + ">" + esc(ymLabel(ym)) + "</option>";
    }).join("") + '</select><label class="pd-check"><input type="checkbox" class="pd-co"' + (companies ? " checked" : "") + ">他旅行会社動向</label></div>";
    html += '<div class="pd-news">';
    if (!items.length) html += '<p class="pd-empty">ニュースはまだありません。</p>';
    else if (!groups.length) html += '<p class="pd-empty">該当するニュースはありません。</p>';
    else {
      var latest = groups[0].date;
      html += groups.map(function (g) {
        var open = !!openDates[g.date];
        return '<button type="button" class="pd-date" data-date="' + esc(g.date) + '" aria-expanded="' + open + '"><span>' + esc(jpDate(g.date)) + "</span>" + (g.date === latest ? '<span class="pd-new">最新</span>' : "") + '<span class="count">' + g.items.length + "件</span></button>" + (open ? g.items.map(card).join("") : "");
      }).join("");
    }
    html += "</div>";
    root.innerHTML = html;
    root.querySelectorAll(".pd-chip").forEach(function (b) {
      b.onclick = function () { filter = b.getAttribute("data-f") || "all"; openDates = {}; render(); };
    });
    root.querySelectorAll(".pd-date").forEach(function (b) {
      b.onclick = function () {
        var d = b.getAttribute("data-date");
        openDates[d] = !openDates[d];
        render();
      };
    });
    var input = root.querySelector(".pd-q");
    var timer = 0;
    input.oninput = function () {
      clearTimeout(timer);
      timer = setTimeout(function () { query = input.value; openDates = {}; render(); }, 120);
    };
    root.querySelector(".pd-nmonth").onchange = function (e) { newsMonth = e.target.value; openDates = {}; render(); };
    root.querySelector(".pd-co").onchange = function (e) { companies = e.target.checked; openDates = {}; render(); };
    if (keepQ) {
      var again = root.querySelector(".pd-q");
      again.focus();
      var pos = again.value.length;
      if (again.setSelectionRange) again.setSelectionRange(pos, pos);
    }
  }

  function card(it) {
    var href = it.sources && it.sources[0] ? safeUrl(it.sources[0].url) : "";
    var host = it.sources && it.sources[0] ? it.sources[0].label : "";
    var link = href ? '<div class="pd-meta"><a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(host || "出典") + "</a></div>" : "";
    return "<article><div class=\"pd-kicker\"><span class=\"pd-cat\">" + esc(it.category || it.themeLabel || "") + "</span><span>" + esc(it.feedLabel || "") + "</span></div><h3>" + esc(it.headline) + "</h3>" + (it.body ? "<p>" + esc(it.body) + "</p>" : "") + link + "</article>";
  }

  function load() {
    failed = false;
    if (!doc && panel) {
      var asof = panel.querySelector(".pd-asof");
      if (asof) asof.textContent = "読み込み中…";
      var cal = document.getElementById("pd-cal");
      var news = document.getElementById("pd-news");
      if (cal) cal.innerHTML = "<h2>イベントカレンダー</h2><p class=\"pd-empty\">読み込み中…</p>";
      if (news) news.innerHTML = "<h2>毎日のニュース</h2><p class=\"pd-empty\">読み込み中…</p>";
    }
    var url = window.__PD_BRIEF_URL || dataUrl;
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (json) {
        if (!json || !json.events || !json.news) throw new Error("shape");
        doc = json;
        failed = false;
        openDates = {};
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
