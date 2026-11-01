# パフォーマンスダッシュボード

宿泊・販売の数値は、これまでどおりパスワード付きの `index.html` の中にあります。イベントカレンダーと毎日のニュースは、その外側の `data/briefing.json` を開いたあとに読み込みます。

## 更新の流れ

1. GitHub Actions の「Collect event calendar and daily news」が、毎日 8:40（日本時間）に動きます。時刻は UTC の `40 23 * * *` です。GitHub の定期実行は遅れることがあります。
2. `scripts/collect_briefing.py` が公開の祝日・ドーム日程・旅行ニュース RSS を取り、`data/briefing.json` を書き直します。
3. 中身が変わったときだけ、そのファイルを `main` にコミットします。GitHub Pages が同じサイトを更新します。
4. ダッシュボードを開き直すと、新しいカレンダーとニュースが出ます。インバウンドマップの更新には依存しません。

手動で今すぐ取り直すときは、Actions の画面から **Run workflow** を押します。出典がすべて失敗した回は、すでにある `data/briefing.json` を残して終了します。

`main` への push が Actions に許可されていない場合（ブランチ保護など）は、この定期コミットだけ失敗します。そのときはリポジトリの Actions 権限で `contents: write` を許可してください。

## 画面

パスワードを入れると、既存のタブ（SMM、サマリー分析など）の並びに「イベント・ニュース」が足されます。スマホでは右上メニューのタブ一覧にも出ます。タブの位置を判定できない場合は、画面右上に同じボタンを出します。読み込みに失敗したときは「イベントとニュースを読み込めませんでした。時間をおいて、もう一度開いてください。」と出て、数値の画面はそのままです。

パスワードを手で入れる経路も、「Remember me」で自動的に開く経路も、同じ復号処理（`replaceHtmlCallback`）を通ります。

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

インバウンドマップの `news.json` と `events.json` は、このリポジトリからは参照しません。あちらの更新は GitHub Actions ではなく、リポジトリの外で作ってコミットしています。

- ニュースは非公開の Excel（`旅行業界ニュース` / `海外OTAニュース`）が正です。`scripts/build_news.py` で JSON にし、朝の追加は外部の作業が `news.json` を直接コミットします。
- イベントは主催者サイトを調べた結果を `events.json` にコミットしています。`scripts/validate_events.py` に「8:40 のジョブ」と書かれていますが、そのジョブの本体はリポジトリにありません。祝日以外の大規模イベントの定期追加も、2026-10-27 の一括追加以降は見当たりません。

このダッシュボード側で自動取得しているもの:

- 日本の祝日: 内閣府の CSV
- 香港の休日: GovHK
- 中国・韓国・英国の祝日: Nager.Date
- 台湾: 公開 API に休日表がないため、元日・春節（旧正月の日付）・双十節だけを「予定」として計算
- タイのソンクラーン: 例年 4月13日–15日
- 公演・試合: 東京ドームと京セラドーム大阪の公開スケジュール（公式戦の連戦は除く）
- ニュース: TRAICY、Aviation Wire、トラベルボイス、スカイバジェット、観光経済新聞、Skift の RSS

手作業のマップにあって、こちらでは自動では揃わないもの:

- Excel に書かれた実務メモと、見出しの言い換え
- ドーム以外の祭り・マラソン・展示会（主催者ごとのページがバラバラなため）
- ホテル開業の全国一覧
