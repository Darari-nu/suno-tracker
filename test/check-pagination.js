const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://suno.com/@coban3137', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // ページ0, 1, 2... と取得して全曲集める
  const allClips = [];
  let pageNum = 0;
  let totalClips = 0;

  while (true) {
    const url = `https://studio-api-prod.suno.com/api/profiles/coban3137?playlists_sort_by=upvote_count&clips_sort_by=created_at&clips_page=${pageNum}`;
    const result = await page.evaluate(async (u) => {
      const res = await fetch(u);
      return res.json();
    }, url);

    totalClips = result.num_total_clips;
    const clips = result.clips || [];
    console.log(`Page ${pageNum}: ${clips.length}曲取得 (累計: ${allClips.length + clips.length}/${totalClips})`);

    for (const clip of clips) {
      allClips.push({
        id: clip.id,
        title: clip.title,
        playCount: clip.play_count,
        upvoteCount: clip.upvote_count,
        commentCount: clip.comment_count
      });
    }

    if (clips.length === 0 || allClips.length >= totalClips) break;
    pageNum++;
  }

  console.log(`\n=== 全 ${allClips.length}/${totalClips} 曲 ===`);
  allClips.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.title} (再生:${c.playCount}, いいね:${c.upvoteCount}, コメント:${c.commentCount || 0}) [${c.id}]`);
  });

  await browser.close();
})();
