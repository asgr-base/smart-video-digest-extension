# Smart Video Digest — 実装プラン

## 概要

YouTube動画をChrome内蔵AI（Gemini Nano）で要約するChrome拡張。字幕テキストを取得し、チャプター単位で要約、TL;DR + Key Points + チャプター要約を生成。すべてオンデバイスで完結。

## アーキテクチャ

Smart Page Digestのコードベースをフォークし、YouTube専用にカスタマイズ。CSSプレフィックスは `svd-`（Smart Video Digest）。

```
YouTube動画ページ
    ↓
content.js（youtube.com専用）
  ├─ ytInitialPlayerResponse から字幕トラックURL取得
  ├─ チャプター情報取得（説明欄 or engagementPanels）
  └─ 字幕JSON取得（baseUrl + &fmt=json3）
    ↓
sidepanel.js
  ├─ チャプターごとに字幕テキスト分割
  ├─ 各チャプター → Summarizer API（並列実行）→ チャプター要約（段階的表示）
  ├─ 全チャプター要約を結合
  │   ├─ → Summarizer API → TL;DR
  │   └─ → Prompt API → Key Points（重要度タグ付き）
  ├─ クイズ生成（Prompt API）
  └─ Q&Aチャット（Prompt API）
```

## ファイル構成

```
smart-video-digest-extension/
├── README.md
├── package.json
├── .gitignore
└── src/
    ├── manifest.json          # YouTube専用パーミッション
    ├── config.js              # SVD_CONFIG（SPDのOCS_CONFIGを改名）
    ├── content.js             # YouTube字幕・チャプター抽出（完全新規）
    ├── background.js          # SPDベース、YouTube URL判定追加
    ├── _locales/
    │   ├── en/messages.json   # 英語（YouTube固有メッセージ追加）
    │   ├── ja/messages.json   # 日本語
    │   └── es/messages.json   # スペイン語
    ├── icons/                 # アイコン（要新規作成 or 仮アイコン）
    ├── sidepanel/
    │   ├── sidepanel.html     # チャプターセクション追加
    │   ├── sidepanel.css      # svd-プレフィックス、チャプターUI
    │   └── sidepanel.js       # 階層的要約ロジック追加
    └── options/
        ├── options.html       # SPDベース
        ├── options.css        # SPDベース
        └── options.js         # SPDベース
```

## 実装ステップ

### Step 1: プロジェクト初期化 + ベースコピー

Smart Page Digestから以下をコピー＆改名:
- `config.js`: `OCS_CONFIG` → `SVD_CONFIG`、`STORAGE_KEY: 'svdSettings'`
- `background.js`: メッセージID `ocs-summarize` → `svd-summarize`、YouTube URL専用判定
- `options/`: CSSクラス `ocs-` → `svd-`、設定項目調整
- `sidepanel/sidepanel.css`: CSSプレフィックス `ocs-` → `svd-`
- `_locales/`: 拡張名・説明変更、YouTube固有メッセージ追加
- `manifest.json`: 新規作成（`matches: ["https://www.youtube.com/watch*"]`）
- `.gitignore`, `package.json`: 新規作成
- `icons/`: SPDのアイコンを仮利用

### Step 2: content.js — YouTube字幕・チャプター抽出（完全新規）

YouTube専用content scriptの実装:

1. **字幕トラック取得**: ページ内`<script>`タグから`ytInitialPlayerResponse`をパースし、`captions.playerCaptionsTracklistRenderer.captionTracks`を取得
2. **字幕テキスト取得**: `baseUrl + '&fmt=json3'`をfetch → JSON解析 → タイムスタンプ付きテキスト配列に変換
3. **チャプター取得**: 3段階フォールバック
   - `ytInitialPlayerResponse`の`chapters`（macroMarkersListItemRenderer）
   - 動画説明欄のタイムスタンプパース（`0:00 イントロ`形式）
   - フォールバック: 3分ごとの自動分割
4. **SPAナビゲーション対応**: `yt-navigate-finish`イベントでデータ再取得
5. **メッセージ応答**: `extractTranscript`メッセージに対し`{ transcript, chapters, videoInfo }`を返却

データ構造:
```js
{
  transcript: [
    { startMs: 0, endMs: 5000, text: "Hello world" },
    ...
  ],
  chapters: [
    { startMs: 0, title: "Introduction" },
    { startMs: 150000, title: "Main Topic" },
    ...
  ],
  videoInfo: {
    title: "Video Title",
    videoId: "xxxxx",
    channelName: "Channel",
    duration: 600, // seconds
    lang: "en",
    url: "https://www.youtube.com/watch?v=xxxxx"
  }
}
```

### Step 3: sidepanel.js — チャプター要約＋階層的要約

