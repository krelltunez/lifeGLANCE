# lifeGLANCE

**Your life, at a glance.** A zoomable personal timeline for milestones — past and future.

Built for people who want to map their life without handing their data to a cloud service. lifeGLANCE is a privacy-first progressive web app that runs entirely in the browser. There is no account, no server, no sync — your data never leaves your device.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.5.2-brightgreen.svg)](../../releases)

---

![lifeGLANCE timeline](docs/screenshot.png)

---

## Install

Use the hosted version at [lifeglance.app](https://lifeglance.app), or self-host with Docker (see below).

---

## Features

**Timeline**
- Smooth pan and zoom from individual weeks to multiple decades
- Past and future milestones on a single continuous axis
- Keyboard navigation between milestones and zoom levels
- Cluster badges for dense date ranges
- "Today" marker with date, day of week, and optional age display

**Milestones**
- Title, date (day / month / year precision), category, note, and URL
- Photo, audio, and video attachments stored as local blobs — no base64 bloat
- Annual recurrence with configurable end year
- Inline delete confirmation, undo / redo history

**Views & search**
- All / Past / Future view modes
- Full-text search across titles and notes
- Stats panel and summary modal
- "On this day" — milestones from this date in past years
- Minimap scrubbar for fast navigation

**Import / export**
- Import events from `.ics` calendar files
- Export timeline as a high-resolution PNG (2×, with branding watermark)
- JSON backup and restore

**App**
- Installable PWA — works fully offline after first load
- Ambient generative audio with mute toggle
- Adjustable text size
- Portrait-mode warning for mobile

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `←` / `→` | Cycle past / future milestones |
| `↑` / `↓` | Zoom out / in |
| `1` – `9` | Custom zoom to N years |
| `C` | Custom zoom input |
| `T` | Jump to today |
| `P` / `A` / `F` | Past / All / Future view |
| `N` | New milestone |
| `E` | Export image |
| `/` | Search |
| `S` | Settings |
| `M` | Mute / unmute |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Y` | Redo |
| `?` | Help |
| `Esc` | Close modal |

---

## Storage

All data is stored locally in your browser using IndexedDB. Nothing is sent to a server.

| Store | Contents |
|---|---|
| IndexedDB `milestones` | Milestone records (text fields, flags) |
| IndexedDB `media` | Audio / video blobs, keyed by milestone ID |
| `localStorage` | Settings and preferences only (a few KB) |

Media blobs are fetched lazily — only when you open a milestone detail or click play — so startup time stays fast regardless of how many attachments you have.

**Backup:** use *Settings → save backup* to export a JSON file of your milestone records. **Audio and video attachments are not included in the JSON backup — re-attach them after restoring if needed.**

**Storage limits** vary by browser. Chrome and Firefox allow multiple GB. Safari on iOS is more restrictive and may evict data for origins not visited for 7+ days unless the app is installed to the home screen. The current usage and available quota are shown in the Help modal (`?`).

---

## Running locally

Requires Node 20+.

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.

---

## Building

```bash
npm run build   # outputs to /dist
npm run preview # serve the production build locally
```

---

## Docker

```bash
docker build -t lifeglance .
docker run -p 8080:80 lifeglance
```

The image builds with Node 20 Alpine and serves the static output via nginx.

---

## Tech

| | |
|---|---|
| Framework | React 18 + Vite |
| PWA | vite-plugin-pwa (Workbox) |
| Storage | IndexedDB (milestones + media), localStorage (settings) |
| Dates | date-fns |
| Font | Courier Prime (Google Fonts, cached offline) |
| Audio | Web Audio API — synthesised, no samples |
| Deployment | Docker + nginx |

---

## Privacy

lifeGLANCE has no backend, no analytics, no accounts, and no network requests beyond loading the app itself and fetching the Courier Prime font (cached after first load). Your timeline data is yours alone.

---

## Support

If you have enjoyed using lifeGLANCE, consider supporting its development:

[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-EA4AAA?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/krelltunez)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?logo=kofi&logoColor=white)](https://ko-fi.com/krelltunez)
