// node test/save-to-ssd.test.js  （ネットワーク・SSD には出ない。一時ディレクトリのみ）
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { planArtist, shouldSkipRoot, isAllowedImageHost } = require('../src/save_to_ssd');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'save-ssd-'));
const mk = (rel, content = 'x') => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const dir = path.join(tmp, 'Dara');
const clip = (id, title, imageUrl = 'https://cdn2.suno.ai/y.jpg') => ({ id, title, imageUrl });

t('大文字小文字・前後空白の違いで既存フォルダに一致', () => {
  mk('Dara/Hello World/a.txt');
  const [p] = planArtist(dir, [clip('aaaaaaaa1', '  hello world ')]);
  assert.strictEqual(p.folder, 'Hello World');
  assert.strictEqual(p.isNewFolder, false);
});
t('wav があれば音源 SKIP（拡張子大文字も）', () => {
  mk('Dara/Wavsong/mix.WAV');
  const [p] = planArtist(dir, [clip('bbbbbbbb1', 'Wavsong')]);
  assert.strictEqual(p.audio, 'wav-skip');
});
t('mp3 が既にあれば SKIP', () => {
  mk('Dara/Mp3song/Mp3song.mp3');
  const [p] = planArtist(dir, [clip('cccccccc1', 'Mp3song')]);
  assert.strictEqual(p.audio, 'mp3-exists');
});
t('音源なしは download、新規フォルダ', () => {
  const [p] = planArtist(dir, [clip('dddddddd1', 'Brand New')]);
  assert.strictEqual(p.audio, 'download');
  assert.strictEqual(p.isNewFolder, true);
  assert.strictEqual(p.folder, 'Brand New');
});
t('jacket が既にあれば SKIP / URL なしは no-url / 他は download', () => {
  mk('Dara/Jk/Jk_jacket.jpg');
  assert.strictEqual(planArtist(dir, [clip('eeeeeeee1', 'Jk')])[0].jacket, 'exists');
  assert.strictEqual(planArtist(dir, [clip('eeeeeeee2', 'NoImg', '')])[0].jacket, 'no-url');
  assert.strictEqual(planArtist(dir, [clip('eeeeeeee3', 'Img')])[0].jacket, 'download');
});
t('同名の別版は _<id8> フォルダ', () => {
  const ps = planArtist(dir, [clip('11112222abcd', 'Twin'), clip('33334444efgh', 'Twin')]);
  assert.strictEqual(ps[0].folder, 'Twin');
  assert.strictEqual(ps[1].folder, 'Twin_33334444');
  assert.strictEqual(ps[1].audio, 'download');
});
t('1曲目に wav があれば別版の音源も SKIP（jacket は保存）', () => {
  mk('Dara/Twinwav/a.wav');
  const ps = planArtist(dir, [clip('55556666abcd', 'Twinwav'), clip('77778888efgh', 'Twinwav')]);
  assert.strictEqual(ps[1].folder, 'Twinwav_77778888');
  assert.strictEqual(ps[1].audio, 'wav-skip');
  assert.strictEqual(ps[1].jacket, 'download');
});
t('同じ id の重複は1件にまとめる', () => {
  assert.strictEqual(planArtist(dir, [clip('99990000a', 'Dup'), clip('99990000a', 'Dup')]).length, 1);
});
t('root が無ければスキップして exit 0', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '../src/save_to_ssd.js'), '--root', path.join(tmp, 'nonexistent')], { encoding: 'utf8' });
  assert.ok(out.includes('SSD 未接続のためスキップ'));
});
t('.. や . ドット始まりのタイトルは root の外に出ない', () => {
  for (const title of ['..', '.', '...', '.hidden', '../x']) {
    const [p] = planArtist(dir, [clip('zzzzzzzz1', title)]);
    assert.ok(!p.unsafe, title);
    const rel = path.relative(dir, p.folderPath);
    assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep), title + ' -> ' + rel);
  }
});
t('EPERM は例外(exit1対象)、ENOENT はスキップ', () => {
  const mkErr = (code) => () => { const e = new Error('x'); e.code = code; throw e; };
  assert.strictEqual(shouldSkipRoot('/x', mkErr('ENOENT')), true);
  assert.throws(() => shouldSkipRoot('/x', mkErr('EPERM')), /cannot be accessed/);
});
t('EPERM 注入で実プロセスが exit 1', () => {
  let code = 0;
  try {
    execFileSync(process.execPath, [path.join(__dirname, '../src/save_to_ssd.js'), '--root', tmp], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SAVE_TO_SSD_TEST_STAT_ERROR: 'EPERM' } });
  } catch (e) { code = e.status; }
  assert.strictEqual(code, 1);
});
t('サブフォルダ(Stems/)内の wav も wav あり扱い', () => {
  mk('Dara/Circus/Stems/vocal.wav');
  const [p] = planArtist(dir, [clip('yyyyyyyy1', 'Circus')]);
  assert.strictEqual(p.audio, 'wav-skip');
});
t('suno 以外のホストのジャケットは拒否', () => {
  assert.ok(isAllowedImageHost('https://cdn2.suno.ai/image_large_x.jpeg'));
  assert.ok(isAllowedImageHost('https://suno.com/a.jpg'));
  assert.ok(!isAllowedImageHost('https://evil.com/a.jpg'));
  assert.ok(!isAllowedImageHost('https://notsuno.ai/a.jpg'));
  assert.ok(!isAllowedImageHost('https://suno.ai.evil.com/a.jpg'));
  assert.ok(!isAllowedImageHost('http://cdn2.suno.ai/a.jpg'));
  const [p] = planArtist(dir, [clip('xxxxxxxx1', 'BadHost', 'https://evil.com/a.jpg')]);
  assert.strictEqual(p.jacket, 'bad-host');
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
