const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
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
  console.log(`初期（リスト表示）: ${songCount}曲`);
  await page.screenshot({ path: 'tools/suno-tracker/test/coban-list-view.png' });

  // 右上の表示切替ボタンを探す
  console.log('\n=== 表示切替ボタンを探す ===');

  // SVGアイコンのボタンを探す（グリッド/リスト切替はSVGアイコン付きボタンが多い）
  const toggleButtons = await page.evaluate(() => {
    // ページ右上のボタンを探す
    const buttons = document.querySelectorAll('button, div[role="button"], [class*="cursor-pointer"]');
    const results = [];
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      // 右上エリアにあるボタン（x > 700, y < 150）
      if (rect.x > 600 && rect.y < 200 && rect.width < 100) {
        results.push({
          tag: btn.tagName,
          class: btn.className.substring(0, 150),
          ariaLabel: btn.getAttribute('aria-label'),
          title: btn.getAttribute('title'),
          text: btn.innerText.trim().substring(0, 50),
          hasSvg: btn.querySelector('svg') !== null,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    }
    return results;
  });
  console.log('右上のボタン:', JSON.stringify(toggleButtons, null, 2));

  // SVGを持つボタンをクリック（グリッド表示に切り替え）
  const svgButtons = toggleButtons.filter(b => b.hasSvg);
  if (svgButtons.length > 0) {
    console.log(`\nSVGボタン ${svgButtons.length}個見つかった。クリックしてみる`);

    // 右上のSVGボタンをクリック
    for (let i = 0; i < svgButtons.length; i++) {
      const btn = svgButtons[i];
      console.log(`\nボタン${i+1}をクリック (x=${btn.x}, y=${btn.y})`);
      await page.click(`${btn.tag}.${btn.class.split(' ')[0]}`, { position: { x: 10, y: 10 } }).catch(() => {});
    }

    // 座標でクリック
    for (const btn of svgButtons) {
      await page.mouse.click(btn.x + btn.width / 2, btn.y + btn.height / 2);
      await page.waitForTimeout(2000);

      const newCount = await page.$$eval('a[href*="/song/"]', els => els.length);
      console.log(`クリック後: ${newCount}曲`);
      await page.screenshot({ path: `tools/suno-tracker/test/coban-after-toggle-${btn.x}.png` });
    }
  }

  // 「Top」タブも試す
  console.log('\n=== "Top" タブを試す ===');
  const topTab = page.locator('text="Top"').first();
  if (await topTab.isVisible({ timeout: 2000 })) {
    await topTab.click();
    await page.waitForTimeout(3000);

    // スクロールして全部読み込む
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const topCount = await page.$$eval('a[href*="/song/"]', els => els.length);
    console.log(`Topタブ: ${topCount}曲`);
    await page.screenshot({ path: 'tools/suno-tracker/test/coban-top-tab.png' });
  }

  // グリッド表示に切り替えてスクロール
  console.log('\n=== グリッド表示でスクロール ===');
  // もう一度Recentに戻す
  const recentTab = page.locator('text="Recent"').first();
  if (await recentTab.isVisible({ timeout: 2000 })) {
    await recentTab.click();
    await page.waitForTimeout(2000);
  }

  // グリッドビューのトグルボタン（2つ目のSVGボタン）をクリック
  if (svgButtons.length >= 2) {
    await page.mouse.click(svgButtons[1].x + svgButtons[1].width / 2, svgButtons[1].y + svgButtons[1].height / 2);
    await page.waitForTimeout(2000);
  }

  // ガンガンスクロール
  let prevCount = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const count = await page.$$eval('a[href*="/song/"]', els => els.length);
    if (count !== prevCount) {
      console.log(`スクロール${i+1}: ${count}曲`);
      prevCount = count;
    } else if (i > 0) {
      // 追加待ち
      await page.waitForTimeout(3000);
      const finalCount = await page.$$eval('a[href*="/song/"]', els => els.length);
      if (finalCount === prevCount) {
        console.log(`これ以上なし: ${finalCount}曲`);
        break;
      }
    }
  }

  await page.screenshot({ path: 'tools/suno-tracker/test/coban-grid-scrolled.png' });

  // 最終タイトル
  const titles = await page.$$eval('a[href*="/song/"]', els => els.map(e => e.innerText.trim()).filter(t => t));
  console.log(`\n最終: ${titles.length}曲`);
  titles.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  await browser.close();
})();
