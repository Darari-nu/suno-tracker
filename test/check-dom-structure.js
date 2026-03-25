const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://suno.com/@darari_nu?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 各曲の行ごとのデータ構造を探る
  // 曲リンクの親要素を辿ってカード全体を取得
  const songData = await page.evaluate(() => {
    const songLinks = document.querySelectorAll('a[href*="/song/"]');
    const results = [];

    for (const link of songLinks) {
      // 曲リンクから上に辿って行全体を探す
      let row = link;
      for (let i = 0; i < 10; i++) {
        row = row.parentElement;
        if (!row) break;
        // 行全体のテキストに数字が含まれていれば、そこが曲カード
        const text = row.innerText;
        if (text.includes(link.innerText) && /\d+\.\d+K|\d{2,}/.test(text)) {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          results.push({
            title: link.innerText.trim(),
            href: link.href,
            rowTag: row.tagName,
            rowClass: row.className.substring(0, 100),
            lines: lines.slice(0, 15)
          });
          break;
        }
      }
    }
    return results;
  });

  console.log('=== 曲カード構造 ===');
  for (const song of songData.slice(0, 3)) {
    console.log(`\n--- ${song.title} ---`);
    console.log(`URL: ${song.href}`);
    console.log(`Tag: ${song.rowTag}, Class: ${song.rowClass}`);
    console.log('Lines:', JSON.stringify(song.lines, null, 2));
  }

  await browser.close();
})();
