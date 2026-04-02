const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const DATA_DIR = path.resolve(__dirname, '..', 'data');

/**
 * アーティストのCSVから最新曲の createdAt を取得する
 * アーティスト別CSV（{name}.csv）と統合CSV（songs.csv）の両方に対応
 */
function getNewestSongDate(artistName) {
  // まずアーティスト別CSV（新形式、createdAtあり）を探す
  const artistCsv = path.join(DATA_DIR, `${artistName}.csv`);
  if (fs.existsSync(artistCsv)) {
    const newest = findNewestCreatedAt(artistCsv);
    if (newest) return newest;
  }

  // なければ統合CSV（songs.csv）から探す（createdAtカラムがあれば）
  const songsCsv = path.join(DATA_DIR, 'songs.csv');
  if (fs.existsSync(songsCsv)) {
    return findNewestCreatedAt(songsCsv, artistName);
  }

  return null;
}

/**
 * CSVファイルから最新の createdAt を取得
 */
function findNewestCreatedAt(csvPath, filterArtist) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length <= 1) return null;

  // ヘッダーから createdAt カラムのインデックスを探す
  const header = parseCSVLine(lines[0]);
  const createdAtIdx = header.findIndex(h => h.toLowerCase() === 'createdat');
  if (createdAtIdx === -1) return null;

  const artistIdx = header.findIndex(h => h.toLowerCase() === 'artist');

  let newest = null;
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (filterArtist && artistIdx !== -1 && fields[artistIdx] !== filterArtist) continue;
    const createdAt = fields[createdAtIdx];
    if (createdAt && createdAt !== '') {
      const date = new Date(createdAt);
      if (!isNaN(date.getTime()) && (!newest || date > newest)) {
        newest = date;
      }
    }
  }
  return newest;
}

/**
 * いずれかのアーティストに指定日数以内の新曲があるか判定
 */
function hasRecentNewSong(boostDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - boostDays);

  for (const artist of config.artists) {
    const newest = getNewestSongDate(artist.name);
    if (newest && newest > cutoff) {
      console.log(`  ${artist.name}: 最新曲 ${newest.toISOString().slice(0, 10)}（${boostDays}日以内）`);
      return true;
    }
  }
  return false;
}

/**
 * CSV行をパースする
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

module.exports = { hasRecentNewSong };
