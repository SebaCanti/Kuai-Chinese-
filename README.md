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
- You can save single words, or all of them, to your **personal dictionary**, where they become flash cards. New words sit in the middle; mark each one as Memorized (left pile) or Not memorized (right pile). Tap a pile to see its words and keep studying them.
- **Random** shows a saved word's characters and plays its audio; **Flip card** reveals the Pinyin, English meaning and your example sentences: the phrase you saved it from, plus any sentence you add with **+ Add sentence** (↻ moves between them). The app never makes up examples.
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

## Word meanings and compound words

`cedict.txt` is a compact word list built from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) (CC BY-SA 4.0): one `word<TAB>sense1|sense2|...` per line, words up to 4 characters. The word table picks the sense that matches the full English translation (想 → "to miss" in 我想你了, "to want" in 不想让你花钱买). Compound words always stay together; when none of their senses fit the sentence, Google is asked for that word alone. Entries that CC-CEDICT only lists as an abbreviation or variant (体检) take the senses of the word they point to. The app splits Chinese text by longest match against it, so compound words like 咳嗽 or 一点点 stay together, and takes the word-by-word meanings from it without needing the network. Google Translate is only used for the full sentence and for words missing from the list.

## Sync between devices

Settings › Sync devices stores history and dictionary in a private gist (`kuai-chinese-sync.json`) in your GitHub account. Create a token with only the `gist` scope and paste it on each device. Changes sync a few seconds after you make them and when the app comes back to the foreground; deletions sync too.

## Your own corrections

Tap ✎ next to a word's meaning or "Edit translation" under the full translation to correct it. Corrections are saved per word and per sentence, used before anything automatic the next time, and travel with sync. Clear the field to go back to the automatic translation.
