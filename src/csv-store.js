const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const BASE_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const TRENDS_FILE = path.join(DATA_DIR, config.data.trendsFile || 'trends.csv');

const SONGS_HEADER = 'timestamp,artist,songId,title,url,plays,likes,comments,imageUrl,createdAt';
const TRENDS_HEADER = 'timestamp,region,period,artist,songId,title,rank,plays,likes';

/**
 * CSVの値をエスケープする
 */
function csvEscape(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * CSV行を作る
 */
function csvRow(values) {
  return values.map(csvEscape).join(',');
}

/**
 * CSVファイルを初期化（ヘッダーがなければ作成）
 */
function ensureFile(filePath, header) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header + '\n', 'utf-8');
    console.log(`[csv] ${filePath} を作成`);
  }
}

/**
 * アーティスト名からCSVファイルパスを取得
 */
function getArtistFile(artistName) {
  return path.join(DATA_DIR, `${artistName}.csv`);
}

/**
 * 曲データをアーティスト別CSVに追記する
 */
function saveSongsData(artistData) {
  let totalLines = 0;

  for (const [artistName, data] of Object.entries(artistData)) {
    if (!data.success) continue;

    const artistFile = getArtistFile(artistName);
    ensureFile(artistFile, SONGS_HEADER);

    const lines = [];
    for (const song of data.songs) {
      lines.push(csvRow([
        data.timestamp,
        artistName,
        song.songId,
        song.title,
        song.url,
        song.plays,
        song.likes,
        song.comments,
        song.imageUrl || '',
        song.createdAt || ''
      ]));
    }

    if (lines.length > 0) {
      fs.appendFileSync(artistFile, lines.join('\n') + '\n', 'utf-8');
      console.log(`[csv] ${artistName}: ${lines.length}件保存 → ${artistFile}`);
      totalLines += lines.length;
    }
  }

  return totalLines;
}

/**
 * artists.json を生成する（ダッシュボード用）
 */
function saveArtistsList(artistData) {
  const artists = Object.entries(artistData).map(([name, data]) => ({
    name,
    avatar: data.avatarUrl || ''
  }));
  const filePath = path.join(DATA_DIR, 'artists.json');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(artists, null, 2), 'utf-8');
  console.log(`[csv] artists.json 更新: ${artists.map(a => a.name).join(', ')}`);
}

/**
 * トレンドデータをCSVに追記する
 */
function saveTrendsData(trendResults) {
  ensureFile(TRENDS_FILE, TRENDS_HEADER);

  const lines = [];
  for (const result of trendResults) {
    if (!result.success) continue;
    for (const match of result.matches) {
      lines.push(csvRow([
        result.timestamp,
        result.region,
        result.period,
        match.artist,
        match.songId,
        match.title,
        match.rank,
        match.plays,
        match.likes
      ]));
    }
    // ランクインなしの場合でも、チェックした記録を残す
    if (result.matches.length === 0) {
      lines.push(csvRow([
        result.timestamp,
        result.region,
        result.period,
        '-',
        '-',
        '-',
        0,
        0,
        0
      ]));
    }
  }

  if (lines.length > 0) {
    fs.appendFileSync(TRENDS_FILE, lines.join('\n') + '\n', 'utf-8');
    console.log(`[csv] ${lines.length}件のトレンドデータを保存 → ${TRENDS_FILE}`);
  }

  return lines.length;
}

/**
 * 前回の曲データを取得する（異常検知用）
 */
function getLastSongsData() {
  const lastData = {};

  for (const artist of config.artists) {
    const artistFile = getArtistFile(artist.name);
    if (!fs.existsSync(artistFile)) continue;

    const content = fs.readFileSync(artistFile, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length <= 1) continue; // ヘッダーのみ

    // 最新のtimestampを取得
    const lastLine = lines[lines.length - 1];
    const lastTimestamp = lastLine.split(',')[0].replace(/"/g, '');

    // 同じタイムスタンプの行を全部取得
    const artistSongs = [];
    for (let i = lines.length - 1; i >= 1; i--) {
      const fields = parseCSVLine(lines[i]);
      if (fields[0] !== lastTimestamp) break;

      artistSongs.push({
        songId: fields[2],
        title: fields[3],
        plays: parseInt(fields[5], 10) || 0,
        likes: parseInt(fields[6], 10) || 0,
        comments: parseInt(fields[7], 10) || 0
      });
    }

    if (artistSongs.length > 0) {
      lastData[artist.name] = {
        songs: artistSongs,
        timestamp: lastTimestamp,
        songCount: artistSongs.length
      };
    }
  }

  return Object.keys(lastData).length > 0 ? lastData : null;
}

/**
 * CSV行をパースする（カンマ内のクォート対応）
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

module.exports = { saveSongsData, saveTrendsData, getLastSongsData, saveArtistsList };
