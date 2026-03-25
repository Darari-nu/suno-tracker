const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ネットワーク監視でプロファイルAPIリクエストをキャプチャ
  const apiRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('profiles/coban3137')) {
      apiRequests.push(req.url());
    }
  });

  await page.goto('https://suno.com/@coban3137?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('=== ページロード時のプロファイルAPIリクエスト ===');
  apiRequests.forEach(u => console.log(u));

  // スクロールして追加リクエストを発生させる
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }

  console.log('\n=== スクロール後のプロファイルAPIリクエスト ===');
  apiRequests.forEach(u => console.log(u));

  // 様々なページネーションパラメータを試す
  console.log('\n=== パラメータテスト ===');
  const tests = [
    '?playlists_sort_by=upvote_count&clips_sort_by=created_at&page=1',
    '?playlists_sort_by=upvote_count&clips_sort_by=created_at&page=2',
    '?playlists_sort_by=upvote_count&clips_sort_by=created_at&offset=20',
    '?playlists_sort_by=upvote_count&clips_sort_by=created_at&clips_offset=20',
    '?playlists_sort_by=upvote_count&clips_sort_by=created_at&clips_page=1&clips_per_page=20',
  ];

  for (const params of tests) {
    const url = `https://studio-api-prod.suno.com/api/profiles/coban3137${params}`;
    const result = await page.evaluate(async (u) => {
      const res = await fetch(u);
      const json = await res.json();
      const titles = (json.clips || []).map(c => c.title);
      return {
        status: res.status,
        clipCount: json.clips?.length || 0,
        total: json.num_total_clips,
        currentPage: json.current_page,
        firstTitle: titles[0] || 'none',
        lastTitle: titles[titles.length - 1] || 'none'
      };
    }, url);
    console.log(`\n${params}`);
    console.log(`  clips=${result.clipCount}, total=${result.total}, page=${result.currentPage}, first="${result.firstTitle}", last="${result.lastTitle}"`);
  }

  await browser.close();
})();
