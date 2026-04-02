const { scrapeAllArtists } = require('./scraper');
const { checkAllTrends } = require('./trend-checker');
const { saveSongsData, saveTrendsData, saveFollowersData, getLastSongsData, saveArtistsList } = require('./csv-store');
const { detectAnomalies, formatAnomalySummary } = require('./anomaly-detector');
const { notifyAnomalies, notifyDailyReport } = require('./notifier');
const { hasRecentNewSong, shouldRunNow } = require('./frequency-checker');
const config = require('../config.json');

async function main() {
  const startTime = Date.now();
  console.log(`\n========================================`);
  console.log(`SUNO Tracker 実行開始: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`========================================\n`);

  // Step 0: 実行頻度チェック（新曲がなければ3時間おきのみ実行）
  const boostDays = config.schedule.newSongBoostDays || 10;
  const normalInterval = config.schedule.intervalHours || 3;
  const boostInterval = config.schedule.boostIntervalHours || 1;
  const hasNewSong = hasRecentNewSong(boostDays);

  if (hasNewSong) {
    console.log(`[頻度] 🆕 新曲検知（${boostDays}日以内）→ 高頻度モード（${boostInterval}時間おき）`);
  } else if (shouldRunNow(normalInterval)) {
    console.log(`[頻度] 通常モード（${normalInterval}時間おき）→ 実行`);
  } else {
    console.log(`[頻度] 通常モード → スキップ（前回取得から${normalInterval}時間未経過）`);
    console.log(`========================================\n`);
    return;
  }

  // Step 1: 前回データを取得（異常検知用）
  console.log('[1/6] 前回データを読み込み中...');
  const previousData = getLastSongsData();
  if (previousData) {
    const prevArtists = Object.keys(previousData);
    console.log(`  前回データあり: ${prevArtists.join(', ')}`);
  } else {
    console.log('  前回データなし（初回実行）');
  }

  // Step 2: アーティストデータ取得
  console.log('\n[2/6] アーティストデータを取得中...');
  const artistData = await scrapeAllArtists();

  // Step 3: トレンドチェック
  console.log('\n[3/6] トレンドをチェック中...');
  const trendResults = await checkAllTrends(artistData);

  // Step 4: CSV保存
  console.log('\n[4/6] データを保存中...');
  const savedSongs = saveSongsData(artistData);
  const savedTrends = saveTrendsData(trendResults);
  const savedFollowers = saveFollowersData(artistData);
  saveArtistsList(artistData);

  // Step 5: 異常検知
  console.log('\n[5/6] 異常検知中...');
  const anomalies = detectAnomalies(artistData, previousData, trendResults);
  if (anomalies.length > 0) {
    const summary = formatAnomalySummary(anomalies);
    console.log('  異常を検知:\n' + summary);
    await notifyAnomalies(summary);
  } else {
    console.log('  異常なし');
  }

  // Step 6: 定期レポート（設定された時間のみ）
  console.log('\n[6/6] 通知チェック...');
  const hour = new Date().getHours();
  if (hour === config.schedule.dailyReportHour) {
    console.log('  定期レポート送信');
    await notifyDailyReport(artistData, trendResults);
  } else {
    console.log(`  定期レポートは${config.schedule.dailyReportHour}時に送信（現在${hour}時）`);
  }

  // サマリー
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n========================================`);
  console.log(`実行完了 (${elapsed}秒)`);
  console.log(`  曲データ: ${savedSongs}件保存`);
  console.log(`  フォロワー: ${savedFollowers}件保存`);
  console.log(`  トレンド: ${savedTrends}件保存`);
  console.log(`  異常: ${anomalies.length}件`);

  // トレンドランクインのサマリー
  const allMatches = trendResults.flatMap(r => r.matches || []);
  if (allMatches.length > 0) {
    console.log(`  🏆 トレンドランクイン:`);
    for (const m of allMatches) {
      console.log(`    ${m.artist} "${m.title}" → ${m.rank}位`);
    }
  }
  console.log(`========================================\n`);
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