SPDの`sidepanel.js`をベースに以下を変更・追加:

1. **extractText → extractTranscript**: content.jsへのメッセージタイプ変更
2. **チャプター分割ロジック追加**: 字幕配列をチャプター境界で分割し、各チャプターのテキストを結合
3. **チャプター要約セクション**: 新規UIセクション。各チャプターにタイムスタンプ + 要約を表示
4. **階層的要約パイプライン**:
   ```
   handleSummarize()
     → extractTranscript()
     → splitByChapters(transcript, chapters)
     → 各チャプター → Summarizer API（並列実行）→ チャプター要約表示
     → 全チャプター要約を結合
       → Summarizer API → TL;DR
       → Prompt API → Key Points（重要度タグ）
   ```
5. **段階的表示**: チャプター要約は完了次第即表示。TL;DR/Key Pointsは全チャプター完了後に生成
6. **プログレス表示**: 「チャプター 2/4 を処理中...」
7. **タブキャッシュ**: videoIdベースでキャッシュ（URLのvパラメータ）
8. **字幕なし動画の処理**: 「この動画には字幕がありません」メッセージ表示

### Step 4: sidepanel.html — UI構造

SPDベースに以下のセクションを追加:

- **動画情報**: サムネイル表示なし（シンプルに）、タイトル + チャンネル名 + 再生時間
- **チャプター要約セクション**:
  ```html
  <div id="chaptersSection" class="svd-result-section">
    <h2>Chapters</h2>
    <div id="chaptersContent"></div>
    <!-- 各チャプター: タイムスタンプ + タイトル + 要約 -->
  </div>
  ```
- **TL;DR / Key Points**: SPDと同構造
- **クイズ / Q&A**: SPDと同構造

### Step 5: i18n — ロケールファイル

SPDベースに以下のYouTube固有メッセージを追加:

- `summarizeButton`: "Summarize this video" / "この動画を要約する"
- `extractingTranscript`: "Extracting transcript..." / "字幕を取得中..."
- `chaptersHeading`: "Chapters" / "チャプター"
- `chapterProgress`: "Processing chapter $1/$2..." / "チャプター $1/$2 を処理中..."
- `noTranscript`: "No transcript available for this video." / "この動画には字幕がありません。"
- `notYoutube`: "This extension works only on YouTube video pages." / "この拡張はYouTube動画ページでのみ利用できます。"
- `customPromptHeading`: "Ask about this video" / "この動画について質問する"

### Step 6: テスト・デバッグ

- 字幕あり動画（手動字幕）で動作確認
- 字幕あり動画（自動生成字幕）で動作確認
- チャプターあり動画で動作確認
- チャプターなし動画で自動分割確認
- 字幕なし動画でエラーハンドリング確認
- SPAナビゲーション（動画間遷移）で再取得確認
- 5分 / 10分 / 20分の動画で処理時間確認

### Step 7: README.md + Git初期化 + GitHub push

## SPDから再利用するもの（変更最小限）

| 機能 | SPDの関数/パターン | 変更点 |
|------|-------------------|--------|
| Summarizer API呼び出し | `runSummarizer()` | そのまま |
| Prompt API呼び出し | `runPromptApi()` | そのまま |
| Key Points重要度レンダリング | `renderKeyPointsWithImportance()` | そのまま |
| Markdownレンダリング | `renderMarkdownSafe()`, `appendInlineFormatted()` | そのまま |
| クイズ生成 | `handleGenerateQuiz()`, `renderQuiz()` | テキストソースを字幕に変更 |
| Q&Aチャット | `handleCustomPrompt()` | テキストソースを字幕に変更 |
| 翻訳 | `translateIfNeeded()`, `createTranslator()` etc. | そのまま |
| 読み上げ | `handleReadAloud()`, `stopReadAloud()` | そのまま |
| タブキャッシュ | `tabCache`, `saveToCache()`, `restoreFromCache()` | videoIdベースに拡張 |
| 設定管理 | `loadSettings()`, `saveSetting()` | STORAGE_KEY変更 |
| i18n | `applyI18n()` | そのまま |
| UIヘルパー | `showToast()`, `copyToClipboard()` etc. | CSSプレフィックス変更 |

## 新規実装が必要なもの

| 機能 | 概要 |
|------|------|
| YouTube字幕抽出 | `ytInitialPlayerResponse`パース + timedtext API fetch |
| チャプター検出 | chapters / 説明欄パース / 自動分割 |
| チャプター要約UI | タイムスタンプ付き要約カードの表示 |
| 階層的要約パイプライン | チャンク分割 → 並列要約 → 統合要約 |
| SPAナビゲーション対応 | `yt-navigate-finish`イベント監視 |
| YouTube URL判定 | `youtube.com/watch`ページのみ対応 |
