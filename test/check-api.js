const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ネットワークリクエストを監視してAPIエンドポイントを見つける
  const apiCalls = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('graphql') || url.includes('/v1/')) {
      const status = response.status();
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json')) {
        try {
          const body = await response.json();
          apiCalls.push({
            url: url.substring(0, 200),
            status,
            bodyKeys: Object.keys(body),
            bodyPreview: JSON.stringify(body).substring(0, 500)
          });
        } catch (e) {
          apiCalls.push({ url: url.substring(0, 200), status, error: 'parse failed' });
        }
      }
    }
  });

  await page.goto('https://suno.com/@coban3137?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  console.log('=== API呼び出し一覧 ===');
  for (const call of apiCalls) {
    console.log(`\nURL: ${call.url}`);
    console.log(`Status: ${call.status}`);
    if (call.bodyKeys) console.log(`Keys: ${call.bodyKeys.join(', ')}`);
    if (call.bodyPreview) console.log(`Preview: ${call.bodyPreview}`);
  }

  // song関連のAPIを探す
  const songApis = apiCalls.filter(c => c.url.includes('song') || c.url.includes('clip') || c.url.includes('profile'));
  console.log('\n=== Song/Profile関連API ===');
  for (const call of songApis) {
    console.log(`URL: ${call.url}`);
    console.log(`Preview: ${call.bodyPreview}`);
  }

  await browser.close();
})();
