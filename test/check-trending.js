const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('=== トレンドページにアクセス ===');
  await page.goto('https://suno.com/explore/feed/trending', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // スクリーンショット撮影
  await page.screenshot({ path: 'tools/suno-tracker/test/trending-initial.png', fullPage: false });
  console.log('スクリーンショット保存: trending-initial.png');

  // ページの主要テキストを取得
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('\n=== ページテキスト（先頭2000文字） ===');
  console.log(bodyText.substring(0, 2000));

  // ドロップダウンやフィルター系のボタンを探す
  console.log('\n=== ボタン・セレクト要素を探索 ===');
  const buttons = await page.$$eval('button', els => els.map(e => ({ text: e.innerText.trim(), class: e.className })).filter(e => e.text));
  console.log('ボタン一覧:', JSON.stringify(buttons.slice(0, 30), null, 2));

  // select要素
  const selects = await page.$$eval('select', els => els.map(e => ({ options: [...e.options].map(o => o.text) })));
  console.log('セレクト要素:', JSON.stringify(selects, null, 2));

  // role=listbox や role=combobox
  const listboxes = await page.$$eval('[role="listbox"], [role="combobox"], [role="menu"]', els => els.map(e => e.innerText.trim()));
  console.log('Listbox/Combobox:', JSON.stringify(listboxes, null, 2));

  // "Now", "Week", "Month", "All Time" を含む要素を探す
  console.log('\n=== トレンドフィルター関連の要素 ===');
  for (const keyword of ['Now', 'Week', 'Month', 'All Time', 'Japanese', 'Global', 'Japan']) {
    const found = await page.$$eval(`*`, (els, kw) => {
      return els.filter(e => e.innerText.includes(kw) && e.children.length < 3)
        .slice(0, 3)
        .map(e => ({ tag: e.tagName, text: e.innerText.trim().substring(0, 100), class: e.className }));
    }, keyword);
    if (found.length > 0) {
      console.log(`"${keyword}" found:`, JSON.stringify(found, null, 2));
    } else {
      console.log(`"${keyword}" → 見つからず`);
    }
  }

  // 曲リスト的な要素を探す
  console.log('\n=== 曲データっぽい要素 ===');
  const songCards = await page.$$eval('[class*="song"], [class*="track"], [class*="clip"], [class*="card"]', els =>
    els.slice(0, 5).map(e => e.innerText.trim().substring(0, 200))
  );
  console.log('カード要素:', JSON.stringify(songCards.slice(0, 5), null, 2));

  await browser.close();
  console.log('\n=== 完了 ===');
})();
