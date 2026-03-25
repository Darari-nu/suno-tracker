const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://suno.com/@coban3137?page=songs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Profile API を正しいパラメータで呼ぶ
  const endpoints = [
    'https://studio-api-prod.suno.com/api/profiles/coban3137?playlists_sort_by=upvote_count&clips_sort_by=created_at',
    'https://studio-api-prod.suno.com/api/profiles/coban3137?playlists_sort_by=upvote_count&clips_sort_by=created_at&clips_page=0&clips_per_page=100',
    'https://studio-api-prod.suno.com/api/profiles/coban3137?playlists_sort_by=created_at&clips_sort_by=created_at&clips_page=0&clips_per_page=50',
  ];

  for (const url of endpoints) {
    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u);
        const json = await res.json();
        return {
          status: res.status,
          keys: Object.keys(json),
          clipCount: json.clips?.length || 0,
          totalClips: json.num_total_clips || json.total_clips || 'unknown',
          preview: JSON.stringify(json).substring(0, 500)
        };
      } catch (e) {
        return { error: e.message };
      }
    }, url);
    console.log(`\n${url}`);
    console.log(`Status: ${result.status}`);
    console.log(`Keys: ${result.keys?.join(', ')}`);
    console.log(`Clips: ${result.clipCount}, Total: ${result.totalClips}`);
    console.log(`Preview: ${result.preview}`);
  }

  // RSCデータからclipsの数を確認
  const rscClips = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    // "clips":[ で始まるJSONを探す
    const match = html.match(/"clips":\[(\{[^]*?\})\]/);
    if (match) {
      // クリップの数を数える
      const clipsStr = match[0];
      const idMatches = clipsStr.match(/"id":"[^"]+"/g);
      return idMatches?.length || 0;
    }
    return 0;
  });
  console.log(`\nRSCデータ内のクリップ数: ${rscClips}`);

  // RSCデータから全曲の情報を抽出
  const allClips = await page.evaluate(() => {
    // self.__next_f からRSCペイロードを抽出
    const allText = document.documentElement.innerHTML;
    const clipPattern = /"title":"([^"]+)","play_count":(\d+),"upvote_count":(\d+),"allow_comments":\w+,"id":"([0-9a-f-]+)"/g;
    const clips = [];
    let match;
    while ((match = clipPattern.exec(allText)) !== null) {
      clips.push({
        title: match[1],
        playCount: parseInt(match[2]),
        upvoteCount: parseInt(match[3]),
        id: match[4]
      });
    }
    return clips;
  });
  console.log(`\n=== RSCから抽出した全曲 (${allClips.length}曲) ===`);
  allClips.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.title} (再生:${c.playCount}, いいね:${c.upvoteCount}) [${c.id}]`);
  });

  await browser.close();
})();
