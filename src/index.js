const { scrapeAllArtists } = require('./scraper');
const { checkAllTrends } = require('./trend-checker');
const { saveSongsData, saveTrendsData, saveFollowersData, getLastSongsData, saveArtistsList, getKnownSongIds } = require('./csv-store');
const { detectAnomalies, formatAnomalySummary } = require('./anomaly-detector');
const { notifyAnomalies, sendWebhook, IMMEDIATE_TYPES } = require('./notifier');
const { runDailyReportIfDue } = require('./daily-report');
const { appendRunLog } = require('./run-log');
const { hasRecentNewSong, shouldRunNow } = require('./frequency-checker');
const { collectSongDetails } = require('./2ndbrain-publisher');
const { dispatchSrtGeneration } = require('./srt-dispatcher');
const config = require('../config.json');

async function main() {
  const startTime = Date.now();
  console.log(`\n========================================`);
  console.log(`SUNO Tracker 実行開始: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`========================================\n`);

  // Step -1: 日報（JSTで設定時刻以降の最初の実行で1日1通。頻度チェックでスキップされる回でも判定する）
  try {
    const r = await runDailyReportIfDue({
      now: new Date(),
      reportHour: config.schedule.dailyReportHour,
      artists: config.artists.map(a => a.name),
      send: sendWebhook
    });
    console.log(`[日報] ${r.sent ? '送信' : r.reason}`);
  } catch (err) {
    console.error('[日報] エラー（実行は継続）:', err.message);
  }

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

  // 保存前の全履歴 songId（新曲判定用。保存後だと今回分が入ってしまう）
  const knownSongIds = {};
  for (const a of config.artists) knownSongIds[a.name] = getKnownSongIds(a.name);

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
  const anomalies = detectAnomalies(artistData, previousData, trendResults, knownSongIds);
  if (anomalies.length > 0) {
    const summary = formatAnomalySummary(anomalies);
    console.log('  異常を検知:\n' + summary);
    const immediateCount = anomalies.filter(a => IMMEDIATE_TYPES.includes(a.type)).length;
    console.log(`  即時通知対象: ${immediateCount}件（残りは日報の注意に集約）`);
    await notifyAnomalies(anomalies);

    // 新曲が検知された場合、SRT自動生成をdispatchする（歌詞などの材料を集めてから渡す）
    const newSongs = anomalies.filter(a => a.type === 'NEW_SONG');
    if (newSongs.length > 0) {
      console.log(`\n🆕 新曲を検知したため、SRT自動生成の準備を開始します (${newSongs.length}件)...`);
      try {
        const targets = newSongs.map(a => ({ songId: a.songId, handle: a.handle }));
        const { songs } = await collectSongDetails(targets);

        // 新曲のSRT/JSON/beatsをクラウドで自動生成（vocal-srt-generatorへdispatch）
        await dispatchSrtGeneration(songs);
      } catch (err) {
        console.error('[index] 新曲の詳細取得/dispatchでエラーが発生しました:', err.message);
      }
    }
  } else {
    console.log('  異常なし');
  }

  // Step 6: 実行記録（日報の材料）
  console.log('\n[6/6] 実行記録を保存...');
  try {
    const artistsLog = {};
    for (const [name, d] of Object.entries(artistData)) {
      artistsLog[name] = { success: !!d.success, method: d.method, songCount: d.songCount };
    }
    appendRunLog({
      ts: new Date().toISOString(),
      artists: artistsLog,
      anomalies: anomalies.map(a => ({ type: a.type, severity: a.severity, artist: a.artist, message: a.message }))
    });
  } catch (err) {
    console.error('[run-log] 保存エラー:', err.message);
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
