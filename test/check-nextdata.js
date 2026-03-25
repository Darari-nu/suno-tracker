const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 全てのレスポンスをキャプチャ（曲一覧関連）
  const responses = [];
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    // Next.jsのデータフェッチやprofile関連のAPI
    if ((url.includes('profiles') || url.includes('_next/data') || url.includes('playlist') || url.includes('songs')) && contentType.includes('json')) {
      try {
        const body = await response.text();
        responses.push({ url: url.substring(0, 300), status: response.status(), body: body.substring(0, 1000) });
      } catch (e) {}
    }
  });

  await page.goto('https://suno.com/@coban3137?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('=== プロフィール/曲関連レスポンス ===');
  for (const r of responses) {
    console.log(`\nURL: ${r.url}`);
    console.log(`Status: ${r.status}`);
    console.log(`Body: ${r.body}`);
  }

  // __NEXT_DATA__ を確認
  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    if (el) return el.textContent.substring(0, 2000);
    return null;
  });
  console.log('\n=== __NEXT_DATA__ ===');
  console.log(nextData ? nextData.substring(0, 2000) : 'なし');

  // RSC (React Server Components) のデータを確認
  // Next.js App Router uses RSC payloads
  const rscResponses = [];
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('text/x-component') || url.includes('_rsc')) {
      try {
        const body = await response.text();
        rscResponses.push({ url, body: body.substring(0, 2000) });
      } catch (e) {}
    }
  });

  // ページの初期HTMLからsong IDを全て抽出
  const allSongIds = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const matches = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
    return [...new Set(matches || [])];
  });
  console.log(`\n=== ページ内のUUID (${allSongIds.length}個) ===`);
  allSongIds.forEach(id => console.log(id));

  await browser.close();
})();
