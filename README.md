# 快 Kuai Chinese

A PWA to learn Chinese fast.

## How to use it

### On your phone (recommended)

1. Open `index.html` in your phone's browser (Chrome, Safari, Edge…).
   - Easiest: host the folder for free (Netlify, GitHub Pages, Vercel) or use a local server.
2. **Install it as an app**:
   - **Android (Chrome)**: menu ⋮ → "Install app" or "Add to Home screen".
   - **iPhone (Safari)**: Share button → "Add to Home Screen".
3. Once installed it works like a native app (full screen, its own icon).

### Daily use

1. Copy any phrase (Chinese, English or Spanish).
2. In the app, **press and hold** the big box → it pastes and translates automatically.
3. You can also paste or type manually and press "Translate now".

### What it does depending on the language

| Pasted text | Result |
|-------------|--------|
| **Chinese** | Full Pinyin + English translation + word-by-word table (Pinyin + English). Button to also see it in Spanish. |
| **English or Spanish** | Full Chinese translation + Pinyin + word-by-word table. |

- Chinese compounds (e.g. 北京大学) are kept together where possible.
- You can save single words, or all of them, to your **personal dictionary**, where they become flash cards: mark each one as Memorized (left column) or Not memorized (right column). New words sit in the middle.
- **Random** shows a saved word's characters and plays its audio; **Flip card** reveals the Pinyin, English meaning and the phrase you saved it from.
- Every Chinese phrase and word has a 🔊 button to hear it.
- Every phrase is kept in your **history** to review later.

## Look and feel

- UI uses the same CRT terminal format as Kuai Temperature: `VT323` for the interface and `Noto Sans SC` for the 快中文 logo, with scanlines and `[ BRACKETED ]` buttons.
- Study text (input, translations, characters, Pinyin and meanings) stays in a plain monospace font so it is easy to read.
- The animation in the middle is an inline SVG: a nerd kid with headphones typing at a retro CRT, with his coffee steaming on the desk.

## Files

```
kuai-chinese/
├── index.html      ← open this
├── styles.css
├── app.js
├── manifest.json   ← makes it installable
├── sw.js           ← works offline (app shell)
├── icon-192.png
├── icon-512.png
├── icon.svg
├── apple-touch-icon.png
└── README.md
```

## Technical notes

- Translations: free Google Translate endpoint (no API key).
- Pinyin and segmentation: `pinyin-pro` library.
- Data (history and dictionary) is stored only on your device (`localStorage`).
- Needs HTTPS (or localhost) to read the clipboard.
- Dictionary words are flash cards with a status (new, memorized, not memorized). Random mode quizzes you on any saved word and plays its audio.
- Chinese audio uses the device's Chinese voice when available, otherwise Google Translate speech.
- When changing `styles.css` or `app.js`, bump the `?v=` in `index.html` and `sw.js` and the `CACHE_NAME` in `sw.js` so installed apps pick up the new files.

## Quick local server

```bash
cd kuai-chinese
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your phone's browser (same Wi-Fi network).
