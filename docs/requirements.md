# SUNO Tracker 要件定義書

## 1. 概要

### 1.1 目的
DaraとCobanの楽曲の伸び方をデータで把握し、PDCAを回すための分析ツール。
どんな曲がどんなふうに伸びていくのかを可視化し、楽曲制作の改善に活用する。

### 1.2 対象アーティスト
| 名前 | URL |
|------|-----|
| darari_nu | https://suno.com/@darari_nu?page=songs |
| coban3137 | https://suno.com/@coban3137?page=songs |

## 2. 取得データ

### 2.1 各曲の数値データ
SUNO Profile APIを使って全曲を自動取得し、以下のデータを記録する。
APIが使えない場合はDOMスクレイピングにフォールバックする。

| データ項目 | 説明 |
|-----------|------|
| 曲名 | 楽曲タイトル |
| 再生数 | 累計再生回数 |
| いいね数 | 累計いいね数 |
| コメント数 | 件数のみ（中身は取得しない） |

- 新曲が追加された場合は自動で検出・追加する（毎回アーティストページから曲一覧を取得する設計）

### 2.2 トレンドデータ
トレンドページ（https://suno.com/explore/feed/trending）から各曲のランクイン状況を確認する。

| 地域 | 期間 |
|------|------|
| Japanese | Now / Weekly / Monthly / All Time |
| Global | Now / Weekly / Monthly / All Time |

- 計8パターン（2地域 × 4期間）のトレンドをチェック
- 対象アーティストの曲がランクインしていれば、順位とともに記録

## 3. 仕様

### 3.1 実行仕様
| 項目 | 内容 |
|------|------|
| 取得頻度 | 3時間ごと |
| 実行環境 | GitHub Actions（Ubuntu） |
| 実行方法 | GitHub Actions cron（`0 */3 * * *`）+ 手動実行 |
| トークン消費 | なし（Playwright スクリプトのみで動作） |

### 3.2 データ保存
| 項目 | 内容 |
|------|------|
| 保存形式 | CSV（アーティスト別ファイル） |
| 保存場所 | data/ ディレクトリ配下 |
| ファイル構成 | `{artist}.csv`（アーティスト別）+ `trends.csv`（トレンド共通）+ `artists.json`（一覧） |
| Git管理 | data/ はリポジトリにコミット（GitHub Actionsが自動push） |

### 3.3 ダッシュボード
| 項目 | 内容 |
|------|------|
| 形式 | HTML + JavaScript |
| グラフライブラリ | Chart.js |
| 表示内容 | 曲別の再生数推移、いいね推移、トレンドランクイン履歴 |
| ホスティング | GitHub Pages |
| データ取得 | 相対パスで data/ 内のCSVを自動読み込み |

## 3.4 非公式API利用に関するリスク

曲データ取得に SUNO の非公式 API（`studio-api-prod.suno.com/api/profiles/`）を使用している。

| リスク | 対策 |
|--------|------|
| API廃止・仕様変更 | DOMスクレイピングへの自動フォールバック |
| レート制限 | 3時間間隔での実行（過度なリクエストを避ける） |
| 認証必須化 | DOMスクレイピングにフォールバック + Discord通知 |
| フォールバック発動 | Discord に「API使用不可、DOMフォールバック中」と通知 |

## 4. 異常検知・通知

### 4.1 検知パターン
| # | 異常パターン | 考えられる原因 |
|---|-------------|---------------|
| 1 | データ取得ゼロ | ページ構造変更（UI変更） |
| 2 | 曲数が前回より減少 | 曲削除 or セレクタ破損 |
| 3 | 再生数が前回より減少 | データ不整合 or 取得エラー |
| 4 | トレンドフィルターが見つからない | UI変更 |
| 5 | 同じ値が長期間継続 | 取得処理がスタック |
| 6 | API→DOMフォールバック発動 | 非公式API廃止の可能性 |

### 4.2 通知仕様
| 項目 | 内容 |
|------|------|
| 通知先 | Discord チャンネル（Webhook） |
| 通知方法 | Discord Webhook（トークン消費なし） |
| 異常時 | 即座に通知（異常内容を含む） |
| 正常時 | 1日1回の定期レポート |
| Webhook URL | GitHub Secrets に格納（`DISCORD_WEBHOOK_URL`） |

### 4.3 通知メッセージ例
- 異常時：`⚠ データ取得異常：曲数が前回30→0に減少。UI変更の可能性あり`
- 正常時：`✅ 定期レポート：darari_nu 15曲 / coban3137 30曲 取得完了、異常なし`

## 5. フェーズ分け

### Phase 1（実装済み）
- スクレイピングスクリプト（Playwright）
- SUNO非公式API + DOMフォールバック
- アーティスト別CSV データ保存
- HTML ダッシュボード（GitHub Pages）
- Discord Webhook 通知（異常検知 + 定期レポート）
- GitHub Actions による自動実行（3時間ごと）

### Phase 2（Phase 1 安定後）
- 異常検知時に Claude Code を自動起動
- Discord チャンネルで確認フロー（「修正しますか？」→ 承認後に修正）

## 6. 技術スタック

| 技術 | 用途 |
|------|------|
| Node.js | ランタイム |
| Playwright | ブラウザ自動操作・スクレイピング |
| CSV | データ保存（アーティスト別） |
| Chart.js | グラフ描画 |
| HTML + JS | ダッシュボード |
| Discord Webhook | 通知 |
| GitHub Actions | 定期実行（3時間ごと） |
| GitHub Pages | ダッシュボードホスティング |

## 7. リポジトリ構成

```
suno-tracker/
├── .github/
│   └── workflows/
│       └── tracker.yml          # GitHub Actions ワークフロー
├── docs/
│   └── requirements.md          # この要件定義書
├── src/
│   ├── index.js                 # メイン（エントリーポイント）
│   ├── scraper.js               # SUNO API + DOMスクレイピング
│   ├── trend-checker.js         # トレンドチェック
│   ├── csv-store.js             # アーティスト別CSV保存
│   ├── anomaly-detector.js      # 異常検知
│   └── notifier.js              # Discord通知
├── dashboard/
│   ├── index.html               # ダッシュボード
│   └── js/
│       └── charts.js            # グラフ描画（CSV自動読み込み）
├── data/                        # 蓄積データ（GitHub Actionsが自動push）
│   ├── darari_nu.csv            # darari_nu の楽曲データ
│   ├── coban3137.csv            # coban3137 の楽曲データ
│   ├── trends.csv               # トレンドデータ
│   └── artists.json             # アーティスト一覧
├── config.example.json          # 設定テンプレート（GitHub管理）
├── config.json                  # 実設定（.gitignore、Webhook URL含む）
├── package.json
└── README.md                    # セットアップ手順
```

## 8. デプロイフロー

1. GitHub に `suno-tracker` リポジトリを作成（公開）
2. GitHub Secrets に `DISCORD_WEBHOOK_URL` を設定
3. GitHub Pages を有効化（main ブランチ / root）
4. GitHub Actions が3時間ごとにデータを自動更新
5. ダッシュボードURL: `https://darari-nu.github.io/suno-tracker/dashboard/`
