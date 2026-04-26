# J.A.R.V.I.S. — Desktop AI Assistant

> Just A Rather Very Intelligent System — Your personal AI assistant with system access

A local desktop application powered by **Electron + Next.js** that monitors your system, scans your network, and provides an intelligent AI assistant — all running on your Mac.

## Features

- 🖥️ **Real-time System Monitoring** — CPU, RAM, disk, battery, and top processes
- 🌐 **Network Scanner** — Detects all devices on your local network with vendor identification
- 🤖 **AI Chat (Gemini)** — JARVIS personality with access to live system + network data
- 🎙️ **Voice Input/Output** — Speak to JARVIS, hear responses via text-to-speech
- ⌨️ **Global Shortcut** — Press `Cmd+Shift+J` to summon JARVIS from anywhere
- 📌 **System Tray** — Stays in your menu bar, ready when you need it

## Quick Start

```bash
# Install dependencies
npm install

# Launch JARVIS as a desktop app
npm run desktop
```

That's it! JARVIS will start its internal server and open as a native desktop window.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run desktop` | Launch JARVIS desktop app |
| `npm run dev` | Run as web app only (browser) |
| `npm run dist` | Build distributable `.dmg` |

## Environment

Create `.env.local` with your Gemini API key:

```
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

## Tech Stack

- **Electron** — Native desktop wrapper
- **Next.js 16** — React framework with API routes
- **Gemini AI** — Google's generative AI for JARVIS personality
- **Tailwind CSS 4** — Styling
- **Web Speech API** — Voice input/output

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+J` | Summon JARVIS window |
| `Cmd+W` | Hide to tray |
| `Cmd+Q` | Quit JARVIS |

---

*Built by Prabin Sharma*
