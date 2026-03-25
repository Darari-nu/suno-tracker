const { chromium } = require('playwright');
const config = require('../config.json');

/**
 * 再生数の文字列を数値に変換する
 */
function parseCount(str) {
  if (!str) return 0;
  str = str.trim();
  if (str.endsWith('K')) return Math.round(parseFloat(str.replace('K', '')) * 1000);
  if (str.endsWith('M')) return Math.round(parseFloat(str.replace('M', '')) * 1000000);
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

/**
 * フィルターエリアのドロップダウン（地域 or 期間）を操作する
 * @param {number} dropdownIndex - 0=地域, 1=期間
 */
async function selectFilter(page, dropdownIndex, targetLabel) {
  const selector = 'div.inline-flex.cursor-pointer.min-w-20';
  const triggers = page.locator(selector);
  const count = await triggers.count();

  if (count <= dropdownIndex) {
    throw new Error(`ドロップダウンが見つからない (count=${count}, index=${dropdownIndex})`);
  }

  const trigger = triggers.nth(dropdownIndex);
  const currentLabel = await trigger.locator('span.line-clamp-1').innerText();

  if (currentLabel === targetLabel) {
    return; // 既に選択済み
  }

  // ドロップダウンを開く
  await trigger.click();
  await page.waitForTimeout(1000);

  // page.evaluate でドロップダウン内のオプションを直接クリック
  // オプションは div.font-sans.font-medium 内にテキストがある
  const clicked = await page.evaluate((label) => {
    // 方法1: font-sans font-medium クラスを持つ要素（SUNOのドロップダウンオプション）
    const options = document.querySelectorAll('div.font-sans.font-medium');
    for (const opt of options) {
      if (opt.textContent.trim() === label &&
          opt.offsetParent !== null &&
          opt.children.length === 0) {
        // 親のcursor-pointer要素をクリック（イベントリスナーが親にある場合）
        const parent = opt.closest('.cursor-pointer');
        if (parent) {
          parent.click();
          return 'parent-click';
        }
        opt.click();
        return 'direct-click';
      }
    }

    // 方法2: テキスト完全一致で cursor-pointer 内の子要素
    const cursorDivs = document.querySelectorAll('div.cursor-pointer');
    for (const div of cursorDivs) {
      const children = div.querySelectorAll('div');
      for (const child of children) {
        if (child.textContent.trim() === label &&
            child.children.length === 0 &&
            child.offsetParent !== null) {
          div.click();
          return 'nested-click';
        }
      }
    }

    return null;
  }, targetLabel);

  if (clicked) {
    console.log(`[trend]   "${targetLabel}" 選択成功 (${clicked})`);
  } else {
    // 最終フォールバック: Playwright のテキストセレクタ
    console.log(`[trend]   "${targetLabel}" evaluate失敗、Playwrightフォールバック`);
    try {
      await page.locator(`text="${targetLabel}"`).first().click({ force: true, timeout: 3000 });
    } catch (e) {
      console.error(`[trend]   "${targetLabel}" 選択に完全失敗`);
    }
  }
  await page.waitForTimeout(2000);

  // フィルターが変わったか確認
  const newLabel = await trigger.locator('span.line-clamp-1').innerText();
  if (newLabel !== targetLabel) {
    console.warn(`[trend]   フィルター未変更: "${newLabel}" (期待: "${targetLabel}")`);
  }
}

/**
 * 現在表示中のトレンドから全曲を取得する
 */
async function getCurrentTrendSongs(page) {
  // コンテンツ読み込み待ち
  await page.waitForTimeout(2000);

  // スクロールして全曲読み込み（CI環境ではより多くのスクロールが必要）
  let prevCount = 0;
  let stableCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const currentCount = await page.locator('a[href*="/song/"]').count();
    if (currentCount === prevCount) {
      stableCount++;
      if (stableCount >= 3) break; // 3回連続で変化なし→全曲読み込み完了
    } else {
      stableCount = 0;
    }
    prevCount = currentCount;
  }
  // ページトップに戻る
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // 曲データを取得
  return await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/song/"]');
    const songs = [];
    const seen = new Set();

    for (const link of links) {
      const href = link.href;
      if (seen.has(href) || !link.innerText.trim()) continue;
      seen.add(href);

      // 親要素から再生数・いいねを取得
      let row = link;
      for (let i = 0; i < 10; i++) {
        row = row.parentElement;
        if (!row) break;
        const text = row.innerText;
        if (text.includes(link.innerText) && /\d+\.\d+K|\d{2,}/.test(text)) {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          const numericLines = [];
          for (let j = lines.length - 1; j >= 0; j--) {
            if (/^[\d,.]+[KM]?$/.test(lines[j])) {
              numericLines.unshift(lines[j]);
            } else {
              break;
            }
          }
          if (numericLines.length >= 2) {
            songs.push({
              title: link.innerText.trim(),
              url: href,
              songId: href.split('/song/')[1] || '',
              playsRaw: numericLines[numericLines.length - 2],
              likesRaw: numericLines[numericLines.length - 1]
            });
          }
          break;
        }
      }
    }
    return songs;
  });
}

/**
 * 特定の地域×期間のトレンドをチェックし、対象アーティストの曲を探す
 */
async function checkTrending(page, region, period, artistSongIds) {
  // 地域を切り替え（index 0）
  await selectFilter(page, 0, region);

  // 期間を切り替え（index 1）
  await selectFilter(page, 1, period);

  await page.waitForTimeout(2000);

  // 現在のトレンド曲を取得
  const trendSongs = await getCurrentTrendSongs(page);
  console.log(`[trend]   ${region}/${period}: ${trendSongs.length}曲取得`);

  // 対象アーティストの曲がランクインしているか確認
  const matches = [];
  for (let i = 0; i < trendSongs.length; i++) {
    const song = trendSongs[i];
    for (const [artistName, songIds] of Object.entries(artistSongIds)) {
      if (songIds.includes(song.songId)) {
        matches.push({
          artist: artistName,
          title: song.title,
          songId: song.songId,
          rank: i + 1,
          plays: song.playsRaw,
          likes: song.likesRaw
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

  console.log(`[trend] トレンドページにアクセス中...`);
  await page.goto(config.trending.url, { waitUntil: 'domcontentloaded', timeout: config.playwright.timeout });
  await page.waitForTimeout(5000);

  // Cookie バナーを閉じる
  try {
    const acceptBtn = page.locator('button:has-text("Accept All Cookies")');
    if (await acceptBtn.isVisible({ timeout: 2000 })) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {}

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
  // テスト用のダミーデータ
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
