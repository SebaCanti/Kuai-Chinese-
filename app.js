/* ===== Kuai Chinese App ===== */
(function () {
  'use strict';

  // ---------- State ----------
  let currentResult = null;
  let meaningLang = 'en'; // 'en' | 'es'
  let longPressTimer = null;
  const LONG_PRESS_MS = 400;

  // ---------- Themes ----------
  const THEME_KEY = 'kuai_theme';
  const THEMES = ['neon-tokyo', 'matrix-soft', 'synthwave', 'chrome-crimson', 'holo-glass', 'night-reader', 'paper', 'soft-slate'];

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
      'holo-glass': '#0f0c29',
      'night-reader': '#1d1b18',
      'paper': '#f3ead8',
      'soft-slate': '#232a33'
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
  // Your own corrections: word meanings and full-sentence translations.
  // Stored as { key: { en, t } } and used before anything automatic.
  const STORAGE_MY_MEANINGS = 'kuai_my_meanings';
  const STORAGE_MY_SENTENCES = 'kuai_my_sentences';
  function getMine(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  }
  function setMine(key, item, en) {
    const all = getMine(key);
    // An empty value goes back to the automatic translation (kept as a dated blank so sync spreads it)
    all[item] = { en: (en || '').trim(), t: Date.now() };
    localStorage.setItem(key, JSON.stringify(all));
    scheduleSync();
  }
  function myText(key, item) {
    const v = getMine(key)[item];
    return v && v.en ? v.en : '';
  }

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
      pos: (cedict && posEn) ? guessPos(word.char, word.en) : '',
      sentences: word.example ? [{ zh: word.example, en: word.exampleEn || '' }] : [],
      date: new Date().toISOString()
    });
    saveDict(dict);
    renderDictionary();
    fillMissingPos();
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
      cedictLoading = fetchWithTimeout('cedict.txt?v=23', 30000)
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

  // ---------- Word types (noun, verb, adjective…) ----------
  // Worked out offline from the word's English meaning: CEDICT writes verbs as "to …",
  // and pos-en.txt (from WordNet) says which English words are adjectives, adverbs or verbs.
  // Any English word not listed there is a noun. You can change the type on the card.
  const POS_LABELS = {
    noun: 'Noun', verb: 'Verb', adj: 'Adjective', adv: 'Adverb', pron: 'Pronoun',
    mw: 'Measure word', part: 'Particle', conj: 'Conjunction', prep: 'Preposition',
    num: 'Number', expr: 'Expression'
  };
  const POS_PLURAL = {
    noun: 'Nouns', verb: 'Verbs', adj: 'Adjectives', adv: 'Adverbs', pron: 'Pronouns',
    mw: 'Measure words', part: 'Particles', conj: 'Conjunctions', prep: 'Prepositions',
    num: 'Numbers', expr: 'Expressions'
  };
  const POS_WORDS = {
    pron: 'i me my mine you your yours he him his she her hers it its we us our they them their this that these those who whom whose what which myself yourself himself herself itself ourselves themselves everyone everybody someone somebody nobody anyone anything something nothing everything each',
    conj: 'and but or because although though if unless so therefore however whereas while yet nor otherwise moreover furthermore',
    prep: 'at in on by from to for with without toward towards into onto about above below under over between among through across along around behind beside near since until till via per than against according',
    num: 'zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion half first second third',
    adv: 'very quite too also still already just only not never always often sometimes then again even almost soon really so more most now here there together certainly perhaps maybe probably extremely rather fairly',
    part: 'particle marker interjection'
  };
  const POS_SET = {};
  Object.keys(POS_WORDS).forEach(k => POS_WORDS[k].split(' ').forEach(w => { if (!POS_SET[w]) POS_SET[w] = k; }));

  let posEn = null;
  let posLoading = null;
  function loadPosLexicon() {
    if (posEn) return Promise.resolve(posEn);
    if (!posLoading) {
      posLoading = fetchWithTimeout('pos-en.txt?v=23', 20000)
        .then(res => res.ok ? res.text() : Promise.reject(new Error('pos ' + res.status)))
        .then(txt => {
          const code = { a: 'adj', r: 'adv', v: 'verb' };
          const map = new Map();
          txt.split('\n').forEach(line => {
            const [w, c] = line.split('\t');
            if (w && code[c]) map.set(w, code[c]);
          });
          posEn = map;
          return map;
        })
        .catch(err => { console.warn('Word types unavailable', err); posLoading = null; return null; });
    }
    return posLoading;
  }

  // The type one English meaning points to, or '' when it says nothing
  function posOfSense(sense) {
    const raw = String(sense || '').toLowerCase().trim();
    if (!raw) return '';
    if (/measure word|classifier/.test(raw)) return 'mw';
    if (/\(.*(particle|marker|possessive|completed action|aspect|interjection).*\)?/.test(raw)) return 'part';
    if (/\bidiom\b|\bproverb\b/.test(raw)) return 'expr';
    const text = raw.replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim();
    const toks = text.match(/[a-z]+|\d+/g) || [];
    if (!toks.length) return '';
    if (toks[0] === 'to' && toks.length > 1) return 'verb';
    if (/^(don|doesn|didn|not|can|cannot|won|must|should|will|would|could)$/.test(toks[0]) && toks.length > 1) return 'verb';
    if (/^\d+$/.test(toks[0]) && toks.length === 1) return 'num';
    if (/^(a little|a bit|a little bit|a lot)$/.test(text)) return 'adv';
    if (/^(a|an|the)$/.test(toks[0])) return 'noun';
    const first = toks[0];
    const last = toks[toks.length - 1];
    if (toks.length === 1) {
      if (POS_SET[first] && POS_SET[first] !== 'part') return POS_SET[first];
      if (posEn && posEn.has(first)) return posEn.get(first);
      if (/ly$/.test(first) && first.length > 4) return 'adv';
      return 'noun';
    }
    if (POS_SET[last] === 'prep' || POS_SET[first] === 'conj') return POS_SET[first] === 'conj' ? 'conj' : 'prep';
    if (POS_SET[first] === 'adv' && posEn && posEn.get(last) === 'adj') return 'adj';
    if (POS_SET[first] === 'pron') return 'expr';
    const lastPos = posEn && posEn.get(last);
    if (lastPos === 'adj' || lastPos === 'adv') return lastPos;
    return 'noun';
  }

  // Your meaning for the word decides first, then the dictionary's meanings
  function guessPos(char, en) {
    if (/^[零一二三四五六七八九十百千万亿两]+$/.test(char)) return 'num';
    const senses = String(en || '').split(/\s*[;\n]\s*/);
    const listed = cedict && cedict.get(char);
    if (listed) senses.push(...listed.split('|').slice(0, 3));
    for (const s of senses) {
      const p = posOfSense(s);
      if (p) return p;
    }
    return char.length >= 4 ? 'expr' : 'noun';
  }

  // Gives every saved word a type once the word lists are loaded
  async function fillMissingPos() {
    if (!getDict().some(d => !d.pos)) return;
    await Promise.all([loadCedict(), loadPosLexicon()]);
    const dict = getDict();
    let changed = false;
    dict.forEach(d => { if (!d.pos) { d.pos = guessPos(d.char, d.en); changed = true; } });
    if (changed) { saveDict(dict); renderDictionary(); }
  }

  function wordPinyin(word) {
    const fn = (window.pinyinPro || {}).pinyin;
    if (!fn) return word;
    try { return fn(word, { toneType: 'symbol' }).replace(/\s+/g, ''); } catch (e) { return word; }
  }

  // Adverb + verb pairs that the word list also has as rare words
  // (都会 "metropolis"); in sentences they are almost always two words.
  const NO_JOIN = new Set(['都会', '也会', '就会', '才会', '还会', '都要', '也要', '都有', '也有',
    '都在', '也在', '就在', '都是', '也是', '又是', '才是']);

  // Longest match first against the word list, up to 4 characters.
  function segmentWithCedict(text, dict) {
    const out = [];
    const chars = Array.from(text);
    let i = 0;
    while (i < chars.length) {
      if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chars[i])) { i++; continue; }
      let len = Math.min(4, chars.length - i);
      for (; len > 1; len--) {
        const w = chars.slice(i, i + len).join('');
        if (dict.has(w) && !NO_JOIN.has(w)) break;
      }
      const word = chars.slice(i, i + len).join('');
      out.push({ origin: word, result: wordPinyin(word) });
      i += len;
    }
    return out;
  }

  // ---------- Word meanings that fit the sentence ----------
  // The word list holds several senses per word ("to think|to believe|to want").
  // We pick the sense whose words appear in the sentence's English translation,
  // so 想 in "Don't want you to spend money" reads "to want", not "to think".
  const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'sb', 'sth', 'be', 'is', 'are', 'it', 'on', 'in', 'at',
    'for', 'and', 'or', 'with', 'as', 'by', 'do', 'one', 'that', 'this', 'etc', 'used', 'something', 'someone',
    'have', 'has', 'had', 'there', 'get', 'got']);
  function stem(w) {
    if (w.length > 4) return w.replace(/(ing|ed|es|s)$/, '');
    return w;
  }
  function contentWords(str) {
    return (str || '').toLowerCase()
      .replace(/n['’]t\b/g, ' not').replace(/['’](s|re|m|ll|ve|d)\b/g, '')
      .split(/[^a-z]+/).filter(w => w && !STOP.has(w)).map(stem);
  }
  function pickSense(senses, context) {
    let best = { text: senses[0], score: 0 };
    senses.forEach(sense => {
      const score = contentWords(sense).filter(w => context.has(w)).length;
      if (score > best.score) best = { text: sense, score };
    });
    return best;
  }

  // Turns segments into table rows with a meaning each. Compound words always
  // stay together. Candidates for each word are the word list's senses plus
  // Google's translation of the word alone; the one that also appears in the
  // sentence's translation wins. Your own corrections always come first.
  async function wordsInContext(segs, englishText) {
    const dict = await loadCedict();
    const context = new Set(contentWords(englishText));
    const mine = getMine(STORAGE_MY_MEANINGS);
    const ask = segs.map(s => s.origin).filter(w => !(mine[w] && mine[w].en));
    const google = ask.length ? await translateWords(ask, 'en') : {};
    return segs.map(s => {
      const row = { char: s.origin, pinyin: s.result, es: '' };
      if (mine[s.origin] && mine[s.origin].en) {
        // Several meanings of yours ("to want; to miss"): show the one that fits, or all of them
        const own = splitMeanings(mine[s.origin].en);
        const fit = pickSense(own, context);
        return { ...row, en: fit.score > 0 ? fit.text : own.join('; '), mine: true };
      }
      let g = (google[s.origin] || '').trim();
      if (g === s.origin || g === '[Translation error]') g = '';
      if (/^[A-Z][a-z]/.test(g)) g = g[0].toLowerCase() + g.slice(1);
      const senses = dict && dict.has(s.origin) ? dict.get(s.origin).split('|').filter(Boolean) : [];
      const pick = pickSense(g ? [...senses, g] : senses, context);
      if (pick.score > 0) return { ...row, en: pick.text };
      // Nothing matches the sentence: the word list's main sense for single
      // characters (Google is odd on lone characters), Google for compounds.
      const compound = Array.from(s.origin).length > 1;
      return { ...row, en: (compound ? g || senses[0] : senses[0] || g) || '' };
    });
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
        result.englishFull = myText(STORAGE_MY_SENTENCES, text) || await translateText(text, 'en');
        result.words = await wordsInContext(segs, result.englishFull);
      } else {
        // English / Spanish → Chinese + Pinyin
        const chineseText = await translateText(text, 'zh-CN');
        result.chineseFull = chineseText;
        result.englishFull = text; // keep original for reference

        await loadCedict();
        const segs = segmentAndPinyin(chineseText);
        result.pinyinFull = segs.map(s => s.result).join(' ');

        result.words = await wordsInContext(segs, text);
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
      fullEnglish.textContent = capFirst(currentResult.englishFull);
      fullEnglish.classList.toggle('mine', !!myText(STORAGE_MY_SENTENCES, currentResult.original));
      fullEnglish.classList.remove('hidden');
      $('#edit-full').classList.remove('hidden');
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
      fullEnglish.classList.remove('mine');
      $('#edit-full').classList.add('hidden');
      fullEnglish.classList.remove('hidden');
      fullSpanish.classList.add('hidden');
      btnShowSpanish.classList.add('hidden');
      $('#full-title').textContent = '> Chinese translation';
      speakOriginal.classList.add('hidden');
      speakFull.classList.remove('hidden');
    }

    $('#edit-full-form').classList.add('hidden');
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
      const meaning = capFirst(meaningLang === 'en' ? w.en : (w.es || '…'));
      const saved = isInDict(w.char);

      tr.innerHTML = `
        <td class="word-char-cell">
          <span class="word-char">${highlightHtml(w.char)}</span>
          <button class="speak-btn" data-speak="${escapeHtml(w.char)}" title="Play audio" aria-label="Play audio">🔊</button>
        </td>
        <td class="word-pinyin">${escapeHtml(w.pinyin)}</td>
        <td class="word-meaning${w.mine && meaningLang === 'en' ? ' mine' : ''}">
          <span class="meaning-text">${escapeHtml(meaning)}</span>
          ${meaningLang === 'en' ? `<button class="edit-btn" data-edit="${idx}" title="Edit meaning" aria-label="Edit meaning">✎</button>` : ''}
        </td>
        <td>
          <button class="btn icon-btn ${saved ? 'saved' : ''}" data-idx="${idx}" title="Save">
            ${saved ? '✓' : '＋'}
          </button>
        </td>
      `;
      wordTbody.appendChild(tr);
    });

    wordTbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => editMeaning(parseInt(btn.dataset.edit, 10), btn.closest('td')));
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
    fullSpanish.textContent = capFirst(currentResult.spanishFull);
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

  // ---------- Word type filter (bottom of Dictionary) ----------
  let posFilter = 'all';

  // The saved words the filter lets through
  function shownDict() {
    const dict = getDict();
    return posFilter === 'all' ? dict : dict.filter(d => d.pos === posFilter);
  }

  function renderPosFilter(all) {
    const counts = {};
    all.forEach(d => { if (d.pos) counts[d.pos] = (counts[d.pos] || 0) + 1; });
    if (posFilter !== 'all' && !counts[posFilter]) posFilter = 'all';
    const types = Object.keys(POS_LABELS).filter(k => counts[k]);
    const bar = $('#pos-filter');
    bar.classList.toggle('hidden', types.length === 0);
    bar.innerHTML = [`<button class="pos-chip${posFilter === 'all' ? ' active' : ''}" data-pos="all">All ${all.length}</button>`]
      .concat(types.map(k => `<button class="pos-chip${posFilter === k ? ' active' : ''}" data-pos="${k}">${POS_PLURAL[k]} ${counts[k]}</button>`))
      .join('');
  }

  $('#pos-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.pos-chip');
    if (!btn) return;
    posFilter = btn.dataset.pos;
    renderDictionary();
  });

  function renderDictionary() {
    const all = getDict();
    renderPosFilter(all);
    const dict = shownDict();
    dictEmpty.classList.toggle('hidden', all.length > 0);
    dictBoard.classList.toggle('hidden', all.length === 0);
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
    const items = shownDict().filter(d => d.status === deckStatus);
    const kind = posFilter === 'all' ? '' : ` · ${POS_PLURAL[posFilter].toUpperCase()}`;
    $('#deck-title').textContent = `> ${deckStatus === 'known' ? 'MEMORIZED' : 'NOT MEMORIZED'}${kind} (${items.length})`;
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
    renderCardPos(item);
    renderCardMeaning(item);
    $('#quiz-meaning-form').classList.add('hidden');
    $('#quiz-char-form').classList.add('hidden');
    $('#quiz-delete').classList.toggle('hidden', quizMode !== 'word' || !showDeleteCards());
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
    $('#quiz-example-en').textContent = cur ? capFirst(cur.en) : '';
    $('#quiz-refresh').classList.toggle('hidden', list.length < 2);
    $('#quiz-ex-count').textContent = list.length > 1 ? `${exIdx + 1}/${list.length}` : '';
    $('#quiz-ex-delete').classList.toggle('hidden', !cur);
    $('#quiz-ex-edit').classList.toggle('hidden', !cur);
    $('#quiz-add-form').classList.add('hidden');
    $('#quiz-ex-form').classList.add('hidden');
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

  // ---------- Edit a saved example ----------
  function openEditSentence() {
    const cur = quizItem && quizItem.sentences[exIdx];
    if (!cur) return;
    $('#quiz-ex-zh').value = cur.zh;
    $('#quiz-ex-en').value = capFirst(cur.en);
    $('#quiz-add-form').classList.add('hidden');
    $('#quiz-ex-form').classList.remove('hidden');
    $('#quiz-ex-zh').focus();
  }

  async function saveEditSentence() {
    const cur = quizItem && quizItem.sentences[exIdx];
    if (!cur) return;
    const zh = $('#quiz-ex-zh').value.trim();
    let en = $('#quiz-ex-en').value.trim();
    if (!zh) { showToast('Write the Chinese sentence'); return; }
    if (!zh.includes(quizItem.char)) { showToast(`The sentence must contain ${quizItem.char}`); return; }
    if (quizItem.sentences.some((x, i) => i !== exIdx && x.zh === zh)) { showToast('You already added this sentence'); return; }
    // New Chinese with the old English left as it was: translate the new sentence
    if (zh !== cur.zh && (!en || en === capFirst(cur.en))) {
      const btn = $('#quiz-ex-save');
      btn.disabled = true;
      en = await translateText(zh, 'en') || en;
      btn.disabled = false;
    }
    const sentences = quizItem.sentences.map((x, i) => i === exIdx ? { ...x, zh, en } : x);
    updateSentences(quizItem, sentences);
    fillExample(quizItem);
    showToast('Sentence saved ✓');
  }

  function deleteSentence() {
    if (!quizItem || !quizItem.sentences[exIdx]) return;
    updateSentences(quizItem, quizItem.sentences.filter((_, i) => i !== exIdx));
    exIdx = 0;
    fillExample(quizItem);
    showToast('Sentence deleted');
  }

  // Settings switch: show or hide the Delete button on word cards (this device only)
  const STORAGE_SHOW_DELETE = 'kuai_show_delete';
  function showDeleteCards() {
    return localStorage.getItem(STORAGE_SHOW_DELETE) !== 'off';
  }
  $('#setting-show-delete').checked = showDeleteCards();
  $('#setting-show-delete').addEventListener('change', (e) => {
    localStorage.setItem(STORAGE_SHOW_DELETE, e.target.checked ? 'on' : 'off');
    showToast(e.target.checked ? 'Delete button shown on cards' : 'Delete button hidden on cards');
  });

  function openWordCard(item) {
    quizMode = 'word';
    $('#quiz-title').textContent = '> WORD CARD';
    $('#quiz-next').classList.add('hidden');
    quiz.classList.remove('hidden');
    showCard(item);
  }

  // After marking a word: random mode moves on, word mode closes the card.
  function afterMark() {
    if (quizMode === 'random') nextQuizCard();
    else closeQuiz();
  }

  function nextQuizCard() {
    const dict = shownDict();
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
  $('#quiz-ex-edit').addEventListener('click', openEditSentence);
  $('#quiz-ex-cancel').addEventListener('click', () => $('#quiz-ex-form').classList.add('hidden'));
  $('#quiz-ex-save').addEventListener('click', saveEditSentence);
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
    if (!quizItem || !showDeleteCards()) return;
    removeFromDict(quizItem.id);
    closeQuiz();
  });

  // ---------- Helpers ----------
  // Translations are shown starting with a capital letter ("(Question particle)", "To want").
  // Only the display changes; what is stored stays as it came.
  function capFirst(text) {
    return String(text || '').replace(/\p{L}/u, c => c.toUpperCase());
  }

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
  // quiet: used for the attempt while the finger is still down. If the browser
  // refuses (iPhone does outside a release), we try again on release.
  async function pasteFromClipboard(quiet = false) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('Clipboard API unavailable');
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        inputText.value = text.trim();
        processText(text.trim());
      } else if (!quiet) {
        showToast('Clipboard is empty');
      }
      return true;
    } catch (err) {
      if (quiet) return false;
      console.warn('Clipboard error:', err);
      showToast('Tap the box, hold, then choose Paste');
      inputText.focus();
      return false;
    }
  }


  // As soon as the hold is long enough we paste and translate. Most browsers
  // allow that right away; iPhone Safari only allows reading the clipboard when
  // the finger is lifted, so there the paste happens on release.
  let pressArmed = false;
  let pastedDuringHold = false;
  function startLongPress(e) {
    if (e.target.closest('textarea') || e.target.closest('button')) return;
    pressArmed = false;
    pastedDuringHold = false;
    pasteZone.classList.add('holding');
    longPressTimer = setTimeout(async () => {
      pressArmed = true;
      pasteZone.classList.add('armed');
      if (navigator.vibrate) navigator.vibrate(20);
      pastedDuringHold = await pasteFromClipboard(true);
    }, LONG_PRESS_MS);
  }

  function endLongPress() {
    clearTimeout(longPressTimer);
    pasteZone.classList.remove('holding', 'armed');
    if (pressArmed && !pastedDuringHold) pasteFromClipboard();
    pressArmed = false;
  }

  function cancelLongPress() {
    clearTimeout(longPressTimer);
    pressArmed = false;
    pasteZone.classList.remove('holding', 'armed');
  }


  // ---------- Meanings on the flash card ----------
  // A word can have several meanings, stored as "to want; to miss".
  function splitMeanings(en) {
    return String(en || '').split(/\s*[;\n]\s*/).map(m => m.trim()).filter(Boolean);
  }

  function renderCardMeaning(item) {
    const list = splitMeanings(item.en);
    $('#quiz-meaning').innerHTML = list.length > 1
      ? '<ol class="meaning-list">' + list.map(m => `<li>${escapeHtml(capFirst(m))}</li>`).join('') + '</ol>'
      : escapeHtml(capFirst(list[0] || ''));
  }

  function openCardMeaningEdit() {
    $('#quiz-meaning-input').value = splitMeanings(quizItem.en).join('\n');
    $('#quiz-meaning-form').classList.remove('hidden');
    $('#quiz-meaning-input').focus();
  }

  function saveCardMeaning() {
    const list = splitMeanings($('#quiz-meaning-input').value);
    if (!list.length) { showToast('Write at least one meaning'); return; }
    const en = list.join('; ');
    const dict = getDict();
    const item = dict.find(d => d.char === quizItem.char);
    if (item) { item.en = en; saveDict(dict); }
    quizItem.en = en;
    // Translations use your meanings for this word from now on
    setMine(STORAGE_MY_MEANINGS, quizItem.char, en);
    renderCardMeaning(quizItem);
    $('#quiz-meaning-form').classList.add('hidden');
    renderDictionary();
    showToast(list.length > 1 ? `${list.length} meanings saved ✓` : 'Meaning saved ✓');
  }

  // ---------- Word type on the card (tap to change it) ----------
  function renderCardPos(item) {
    const sel = $('#quiz-pos');
    sel.innerHTML = (item.pos ? '' : '<option value="">Word type…</option>') +
      Object.keys(POS_LABELS).map(k => `<option value="${k}"${item.pos === k ? ' selected' : ''}>${POS_LABELS[k]}</option>`).join('');
  }

  $('#quiz-pos').addEventListener('change', (e) => {
    if (!quizItem || !e.target.value) return;
    const dict = getDict();
    const item = dict.find(d => d.id === quizItem.id);
    if (!item) return;
    item.pos = quizItem.pos = e.target.value;
    saveDict(dict);
    renderCardPos(quizItem);
    renderDictionary();
    showToast(`Saved as ${POS_LABELS[item.pos].toLowerCase()} ✓`);
  });

  // ---------- Fix the Chinese word itself on the card ----------
  function openCardCharEdit() {
    $('#quiz-char-input').value = quizItem.char;
    $('#quiz-char-form').classList.remove('hidden');
    $('#quiz-char-input').focus();
  }

  function saveCardChar() {
    const char = ($('#quiz-char-input').value.match(/\p{Script=Han}/gu) || []).join('');
    if (!char) { showToast('Write the word in Chinese characters'); return; }
    if (char === quizItem.char) { $('#quiz-char-form').classList.add('hidden'); return; }
    const dict = getDict();
    if (dict.some(d => d.char === char)) { showToast(`${char} is already in your dictionary`); return; }
    const item = dict.find(d => d.id === quizItem.id);
    if (!item) return;
    // Memorized status, meanings and sentences stay with the card
    item.char = char;
    item.pinyin = wordPinyin(char);
    saveDict(dict);
    quizItem.char = item.char;
    quizItem.pinyin = item.pinyin;
    $('#quiz-char').textContent = item.char;
    $('#quiz-pinyin').textContent = item.pinyin;
    $('#quiz-char-form').classList.add('hidden');
    renderDictionary();
    if (currentResult) renderResults();
    showToast('Word saved ✓');
  }

  $('#quiz-char-edit').addEventListener('click', openCardCharEdit);
  $('#quiz-char-cancel').addEventListener('click', () => $('#quiz-char-form').classList.add('hidden'));
  $('#quiz-char-save').addEventListener('click', saveCardChar);
  $('#quiz-char-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveCardChar(); });

  $('#quiz-meaning-edit').addEventListener('click', openCardMeaningEdit);
  $('#quiz-meaning-cancel').addEventListener('click', () => $('#quiz-meaning-form').classList.add('hidden'));
  $('#quiz-meaning-save').addEventListener('click', saveCardMeaning);

  // ---------- Your own corrections ----------
  function editMeaning(idx, td) {
    const w = currentResult.words[idx];
    td.innerHTML = `
      <input class="meaning-input" type="text" value="${escapeHtml(w.en)}" aria-label="Meaning of ${escapeHtml(w.char)}" />
      <button class="edit-btn meaning-save" title="Save" aria-label="Save">✓</button>`;
    const input = td.querySelector('input');
    input.focus();
    input.select();
    const save = () => {
      const value = input.value.trim();
      setMine(STORAGE_MY_MEANINGS, w.char, value);
      if (value) {
        w.en = value;
        w.mine = true;
        // Saved words get the corrected meaning too
        const dict = getDict();
        const item = dict.find(d => d.char === w.char);
        if (item) { item.en = value; saveDict(dict); }
        showToast('Meaning saved ✓');
        renderWordTable();
      } else {
        // Cleared: go back to the automatic meaning
        w.mine = false;
        refreshWords();
      }
    };
    td.querySelector('.meaning-save').addEventListener('click', save);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') renderWordTable();
    });
  }

  async function refreshWords() {
    const segs = currentResult.words.map(w => ({ origin: w.char, result: w.pinyin }));
    currentResult.words = await wordsInContext(segs, currentResult.englishFull);
    renderWordTable();
  }

  function openEditFull() {
    $('#edit-full-input').value = currentResult.englishFull;
    $('#edit-full-form').classList.remove('hidden');
    $('#edit-full').classList.add('hidden');
    $('#edit-full-input').focus();
  }

  async function saveEditFull() {
    const value = $('#edit-full-input').value.trim();
    setMine(STORAGE_MY_SENTENCES, currentResult.original, value);
    currentResult.englishFull = value || await translateText(currentResult.original, 'en');
    // Keep history in line with the corrected translation
    const hist = getHistory();
    const entry = hist.find(h => h.original === currentResult.original);
    if (entry) { entry.english = currentResult.englishFull; saveHistory(hist); renderHistory(); }
    // Word meanings are picked again against the corrected sentence
    const segs = currentResult.words.map(w => ({ origin: w.char, result: w.pinyin }));
    currentResult.words = await wordsInContext(segs, currentResult.englishFull);
    renderResults();
    showToast(value ? 'Translation saved ✓' : 'Back to automatic translation');
  }

  $('#edit-full').addEventListener('click', openEditFull);
  $('#edit-full-cancel').addEventListener('click', () => {
    $('#edit-full-form').classList.add('hidden');
    $('#edit-full').classList.remove('hidden');
  });
  $('#edit-full-save').addEventListener('click', saveEditFull);

  // ---------- Event listeners ----------
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  pasteZone.addEventListener('touchstart', startLongPress, { passive: true });
  pasteZone.addEventListener('touchend', (e) => { if (pressArmed) e.preventDefault(); endLongPress(); });
  pasteZone.addEventListener('touchmove', cancelLongPress, { passive: true });
  pasteZone.addEventListener('touchcancel', cancelLongPress);
  pasteZone.addEventListener('mousedown', (e) => { if (e.button === 0) startLongPress(e); });
  pasteZone.addEventListener('mouseup', endLongPress);
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

    const newest = (a = {}, b = {}) => {
      const out = { ...a };
      Object.entries(b).forEach(([k, v]) => { if (!out[k] || (v.t || 0) > (out[k].t || 0)) out[k] = v; });
      return out;
    };
    const meanings = newest(remote.meanings, local.meanings);
    const sentences = newest(remote.sentences, local.sentences);

    return { version: 1, dict, history, deleted, meanings, sentences };
  }

  function syncNow(showResult = false) {
    if (!localStorage.getItem(SYNC_TOKEN)) return Promise.resolve();
    if (syncRunning) return syncRunning;
    setSyncStatus('Syncing…');
    syncRunning = (async () => {
      try {
        const id = await findOrCreateGist();
        const remote = (await readGist(id)) || {};
        const local = {
          dict: readRaw(STORAGE_DICT), history: readRaw(STORAGE_HISTORY), deleted: getDeleted(),
          meanings: getMine(STORAGE_MY_MEANINGS), sentences: getMine(STORAGE_MY_SENTENCES)
        };
        const merged = mergeData(local, remote);
        localStorage.setItem(STORAGE_DICT, JSON.stringify(merged.dict));
        localStorage.setItem(STORAGE_HISTORY, JSON.stringify(merged.history));
        saveDeleted(merged.deleted);
        localStorage.setItem(STORAGE_MY_MEANINGS, JSON.stringify(merged.meanings));
        localStorage.setItem(STORAGE_MY_SENTENCES, JSON.stringify(merged.sentences));
        const content = JSON.stringify(merged);
        if (content !== JSON.stringify({ version: 1, dict: remote.dict, history: remote.history, deleted: remote.deleted, meanings: remote.meanings, sentences: remote.sentences })) {
          await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [SYNC_FILE]: { content } } }) });
        }
        localStorage.setItem(SYNC_LAST, new Date().toISOString());
        renderHistory();
        renderDictionary();
        fillMissingPos();
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
  setTimeout(() => { loadCedict(); loadPosLexicon(); fillMissingPos(); }, 1500);
  setSyncStatus();
  syncNow();
})();
