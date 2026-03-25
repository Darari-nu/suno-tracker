const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // ビューポートを広げてみる
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('https://suno.com/@coban3137?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Cookie バナーを閉じる
  try {
    await page.locator('button:has-text("Accept All Cookies")').click({ timeout: 2000 });
    await page.waitForTimeout(500);
  } catch (e) {}

  // 初期状態
  let songCount = await page.$$eval('a[href*="/song/"]', els => els.length);
  let scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  console.log(`初期: ${songCount}曲, scrollHeight=${scrollHeight}`);

  // 段階的にスクロール
  for (let i = 0; i < 30; i++) {
    // ページ末尾までスクロール
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const newSongCount = await page.$$eval('a[href*="/song/"]', els => els.length);
    const newScrollHeight = await page.evaluate(() => document.body.scrollHeight);

    console.log(`スクロール${i + 1}: ${newSongCount}曲, scrollHeight=${newScrollHeight}`);

    if (newSongCount === songCount && newScrollHeight === scrollHeight) {
      // もう一回待ってから再確認
      await page.waitForTimeout(3000);
      const finalCount = await page.$$eval('a[href*="/song/"]', els => els.length);
      if (finalCount === songCount) {
        console.log('これ以上読み込めない');
        break;
      }
    }
    songCount = newSongCount;
    scrollHeight = newScrollHeight;
  }

  // 全曲タイトル
  const titles = await page.$$eval('a[href*="/song/"]', els => els.map(e => e.innerText.trim()).filter(t => t));
  console.log(`\n最終: ${titles.length}曲`);
  titles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  await browser.close();
})();
