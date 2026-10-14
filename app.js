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
  const btnClearDict = $('#btn-clear-dict');

  // ---------- Storage helpers ----------
  const STORAGE_HISTORY = 'kuai_history';
  const STORAGE_DICT = 'kuai_dictionary';

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]'); }
    catch { return []; }
  }
  function saveHistory(items) {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(items.slice(0, 100)));
  }
  // Each word has a flash-card status: 'new' | 'known' (memorized) | 'learning' (not memorized)
  function getDict() {
    let items;
    try { items = JSON.parse(localStorage.getItem(STORAGE_DICT) || '[]'); }
    catch { items = []; }
    return items.map(d => ({ status: 'new', example: '', exampleEn: '', ...d }));
  }
  function saveDict(items) {
    localStorage.setItem(STORAGE_DICT, JSON.stringify(items));
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
    if (dict.some(d => d.char === word.char)) {
      showToast('Already in your dictionary');
      return false;
    }
    dict.unshift({
      id: Date.now(),
      char: word.char,
      pinyin: word.pinyin,
      en: word.en,
      es: word.es || '',
      status: 'new',
      example: word.example || '',
      exampleEn: word.exampleEn || '',
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
  async function translateText(text, targetLang) {
    if (!text || !text.trim()) return '';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      return data[0].map(part => part[0]).join('');
    } catch (err) {
      console.error('Translation error:', err);
      return '[Translation error]';
    }
  }

  // ---------- Chinese segmentation + Pinyin ----------
  function segmentAndPinyin(text) {
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
      const pyArr = pinyinFn(text, { type: 'array', toneType: 'symbol' });
      const chars = Array.from(text).filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c));
      return chars.map((c, i) => ({ origin: c, result: pyArr[i] || c }));
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
        const segs = segmentAndPinyin(text);
        result.pinyinFull = segs.map(s => s.result).join(' ');
        result.englishFull = await translateText(text, 'en');

        result.words = await Promise.all(segs.map(async (s) => {
          const en = await translateText(s.origin, 'en');
          return { char: s.origin, pinyin: s.result, en, es: '' };
        }));
      } else {
        // English / Spanish → Chinese + Pinyin
        const chineseText = await translateText(text, 'zh-CN');
        result.chineseFull = chineseText;
        result.englishFull = text; // keep original for reference

        const segs = segmentAndPinyin(chineseText);
        result.pinyinFull = segs.map(s => s.result).join(' ');

        result.words = await Promise.all(segs.map(async (s) => {
          const en = await translateText(s.origin, 'en');
          return { char: s.origin, pinyin: s.result, en, es: '' };
        }));
      }

      currentResult = result;
      meaningLang = 'en';
      renderResults();
      addToHistory(result);
    } catch (err) {
      console.error(err);
      showToast('Something went wrong. Please try again.');
    } finally {
      loadingEl.classList.add('hidden');
      btnTranslate.disabled = false;
    }
  }

  // ---------- Render results ----------
  function renderResults() {
    if (!currentResult) return;

    originalText.textContent = currentResult.original;

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
      fullEnglish.textContent = currentResult.chineseFull;
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
          <span class="word-char">${escapeHtml(w.char)}</span>
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
      for (const w of currentResult.words) {
        if (!w.es) {
          w.es = await translateText(w.char, 'es');
        }
      }
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
    saveDict(dict);
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

    ['known', 'new', 'learning'].forEach(status => {
      const items = dict.filter(d => d.status === status);
      $(`#count-${status}`).textContent = items.length;
      $(`#col-${status}`).innerHTML = items.map(item => `
        <div class="flash" data-id="${item.id}">
          <button class="flash-face" data-action="flip" title="Flip">
            <span class="flash-char">${escapeHtml(item.char)}</span>
            <span class="flash-back">
              <span class="flash-pinyin">${escapeHtml(item.pinyin)}</span>
              <span class="flash-meaning">${escapeHtml(item.en)}</span>
            </span>
          </button>
          <div class="flash-tools">
            <button class="speak-btn" data-speak="${escapeHtml(item.char)}" title="Play audio" aria-label="Play audio">🔊</button>
            <button class="flash-btn" data-action="flip">Flip</button>
            <button class="flash-del" data-action="delete" title="Delete" aria-label="Delete">×</button>
          </div>
          <button class="flash-btn known" data-action="known" ${status === 'known' ? 'disabled' : ''}>Memorized</button>
          <button class="flash-btn learning" data-action="learning" ${status === 'learning' ? 'disabled' : ''}>Not memorized</button>
        </div>
      `).join('');
    });
  }

  dictBoard.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.flash');
    const id = Number(card.dataset.id);
    const action = btn.dataset.action;
    if (action === 'flip') card.classList.toggle('flipped');
    else if (action === 'delete') removeFromDict(id);
    else setStatus(id, action);
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

  function nextQuizCard() {
    const dict = getDict();
    if (!dict.length) { closeQuiz(); return; }
    let pick = dict[Math.floor(Math.random() * dict.length)];
    if (dict.length > 1 && quizItem && pick.id === quizItem.id) {
      pick = dict[(dict.indexOf(pick) + 1) % dict.length];
    }
    quizItem = pick;
    $('#quiz-char').textContent = pick.char;
    $('#quiz-pinyin').textContent = pick.pinyin;
    $('#quiz-meaning').textContent = pick.en;
    $('#quiz-example').textContent = pick.example || '—';
    $('#quiz-example-en').textContent = pick.exampleEn || '';
    $('#quiz-back').classList.add('hidden');
    $('#quiz-flip').textContent = 'Flip card';
    speak(pick.char);
  }

  function openQuiz() {
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
  $('#quiz-known').addEventListener('click', () => {
    if (!quizItem) return;
    setStatus(quizItem.id, 'known');
    showToast('Marked as memorized');
    nextQuizCard();
  });
  $('#quiz-learning').addEventListener('click', () => {
    if (!quizItem) return;
    setStatus(quizItem.id, 'learning');
    showToast('Marked as not memorized');
    nextQuizCard();
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

  btnClearDict.addEventListener('click', () => {
    if (confirm('Clear your whole dictionary?')) {
      saveDict([]);
      renderDictionary();
      showToast('Dictionary cleared');
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

  // Initial
  renderHistory();
  renderDictionary();
  applyTheme(getSavedTheme());
})();
