const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://suno.com/explore/feed/trending', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Cookie バナーを閉じる
  try {
    await page.locator('button:has-text("Accept All Cookies")').click({ timeout: 2000 });
    await page.waitForTimeout(500);
  } catch (e) {}

  // 現在のフィルターラベルを取得
  const labels = await page.locator('div.cursor-pointer span.line-clamp-1').allInnerTexts();
  console.log('現在のフィルターラベル:', labels);

  // 「Now」ドロップダウンをクリック（2番目のcursor-pointer div）
  const periodDropdown = page.locator('div.cursor-pointer').nth(1);
  console.log('Period dropdown text:', await periodDropdown.innerText());
  await periodDropdown.click();
  await page.waitForTimeout(1500);

  // スクリーンショット
  await page.screenshot({ path: 'tools/suno-tracker/test/period-dropdown-open.png' });

  // ドロップダウンの中身をすべて取得
  const allText = await page.evaluate(() => {
    // 最近追加された要素（ポップオーバー）を探す
    const divs = document.querySelectorAll('div');
    const candidates = [];
    for (const d of divs) {
      const style = window.getComputedStyle(d);
      if (style.position === 'absolute' || style.position === 'fixed') {
        const text = d.innerText.trim();
        if (text && (text.includes('Week') || text.includes('Month') || text.includes('Now') || text.includes('All'))) {
          candidates.push({
            text: text.substring(0, 300),
            class: d.className.substring(0, 100),
            zIndex: style.zIndex
          });
        }
      }
    }
    return candidates;
  });
  console.log('\nポップオーバー候補:', JSON.stringify(allText, null, 2));

  // innerTextで全ページのテキストからWeek/Month周辺を探す
  const bodyText = await page.evaluate(() => document.body.innerText);
  const weekIndex = bodyText.indexOf('Week');
  if (weekIndex >= 0) {
    console.log('\n"Week" 周辺テキスト:', bodyText.substring(Math.max(0, weekIndex - 50), weekIndex + 100));
  } else {
    console.log('"Week" がページ内に見つからない');
  }

  // クリック可能な要素をすべてリスト
  const clickables = await page.evaluate(() => {
    const els = document.querySelectorAll('div[class*="cursor-pointer"], [role="option"], [role="menuitem"]');
    return [...els].map(e => e.innerText.trim().substring(0, 50)).filter(t => t);
  });
  console.log('\nクリック可能要素:', clickables.slice(0, 20));

  await browser.close();
})();
