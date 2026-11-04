# パフォーマンスダッシュボード

宿泊・販売の数値は、これまでどおりパスワード付きの `index.html` の中にあります。イベントカレンダーは、その外側の `data/briefing.json` を開いたあとに読み込みます。ニュースまとめは、インバウンドマップが GitHub Pages で公開している `news.json` と `hotel_openings.json` を開いたあとに読み込みます。

`bd-area/` is the 直輝チーム 2027 BDエリア権限シミュレータ (password protected).

## 更新の流れ

1. GitHub Actions の「Collect event calendar and daily news」が、毎日 8:40（日本時間）に動きます。時刻は UTC の `40 23 * * *` です。GitHub の定期実行は遅れることがあります。
2. `scripts/collect_briefing.py` が公開の祝日とドーム日程を取り、`data/briefing.json` を書き直します。旅行ニュースの RSS もこのファイルに残しますが、画面のニュースまとめでは使いません。
3. 中身が変わったときだけ、そのファイルを `main` にコミットします。GitHub Pages が同じサイトを更新します。
4. ダッシュボードを開き直すと、新しいカレンダーが出ます。ニュースまとめは、同じ開き直しのときに `https://100nao.github.io/inboud-map/news.json` と `hotel_openings.json` を読みます。インバウンドマップ側が JSON を更新すると、こちらの画面も次の表示で追従します。ブラウザには残さないようにし、URL には分単位の印を付けています。GitHub Pages 側の配信キャッシュはおおよそ10分です。

手動で今すぐ取り直すときは、Actions の画面から **Run workflow** を押します。出典がすべて失敗した回は、すでにある `data/briefing.json` を残して終了します。

`main` への push が Actions に許可されていない場合（ブランチ保護など）は、この定期コミットだけ失敗します。そのときはリポジトリの Actions 権限で `contents: write` を許可してください。

## 画面

パスワードを入れると、既存のタブ（SMM、サマリー分析など）の並びに「イベント・ニュース」が足されます。スマホでは右上メニューのタブ一覧にも出ます。タブの位置を判定できない場合は、画面右上に同じボタンを出します。カレンダーを読み込めないときは「イベントカレンダーを読み込めませんでした。時間をおいて、もう一度開いてください。」と出て、数値の画面とニュースまとめはそのままです。ニュースを読み込めないときは、ニュースの欄だけ「ニュースを読み込めませんでした。」と出ます。

パスワードを手で入れる経路も、「Remember me」で自動的に開く経路も、同じ復号処理（`replaceHtmlCallback`）を通ります。

スマホ（幅 768px 以下）では、右端から約60px以内で左へ短く払うと、右上の「menu」ボタンと同じメニューが開きます。指を離す前に開きます。メニューが開いているときに左から右へ同じくらい払うと閉じます。画面の中央での縦スクロールと、KPI カードやグラフの横スワイプはそのままです。処理は `menu-swipe.js` で、`briefing.js` が読み込みます。

## 再ビルド時にソースへ残すもの

週次のダッシュボードは別のマシンで HTML を作り直し、StatiCrypt で暗号化して、このリポジトリの `index.html` を丸ごと置き換えます。そのとき、パスワード画面に足した読み込み処理は消えます。暗号化される中身のほうに、次のブロックを残してください。

置く場所は、ソース HTML の最後の `</script>` のあと、`</body>` のすぐ前です。`briefing-snippet.html` と同じ内容です。

```html
<script>
(function () {
  if (window.__PD_BRIEF_LOAD) return;
  window.__PD_BRIEF_LOAD = true;
  var path = location.pathname;
  var base = /\/$/.test(path) ? path : (/\.[a-z0-9]+$/i.test(path) ? path.replace(/[^/]*$/, "") : path + "/");
  window.__PD_BRIEF_BASE = base;
  function load() {
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = base + "briefing.css";
    (document.head || document.documentElement).appendChild(css);
    var script = document.createElement("script");
    script.src = base + "briefing.js";
    (document.body || document.documentElement).appendChild(script);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
</script>
```

このブロックがあると、再暗号化のあとでも `briefing.js`、`briefing.css`、`data/briefing.json` を読みます。この3つは暗号化した HTML の外に置いたままにしてください。

`#tab=` の値はこのダッシュボードが知っているタブ（`smm` や `sum` など）だけです。イベント・ニュースはハッシュを変えません。知らない値はサマリー側の処理が `smm` に戻すためです。

## インバウンドマップとの違い

ニュースまとめは、インバウンドマップの公開 JSON をそのまま表示します。正本は非公開の Excel（`旅行業界ニュース` / `海外OTAニュース`）で、`scripts/build_news.py` が `news.json` を作ります。新規開業ホテルは `hotel_openings.json` です。どちらもインバウンドマップの GitHub Pages（`https://100nao.github.io/inboud-map/`）から読みます。このリポジトリにはコピーしません。

イベントカレンダーは、インバウンドマップの `events.json` を参照しません。主催者サイトを調べた結果はあちらの `events.json` にコミットされています。こちらは公開の祝日と、東京ドーム・京セラドーム大阪の日程を自分で集めています。

このダッシュボード側で自動取得しているもの:

- 日本の祝日: 内閣府の CSV
- 香港の休日: GovHK
- 中国・韓国・英国の祝日: Nager.Date
- 台湾: 公開 API に休日表がないため、元日・春節（旧正月の日付）・双十節だけを「予定」として計算
- タイのソンクラーン: 例年 4月13日–15日
- 公演・試合: 東京ドームと京セラドーム大阪の公開スケジュール（公式戦の連戦は除く）

画面のニュースまとめは、上の RSS ではなくインバウンドマップの `news.json` です。RSS で集めた見出しは `data/briefing.json` に残ることがありますが、表示には使いません。

手作業のマップにあって、こちらのカレンダーでは自動では揃わないもの:

- ドーム以外の祭り・マラソン・展示会（主催者ごとのページがバラバラなため）
