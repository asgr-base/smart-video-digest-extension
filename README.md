# Smart Video Digest

**The only YouTube summarizer that works 100% on your device.**

Summarize YouTube videos with chapters using Chrome's built-in AI (Gemini Nano). No account required. No API keys. No subscription. No data leaves your machine.

## Why Smart Video Digest?

Most YouTube summarizer extensions send your video data to external AI services (ChatGPT, Claude, etc.), requiring accounts, API keys, or paid subscriptions. Smart Video Digest takes a fundamentally different approach:

- **Zero cloud dependency** — Uses Gemini Nano, Chrome's built-in on-device AI model
- **No accounts or API keys** — Install and use immediately
- **Complete privacy** — Your viewing data never leaves your device
- **Works offline** — Summarize videos even without internet (after initial model download)
- **Always free** — No usage limits, no tiered plans, no hidden costs

## Features

### AI Summarization
- **TL;DR + Key Points**: Get a quick summary and structured key points from any YouTube video
- **Chapter-aware summarization**: Automatically detects video chapters and summarizes each one individually — unlike most extensions that process the entire transcript as a single block
- **Clickable timestamps**: Jump to any chapter directly from the summary
- **Custom questions**: Ask anything about the video content using the Prompt API

### Active Learning
- **Comprehension Quiz**: Test your understanding with AI-generated Q&A cards — based on retrieval practice research (Roediger & Karpicke, 2006) that improves long-term retention by up to 50%
- **Read aloud**: Listen to summaries with text-to-speech (voice & speed selection)

### Export & Integration
- **Markdown export**: Download structured `.md` files with title, URL, TL;DR, key points, chapter-by-chapter summaries, and full transcript organized by chapter — ready for Obsidian, Notion, or any knowledge base
- **Copy to clipboard**: One-click copy of any summary section

### Workflow
- **Multi-language output**: Summarize in Japanese, English, or Spanish regardless of video language
- **Keyboard shortcut**: Alt+Y to open and summarize instantly
- **Context menu**: Right-click on any YouTube page to summarize
- **Auto-summarize**: Automatically summarize when switching between YouTube tabs

## Requirements

- **Chrome 138+** (Canary/Dev channel recommended)
- **Gemini Nano** enabled:
  1. Open `chrome://flags/#optimization-guide-on-device-model`
  2. Set to **Enabled BypassPerfRequirement**
  3. Open `chrome://flags/#summarization-api-for-gemini-nano`
  4. Set to **Enabled**
  5. Open `chrome://flags/#prompt-api-for-gemini-nano`
  6. Set to **Enabled**
  7. Restart Chrome
  8. Open `chrome://components` and check "Optimization Guide On Device Model" is downloaded

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `src/` folder
5. Navigate to any YouTube video and click the extension icon

## How It Works

```
[Extension Icon / Alt+Y / Right-click] → [Side Panel opens]
         ↓
[Content Script extracts transcript via innertube API]
         ↓
[Chapter detection from ytInitialData or auto-split by duration]
         ↓
[Summarize each chapter individually via Summarizer API]
         ↓
[Generate TL;DR (Summarizer API) + Key Points (Prompt API)]
         ↓
[Streaming display in Side Panel]
         ↓
[Optional: Quiz / Custom Q&A / Markdown Export / Read Aloud]
```

### Technical Details

1. **Transcript extraction**: Uses YouTube's innertube API (ANDROID client) with multiple fallback strategies — XML caption fetch, MAIN world script injection for player data. Handles YouTube SPA navigation with stale data detection.
2. **Chapter detection**: Parses `ytInitialData` for chapter markers. Falls back to auto-splitting long transcripts by duration. Validates videoId to prevent cross-tab data contamination.
3. **Hierarchical summarization**: Each chapter summarized individually, then combined for overall summary. Tab-specific caching ensures correct state across multiple YouTube tabs.
4. **TL;DR**: Generated via Summarizer API from combined chapter summaries
5. **Key Points**: Generated via Prompt API with structured bullet points
6. **Markdown export**: Generates structured Markdown with metadata, summaries, and full transcript organized by chapter boundaries

## Keyboard Shortcut

- **Alt+Y**: Open side panel and summarize the current video
- Customizable via `chrome://extensions/shortcuts`

## Settings

Access via the extension's options page:

- **Summary length**: Short / Medium / Long
- **Output language**: Auto / Japanese / English / Spanish
- **Auto-summarize**: Automatically summarize when switching YouTube tabs
- **Keyboard shortcut**: View current shortcut or change it

## File Structure

```
src/
├── manifest.json           # MV3 manifest (Chrome 138+)
├── config.js               # Shared constants & defaults
├── content.js              # YouTube transcript & chapter extraction
├── background.js           # Service worker: message routing, context menu
├── sidepanel/
│   ├── sidepanel.html      # Side panel UI
│   ├── sidepanel.js        # AI summarization pipeline & UI logic
│   └── sidepanel.css       # Google-style side panel styling
├── options/
│   ├── options.html        # Settings page
│   ├── options.js          # Settings logic
│   └── options.css         # Settings styling
├── icons/                  # Extension icons (16/48/128px)
└── _locales/
    ├── en/messages.json    # English
    ├── ja/messages.json    # Japanese
    └── es/messages.json    # Spanish
```

## Privacy

Smart Video Digest is designed with privacy as a core principle, not an afterthought:

- **On-device AI**: All summarization runs locally via Gemini Nano — no cloud AI services involved
- **No external servers**: Video data, transcripts, and summaries never leave your machine
- **No data collection**: The AI model does not learn from or store your data
- **No tracking**: Zero analytics, telemetry, or external network requests
- **Offline capable**: Works without internet after the initial model download
- **Open source**: Full source code available for inspection

## License

MIT
