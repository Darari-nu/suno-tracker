const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://suno.com/explore/feed/trending', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Cookie バナーを閉じる
  try {
    const acceptBtn = page.locator('button:has-text("Accept All Cookies")');
    if (await acceptBtn.isVisible({ timeout: 2000 })) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {}

  // Global ドロップダウンを探す
  console.log('=== "Global" ドロップダウンを探す ===');
  const globalBtn = page.locator('button:has-text("Global")').first();
  console.log('Global ボタン visible:', await globalBtn.isVisible());

  // クリックしてドロップダウンを開く
  await globalBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tools/suno-tracker/test/trending-global-dropdown.png' });

  // ドロップダウン内の選択肢を取得
  const regionOptions = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]');
    if (items.length > 0) return [...items].map(i => i.innerText.trim());
    // popover/menu を探す
    const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
    if (menus.length > 0) return [...menus].map(m => m.innerText.trim());
    return [];
  });
  console.log('地域オプション:', regionOptions);

  // もし見つからなければ、新しく出現した要素を探す
  if (regionOptions.length === 0) {
    const newElements = await page.evaluate(() => {
      const all = document.querySelectorAll('div[style*="position"], div[class*="popover"], div[class*="dropdown"], div[class*="menu"]');
      return [...all].filter(e => e.innerText.includes('Japanese') || e.innerText.includes('Global'))
        .map(e => ({ text: e.innerText.trim().substring(0, 500), tag: e.tagName, class: e.className.substring(0, 100) }));
    });
    console.log('ポップオーバー要素:', JSON.stringify(newElements, null, 2));
  }

  // 閉じる
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // "Japanese" を選択する
  console.log('\n=== "Japanese" を選択 ===');
  await globalBtn.click();
  await page.waitForTimeout(1000);

  // Japanese テキストを持つクリッカブルな要素を探す
  try {
    const japaneseOption = page.locator('text=Japanese').first();
    if (await japaneseOption.isVisible({ timeout: 2000 })) {
      await japaneseOption.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'tools/suno-tracker/test/trending-japanese.png' });
      console.log('Japanese 選択成功');
    }
  } catch (e) {
    console.log('Japanese 選択失敗:', e.message);
  }

  // Now ドロップダウンを探す
  console.log('\n=== "Now" ドロップダウンを探す ===');
  const nowBtn = page.locator('button:has-text("Now")').first();
  console.log('Now ボタン visible:', await nowBtn.isVisible());
  await nowBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tools/suno-tracker/test/trending-now-dropdown.png' });

  const periodOptions = await page.evaluate(() => {
    const all = document.querySelectorAll('div[style*="position"], div[class*="popover"], div[class*="dropdown"]');
    return [...all].filter(e => e.innerText.includes('Week') || e.innerText.includes('Month'))
      .map(e => e.innerText.trim().substring(0, 300));
  });
  console.log('期間オプション:', periodOptions);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 現在表示されてるトレンド曲を取得
  console.log('\n=== 現在のトレンド曲 ===');
  const trendSongs = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/song/"]');
    return [...links].slice(0, 10).map(l => ({
      title: l.innerText.trim(),
      href: l.href
    }));
  });
  console.log(JSON.stringify(trendSongs, null, 2));

  await browser.close();
  console.log('\n=== 完了 ===');
})();
