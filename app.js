/* ===== Kuai Chinese App ===== */
(function () {
  'use strict';

  // ---------- State ----------
  let currentResult = null;
  let meaningLang = 'en'; // 'en' | 'es'
  let longPressTimer = null;
  const LONG_PRESS_MS = 550;

  // ---------- Themes ----------
  const THEME_KEY = 'kuai_theme';
  const THEMES = ['neon-tokyo', 'matrix-soft', 'synthwave', 'chrome-crimson', 'holo-glass'];

  function getSavedTheme() {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : 'matrix-soft';
  }

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'matrix-soft';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    // Update theme-color meta for mobile status bar
    const meta = document.querySelector('meta[name="theme-color"]');
    const colors = {
      'neon-tokyo': '#0a0a12',
      'matrix-soft': '#05080a',
      'synthwave': '#1a0a2e',
      'chrome-crimson': '#0e1015',
      'holo-glass': '#0f0c29'
    };
    if (meta) meta.content = colors[theme] || '#0a0a12';
    // Highlight active card
    document.querySelectorAll('.theme-card').forEach(card => {
      card.classList.toggle('active', card.dataset.theme === theme);
    });
  }

  // Apply saved theme immediately
  applyTheme(getSavedTheme());


  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const pasteZone = $('#paste-zone');
  const inputText = $('#input-text');
  const btnTranslate = $('#btn-translate');
  const loadingEl = $('#loading');
  const resultsEl = $('#results');
  const originalText = $('#original-text');
  const fullPinyin = $('#full-pinyin');
  const fullEnglish = $('#full-english');
  const fullSpanish = $('#full-spanish');
  const btnShowSpanish = $('#btn-show-spanish');
  const wordTbody = $('#word-tbody');
  const thMeaning = $('#th-meaning');
  const btnToggleLang = $('#btn-toggle-lang');
  const btnSaveAll = $('#btn-save-all');
  const historyList = $('#history-list');
  const dictEmpty = $('#dict-empty');
  const dictBoard = $('#dict-board');
  const speakOriginal = $('#speak-original');
  const speakFull = $('#speak-full');
  const btnClearHistory = $('#btn-clear-history');

  // ---------- Storage helpers ----------
  const STORAGE_HISTORY = 'kuai_history';
  const STORAGE_DICT = 'kuai_dictionary';

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]'); }
    catch { return []; }
  }
  function saveHistory(items) {
    const next = items.slice(0, 100);
    const ids = new Set(next.map(h => String(h.id)));
    readRaw(STORAGE_HISTORY).forEach(h => { if (!ids.has(String(h.id))) markDeleted('history', String(h.id)); });
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
    scheduleSync();
  }

  // ---------- Change tracking for sync ----------
  // Each dictionary word carries `updated` (ms). Deleted words/history entries
  // leave a tombstone so the deletion also reaches the other device.
  const STORAGE_DELETED = 'kuai_deleted';
  function readRaw(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function getDeleted() {
    try { return { dict: {}, history: {}, ...JSON.parse(localStorage.getItem(STORAGE_DELETED) || '{}') }; }
    catch { return { dict: {}, history: {} }; }
  }
  function saveDeleted(del) {
    // Forget tombstones older than 180 days
    const cutoff = Date.now() - 180 * 864e5;
    ['dict', 'history'].forEach(k => {
      Object.keys(del[k]).forEach(id => { if (del[k][id] < cutoff) delete del[k][id]; });
    });
    localStorage.setItem(STORAGE_DELETED, JSON.stringify(del));
  }
  function markDeleted(kind, key) {
    const del = getDeleted();
    del[kind][key] = Date.now();
    saveDeleted(del);
  }
  function sameWord(a, b) {
    const { updated: _a, ...x } = a;
    const { updated: _b, ...y } = b;
    return JSON.stringify(x) === JSON.stringify(y);
  }
  // Each word has a flash-card status: 'new' | 'known' (memorized) | 'learning' (not memorized)
  function getDict() {
    let items;
    try { items = JSON.parse(localStorage.getItem(STORAGE_DICT) || '[]'); }
    catch { items = []; }
    return items.map(d => {
      const w = { status: 'new', ...d };
      // Example sentences are only ones you added: the phrase you saved the word from, or
      // sentences you add on its card. Older versions stored one example (sometimes made up by
      // the app); keep it only if it was your phrase.
      if (!Array.isArray(w.sentences)) {
        const own = w.phrase || w.example || '';
        const ownEn = w.phrase ? (w.phraseEn || '') : (w.exampleEn || '');
        const madeUp = /^我今天学了「.*」这个词。$/.test(own) ||
          /^(I like .+|I want to .+ today|This is very .+|The .+ is here)\.$/.test(ownEn);
        w.sentences = own && !madeUp ? [{ zh: own, en: ownEn }] : [];
      }
      return w;
    });
  }
  function saveDict(items) {
    const prev = {};
    readRaw(STORAGE_DICT).forEach(d => { prev[d.char] = d; });
    const now = Date.now();
    const chars = new Set();
    items.forEach(it => {
      chars.add(it.char);
      const p = prev[it.char];
      it.updated = (!p || !sameWord(p, it)) ? now : (p.updated || 0);
    });
    Object.keys(prev).forEach(c => { if (!chars.has(c)) markDeleted('dict', c); });
    const del = getDeleted();
    items.forEach(it => { if (del.dict[it.char]) delete del.dict[it.char]; });
    saveDeleted(del);
    localStorage.setItem(STORAGE_DICT, JSON.stringify(items));
    scheduleSync();
  }

  function addToHistory(entry) {
    const hist = getHistory();
    if (hist[0] && hist[0].original === entry.original) return;
    hist.unshift({
      id: Date.now(),
      original: entry.original,
      pinyin: entry.pinyinFull || '',
      english: entry.englishFull || '',
      spanish: entry.spanishFull || '',
      chinese: entry.chineseFull || '',
      isChinese: entry.isChinese,
      date: new Date().toISOString()
    });
    saveHistory(hist);
    renderHistory();
  }

  function isInDict(char) {
    return getDict().some(d => d.char === char);
  }

  function addToDict(word) {
    const dict = getDict();
    const existing = dict.find(d => d.char === word.char);
    if (existing) {
      if (word.example && !existing.sentences.some(x => x.zh === word.example)) {
        existing.sentences.push({ zh: word.example, en: word.exampleEn || '' });
        saveDict(dict);
        showToast('Added this phrase to its examples');
      } else {
        showToast('Already in your dictionary');
      }
      return false;
    }
    dict.unshift({
      id: Date.now(),
      char: word.char,
      pinyin: word.pinyin,
      en: word.en,
      es: word.es || '',
      status: 'new',
      sentences: word.example ? [{ zh: word.example, en: word.exampleEn || '' }] : [],
      date: new Date().toISOString()
    });
    saveDict(dict);
    renderDictionary();
    showToast('Saved to dictionary ✓');
    return true;
  }

  // ---------- Chinese audio ----------
  // Uses the device's Chinese voice when it has one, otherwise Google Translate's speech audio.
  let zhVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    zhVoice = voices.find(v => /^zh[-_]CN/i.test(v.lang)) || voices.find(v => /^zh|cmn/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  let ttsAudio = null;

  function speak(text) {
    text = (text || '').trim();
    if (!text) return;
    if (zhVoice) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = zhVoice;
      u.lang = zhVoice.lang;
      u.rate = 0.85;
      speechSynthesis.speak(u);
      return;
    }
    if (ttsAudio) ttsAudio.pause();
    ttsAudio = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${encodeURIComponent(text.slice(0, 190))}`);
    ttsAudio.play().catch(() => showToast('Couldn’t play audio'));
  }

  // ---------- Language detection ----------
  function isChineseText(text) {
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).join('').length;
    const total = text.replace(/\s/g, '').length;
    return total > 0 && cjk / total > 0.3;
  }

  // ---------- Translation (free Google endpoint) ----------
  // Fetch with a time limit so a stalled request on a phone never hangs the app.
  async function fetchWithTimeout(url, ms = 12000, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function translateText(text, targetLang) {
    if (!text || !text.trim()) return '';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    try {
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      return data[0].map(part => part[0]).join('');
    } catch (err) {
      console.error('Translation error:', err);
      return '[Translation error]';
    }
  }

  // Translates a list of words with one request (one word per line).
  // Falls back to a few requests at a time if the lines don't line up.
  async function translateWords(words, targetLang) {
    const unique = [...new Set(words)];
    const out = {};
    if (!unique.length) return out;
    const joined = await translateText(unique.join('\n'), targetLang);
    // Network failure or timeout: don't retry word by word, just leave them blank.
    if (joined === '[Translation error]') return out;
    const lines = joined.split('\n').map(l => l.trim());
    if (lines.length === unique.length) {
      unique.forEach((w, i) => { out[w] = lines[i]; });
      return out;
    }
    for (let i = 0; i < unique.length; i += 4) {
      const batch = unique.slice(i, i + 4);
      const res = await Promise.all(batch.map(w => translateText(w, targetLang)));
      batch.forEach((w, j) => { out[w] = res[j]; });
    }
    return out;
  }

  // ---------- Offline word list (CC-CEDICT, CC BY-SA 4.0) ----------
  // One "word<TAB>meaning" per line. Gives word meanings without the network
  // and lets compound words (昨天, 咳嗽, 午饭) stay together.
  let cedict = null;
  let cedictLoading = null;
  function loadCedict() {
    if (cedict) return Promise.resolve(cedict);
    if (!cedictLoading) {
      cedictLoading = fetchWithTimeout('cedict.txt?v=12', 30000)
        .then(res => res.ok ? res.text() : Promise.reject(new Error('cedict ' + res.status)))
        .then(txt => {
          const map = new Map();
          txt.split('\n').forEach(line => {
            const tab = line.indexOf('\t');
            if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
          });
          cedict = map;
          return map;
        })
        .catch(err => { console.warn('Word list unavailable', err); cedictLoading = null; return null; });
    }
    return cedictLoading;
  }

  function wordPinyin(word) {
    const fn = (window.pinyinPro || {}).pinyin;
    if (!fn) return word;
    try { return fn(word, { toneType: 'symbol' }).replace(/\s+/g, ''); } catch (e) { return word; }
  }

  // Longest match first against the word list, up to 4 characters.
  function segmentWithCedict(text, dict) {
    const out = [];
    const chars = Array.from(text);
    let i = 0;
    while (i < chars.length) {
      if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chars[i])) { i++; continue; }
      let len = Math.min(4, chars.length - i);
      for (; len > 1; len--) {
        if (dict.has(chars.slice(i, i + len).join(''))) break;
      }
      const word = chars.slice(i, i + len).join('');
      out.push({ origin: word, result: wordPinyin(word) });
      i += len;
    }
    return out;
  }

  // Meanings from the word list first; Google only for words it doesn't have.
  async function wordMeanings(words) {
    const dict = await loadCedict();
    const out = {};
    const missing = [];
    words.forEach(w => {
      if (dict && dict.has(w)) out[w] = dict.get(w);
      else missing.push(w);
    });
    if (missing.length) Object.assign(out, await translateWords(missing, 'en'));
    return out;
  }

  // ---------- Chinese segmentation + Pinyin ----------
  function segmentAndPinyin(text) {
    if (cedict) return segmentWithCedict(text, cedict);
    const lib = window.pinyinPro || {};
    const pinyinFn = lib.pinyin;
    const segmentFn = lib.segment;

    if (!pinyinFn) {
      return Array.from(text)
        .filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c))
        .map(c => ({ origin: c, result: c }));
    }

    // Prefer segment so compound words stay together
    if (typeof segmentFn === 'function') {
      try {
        const segs = segmentFn(text);
        if (Array.isArray(segs) && segs.length && segs[0].origin !== undefined) {
          return segs.filter(s => s.origin && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s.origin));
        }
      } catch (e) {
        console.warn('segment failed', e);
      }
    }

    // Fallback: one entry per character
    try {
      // pinyin() returns one entry per character, punctuation included,
      // so pair them up before dropping the non-Chinese ones.
      const pyArr = pinyinFn(text, { type: 'array', toneType: 'symbol' });
      return Array.from(text)
        .map((c, i) => ({ origin: c, result: pyArr[i] || c }))
        .filter(s => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s.origin));
    } catch (e) {
      return Array.from(text)
        .filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c))
        .map(c => ({ origin: c, result: c }));
    }
  }

  // ---------- Main process ----------
  async function processText(rawText) {
    const text = (rawText || '').trim();
    if (!text) {
      showToast('Nothing to translate');
      return;
    }

    loadingEl.classList.remove('hidden');
    resultsEl.classList.add('hidden');
    btnTranslate.disabled = true;

    try {
      const chinese = isChineseText(text);
      const result = {
        original: text,
        isChinese: chinese,
        pinyinFull: '',
        englishFull: '',
        spanishFull: '',
        chineseFull: '',
        words: []
      };

      if (chinese) {
        // Chinese → Pinyin + English
        await loadCedict();
        const segs = segmentAndPinyin(text);
        result.pinyinFull = segs.map(s => s.result).join(' ');
        const [englishFull, meanings] = await Promise.all([
          translateText(text, 'en'),
          wordMeanings(segs.map(s => s.origin))
        ]);
        result.englishFull = englishFull;
        result.words = segs.map(s => ({ char: s.origin, pinyin: s.result, en: meanings[s.origin] || '', es: '' }));
      } else {
        // English / Spanish → Chinese + Pinyin
        const chineseText = await translateText(text, 'zh-CN');
        result.chineseFull = chineseText;
        result.englishFull = text; // keep original for reference

        await loadCedict();
        const segs = segmentAndPinyin(chineseText);
        result.pinyinFull = segs.map(s => s.result).join(' ');

        const meanings = await wordMeanings(segs.map(s => s.origin));
        result.words = segs.map(s => ({ char: s.origin, pinyin: s.result, en: meanings[s.origin] || '', es: '' }));
      }

      currentResult = result;
      meaningLang = 'en';
      renderResults();
      addToHistory(result);
      if ([result.englishFull, result.chineseFull].includes('[Translation error]')) {
        showToast('Translation failed. Check your connection and try again.');
      }
    } catch (err) {
      console.error(err);
      showToast('Something went wrong. Please try again.');
    } finally {
      loadingEl.classList.add('hidden');
      btnTranslate.disabled = false;
    }
  }

  // ---------- Render results ----------
  // ---------- Dictionary colors in translations ----------
  // Words already in your dictionary are colored: green = memorized, red = not memorized.
  function dictStatusMap() {
    const map = {};
    getDict().forEach(d => { if (d.status === 'known' || d.status === 'learning') map[d.char] = d.status; });
    return map;
  }

  // Escapes the text and wraps dictionary words, matching the longest word first.
  function highlightHtml(text, map = dictStatusMap()) {
    const words = Object.keys(map).sort((a, b) => b.length - a.length);
    if (!text || !words.length) return escapeHtml(text);
    let out = '';
    let i = 0;
    while (i < text.length) {
      const w = words.find(x => text.startsWith(x, i));
      if (w) {
        out += `<span class="hl-${map[w]}">${escapeHtml(w)}</span>`;
        i += w.length;
      } else {
        out += escapeHtml(text[i]);
        i += 1;
      }
    }
    return out;
  }

  function renderResults() {
    if (!currentResult) return;

    const statusMap = dictStatusMap();
    originalText.innerHTML = currentResult.isChinese ? highlightHtml(currentResult.original, statusMap) : escapeHtml(currentResult.original);

    if (currentResult.isChinese) {
      fullPinyin.textContent = currentResult.pinyinFull;
      fullPinyin.classList.remove('hidden');
      fullEnglish.textContent = currentResult.englishFull;
      fullEnglish.classList.remove('hidden');
      fullSpanish.classList.add('hidden');
      fullSpanish.textContent = '';
      btnShowSpanish.classList.remove('hidden');
      btnShowSpanish.textContent = 'Show in Spanish';
      $('#full-title').textContent = '> Full translation';
      speakOriginal.classList.remove('hidden');
      speakFull.classList.add('hidden');
    } else {
      // Source EN/ES → show Chinese + Pinyin
      fullPinyin.textContent = currentResult.pinyinFull;
      fullPinyin.classList.remove('hidden');
      fullEnglish.innerHTML = highlightHtml(currentResult.chineseFull, statusMap);
      fullEnglish.classList.remove('hidden');
      fullSpanish.classList.add('hidden');
      btnShowSpanish.classList.add('hidden');
      $('#full-title').textContent = '> Chinese translation';
      speakOriginal.classList.add('hidden');
      speakFull.classList.remove('hidden');
    }

    renderWordTable();
    resultsEl.classList.remove('hidden');
  }

  function renderWordTable() {
    if (!currentResult) return;
    wordTbody.innerHTML = '';
    thMeaning.textContent = meaningLang === 'en' ? 'English' : 'Spanish';
    btnToggleLang.textContent = meaningLang === 'en' ? 'Switch to Spanish' : 'Switch to English';

    currentResult.words.forEach((w, idx) => {
      const tr = document.createElement('tr');
      const meaning = meaningLang === 'en' ? w.en : (w.es || '…');
      const saved = isInDict(w.char);

      tr.innerHTML = `
        <td class="word-char-cell">
          <span class="word-char">${highlightHtml(w.char)}</span>
          <button class="speak-btn" data-speak="${escapeHtml(w.char)}" title="Play audio" aria-label="Play audio">🔊</button>
        </td>
        <td class="word-pinyin">${escapeHtml(w.pinyin)}</td>
        <td class="word-meaning">${escapeHtml(meaning)}</td>
        <td>
          <button class="btn icon-btn ${saved ? 'saved' : ''}" data-idx="${idx}" title="Save">
            ${saved ? '✓' : '＋'}
          </button>
        </td>
      `;
      wordTbody.appendChild(tr);
    });

    wordTbody.querySelectorAll('.icon-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const word = withExample(currentResult.words[idx]);
        if (!word.es) {
          word.es = await translateText(word.char, 'es');
        }
        if (addToDict(word)) {
          btn.classList.add('saved');
          btn.textContent = '✓';
        }
      });
    });
  }

  // The phrase a word was saved from becomes its example sentence on the flash card.
  function withExample(word) {
    if (!currentResult) return word;
    word.example = currentResult.isChinese ? currentResult.original : currentResult.chineseFull;
    word.exampleEn = currentResult.isChinese ? currentResult.englishFull : currentResult.original;
    return word;
  }

  // ---------- Spanish full translation ----------
  async function showSpanishFull() {
    if (!currentResult || !currentResult.isChinese) return;
    if (!currentResult.spanishFull) {
      btnShowSpanish.textContent = 'Translating…';
      btnShowSpanish.disabled = true;
      currentResult.spanishFull = await translateText(currentResult.original, 'es');
      btnShowSpanish.disabled = false;
    }
    fullSpanish.textContent = currentResult.spanishFull;
    fullSpanish.classList.remove('hidden');
    btnShowSpanish.textContent = 'Hide Spanish';
  }

  // ---------- Toggle meaning language ----------
  async function toggleMeaningLang() {
    if (!currentResult) return;
    meaningLang = meaningLang === 'en' ? 'es' : 'en';

    if (meaningLang === 'es') {
      const missing = currentResult.words.filter(w => !w.es).map(w => w.char);
      const meanings = await translateWords(missing, 'es');
      currentResult.words.forEach(w => { if (!w.es) w.es = meanings[w.char] || ''; });
    }
    renderWordTable();
  }

  // ---------- History & Dictionary ----------
  function renderHistory() {
    const hist = getHistory();
    if (hist.length === 0) {
      historyList.innerHTML = '<p class="empty-state">No phrases in your history yet.</p>';
      return;
    }
    historyList.innerHTML = hist.map(item => `
      <div class="card-item" data-id="${item.id}">
        <div class="original">${escapeHtml(item.original)}</div>
        <button class="speak-btn" data-speak="${escapeHtml(item.isChinese ? item.original : item.chinese)}" title="Play audio" aria-label="Play audio">🔊</button>
        ${item.pinyin ? `<div class="pinyin-line">${escapeHtml(item.pinyin)}</div>` : ''}
        ${item.chinese ? `<div class="meta">→ ${escapeHtml(item.chinese)}</div>` : ''}
        <div class="meta">${formatDate(item.date)} · ${item.isChinese ? 'Chinese' : 'EN/ES → ZH'}</div>
        <div class="actions">
          <button class="btn secondary small reuse-btn">Use again</button>
          <button class="btn danger small delete-hist">Delete</button>
        </div>
      </div>
    `).join('');

    historyList.querySelectorAll('.reuse-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        inputText.value = hist[i].original;
        switchTab('translate');
        processText(hist[i].original);
      });
    });
    historyList.querySelectorAll('.delete-hist').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const newHist = getHistory().filter(h => h.id !== hist[i].id);
        saveHistory(newHist);
        renderHistory();
      });
    });
  }

  function setStatus(id, status) {
    const dict = getDict();
    const item = dict.find(d => d.id === id);
    if (!item) return;
    item.status = status;
    // The most recently moved card sits on top of its pile
    dict.splice(dict.indexOf(item), 1);
    dict.unshift(item);
    saveDict(dict);
    if (currentResult) renderResults();
    renderDictionary();
  }

  function removeFromDict(id) {
    saveDict(getDict().filter(d => d.id !== id));
    renderDictionary();
    showToast('Deleted');
  }

  function renderDictionary() {
    const dict = getDict();
    dictEmpty.classList.toggle('hidden', dict.length > 0);
    dictBoard.classList.toggle('hidden', dict.length === 0);
    $('#btn-random').disabled = dict.length === 0;

    // New words: compact chips in the middle column
    const fresh = dict.filter(d => d.status === 'new');
    $('#count-new').textContent = fresh.length;
    $('#col-new').innerHTML = fresh.map(chipHtml).join('');

    // Memorized (left) and not memorized (right): a pile of stacked cards
    ['known', 'learning'].forEach(status => {
      const items = dict.filter(d => d.status === status);
      const pile = $(`#pile-${status}`);
      const layers = Math.min(items.length, 5);
      pile.classList.toggle('empty', items.length === 0);
      pile.style.setProperty('--layers', layers);
      pile.innerHTML = items.length
        ? `<span class="pile-top">${escapeHtml(items[0].char)}</span><span class="pile-count">${items.length} card${items.length === 1 ? '' : 's'}</span>`
        : '<span class="pile-count">No cards yet</span>';
    });
    if (!deck.classList.contains('hidden')) renderDeck();
  }

  function chipHtml(item) {
    return `<button class="chip" data-id="${item.id}" title="${escapeHtml(item.pinyin)}">${escapeHtml(item.char)}</button>`;
  }

  // ---------- Deck (one pile, as a study list) ----------
  const deck = $('#deck');
  let deckStatus = 'known';

  function renderDeck() {
    const items = getDict().filter(d => d.status === deckStatus);
    $('#deck-title').textContent = `> ${deckStatus === 'known' ? 'MEMORIZED' : 'NOT MEMORIZED'} (${items.length})`;
    $('#deck-list').innerHTML = items.length
      ? items.map(chipHtml).join('')
      : '<p class="empty-state">No cards in this pile.</p>';
  }

  function openDeck(status) {
    deckStatus = status;
    deck.classList.remove('hidden');
    renderDeck();
  }

  document.querySelectorAll('.pile').forEach(p => p.addEventListener('click', () => {
    if (!p.classList.contains('empty')) openDeck(p.dataset.status);
  }));
  $('#deck-close').addEventListener('click', () => deck.classList.add('hidden'));
  deck.addEventListener('click', (e) => {
    if (e.target === deck) { deck.classList.add('hidden'); return; }
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const item = getDict().find(d => d.id === Number(chip.dataset.id));
    if (item) openWordCard(item);
  });

  dictBoard.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const item = getDict().find(d => d.id === Number(chip.dataset.id));
    if (item) openWordCard(item);
  });

  // Any speaker button anywhere plays its data-speak text
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.speak-btn');
    if (!btn) return;
    e.stopPropagation();
    if (btn.id === 'speak-original') speak(currentResult && currentResult.original);
    else if (btn.id === 'speak-full') speak(currentResult && currentResult.chineseFull);
    else speak(btn.dataset.speak);
  });

  // ---------- Random flash card quiz ----------
  const quiz = $('#quiz');
  let quizItem = null;
  let quizMode = 'random'; // 'random' | 'word'

  function showCard(item) {
    quizItem = item;
    $('#quiz-char').textContent = item.char;
    $('#quiz-pinyin').textContent = item.pinyin;
    $('#quiz-meaning').textContent = item.en;
    exIdx = 0;
    fillExample(item);
    $('#quiz-back').classList.add('hidden');
    $('#quiz-flip').textContent = 'Flip card';
    $('#quiz-known').disabled = quizMode === 'word' && item.status === 'known';
    $('#quiz-learning').disabled = quizMode === 'word' && item.status === 'learning';
  }

  // ---------- Example sentences (only ones you added) ----------
  let exIdx = 0;

  function fillExample(item) {
    const list = item.sentences || [];
    if (exIdx >= list.length) exIdx = 0;
    const cur = list[exIdx];
    $('#quiz-example').textContent = cur ? cur.zh : 'No example yet. Add a sentence where you found this word.';
    $('#quiz-example').classList.toggle('empty', !cur);
    $('#quiz-example-pinyin').textContent = cur ? sentencePinyin(cur.zh) : '';
    $('#quiz-example-en').textContent = cur ? cur.en : '';
    $('#quiz-refresh').classList.toggle('hidden', list.length < 2);
    $('#quiz-ex-count').textContent = list.length > 1 ? `${exIdx + 1}/${list.length}` : '';
    $('#quiz-ex-delete').classList.toggle('hidden', !cur);
    $('#quiz-add-form').classList.add('hidden');
    $('#quiz-add').classList.remove('hidden');
  }

  function updateSentences(item, sentences) {
    const dict = getDict();
    const stored = dict.find(d => d.id === item.id);
    if (stored) {
      stored.sentences = sentences;
      saveDict(dict);
    }
    item.sentences = sentences;
  }

  function sentencePinyin(text) {
    const lib = window.pinyinPro;
    if (!lib || !lib.pinyin) return '';
    try { return lib.pinyin(text, { toneType: 'symbol' }); } catch { return ''; }
  }

  // ↻ shows the next of your sentences
  function nextExample() {
    if (!quizItem || (quizItem.sentences || []).length < 2) return;
    exIdx = (exIdx + 1) % quizItem.sentences.length;
    fillExample(quizItem);
  }

  function openAddSentence() {
    $('#quiz-add-form').classList.remove('hidden');
    $('#quiz-add').classList.add('hidden');
    const input = $('#quiz-add-input');
    input.value = '';
    input.focus();
  }

  async function saveSentence() {
    if (!quizItem) return;
    const zh = $('#quiz-add-input').value.trim();
    if (!zh) return;
    if (!zh.includes(quizItem.char)) {
      showToast(`The sentence must contain ${quizItem.char}`);
      return;
    }
    if (quizItem.sentences.some(x => x.zh === zh)) {
      showToast('You already added this sentence');
      return;
    }
    const btn = $('#quiz-add-save');
    btn.disabled = true;
    const en = await translateText(zh, 'en');
    btn.disabled = false;
    updateSentences(quizItem, [...quizItem.sentences, { zh, en }]);
    exIdx = quizItem.sentences.length - 1;
    fillExample(quizItem);
    showToast('Sentence added ✓');
  }

  function deleteSentence() {
    if (!quizItem || !quizItem.sentences[exIdx]) return;
    updateSentences(quizItem, quizItem.sentences.filter((_, i) => i !== exIdx));
    exIdx = 0;
    fillExample(quizItem);
    showToast('Sentence deleted');
  }

  function openWordCard(item) {
    quizMode = 'word';
    $('#quiz-title').textContent = '> WORD CARD';
    $('#quiz-next').classList.add('hidden');
    $('#quiz-delete').classList.remove('hidden');
    quiz.classList.remove('hidden');
    showCard(item);
  }

  // After marking a word: random mode moves on, word mode closes the card.
  function afterMark() {
    if (quizMode === 'random') nextQuizCard();
    else closeQuiz();
  }

  function nextQuizCard() {
    const dict = getDict();
    if (!dict.length) { closeQuiz(); return; }
    let pick = dict[Math.floor(Math.random() * dict.length)];
    if (dict.length > 1 && quizItem && pick.id === quizItem.id) {
      pick = dict[(dict.indexOf(pick) + 1) % dict.length];
    }
    showCard(pick);
    speak(pick.char);
  }

  function openQuiz() {
    quizMode = 'random';
    $('#quiz-title').textContent = '> RANDOM CARD';
    $('#quiz-next').classList.remove('hidden');
    $('#quiz-delete').classList.add('hidden');
    quiz.classList.remove('hidden');
    nextQuizCard();
  }

  function closeQuiz() {
    quiz.classList.add('hidden');
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  $('#btn-random').addEventListener('click', openQuiz);
  $('#quiz-close').addEventListener('click', closeQuiz);
  quiz.addEventListener('click', (e) => { if (e.target === quiz) closeQuiz(); });
  $('#quiz-audio').addEventListener('click', () => quizItem && speak(quizItem.char));
  $('#quiz-flip').addEventListener('click', () => {
    const back = $('#quiz-back');
    back.classList.toggle('hidden');
    $('#quiz-flip').textContent = back.classList.contains('hidden') ? 'Flip card' : 'Hide';
  });
  $('#quiz-next').addEventListener('click', nextQuizCard);
  $('#quiz-refresh').addEventListener('click', nextExample);
  $('#quiz-add').addEventListener('click', openAddSentence);
  $('#quiz-add-cancel').addEventListener('click', () => fillExample(quizItem));
  $('#quiz-add-save').addEventListener('click', saveSentence);
  $('#quiz-ex-delete').addEventListener('click', deleteSentence);
  $('#quiz-known').addEventListener('click', () => {
    if (!quizItem) return;
    setStatus(quizItem.id, 'known');
    showToast('Marked as memorized');
    afterMark();
  });
  $('#quiz-learning').addEventListener('click', () => {
    if (!quizItem) return;
    setStatus(quizItem.id, 'learning');
    showToast('Marked as not memorized');
    afterMark();
  });
  $('#quiz-delete').addEventListener('click', () => {
    if (!quizItem) return;
    removeFromDict(quizItem.id);
    closeQuiz();
  });

  // ---------- Helpers ----------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function showToast(msg) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
    if (name === 'history') renderHistory();
    if (name === 'dictionary') renderDictionary();
    if (name === 'settings') {
      // refresh active theme highlight
      applyTheme(getSavedTheme());
    }
  }

  // ---------- Clipboard long-press ----------
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        inputText.value = text.trim();
        showToast('Text pasted ✓');
        processText(text.trim());
      } else {
        showToast('Clipboard is empty');
      }
    } catch (err) {
      console.warn('Clipboard error:', err);
      showToast('Couldn’t read the clipboard. Paste manually');
      inputText.focus();
    }
  }

  function startLongPress(e) {
    if (e.target.closest('textarea') || e.target.closest('button')) return;
    pasteZone.classList.add('holding');
    longPressTimer = setTimeout(() => {
      pasteZone.classList.remove('holding');
      pasteFromClipboard();
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    clearTimeout(longPressTimer);
    pasteZone.classList.remove('holding');
  }

  // ---------- Event listeners ----------
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  pasteZone.addEventListener('touchstart', startLongPress, { passive: true });
  pasteZone.addEventListener('touchend', cancelLongPress);
  pasteZone.addEventListener('touchmove', cancelLongPress);
  pasteZone.addEventListener('mousedown', startLongPress);
  pasteZone.addEventListener('mouseup', cancelLongPress);
  pasteZone.addEventListener('mouseleave', cancelLongPress);
  pasteZone.addEventListener('contextmenu', (e) => e.preventDefault());

  btnTranslate.addEventListener('click', () => processText(inputText.value));

  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      processText(inputText.value);
    }
  });

  btnShowSpanish.addEventListener('click', async () => {
    if (fullSpanish.classList.contains('hidden')) {
      await showSpanishFull();
    } else {
      fullSpanish.classList.add('hidden');
      btnShowSpanish.textContent = 'Show in Spanish';
    }
  });

  btnToggleLang.addEventListener('click', toggleMeaningLang);

  btnSaveAll.addEventListener('click', async () => {
    if (!currentResult) return;
    let added = 0;
    for (const w of currentResult.words) {
      if (!w.es) w.es = await translateText(w.char, 'es');
      if (addToDict(withExample(w))) added++;
    }
    if (added > 0) showToast(`${added} words saved`);
    else showToast('All words were already saved');
    renderWordTable();
  });

  btnClearHistory.addEventListener('click', () => {
    if (confirm('Clear your whole history?')) {
      saveHistory([]);
      renderHistory();
      showToast('History cleared');
    }
  });



  // ---------- Clock ----------
  function updateClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  updateClock();
  setInterval(updateClock, 10000);

  // Theme cards
  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
      applyTheme(card.dataset.theme);
      showToast('Theme applied ✓');
    });
  });


  // ---------- Sync between devices (private GitHub gist) ----------
  const SYNC_TOKEN = 'kuai_sync_token';
  const SYNC_GIST = 'kuai_sync_gist';
  const SYNC_LAST = 'kuai_sync_last';
  const SYNC_FILE = 'kuai-chinese-sync.json';
  let syncTimer = null;
  let syncRunning = null;

  function gh(path, opts = {}) {
    return fetchWithTimeout('https://api.github.com' + path, 20000, {
      ...opts,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + localStorage.getItem(SYNC_TOKEN),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    }).then(async res => {
      if (!res.ok) throw new Error(res.status === 401 ? 'Token rejected' : 'GitHub error ' + res.status);
      return res.json();
    });
  }

  function scheduleSync() {
    if (!localStorage.getItem(SYNC_TOKEN)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), 3000);
  }

  async function findOrCreateGist() {
    let id = localStorage.getItem(SYNC_GIST);
    if (id) return id;
    for (let page = 1; page <= 5 && !id; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      const found = list.find(g => g.files && g.files[SYNC_FILE]);
      if (found) id = found.id;
      if (list.length < 100) break;
    }
    if (!id) {
      const created = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: 'Kuai Chinese sync (history + dictionary)',
          public: false,
          files: { [SYNC_FILE]: { content: JSON.stringify({ version: 1, dict: [], history: [], deleted: { dict: {}, history: {} } }) } }
        })
      });
      id = created.id;
    }
    localStorage.setItem(SYNC_GIST, id);
    return id;
  }

  async function readGist(id) {
    const gist = await gh('/gists/' + id);
    const file = gist.files && gist.files[SYNC_FILE];
    if (!file) return null;
    let content = file.content;
    if (file.truncated && file.raw_url) content = await (await fetchWithTimeout(file.raw_url, 20000)).text();
    try { return JSON.parse(content); } catch { return null; }
  }

  function mergeData(local, remote) {
    const deleted = { dict: {}, history: {} };
    ['dict', 'history'].forEach(k => {
      [local.deleted[k], (remote.deleted || {})[k] || {}].forEach(src => {
        Object.entries(src).forEach(([key, t]) => { deleted[k][key] = Math.max(deleted[k][key] || 0, t); });
      });
    });

    const words = {};
    [...(remote.dict || []), ...local.dict].forEach(w => {
      const cur = words[w.char];
      if (!cur || (w.updated || 0) >= (cur.updated || 0)) words[w.char] = w;
    });
    const dict = Object.values(words)
      .filter(w => !(deleted.dict[w.char] >= (w.updated || 0)))
      .sort((a, b) => (a.id || 0) - (b.id || 0));

    const entries = {};
    [...(remote.history || []), ...local.history].forEach(h => { entries[String(h.id)] = h; });
    const history = Object.values(entries)
      .filter(h => !deleted.history[String(h.id)])
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 100);

    return { version: 1, dict, history, deleted };
  }

  function syncNow(showResult = false) {
    if (!localStorage.getItem(SYNC_TOKEN)) return Promise.resolve();
    if (syncRunning) return syncRunning;
    setSyncStatus('Syncing…');
    syncRunning = (async () => {
      try {
        const id = await findOrCreateGist();
        const remote = (await readGist(id)) || {};
        const local = { dict: readRaw(STORAGE_DICT), history: readRaw(STORAGE_HISTORY), deleted: getDeleted() };
        const merged = mergeData(local, remote);
        localStorage.setItem(STORAGE_DICT, JSON.stringify(merged.dict));
        localStorage.setItem(STORAGE_HISTORY, JSON.stringify(merged.history));
        saveDeleted(merged.deleted);
        const content = JSON.stringify(merged);
        if (content !== JSON.stringify({ version: 1, dict: remote.dict, history: remote.history, deleted: remote.deleted })) {
          await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [SYNC_FILE]: { content } } }) });
        }
        localStorage.setItem(SYNC_LAST, new Date().toISOString());
        renderHistory();
        renderDictionary();
        if (currentResult) renderResults();
        setSyncStatus();
        if (showResult) showToast('Synced ✓');
      } catch (err) {
        console.warn('Sync failed', err);
        setSyncStatus('Sync failed: ' + err.message);
        if (showResult) showToast('Sync failed');
      } finally {
        syncRunning = null;
      }
    })();
    return syncRunning;
  }

  function setSyncStatus(msg) {
    const status = $('#sync-status');
    if (!status) return;
    const connected = !!localStorage.getItem(SYNC_TOKEN);
    $('#sync-setup').classList.toggle('hidden', connected);
    $('#sync-connected').classList.toggle('hidden', !connected);
    if (msg) { status.textContent = msg; return; }
    if (!connected) { status.textContent = 'Not connected. History and dictionary live only on this device.'; return; }
    const last = localStorage.getItem(SYNC_LAST);
    status.textContent = last
      ? `Connected. Last sync ${new Date(last).toLocaleString()}.`
      : 'Connected.';
  }

  async function connectSync() {
    const token = $('#sync-token').value.trim();
    if (!token) { showToast('Paste your GitHub token first'); return; }
    localStorage.setItem(SYNC_TOKEN, token);
    localStorage.removeItem(SYNC_GIST);
    try {
      await gh('/user');
    } catch (err) {
      localStorage.removeItem(SYNC_TOKEN);
      setSyncStatus('Could not connect: ' + err.message);
      return;
    }
    $('#sync-token').value = '';
    await syncNow(true);
  }

  function disconnectSync() {
    [SYNC_TOKEN, SYNC_GIST, SYNC_LAST].forEach(k => localStorage.removeItem(k));
    setSyncStatus();
    showToast('Sync turned off on this device');
  }

  $('#sync-connect').addEventListener('click', connectSync);
  $('#sync-now').addEventListener('click', () => syncNow(true));
  $('#sync-disconnect').addEventListener('click', disconnectSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });

  // Initial
  renderHistory();
  renderDictionary();
  applyTheme(getSavedTheme());
  // Warm up the offline word list so the first translation is fast
  setTimeout(loadCedict, 1500);
  setSyncStatus();
  syncNow();
})();
