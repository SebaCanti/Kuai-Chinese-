/* ===== Kuai Chinese App ===== */
(function () {
  'use strict';

  // ---------- State ----------
  let currentResult = null;
  let meaningLang = 'en'; // 'en' | 'es'
  let longPressTimer = null;
  const LONG_PRESS_MS = 550;

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
  const dictList = $('#dict-list');
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
  function getDict() {
    try { return JSON.parse(localStorage.getItem(STORAGE_DICT) || '[]'); }
    catch { return []; }
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
      showToast('Ya está en el diccionario');
      return false;
    }
    dict.unshift({
      id: Date.now(),
      char: word.char,
      pinyin: word.pinyin,
      en: word.en,
      es: word.es || '',
      date: new Date().toISOString()
    });
    saveDict(dict);
    renderDictionary();
    showToast('Guardado en diccionario ✓');
    return true;
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
      return '[Error de traducción]';
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
      showToast('No hay texto para traducir');
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
      showToast('Error al procesar. Intenta de nuevo.');
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
      btnShowSpanish.textContent = 'Mostrar en español';
      $('#full-title').textContent = 'Traducción completa';
    } else {
      // Source EN/ES → show Chinese + Pinyin
      fullPinyin.textContent = currentResult.pinyinFull;
      fullPinyin.classList.remove('hidden');
      fullEnglish.textContent = currentResult.chineseFull;
      fullEnglish.classList.remove('hidden');
      fullSpanish.classList.add('hidden');
      btnShowSpanish.classList.add('hidden');
      $('#full-title').textContent = 'Traducción al chino';
    }

    renderWordTable();
    resultsEl.classList.remove('hidden');
  }

  function renderWordTable() {
    if (!currentResult) return;
    wordTbody.innerHTML = '';
    thMeaning.textContent = meaningLang === 'en' ? 'Inglés' : 'Español';
    btnToggleLang.textContent = meaningLang === 'en' ? 'Cambiar a español' : 'Cambiar a inglés';

    currentResult.words.forEach((w, idx) => {
      const tr = document.createElement('tr');
      const meaning = meaningLang === 'en' ? w.en : (w.es || '…');
      const saved = isInDict(w.char);

      tr.innerHTML = `
        <td class="word-char">${escapeHtml(w.char)}</td>
        <td class="word-pinyin">${escapeHtml(w.pinyin)}</td>
        <td class="word-meaning">${escapeHtml(meaning)}</td>
        <td>
          <button class="btn icon-btn ${saved ? 'saved' : ''}" data-idx="${idx}" title="Guardar">
            ${saved ? '✓' : '＋'}
          </button>
        </td>
      `;
      wordTbody.appendChild(tr);
    });

    wordTbody.querySelectorAll('.icon-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const word = currentResult.words[idx];
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

  // ---------- Spanish full translation ----------
  async function showSpanishFull() {
    if (!currentResult || !currentResult.isChinese) return;
    if (!currentResult.spanishFull) {
      btnShowSpanish.textContent = 'Traduciendo…';
      btnShowSpanish.disabled = true;
      currentResult.spanishFull = await translateText(currentResult.original, 'es');
      btnShowSpanish.disabled = false;
    }
    fullSpanish.textContent = currentResult.spanishFull;
    fullSpanish.classList.remove('hidden');
    btnShowSpanish.textContent = 'Ocultar español';
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
      historyList.innerHTML = '<p class="empty-state">Aún no hay frases en el historial.</p>';
      return;
    }
    historyList.innerHTML = hist.map(item => `
      <div class="card-item" data-id="${item.id}">
        <div class="original">${escapeHtml(item.original)}</div>
        ${item.pinyin ? `<div class="pinyin-line">${escapeHtml(item.pinyin)}</div>` : ''}
        ${item.chinese ? `<div class="meta">→ ${escapeHtml(item.chinese)}</div>` : ''}
        <div class="meta">${formatDate(item.date)} · ${item.isChinese ? 'Chino' : 'EN/ES → ZH'}</div>
        <div class="actions">
          <button class="btn secondary small reuse-btn">Usar de nuevo</button>
          <button class="btn danger small delete-hist">Eliminar</button>
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

  function renderDictionary() {
    const dict = getDict();
    if (dict.length === 0) {
      dictList.innerHTML = '<p class="empty-state">Aún no has guardado palabras.</p>';
      return;
    }
    dictList.innerHTML = dict.map(item => `
      <div class="card-item dict-item" data-id="${item.id}">
        <div class="char">${escapeHtml(item.char)}</div>
        <div class="info">
          <div class="pinyin">${escapeHtml(item.pinyin)}</div>
          <div class="meaning">${escapeHtml(item.en)}${item.es ? ' · ' + escapeHtml(item.es) : ''}</div>
        </div>
        <button class="remove-btn" title="Eliminar">×</button>
      </div>
    `).join('');

    dictList.querySelectorAll('.remove-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const newDict = getDict().filter(d => d.id !== dict[i].id);
        saveDict(newDict);
        renderDictionary();
        showToast('Eliminado');
      });
    });
  }

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
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
  }

  // ---------- Clipboard long-press ----------
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        inputText.value = text.trim();
        showToast('Texto pegado ✓');
        processText(text.trim());
      } else {
        showToast('Portapapeles vacío');
      }
    } catch (err) {
      console.warn('Clipboard error:', err);
      showToast('No se pudo leer el portapapeles. Pega manualmente');
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
      btnShowSpanish.textContent = 'Mostrar en español';
    }
  });

  btnToggleLang.addEventListener('click', toggleMeaningLang);

  btnSaveAll.addEventListener('click', async () => {
    if (!currentResult) return;
    let added = 0;
    for (const w of currentResult.words) {
      if (!w.es) w.es = await translateText(w.char, 'es');
      if (addToDict(w)) added++;
    }
    if (added > 0) showToast(`${added} palabras guardadas`);
    else showToast('Todas ya estaban guardadas');
    renderWordTable();
  });

  btnClearHistory.addEventListener('click', () => {
    if (confirm('¿Borrar todo el historial?')) {
      saveHistory([]);
      renderHistory();
      showToast('Historial borrado');
    }
  });

  btnClearDict.addEventListener('click', () => {
    if (confirm('¿Borrar todo el diccionario?')) {
      saveDict([]);
      renderDictionary();
      showToast('Diccionario borrado');
    }
  });

  // Initial
  renderHistory();
  renderDictionary();
})();
