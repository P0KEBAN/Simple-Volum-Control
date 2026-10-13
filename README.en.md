# Simple Volume Control

<p align="center">
  <img src="icons/icon128.png" alt="Simple Volume Control Icon" width="128" height="128">
</p>

<p align="center">
  <strong>A minimalist Chrome extension for controlling tab volume</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="README.md">日本語</a> | <strong>English</strong>
</p>

---

## ✨ Features

- **Minimal UI** — Just a volume slider and a reset button
- **0% – 600% volume range** — Boost or reduce with a single slider
- **Tab-level audio control** — Powered by `tabCapture` + Web Audio API, independent of site implementation
- **Dark theme** — Clean and easy on the eyes

## 📸 Screenshot

<p align="center">
  <img src="screenshot.png" alt="Simple Volume Control Screenshot" width="360">
</p>

## 🎯 Use Cases

- Normalize volume differences between YouTube videos
- Boost audio on quiet websites
- Replace over-complicated volume extensions with something simple

## 🛠 Architecture

```
popup (UI)
  ↓ message
service_worker
  ↓ stream ID / state management
offscreen document
  ↓
Web Audio API (GainNode → AudioDestination)
```

| Technology | Purpose |
|---|---|
| Manifest V3 | Chrome extension framework |
| tabCapture API | Capture tab audio stream |
| Offscreen Document | Background audio processing |
| Web Audio API (GainNode) | Volume gain control |

## 📁 Project Structure

```
Simple-Volum-Control/
├── manifest.json          # Extension configuration
├── service_worker.js      # Background logic & tab management
├── offscreen.html         # Offscreen Document (HTML)
├── offscreen.js           # Audio processing (Web Audio API)
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.css          # Styles (dark theme)
│   └── popup.js           # UI logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 🚀 Installation

1. Clone or download this repository
   ```bash
   git clone https://github.com/P0KEBAN/Simple-Volum-Control.git
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the cloned folder

## 🧪 Tests

The isolated unit tests use only the Node.js standard library. They mock Chrome
and Web Audio APIs, so they do not capture real tabs or access browser profiles.

```bash
node --test
```

## 💡 Usage

1. Click the extension icon on a tab playing audio
2. Adjust the slider (0% – 600%)
3. Click `Reset` to return to 100%

### ⌨️ Keyboard

| Key | Action |
|---|---|
| `Alt` + `Shift` + `V` (Mac: `Option` + `Shift` + `V`) | Open the popup |
| `←` `→` `↑` `↓` | Adjust volume by 5% |
| `Shift` + arrow | Adjust volume by 25% |
| `0` – `6` | Jump to 0% – 600% (`0` mutes, `1` is 100%) |
| `R` | Reset to 100% |
| `Esc` | Close the popup |

You can change the popup shortcut at `chrome://extensions/shortcuts`. If another extension already
uses the same keys, Chrome does not assign it automatically; set it from that page.

## ⚠️ Notes

- Some tabs (e.g. `chrome://` pages) do not support audio capture
- Extreme volume boost may cause audio clipping
- Volume settings are session-only (reset when the tab is closed)

## 🔧 Permissions

| Permission | Reason |
|---|---|
| `tabCapture` | Capture the audio stream of a tab |
| `offscreen` | Process audio in the background |
| `activeTab` | Access the current tab info |

## 📄 License

MIT
