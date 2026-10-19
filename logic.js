/* Logika zkoušení bez vazby na stránku – používá app.js a testy v Node. */
(function (root) {
  'use strict';

  // Sloupce lekce (stejné jako na původních listech sešitu)
  const COL = { CZ: 0, CZ_NOTE: 1, EN: 2, TYPE: 3, ACCENT: 4, EN_NOTE: 5 };
  const NCOLS = 6;
  const HEADER = ['české slovíčko', 'poznámka (česká)', 'anglické slovíčko', 'druh slova', 'výslovnost', 'poznámka (anglická)'];
  const HELP_KEEP = '.,:=-_ ';

  /* ---------- CSV ---------- */

  // Bajty souboru -> text. UTF-8, jinak Windows-1250 (export z Excelu v češtině).
  function decodeText(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      text = new TextDecoder('windows-1250').decode(u8);
    }
    return text.replace(/^﻿/, '');
  }

  // Oddělovač podle prvního řádku (mimo uvozovky): ; , nebo tabulátor
  function detectSeparator(text) {
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let inQ = false;
    for (const ch of text) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && (ch === '\n' || ch === '\r')) break;
      else if (!inQ && ch in counts) counts[ch]++;
    }
    let best = ';';
    for (const k of [',', '\t']) if (counts[k] > counts[best]) best = k;
    return best;
  }

  function parseCSV(text, sep) {
    sep = sep || detectSeparator(text);
    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
      i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // První řádek je vždy záhlaví. Prázdné řádky se vynechají.
  function parseLesson(name, text) {
    const records = parseCSV(text);
    const rows = [];
    for (const rec of records.slice(1)) {
      const r = [];
      for (let c = 0; c < NCOLS; c++) r.push((rec[c] || '').trim());
      if (r.some(v => v !== '')) rows.push(r);
    }
    return { name, rows };
  }

  function csvField(v, sep) {
    v = v == null ? '' : String(v);
    return /["\n\r]/.test(v) || v.includes(sep) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // Lekce -> CSV (oddělovač ;, CRLF; BOM přidává až uložení souboru)
  function lessonToCSV(lesson, sep) {
    sep = sep || ';';
    return [HEADER].concat(lesson.rows)
      .map(r => r.map(v => csvField(v, sep)).join(sep)).join('\r\n') + '\r\n';
  }

  function lessonNameFromFile(fileName) {
    return fileName.replace(/^.*[\\/]/, '').replace(/\.(csv|txt)$/i, '');
  }

  /* ---------- Nápověda ---------- */

  // Prvních `level` písmen (vždy zbydou alespoň 2 k doplnění), zbytek tečky;
  // interpunkce a mezery zůstávají vidět.
  function helpMask(answer, level) {
    const chars = Array.from(answer);
    let mask = '';
    let prefix = '';
    chars.forEach((ch, idx) => {
      if (idx + 1 <= level && Array.from(mask).length < chars.length - 2) {
        mask += ch;
        prefix = mask;
      } else if (HELP_KEEP.includes(ch)) mask += ch;
      else mask += '.';
    });
    return { mask, prefix };
  }

  function helpDisplay(mask, typed) {
    const m = Array.from(mask), t = Array.from(typed);
    return t.length >= m.length ? typed : typed + m.slice(t.length).join('');
  }

  function normalizeAnswer(s) {
    return String(s).trim().replace(/\s+/g, ' ');
  }

  /* ---------- Zkoušení ---------- */

  // Slova k zkoušení z vybraných lekcí; slovo musí mít vyplněnou češtinu i angličtinu.
  function buildWords(lessons, settings) {
    const words = [];
    for (const lesson of lessons) {
      lesson.rows.forEach((r, row) => {
        if (!r[COL.CZ] || !r[COL.EN]) return;
        const base = { lesson: lesson.name, row, type: r[COL.TYPE], accent: r[COL.ACCENT], repeat: settings.repeat };
        if (settings.czEn) words.push(Object.assign({}, base, { direct: true, word: r[COL.CZ], note: r[COL.CZ_NOTE], answer: r[COL.EN], answerNote: r[COL.EN_NOTE] }));
        if (settings.enCz) words.push(Object.assign({}, base, { direct: false, word: r[COL.EN], note: r[COL.EN_NOTE], answer: r[COL.CZ], answerNote: r[COL.CZ_NOTE] }));
      });
    }
    return words;
  }

  // Správně -> opakování −1, chyba -> +1 (nejvýš nastavený počet).
  // Slovo s nulou opakování se vyřadí, jinak se zařadí na konec seznamu.
  // Uzná se každý překlad, který má stejné zkoušené slovo ve vybraných lekcích
  // (např. upřímný = honest i sincere).
  class Exam {
    constructor(words, maxRepeat, rng) {
      this.words = words;
      this.allWords = words.slice();
      this.maxRepeat = maxRepeat;
      this.rng = rng || Math.random;
      this.errors = 0;
      this.answered = 0;
      this.index = -1;
    }

    // Všechny správné překlady zkoušeného slova w (w.answer první)
    answersFor(w) {
      const key = normalizeAnswer(w.word);
      const out = [w.answer];
      for (const o of this.allWords) {
        if (o.direct === w.direct && normalizeAnswer(o.word) === key && !out.includes(o.answer)) out.push(o.answer);
      }
      return out;
    }
    get remaining() { return this.words.length; }
    get finished() { return this.words.length === 0; }
    get current() { return this.index >= 0 ? this.words[this.index] : null; }

    next() {
      if (this.finished) { this.index = -1; return null; }
      this.index = Math.min(Math.floor(this.rng() * this.words.length), this.words.length - 1);
      return this.current;
    }

    submit(input) {
      const w = this.current;
      const given = normalizeAnswer(input);
      const answers = this.answersFor(w);
      const correct = answers.some(a => normalizeAnswer(a) === given);
      if (correct) w.repeat -= 1;
      else {
        if (w.repeat < this.maxRepeat) w.repeat += 1;
        this.errors += 1;
      }
      this.answered += 1;
      this.words.splice(this.index, 1);
      if (w.repeat > 0) this.words.push(w);
      this.index = -1;
      return { correct, given, word: w, answers };
    }

    // Po úpravě slova přepsat obě směrové varianty téhož řádku
    updateRow(lessonName, row, r) {
      for (const w of this.allWords) {
        if (w.lesson !== lessonName || w.row !== row) continue;
        w.type = r[COL.TYPE]; w.accent = r[COL.ACCENT];
        if (w.direct) Object.assign(w, { word: r[COL.CZ], note: r[COL.CZ_NOTE], answer: r[COL.EN], answerNote: r[COL.EN_NOTE] });
        else Object.assign(w, { word: r[COL.EN], note: r[COL.EN_NOTE], answer: r[COL.CZ], answerNote: r[COL.CZ_NOTE] });
      }
    }
  }

  // Řádek logu ve stejném tvaru jako v LibreOffice verzi
  function answerLogText(res, remaining) {
    return (res.correct ? 'OK: ' : 'Chyba: ') + '"' + res.given + '" - "' + res.word.word + '" / "' +
      res.word.answer + '" zbývá: ' + remaining + ' slov';
  }

  function clamp(n, min, max, def) {
    n = Number(n);
    return Number.isInteger(n) && n >= min && n <= max ? n : def;
  }

  const api = {
    COL, NCOLS, HEADER, decodeText, detectSeparator, parseCSV, parseLesson, lessonToCSV,
    lessonNameFromFile, helpMask, helpDisplay, normalizeAnswer, buildWords, Exam, answerLogText, clamp,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Slovicka = api;
})(this);
