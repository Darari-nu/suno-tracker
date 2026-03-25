# SUNO Tracker

SUNOアーティストの楽曲データを定期的に取得・蓄積し、グラフで可視化するツール。

## ダッシュボード

https://darari-nu.github.io/suno-tracker/dashboard/

## 仕組み

```
GitHub Actions（3時間ごと）
  ↓ SUNO Profile API で全曲データ+フォロワー数取得
  ↓ SUNO Discover API でトレンドチェック（8パターン）
  ↓ data/*.csv を更新 → 自動コミット＆プッシュ
  ↓ 異常検知時は Discord に通知

GitHub Pages
  ↓ dashboard/ を公開（ライトテーマ、Applify風デザイン）
  ↓ data/ のCSVを自動読み込み → グラフ表示
```

## セットアップ（GitHub Actions）

### 1. リポジトリをフォーク or クローン

### 2. GitHub Secrets を設定
リポジトリの Settings → Secrets and variables → Actions → New repository secret

| Name | Value |
|------|-------|
| `DISCORD_WEBHOOK_URL` | Discord Webhook の URL |

### 3. GitHub Pages を有効化
Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / `/ (root)`

### 4. 動作確認
Actions タブ → SUNO Tracker → Run workflow

## ローカルで実行する場合

### 1. 設定ファイルを作成
```bash
cp config.example.json config.json
```
`config.json` を開いて Discord Webhook URL を設定する。

> config.json は .gitignore に含まれており GitHub には上がりません。

### 2. 依存パッケージをインストール
```bash
npm install
npx playwright install chromium
```

### 3. 実行
```bash
node src/index.js
```

## ファイル構成

```
suno-tracker/
├── .github/workflows/tracker.yml  # GitHub Actions
├── src/
│   ├── index.js                   # メイン
│   ├── scraper.js                 # SUNO API + DOMフォールバック
│   ├── trend-checker.js           # トレンドチェック
│   ├── csv-store.js               # アーティスト別CSV保存
│   ├── anomaly-detector.js        # 異常検知
│   └── notifier.js                # Discord通知
├── dashboard/
│   ├── index.html                 # ダッシュボード
│   └── js/charts.js               # グラフ描画
├── data/                          # 蓄積データ（自動更新）
│   ├── darari_nu.csv
│   ├── coban3137.csv
│   ├── trends.csv
│   ├── followers.csv              # フォロワー推移
│   └── artists.json               # アーティスト一覧（アバター・フォロワー数含む）
├── config.example.json            # 設定テンプレート
└── docs/requirements.md           # 要件定義書
```

## 設定項目（config.json）

| キー | 説明 | デフォルト |
|------|------|-----------|
| artists | 対象アーティスト一覧 | darari_nu, coban3137 |
| trending.regions | チェックする地域 | Global, Japanese |
| trending.periods | チェックする期間 | Now, Weekly, Monthly, All Time |
| schedule.intervalHours | 実行間隔（時間） | 3 |
| schedule.dailyReportHour | 定期レポート送信時刻 | 9 |
| notification.discordWebhookUrl | Discord Webhook URL | （GitHub Secretsで設定） |
| notification.enabled | 通知の有効/無効 | false |
| playwright.headless | ヘッドレスモード | true |

## 異常検知

以下の異常を自動検知し、Discord に通知:

- データ取得失敗（ページ構造変更の可能性）
- 曲数の減少
- 再生数の減少（通常ありえない）
- データのスタック（同じ値が続く）
- トレンドチェック失敗
- API→DOMフォールバック発動（非公式API廃止の可能性）
