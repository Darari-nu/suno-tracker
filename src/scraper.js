const { chromium } = require('playwright');
const config = require('../config.json');

/**
 * SUNO Profile API でアーティストの全曲データを取得する
 * ブラウザコンテキスト内からAPIを叩く（認証不要）
 */
async function fetchArtistViaAPI(page, handle) {
  const allClips = [];
  let pageNum = 1;
  let totalClips = 0;

  while (true) {
    const url = `https://studio-api-prod.suno.com/api/profiles/${handle}?playlists_sort_by=upvote_count&clips_sort_by=created_at&page=${pageNum}`;
    const result = await page.evaluate(async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    }, url);

    totalClips = result.num_total_clips || 0;
    const clips = result.clips || [];

    for (const clip of clips) {
      // 重複チェック（IDベース）
      if (!allClips.some(c => c.songId === clip.id)) {
        allClips.push({
          title: clip.title,
          url: `https://suno.com/song/${clip.id}`,
          songId: clip.id,
          plays: clip.play_count || 0,
          likes: clip.upvote_count || 0,
          comments: clip.comment_count || 0
        });
      }
    }

    console.log(`[scraper]   API page ${pageNum}: ${clips.length}曲取得 (累計: ${allClips.length}/${totalClips})`);

    if (clips.length === 0 || allClips.length >= totalClips) break;
    pageNum++;

    // 安全弁: 10ページ以上はスキップ
    if (pageNum > 10) break;
  }

  return allClips;
}

/**
 * フォールバック: DOMスクレイピングで曲データを取得する（APIが使えない場合）
 */
async function scrapeArtistDOM(page, artistUrl) {
  await page.goto(artistUrl, { waitUntil: 'domcontentloaded', timeout: config.playwright.timeout });
  await page.waitForTimeout(5000);

  // Cookie バナーを閉じる
  try {
    const acceptBtn = page.locator('button:has-text("Accept All Cookies")');
    if (await acceptBtn.isVisible({ timeout: 2000 })) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {}

  // スクロールして全曲を読み込む
  let prevHeight = 0;
  for (let i = 0; i < config.playwright.maxScrollAttempts; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === prevHeight) break;
    prevHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(config.playwright.scrollDelay);
  }

  // 曲データを抽出
  return await page.evaluate(() => {
    const songLinks = document.querySelectorAll('a[href*="/song/"]');
    const results = [];
    for (const link of songLinks) {
      let row = link;
      for (let i = 0; i < 10; i++) {
        row = row.parentElement;
        if (!row) break;
        const text = row.innerText;
        if (text.includes(link.innerText) && /\d+\.\d+K|\d{2,}/.test(text)) {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          const numericLines = [];
          for (let j = lines.length - 1; j >= 0; j--) {
            if (/^[\d,.]+[KM]?$/.test(lines[j])) numericLines.unshift(lines[j]);
            else break;
          }
          if (numericLines.length >= 3) {
            const parseCount = (s) => {
              if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
              if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
              return parseInt(s.replace(/,/g, ''), 10) || 0;
            };
            results.push({
              title: link.innerText.trim(),
              url: link.href,
              songId: link.href.split('/song/')[1] || '',
              plays: parseCount(numericLines[numericLines.length - 3]),
              likes: parseCount(numericLines[numericLines.length - 2]),
              comments: parseCount(numericLines[numericLines.length - 1])
            });
          }
          break;
        }
      }
    }
    return results;
  });
}

/**
 * 全アーティストの曲データを取得する
 * まずAPI方式を試し、失敗したらDOMスクレイピングにフォールバック
 */
async function scrapeAllArtists() {
  const browser = await chromium.launch({ headless: config.playwright.headless });
  const page = await browser.newPage();
  const timestamp = new Date().toISOString();

  // まず任意のSUNOページを開く（API呼び出しにブラウザコンテキストが必要）
  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: config.playwright.timeout });
  await page.waitForTimeout(3000);

  const results = {};

  for (const artist of config.artists) {
    const handle = artist.name;
    console.log(`[scraper] ${handle} のデータを取得中...`);

    try {
      // API方式で取得
      console.log(`[scraper]   API方式で取得...`);
      const songs = await fetchArtistViaAPI(page, handle);

      if (songs.length > 0) {
        results[handle] = {
          songs,
          timestamp,
          success: true,
          songCount: songs.length,
          method: 'api'
        };
        console.log(`[scraper] ${handle}: ${songs.length} 曲取得完了 (API)`);
        continue;
      }
    } catch (error) {
      console.warn(`[scraper]   API方式失敗: ${error.message}`);
    }

    // フォールバック: DOMスクレイピング
    try {
      console.log(`[scraper]   フォールバック: DOMスクレイピング...`);
      const songs = await scrapeArtistDOM(page, artist.url);
      results[handle] = {
        songs,
        timestamp,
        success: true,
        songCount: songs.length,
        method: 'dom'
      };
      console.log(`[scraper] ${handle}: ${songs.length} 曲取得完了 (DOM)`);
    } catch (error) {
      console.error(`[scraper] ${handle} のデータ取得に失敗:`, error.message);
      results[handle] = {
        songs: [],
        timestamp,
        success: false,
        error: error.message,
        songCount: 0
      };
    }
  }

  await browser.close();
  return results;
}

module.exports = { scrapeAllArtists };

// 直接実行時のテスト
if (require.main === module) {
  scrapeAllArtists().then(results => {
    for (const [artist, data] of Object.entries(results)) {
      console.log(`\n=== ${artist} (${data.songCount}曲, ${data.method || 'unknown'}) ===`);
      if (data.success) {
        for (const song of data.songs) {
          console.log(`  ${song.title}: 再生${song.plays} / いいね${song.likes} / コメント${song.comments}`);
        }
      } else {
        console.log(`  エラー: ${data.error}`);
      }
    }
  });
}
