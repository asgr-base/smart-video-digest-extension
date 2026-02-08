# Smart Video Digest

Summarize YouTube videos with chapters using Chrome's built-in AI (Gemini Nano) — fully on-device.

## Features

- **TL;DR + Key Points**: Get a quick summary and structured key points from any YouTube video
- **Chapter-aware summarization**: Automatically detects video chapters and summarizes each one individually
- **Clickable timestamps**: Jump to any chapter directly from the summary
- **Comprehension Quiz**: Test your understanding with AI-generated quiz questions
- **Custom questions**: Ask anything about the video content
- **Read aloud**: Listen to summaries with text-to-speech (voice & speed control)
- **Multi-language output**: Summarize in Japanese, English, or Spanish regardless of video language
- **100% on-device**: All AI processing happens locally via Gemini Nano — no data sent to servers
- **Works offline**: After the initial model download, works without internet

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
[Extension Icon / Alt+Y] → [Side Panel opens]
         ↓
[Summarize Button] → [Content Script extracts transcript]
         ↓
[Chapter detection] → [Summarize each chapter via Summarizer API]
         ↓
[Combine summaries] → [Generate TL;DR + Key Points]
         ↓
[Streaming display in Side Panel]
```

1. **Transcript extraction**: Reads YouTube's caption tracks (same-origin fetch, no external API)
2. **Chapter detection**: Parses `ytInitialData` for chapter markers, or auto-splits by duration
3. **Hierarchical summarization**: Each chapter summarized individually, then combined for overall summary
4. **TL;DR**: Generated via Summarizer API from combined chapter summaries
5. **Key Points**: Generated via Prompt API with importance-tagged bullet points

## Keyboard Shortcut

- **Alt+Y**: Open side panel and summarize the current video
- Customizable via `chrome://extensions/shortcuts`

## Settings

Access via the extension's options page:

- **Summary length**: Short / Medium / Long
- **Output language**: Auto / Japanese / English / Spanish
- **Auto-summarize**: Automatically summarize when switching YouTube tabs

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

- All AI processing happens locally on your device via Gemini Nano
- No video data is sent to external servers
- The AI model does not learn from or store your data
- Works offline after the initial model download

## License

MIT
