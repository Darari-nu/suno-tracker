const { chromium } = require('playwright');
const config = require('../config.json');

/**
 * SUNO Discover API でトレンド曲を取得する
 * ブラウザコンテキスト内からAPIを叩く
 */
async function fetchTrendingViaAPI(page, region, period) {
  return await page.evaluate(async ({ region, period }) => {
    const res = await fetch('https://studio-api-prod.suno.com/api/discover/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_index: 0,
        page_size: 1,
        section_name: 'trending_songs',
        section_content: region,
        secondary_section_content: period,
        page: 1,
        section_size: 50,
        disable_shuffle: true
      })
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }, { region, period });
}

/**
 * 特定の地域×期間のトレンドをチェックし、対象アーティストの曲を探す
 */
async function checkTrending(page, region, period, artistSongIds) {
  const result = await fetchTrendingViaAPI(page, region, period);

  const section = result.sections?.[0];
  if (!section || !section.items) {
    throw new Error('トレンドデータが取得できませんでした');
  }

  const trendSongs = section.items;
  console.log(`[trend]   ${region}/${period}: ${trendSongs.length}曲取得 (API)`);

  // 対象アーティストの曲がランクインしているか確認
  const matches = [];
  for (let i = 0; i < trendSongs.length; i++) {
    const song = trendSongs[i];
    for (const [artistName, songIds] of Object.entries(artistSongIds)) {
      if (songIds.includes(song.id)) {
        matches.push({
          artist: artistName,
          title: song.title,
          songId: song.id,
          rank: i + 1,
          plays: song.play_count || 0,
          likes: song.upvote_count || 0
        });
      }
    }
  }

  return {
    region,
    period,
    totalSongs: trendSongs.length,
    matches
  };
}

/**
 * 全パターンのトレンドをチェックする
 */
async function checkAllTrends(artistData) {
  const browser = await chromium.launch({ headless: config.playwright.headless });
  const page = await browser.newPage();
  const timestamp = new Date().toISOString();

  // アーティストごとのsongId一覧を作成
  const artistSongIds = {};
  for (const [artistName, data] of Object.entries(artistData)) {
    if (data.success) {
      artistSongIds[artistName] = data.songs.map(s => s.songId);
    }
  }

  // SUNOページを開く（API呼び出しにブラウザコンテキストが必要）
  console.log(`[trend] SUNOにアクセス中...`);
  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: config.playwright.timeout });
  await page.waitForTimeout(3000);

  const results = [];

  for (const region of config.trending.regions) {
    for (const period of config.trending.periods) {
      console.log(`[trend] ${region} / ${period} をチェック中...`);
      try {
        const result = await checkTrending(page, region, period, artistSongIds);
        result.timestamp = timestamp;
        result.success = true;
        results.push(result);

        if (result.matches.length > 0) {
          for (const m of result.matches) {
            console.log(`  ✅ ${m.artist} - "${m.title}" が ${region}/${period} で ${m.rank}位にランクイン！`);
          }
        } else {
          console.log(`  ランクインなし`);
        }
      } catch (error) {
        console.error(`[trend] ${region}/${period} チェック失敗:`, error.message);
        results.push({
          region,
          period,
          timestamp,
          success: false,
          error: error.message,
          matches: []
        });
      }
    }
  }

  await browser.close();
  return results;
}

module.exports = { checkAllTrends };

// 直接実行時のテスト
if (require.main === module) {
  const testArtistData = {
    darari_nu: {
      success: true,
      songs: [
        { songId: '2c2b8df8-af37-4b91-b0b6-98bb9dcc0759' },
        { songId: 'e389d0aa-1acf-48d3-930c-2bca08b4613c' },
        { songId: 'd3c0c370-3efc-46ed-89f7-9ec14f5248af' },
        { songId: 'a0dd7606-0a87-4312-9fef-34ccef5a52e6' },
        { songId: 'b611d79e-6a38-4c7b-9999-036078b08ed7' },
        { songId: '838a4082-03fb-4386-a5f3-61adef134444' },
      ]
    },
    coban3137: {
      success: true,
      songs: [
        { songId: '79cf91bc-167e-481f-9a49-b581919560c4' }, // BINARY
      ]
    }
  };

  checkAllTrends(testArtistData).then(results => {
    console.log('\n=== 結果サマリー ===');
    for (const r of results) {
      console.log(`${r.region}/${r.period}: ${r.success ? `${r.totalSongs}曲中 ${r.matches.length}曲ランクイン` : `エラー: ${r.error}`}`);
    }
  });
}
