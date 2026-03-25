const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ページを読み込んでセッションを取得
  await page.goto('https://suno.com/@coban3137?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // ページのHTMLソースから埋め込みJSONを探す
  const htmlSource = await page.content();

  // RSCペイロードからsongデータを探す（script type="application/json"）
  const scriptData = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    const results = [];
    for (const s of scripts) {
      const text = s.textContent;
      if (text && text.includes('song') && text.length > 100) {
        results.push({
          type: s.type || 'no-type',
          id: s.id || 'no-id',
          preview: text.substring(0, 500)
        });
      }
    }
    return results;
  });
  console.log('=== song含むscriptタグ ===');
  for (const s of scriptData) {
    console.log(`\nType: ${s.type}, ID: ${s.id}`);
    console.log(`Preview: ${s.preview}`);
  }

  // self.__next_f を確認（Next.js App Router のRSCデータ）
  const rscData = await page.evaluate(() => {
    if (typeof self !== 'undefined' && self.__next_f) {
      return self.__next_f.map(item => {
        const str = JSON.stringify(item);
        if (str.includes('play_count') || str.includes('song')) {
          return str.substring(0, 1000);
        }
        return null;
      }).filter(Boolean);
    }
    return [];
  });
  console.log('\n=== __next_f のsong関連データ ===');
  for (const d of rscData) {
    console.log(d);
  }

  // Fetch API で profile endpoints を試す
  console.log('\n=== Profile API テスト ===');
  const endpoints = [
    'https://studio-api-prod.suno.com/api/profiles/coban3137',
    'https://studio-api-prod.suno.com/api/profiles/coban3137/songs',
    'https://studio-api-prod.suno.com/api/profiles/coban3137/clips',
    'https://studio-api-prod.suno.com/api/profiles/coban3137/songs?page=0&per_page=100',
  ];

  for (const url of endpoints) {
    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u);
        const text = await res.text();
        return { status: res.status, body: text.substring(0, 500) };
      } catch (e) {
        return { error: e.message };
      }
    }, url);
    console.log(`\n${url}`);
    console.log(`Status: ${result.status || 'error'}`);
    console.log(`Body: ${result.body || result.error}`);
  }

  // HTMLソースから全クリップIDっぽいものを探す
  // "id":"uuid" パターン
  const clipIds = htmlSource.match(/"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g);
  console.log('\n=== HTMLの "id":"uuid" パターン ===');
  const uniqueIds = [...new Set((clipIds || []).map(m => m.replace(/"id":"/,'').replace(/"/,'')))];
  console.log(`${uniqueIds.length}個:`, uniqueIds);

  await browser.close();
})();
