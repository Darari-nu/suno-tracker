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

  // "Global" テキストを含むすべての要素を探す
  console.log('=== "Global" を含む全要素 ===');
  const globalEls = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const results = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.childNodes.length <= 3 && el.textContent.trim() === 'Global') {
        results.push({
          tag: el.tagName,
          class: el.className.substring(0, 150),
          role: el.getAttribute('role'),
          ariaExpanded: el.getAttribute('aria-expanded'),
          ariaHaspopup: el.getAttribute('aria-haspopup'),
          dataState: el.getAttribute('data-state'),
          parentTag: el.parentElement?.tagName,
          parentRole: el.parentElement?.getAttribute('role'),
          clickable: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.style.cursor === 'pointer'
        });
      }
    }
    return results;
  });
  console.log(JSON.stringify(globalEls, null, 2));

  // "Now" を含むすべての要素
  console.log('\n=== "Now" を含む全要素 ===');
  const nowEls = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const results = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.childNodes.length <= 3 && el.textContent.trim() === 'Now') {
        results.push({
          tag: el.tagName,
          class: el.className.substring(0, 150),
          role: el.getAttribute('role'),
          ariaExpanded: el.getAttribute('aria-expanded'),
          ariaHaspopup: el.getAttribute('aria-haspopup'),
          dataState: el.getAttribute('data-state'),
          parentTag: el.parentElement?.tagName,
          parentRole: el.parentElement?.getAttribute('role')
        });
      }
    }
    return results;
  });
  console.log(JSON.stringify(nowEls, null, 2));

  // "Global" に近い要素をクリックしてみる
  console.log('\n=== "Global" をクリック ===');
  const globalLocator = page.locator('text="Global"').first();
  if (await globalLocator.isVisible({ timeout: 3000 })) {
    await globalLocator.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tools/suno-tracker/test/trending-after-global-click.png' });

    // ドロップダウンの中身
    const dropdownContent = await page.evaluate(() => {
      // ポップオーバーっぽい要素を探す
      const poppers = document.querySelectorAll('[data-radix-popper-content-wrapper], [role="listbox"], [role="menu"], div[data-state="open"]');
      const results = [];
      for (const p of poppers) {
        results.push(p.innerText.trim().substring(0, 500));
      }
      // aria-expanded=trueの要素の隣を探す
      const expanded = document.querySelectorAll('[aria-expanded="true"]');
      for (const e of expanded) {
        const sibling = e.nextElementSibling;
        if (sibling) results.push(sibling.innerText.trim().substring(0, 500));
      }
      return results;
    });
    console.log('ドロップダウン内容:', JSON.stringify(dropdownContent, null, 2));

    // Japanese を選択
    const japaneseLocator = page.locator('text="Japanese"').first();
    if (await japaneseLocator.isVisible({ timeout: 2000 })) {
      console.log('Japanese が見つかった！');
      await japaneseLocator.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'tools/suno-tracker/test/trending-japanese-selected.png' });
      console.log('Japanese 選択成功');
    } else {
      console.log('Japanese が見つからない');
    }
  } else {
    console.log('"Global" テキストが見つからない');
  }

  // 現在表示中のトレンド曲を取得
  console.log('\n=== トレンド曲一覧 ===');
  const songs = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/song/"]');
    return [...links].slice(0, 20).map(l => l.innerText.trim().substring(0, 80));
  });
  console.log(JSON.stringify(songs, null, 2));

  await browser.close();
  console.log('\n=== 完了 ===');
})();
