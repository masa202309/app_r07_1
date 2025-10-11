# 生成AIスキル試験アプリ

Vercel AI SDKを使用した、マルチプロバイダー対応の生成AIスキル試験システムです。

## 機能

- 生成AIを使った試験問題の自動生成
- 三択問題形式での試験実施
- 自動採点とスコアバンド評価
- LINE Bot統合（オプション）
- 複数のAIプロバイダー対応（OpenAI、Anthropic Claude、Google Gemini）

## 対応AIプロバイダー

- **OpenAI**: GPT-4o, GPT-4o-mini など
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus など
- **Google**: Gemini 2.0 Flash, Gemini 1.5 Pro など

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd app01
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.example`を`.env`にコピーし、必要な値を設定します。

```bash
cp .env.example .env
```

`.env`ファイルで以下を設定：

```env
# 使用するAIプロバイダーを選択 (openai, anthropic, google)
AI_PROVIDER=openai

# OpenAIを使用する場合
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# Anthropic (Claude)を使用する場合
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Google (Gemini)を使用する場合
GOOGLE_API_KEY=your_google_api_key
GOOGLE_MODEL=gemini-2.0-flash-exp
```

### 4. ローカル実行

```bash
npm start
```

ブラウザで `http://localhost:3000` を開きます。

## Vercelへのデプロイ

### 方法1: Vercel CLIを使用

```bash
# Vercel CLIをインストール（初回のみ）
npm i -g vercel

# プロジェクトをデプロイ
vercel

# 本番環境にデプロイ
vercel --prod
```

### 方法2: GitHubと連携

1. GitHubにリポジトリをプッシュ
2. [Vercel Dashboard](https://vercel.com/dashboard)にアクセス
3. "New Project"をクリック
4. GitHubリポジトリをインポート
5. 環境変数を設定（下記参照）
6. "Deploy"をクリック

### Vercelでの環境変数設定

Vercelダッシュボードの Settings → Environment Variables で以下を設定：

**必須設定（使用するプロバイダーに応じて）:**

- `AI_PROVIDER` - openai, anthropic, google のいずれか
- `OPENAI_API_KEY` - OpenAI使用時
- `ANTHROPIC_API_KEY` - Anthropic使用時
- `GOOGLE_API_KEY` - Google使用時

**オプション設定:**

- `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GOOGLE_MODEL` - 使用モデル
- `DEFAULT_AI_MODEL` - フォールバックモデル
- `AI_TEMPERATURE` - 温度パラメータ（デフォルト: 0.2）
- `AI_MAX_TOKENS` - 最大トークン数（デフォルト: 2000）

**LINE Bot設定（オプション）:**

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_AI_PROVIDER` - LINEで使用するプロバイダー
- `LINE_AI_MODEL` - LINEで使用するモデル

## API エンドポイント

### 試験生成

```
POST /exam/generate
Content-Type: application/json

{
  "questionCount": 10,
  "categories": ["プロンプト設計とLLM活用", "データ・セキュリティとコンプライアンス"]
}
```

### 試験取得

```
GET /exam/:id
```

### 試験採点

```
POST /exam/:id/grade
Content-Type: application/json

{
  "answers": [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]
}
```

### LINE Webhook

```
POST /webhook
```

## プロジェクト構成

```
.
├── index.js              # メインサーバーファイル
├── services/
│   ├── aiClient.js       # Vercel AI SDK統合クライアント
│   ├── examService.js    # 試験生成・採点ロジック
│   └── openaiClient.js   # 旧OpenAIクライアント（非推奨）
├── public/
│   ├── index.html        # フロントエンドUI
│   ├── app.js           # フロントエンドロジック
│   └── style.css        # スタイル
├── vercel.json          # Vercel設定ファイル
├── package.json         # 依存関係
└── .env.example         # 環境変数サンプル
```

## 技術スタック

- **バックエンド**: Node.js, Express
- **AI SDK**: Vercel AI SDK
- **AIプロバイダー**: OpenAI, Anthropic, Google
- **LINE**: @line/bot-sdk
- **デプロイ**: Vercel

## ライセンス

ISC
