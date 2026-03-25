const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('=== アーティストページにアクセス ===');
  await page.goto('https://suno.com/@darari_nu?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // スクリーンショット
  await page.screenshot({ path: 'tools/suno-tracker/test/artist-initial.png', fullPage: false });
  console.log('初期スクリーンショット保存');

  // ページのテキスト
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('\n=== ページテキスト（先頭3000文字） ===');
  console.log(bodyText.substring(0, 3000));

  // 曲カードっぽい要素を探す - aタグでsuno.com/songへのリンクを持つもの
  console.log('\n=== 曲リンクを探索 ===');
  const songLinks = await page.$$eval('a[href*="/song/"]', els =>
    els.map(e => ({ href: e.href, text: e.innerText.trim().substring(0, 100) }))
  );
  console.log('曲リンク:', JSON.stringify(songLinks.slice(0, 10), null, 2));

  // data属性を持つ要素
  console.log('\n=== 曲データ構造を探索 ===');
  // 再生数・いいねの数字を含むボタン
  const statButtons = await page.$$eval('button', els =>
    els.filter(e => /^\d/.test(e.innerText.trim()))
      .slice(0, 20)
      .map(e => ({ text: e.innerText.trim(), ariaLabel: e.getAttribute('aria-label') }))
  );
  console.log('数値ボタン:', JSON.stringify(statButtons, null, 2));

  // スクロールして追加読み込みを試す
  console.log('\n=== スクロールテスト ===');
  let prevHeight = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    const songCount = await page.$$eval('a[href*="/song/"]', els => els.length);
    console.log(`スクロール${i + 1}: height ${prevHeight}→${newHeight}, 曲リンク数: ${songCount}`);
    if (newHeight === prevHeight) {
      console.log('これ以上スクロールできない');
      break;
    }
    prevHeight = newHeight;
  }

  // 最終スクリーンショット
  await page.screenshot({ path: 'tools/suno-tracker/test/artist-scrolled.png', fullPage: false });
  console.log('スクロール後スクリーンショット保存');

  // 最終的な曲リンク一覧
  const allSongLinks = await page.$$eval('a[href*="/song/"]', els =>
    els.map(e => ({ href: e.href, text: e.innerText.trim().substring(0, 100) }))
  );
  console.log('\n=== 全曲リンク ===');
  console.log(JSON.stringify(allSongLinks, null, 2));

  await browser.close();
  console.log('\n=== 完了 ===');
})();
