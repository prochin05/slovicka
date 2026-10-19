/* Obsluha stránky: lekce, nastavení, zkoušení, úprava slova, log. */
(function () {
  'use strict';
  const S = window.Slovicka;
  const STORE_KEY = 'slovicka-v1';
  const MAX_LOGS = 300;
  const TITLES = {
    home: 'Zkoušení slovíček', exam: 'Zkoušení', result: 'Konec testu', edit: 'Úprava slova',
    log: 'Log testů', logdetail: 'Log testu', about: 'O programu',
  };
  const DEFAULT_SETTINGS = { name: '', repeat: 1, czEn: true, enCz: false, notes: true, help: true, helpLevel: 0 };

  const $ = id => document.getElementById(id);

  /* ---------- Uložená data (v prohlížeči tohoto zařízení) ---------- */

  function loadData() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* prázdné nebo nedostupné */ }
    d = d && typeof d === 'object' ? d : {};
    d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
    d.lessons = Array.isArray(d.lessons) ? d.lessons : [];
    d.selected = Array.isArray(d.selected) ? d.selected : [];
    d.logs = Array.isArray(d.logs) ? d.logs : [];
    // test, který skončil zavřením aplikace
    for (const log of d.logs) {
      if (log.status === 'running') {
        log.status = 'stopped';
        log.lines.push('Test nebyl dokončen (aplikace byla zavřena).');
      }
    }
    return d;
  }

  let data = loadData();

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      toast('Data se nepodařilo uložit: ' + e.message);
    }
  }

  /* ---------- Pomocné ---------- */

  let toastTimer = null;
  function toast(msg, ms) {
    if (screen === 'exam') return; // při zkoušení nic nezakrývat
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3000);
  }

  const pad2 = n => String(n).padStart(2, '0');
  const hms = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  const stamp = d => d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  const czDate = d => d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());

  function el(tag, props, children) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    for (const c of children || []) e.append(c);
    return e;
  }

  function download(fileName, text, type) {
    const blob = new Blob(['﻿' + text], { type: type + ';charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: fileName });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const wordCount = lesson => lesson.rows.filter(r => r[S.COL.CZ] && r[S.COL.EN]).length;
  const findLesson = name => data.lessons.find(l => l.name === name);

  /* ---------- Obrazovky a tlačítko Zpět ---------- */

  let screen = 'home';
  function show(name, mode) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
    screen = name;
    document.body.dataset.screen = name;
    if (name === 'exam') $('toast').hidden = true;
    $('title').textContent = TITLES[name];
    $('btn-back').hidden = name === 'home';
    if (mode === 'push') history.pushState({ screen: name }, '');
    else if (mode === 'replace') history.replaceState({ screen: name }, '');
    window.scrollTo(0, 0);
  }

  window.addEventListener('popstate', e => {
    const target = (e.state && e.state.screen) || 'home';
    if (exam && screen === 'exam' && target !== 'edit') {
      if (!confirm('Ukončit rozpracovaný test?')) {
        history.pushState({ screen: 'exam' }, '');
        return;
      }
      finishExam(false);
    }
    if (target === 'exam' && exam) {
      show('exam');
      renderWord();
    } else if (target === 'home' || target === 'exam' || target === 'edit') {
      renderHome();
      show('home');
    } else {
      show(target);
    }
  });
  $('btn-back').addEventListener('click', () => history.back());

  // Otevřená klávesnice na telefonu zmenší viditelnou výšku -> třída body.kbd
  // (skryje horní pruh). Porovnává se s nejvyšší výškou při stejné šířce.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    let maxH = vv.height, lastW = vv.width;
    const onResize = () => {
      if (Math.abs(vv.width - lastW) > 1) { lastW = vv.width; maxH = vv.height; }
      maxH = Math.max(maxH, vv.height);
      document.body.classList.toggle('kbd', vv.height < maxH * 0.75);
      keepExamOnTop();
    };
    vv.addEventListener('resize', onResize);
  }

  // Prohlížeč po otevření klávesnice posouvá stránku k poli s odpovědí – při zkoušení
  // ji vrátit nahoru, aby bylo vidět slovo a počet zbývajících slov.
  function keepExamOnTop() {
    if (screen !== 'exam') return;
    for (const ms of [0, 150, 400]) setTimeout(() => { if (screen === 'exam') window.scrollTo(0, 0); }, ms);
  }

  /* ---------- Úvod: lekce ---------- */

  function renderHome() {
    const list = $('lesson-list');
    list.replaceChildren();
    const lessons = data.lessons.slice().sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    $('no-lessons').hidden = lessons.length > 0;
    for (const lesson of lessons) {
      const cb = el('input', { type: 'checkbox', checked: data.selected.includes(lesson.name) });
      cb.addEventListener('change', () => {
        data.selected = data.selected.filter(n => n !== lesson.name);
        if (cb.checked) data.selected.push(lesson.name);
        save();
      });
      const name = el('span', { className: 'name', textContent: lesson.name });
      if (lesson.modified) name.append(el('span', { className: 'badge', textContent: 'upraveno' }));
      name.append(el('span', { className: 'count', textContent: wordCount(lesson) + ' slov' }));
      const exp = el('button', { className: 'icon-btn', type: 'button', title: 'Uložit lekci jako CSV', textContent: '⤓' });
      exp.setAttribute('aria-label', 'Uložit lekci ' + lesson.name + ' jako CSV');
      exp.addEventListener('click', () => {
        download(lesson.name + '.csv', S.lessonToCSV(lesson), 'text/csv');
        lesson.modified = false;
        save();
        renderHome();
      });
      const del = el('button', { className: 'icon-btn', type: 'button', title: 'Odebrat lekci', textContent: '✕' });
      del.setAttribute('aria-label', 'Odebrat lekci ' + lesson.name);
      del.addEventListener('click', () => {
        if (!confirm('Odebrat lekci „' + lesson.name + '“ z tohoto zařízení?' +
          (lesson.modified ? '\nLekce má neuložené úpravy!' : ''))) return;
        data.lessons = data.lessons.filter(l => l !== lesson);
        data.selected = data.selected.filter(n => n !== lesson.name);
        save();
        renderHome();
      });
      list.append(el('li', {}, [
        el('label', { className: 'check' }, [cb, name]),
        exp, del,
      ]));
    }
    renderSettings();
  }

  // Přidá nebo nahradí lekci; vrací false, když uživatel nahrazení odmítl.
  function upsertLesson(lesson, source) {
    const old = findLesson(lesson.name);
    if (old && old.modified && !confirm('Lekce „' + lesson.name + '“ má v tomto zařízení neuložené úpravy. Přepsat ji?')) return false;
    lesson.modified = false;
    lesson.source = source;
    if (old) data.lessons[data.lessons.indexOf(old)] = lesson;
    else {
      data.lessons.push(lesson);
      if (!data.selected.includes(lesson.name)) data.selected.push(lesson.name);
    }
    return true;
  }

  $('file-input').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    let n = 0;
    const empty = [];
    for (const f of files) {
      try {
        const lesson = S.parseLesson(S.lessonNameFromFile(f.name), S.decodeText(await f.arrayBuffer()));
        if (!wordCount(lesson)) { empty.push(f.name); continue; }
        if (upsertLesson(lesson, 'file')) n++;
      } catch (err) {
        empty.push(f.name);
      }
    }
    save();
    renderHome();
    toast('Načteno lekcí: ' + n + (empty.length ? '. Bez slovíček: ' + empty.join(', ') : ''), 5000);
  });

  /* ---------- Lekce ze serveru (když je aplikace na webu) ---------- */

  const onWeb = /^https?:$/.test(location.protocol);

  async function fetchLessonList() {
    const r = await fetch('lekce/seznam.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function downloadFromServer(quiet) {
    try {
      const names = await fetchLessonList();
      let n = 0;
      for (const file of names) {
        const r = await fetch('lekce/' + encodeURIComponent(file), { cache: 'no-store' });
        if (!r.ok) continue;
        const lesson = S.parseLesson(S.lessonNameFromFile(file), S.decodeText(await r.arrayBuffer()));
        if (upsertLesson(lesson, 'server')) n++;
      }
      save();
      renderHome();
      toast('Staženo lekcí: ' + n);
    } catch (e) {
      if (!quiet) toast('Lekce se nepodařilo stáhnout (' + e.message + ').');
    }
  }

  if (onWeb) {
    fetchLessonList().then(names => {
      if (!Array.isArray(names) || !names.length) return;
      $('btn-server').hidden = false;
      if (!data.lessons.length) downloadFromServer(true);
    }).catch(() => { /* bez seznamu lekcí na serveru */ });
  }
  $('btn-server').addEventListener('click', () => downloadFromServer(false));

  /* ---------- Nastavení ---------- */

  function renderSettings() {
    const s = data.settings;
    $('set-name').value = s.name;
    $('set-repeat').textContent = s.repeat;
    $('set-czen').checked = s.czEn;
    $('set-encz').checked = s.enCz;
    $('set-notes').checked = s.notes;
    $('set-help').checked = s.help;
    $('set-helplevel').value = String(s.helpLevel);
  }

  function bindSetting(id, key, prop) {
    $(id).addEventListener('change', () => {
      data.settings[key] = prop === 'checked' ? $(id).checked : $(id).value;
      if (key === 'helpLevel') data.settings.helpLevel = S.clamp(data.settings.helpLevel, 0, 3, 0);
      save();
    });
  }
  bindSetting('set-name', 'name', 'value');
  bindSetting('set-czen', 'czEn', 'checked');
  bindSetting('set-encz', 'enCz', 'checked');
  bindSetting('set-notes', 'notes', 'checked');
  bindSetting('set-help', 'help', 'checked');
  bindSetting('set-helplevel', 'helpLevel', 'value');
  for (const b of document.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      data.settings.repeat = S.clamp(data.settings.repeat + Number(b.dataset.step), 0, 10, data.settings.repeat);
      $('set-repeat').textContent = data.settings.repeat;
      save();
    });
  }

  /* ---------- Zkoušení ---------- */

  let exam = null;
  let examLog = null;
  let examSettings = null;
  let mask = '';
  let waitingForContinue = false;
  let okTimer = null;

  function logLine(text) {
    examLog.lines.push(hms(new Date()) + ' - ' + text);
    save();
  }

  function startExam() {
    const s = data.settings;
    if (!s.czEn && !s.enCz) return toast('Nezvolili jste žádný směr zkoušení.');
    const lessons = data.lessons.filter(l => data.selected.includes(l.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    if (!lessons.length) return toast('Nezvolili jste žádnou lekci.');
    examSettings = Object.assign({}, s, { repeat: S.clamp(s.repeat, 0, 10, 1), helpLevel: S.clamp(s.helpLevel, 0, 3, 0) });
    const words = S.buildWords(lessons, examSettings);
    if (!words.length) return toast('Vybrané lekce neobsahují žádná slovíčka.');

    exam = new S.Exam(words, examSettings.repeat);
    const now = new Date();
    examLog = { id: 'testVocab_' + stamp(now) + '.log', start: now.toISOString(), name: s.name.trim(), status: 'running', errors: 0, lines: [] };
    data.logs.unshift(examLog);
    data.logs.length = Math.min(data.logs.length, MAX_LOGS);
    logLine('Start lekce: ' + lessons.map(l => l.name + '(' + wordCount(l) + ' slov), ').join('') + (examLog.name ? ' [' + examLog.name + ']' : ''));

    show('exam', 'push');
    nextWord();
  }

  function nextWord() {
    waitingForContinue = false;
    if (exam.finished) return finishExam(true);
    exam.next();
    renderWord();
  }

  function renderWord() {
    const w = exam.current;
    if (!w) return;
    const input = $('ex-answer');
    $('ex-direction').textContent = w.direct ? 'Přeložte do angličtiny:' : 'Přeložte do češtiny:';
    $('ex-word').textContent = w.word;
    $('ex-note').textContent = examSettings.notes ? w.note : '';
    $('ex-type').textContent = 'slovní druh: ' + (w.type || 'neurčeno');
    const h = S.helpMask(w.answer, examSettings.helpLevel);
    mask = h.mask;
    input.maxLength = w.answer.length;
    input.value = h.prefix;
    input.disabled = false;
    $('btn-ok').disabled = false;
    $('ex-help').hidden = !examSettings.help;
    updateHelp();
    $('ex-feedback').hidden = true;
    $('btn-edit').hidden = false;
    updateStats(w);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function updateHelp() {
    $('ex-help').textContent = S.helpDisplay(mask, $('ex-answer').value);
  }

  function updateStats(w) {
    $('ex-remaining').textContent = exam.remaining;
    $('ex-repeat').textContent = w ? w.repeat : '–';
    $('ex-errors').textContent = exam.errors;
  }

  $('ex-answer').addEventListener('input', updateHelp);
  $('ex-answer').addEventListener('focus', keepExamOnTop);

  $('answer-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!exam || waitingForContinue || !exam.current) return;
    const res = exam.submit($('ex-answer').value);
    logLine(S.answerLogText(res, exam.remaining));
    if (res.correct) {
      $('ex-ok').hidden = false;
      clearTimeout(okTimer);
      okTimer = setTimeout(() => { $('ex-ok').hidden = true; }, 900);
      nextWord();
    } else {
      waitingForContinue = true;
      $('ex-ok').hidden = true;
      $('ex-correct').textContent = res.answers.join(' / ');
      $('ex-correct-extra').textContent = [res.word.accent, res.word.answerNote].filter(Boolean).join(' · ');
      $('ex-answer').disabled = true;
      $('btn-ok').disabled = true;
      $('ex-help').hidden = true;
      $('btn-edit').hidden = true;
      $('ex-feedback').hidden = false;
      updateStats(null);
      $('btn-continue').focus();
    }
  });

  $('btn-continue').addEventListener('click', () => { if (exam) nextWord(); });

  function finishExam(completed) {
    if (!exam) return;
    const errors = exam.errors;
    logLine((completed ? 'Řádné' : 'Předčasné') + ' ukončení testu, ' + errors + ' chyb.');
    examLog.status = completed ? 'done' : 'stopped';
    examLog.errors = errors;
    save();
    exam = null;
    if (completed) {
      $('res-text').textContent = 'Při zkoušení jste udělali ' + errors + ' chyb.';
      show('result', 'replace');
    }
  }

  $('btn-start').addEventListener('click', startExam);
  $('btn-stop').addEventListener('click', () => {
    if (!confirm('Opravdu ukončit test?')) return;
    finishExam(false);
    history.back();
  });
  $('btn-home').addEventListener('click', () => history.back());

  window.addEventListener('pagehide', () => {
    if (exam) {
      examLog.lines.push(hms(new Date()) + ' - Test nebyl dokončen (aplikace byla zavřena).');
      examLog.status = 'stopped';
      examLog.errors = exam.errors;
      save();
    }
  });
  // návrat na stránku z mezipaměti prohlížeče – test pokračuje
  window.addEventListener('pageshow', e => {
    if (e.persisted && exam && examLog.status === 'stopped') {
      examLog.status = 'running';
      logLine('Pokračování testu.');
    }
  });

  /* ---------- Úprava slova ---------- */

  let editing = null;

  $('btn-edit').addEventListener('click', () => {
    const w = exam && exam.current;
    if (!w) return;
    const lesson = findLesson(w.lesson);
    if (!lesson) return toast('Lekce už v zařízení není.');
    editing = { lesson, row: w.row };
    const form = $('edit-form');
    lesson.rows[w.row].forEach((v, c) => { form.elements['c' + c].value = v; });
    $('edit-where').textContent = 'Lekce ' + lesson.name + ', řádek ' + (w.row + 2);
    show('edit', 'push');
    form.elements.c0.focus();
  });

  $('edit-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!editing) return history.back();
    const form = $('edit-form');
    const r = [];
    for (let c = 0; c < S.NCOLS; c++) r.push(form.elements['c' + c].value.trim());
    if (!r[S.COL.CZ] || !r[S.COL.EN]) return toast('České i anglické slovíčko musí být vyplněné.');
    editing.lesson.rows[editing.row] = r;
    editing.lesson.modified = true;
    if (exam) exam.updateRow(editing.lesson.name, editing.row, r);
    save();
    editing = null;
    toast('Uloženo. Nezapomeňte lekci uložit do CSV (tlačítko ⤓).', 4000);
    history.back();
  });
  $('btn-edit-cancel').addEventListener('click', () => { editing = null; history.back(); });

  /* ---------- Log ---------- */

  function logStatus(log) {
    if (log.status === 'done') return { text: 'Dokončeno, chyb: ' + log.errors, cls: 'ok' };
    if (log.status === 'running') return { text: 'Probíhá', cls: '' };
    return { text: 'Nedokončeno, chyb: ' + (log.errors || 0), cls: 'bad' };
  }

  function logLessons(log) {
    const first = (log.lines[0] || '').replace(/^\S+ - Start lekce: /, '');
    return first.replace(/, $/, '');
  }

  function renderLog() {
    const list = $('log-list');
    list.replaceChildren();
    $('no-logs').hidden = data.logs.length > 0;
    for (const log of data.logs) {
      const st = logStatus(log);
      const li = el('li', { tabIndex: 0 }, [
        el('b', { textContent: czDate(new Date(log.start)) + (log.name ? ' · ' + log.name : '') }),
        el('span', { className: 'small muted', textContent: logLessons(log) }),
        el('span', { className: 'small ' + st.cls, textContent: st.text }),
      ]);
      const open = () => {
        $('logdetail-title').textContent = czDate(new Date(log.start)) + (log.name ? ' · ' + log.name : '');
        $('logdetail-text').textContent = log.lines.join('\n');
        show('logdetail', 'push');
      };
      li.addEventListener('click', open);
      li.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      list.append(li);
    }
  }

  $('btn-log').addEventListener('click', () => { renderLog(); show('log', 'push'); });
  $('btn-log-export').addEventListener('click', () => {
    if (!data.logs.length) return toast('Log je prázdný.');
    const text = data.logs.map(l => '=== ' + l.id + (l.name ? ' · ' + l.name : '') + ' ===\r\n' + l.lines.join('\r\n')).join('\r\n\r\n') + '\r\n';
    download('log_testu_' + stamp(new Date()) + '.txt', text, 'text/plain');
  });
  $('btn-log-clear').addEventListener('click', () => {
    if (!confirm('Smazat celý log testů v tomto zařízení?')) return;
    data.logs = [];
    save();
    renderLog();
  });

  $('btn-about').addEventListener('click', () => show('about', 'push'));

  /* ---------- Start ---------- */

  $('load-error').remove();

  save();
  renderHome();
  show('home', 'replace');

  if ('serviceWorker' in navigator && onWeb) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline režim nebude k dispozici */ });
  }
})();
