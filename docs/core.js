/**
 * Core.gs — «мозг» записи: чистая логика без обращений к Google.
 * Дни — строки 'YYYY-MM-DD', время — минуты от полуночи (10:00 = 600).
 * Этот же файл копируется на сайт (site/core.js) для демо-режима,
 * поэтому демо и настоящий сервер считают свободные окна одинаково.
 */
var CORE = (function () {
  var DEFAULTS = {
    accepting: true,
    stepMin: 30,          // шаг сетки окон: 10:00, 10:30, 11:00 ...
    leadHours: 2,         // не записываем «на через 5 минут»
    horizonDays: 30,      // на сколько дней вперёд открыта запись
    dailyCap: 40,         // защита от флуда: записей с сайта в сутки
    ownerEmail: '',
    siteUrl: '',          // адрес сайта, нужен для ссылки «отменить запись» в письме
    retentionMonths: 12,
    title: 'Запис на манікюр',
    subtitle: ''
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function hm(str, fallback) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str === undefined || str === null ? '' : str).trim());
    if (!m) return fallback;
    var v = Number(m[1]) * 60 + Number(m[2]);
    return v >= 0 && v <= 1440 ? v : fallback;
  }
  function num(v, fallback, min, max) {
    var n = Number(String(v).replace(',', '.'));
    if (!isFinite(n) || String(v).trim() === '') return fallback;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return Math.floor(n);
  }
  function yes(v, fallback) {
    var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
    if (s === '') return fallback;
    return ['так', 'да', 'yes', 'true', '1', 'вкл', 'увімк'].indexOf(s) >= 0;
  }
  function cleanText(s, max) {
    return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /* ---------- Настройки (из листов Google Таблицы) ---------- */

  /** map — пары «название настройки» → значение с листа «Налаштування». */
  function parseSettings(map) {
    map = map || {};
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    c.accepting = yes(map['Прийом записів'], DEFAULTS.accepting);
    c.title = cleanText(map['Назва'], 80) || DEFAULTS.title;
    c.subtitle = cleanText(map['Підзаголовок'], 160);
    c.stepMin = num(map['Крок записів, хв'], DEFAULTS.stepMin, 10, 120);
    c.leadHours = num(map['Не раніше ніж через, год'], DEFAULTS.leadHours, 0, 72);
    c.horizonDays = num(map['Днів уперед'], DEFAULTS.horizonDays, 1, 120);
    c.dailyCap = num(map['Ліміт записів на добу'], DEFAULTS.dailyCap, 1, 500);
    c.ownerEmail = String(map['Пошта власника'] || '').trim();
    c.siteUrl = String(map['Адреса сайту'] || '').trim();
    c.retentionMonths = num(map['Зберігати дані, міс.'], DEFAULTS.retentionMonths, 1, 60);
    return c;
  }

  function parseWorkdays(str, fallback) {
    var wd = String(str === undefined || str === null ? '' : str).split(/[\s,;]+/).map(Number).filter(function (n) { return n >= 1 && n <= 7; });
    return wd.length ? wd : fallback;
  }

  /** rows — строки листа «Майстри»: [id, ім'я, дні, початок, кінець, обід з, обід до, id календаря, пошта]. */
  function parseMasters(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var id = cleanText(r[0], 20), name = cleanText(r[1], 40);
      if (!/^[A-Za-z0-9_]{1,20}$/.test(id) || !name) return;
      var m = {
        id: id, name: name,
        workdays: parseWorkdays(r[2], [1, 2, 3, 4, 5]),
        start: hm(r[3], 600), end: hm(r[4], 1140),
        lunchStart: hm(r[5], 0), lunchEnd: hm(r[6], 0),
        calendarId: String(r[7] || '').trim(),
        email: String(r[8] || '').trim()
      };
      if (m.end <= m.start) { m.start = 600; m.end = 1140; }
      out.push(m);
    });
    return out;
  }

  /** rows — строки листа «Послуги»: [id, назва, тривалість хв, ціна, активна]. */
  function parseServices(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var id = cleanText(r[0], 20), name = cleanText(r[1], 80);
      if (!/^[A-Za-z0-9_]{1,20}$/.test(id) || !name) return;
      if (!yes(r[4], true)) return;
      out.push({ id: id, name: name, durationMin: num(r[2], 60, 10, 480), price: num(r[3], 0, 0, 1000000) });
    });
    return out;
  }

  /**
   * Несколько услуг за один визит: 's1,s3' → одна «составная» услуга (названия через «+», время и цена складываются).
   * Возвращает {ids, name, durationMin, price} или null, если что-то не так (неизвестная услуга, больше 4).
   */
  function combineServices(list, idsStr) {
    var want = String(idsStr === undefined || idsStr === null ? '' : idsStr).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var uniq = want.filter(function (id, i) { return want.indexOf(id) === i; });
    if (!uniq.length || uniq.length > 4) return null;
    var picked = [];
    for (var i = 0; i < uniq.length; i++) {
      var s = list.filter(function (x) { return x.id === uniq[i]; })[0];
      if (!s) return null;
      picked.push(s);
    }
    return {
      ids: picked.map(function (s) { return s.id; }).join(','),
      name: picked.map(function (s) { return s.name; }).join(' + '),
      durationMin: picked.reduce(function (a, s) { return a + s.durationMin; }, 0),
      price: picked.reduce(function (a, s) { return a + s.price; }, 0)
    };
  }

  /** Что можно показывать на сайте (без календарей и почты мастеров). */
  function publicMasters(masters) {
    return masters.map(function (m) { return { id: m.id, name: m.name }; });
  }

  /* ---------- Даты ---------- */

  function isoWeekday(day) {
    var g = new Date(day + 'T00:00:00Z').getUTCDay();
    return g === 0 ? 7 : g;
  }
  function addDays(day, n) {
    var d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function validDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return false;
    var d = new Date(day + 'T00:00:00Z');
    return !isNaN(d.getTime()) && addDays(day, 0) === day;
  }
  /** Дни, на которые вообще открыта запись. now = {day:'YYYY-MM-DD', min:Number}. */
  function availableDays(cfg, now) {
    var out = [];
    for (var i = 0; i <= cfg.horizonDays; i++) out.push(addDays(now.day, i));
    return out;
  }

  /* ---------- Свободные окна ---------- */

  /** Свободные окна одного мастера на день. busy — [{s,e}] в минутах этого дня. Возвращает минуты начала. */
  function masterFree(m, cfg, duration, day, busy, now) {
    if (!validDay(day)) return [];
    if (day < now.day || day > addDays(now.day, cfg.horizonDays)) return [];
    if (m.workdays.indexOf(isoWeekday(day)) < 0) return [];
    busy = busy || [];
    var out = [];
    for (var s = m.start; s + duration <= m.end; s += cfg.stepMin) {
      var e = s + duration;
      if (m.lunchEnd > m.lunchStart && s < m.lunchEnd && e > m.lunchStart) continue;
      if (day === now.day && s < now.min + cfg.leadHours * 60) continue;
      if (busy.some(function (b) { return s < b.e && e > b.s; })) continue;
      out.push(s);
    }
    return out;
  }

  /**
   * Свободные окна на день: либо у выбранного мастера, либо «у любого» (объединение).
   * busyByMaster — { masterId: [{s,e}] }. Возвращает ['10:00', '10:30', ...].
   */
  function freeTimes(masters, cfg, duration, day, busyByMaster, now, masterId) {
    var set = {};
    masters.forEach(function (m) {
      if (masterId && masterId !== 'any' && m.id !== masterId) return;
      masterFree(m, cfg, duration, day, busyByMaster[m.id], now).forEach(function (s) { set[s] = true; });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; }).map(fmt);
  }

  /** Кто именно возьмёт запись: выбранный мастер или первый свободный из «любого». Возвращает id или ''. */
  function pickMaster(masters, cfg, duration, day, time, busyByMaster, now, masterId) {
    var t = hm(time, -1);
    for (var i = 0; i < masters.length; i++) {
      var m = masters[i];
      if (masterId && masterId !== 'any' && m.id !== masterId) continue;
      if (masterFree(m, cfg, duration, day, busyByMaster[m.id], now).indexOf(t) >= 0) return m.id;
    }
    return '';
  }

  /* ---------- Данные клиента ---------- */

  function normalizePhone(raw) {
    var s = String(raw || '').replace(/[\s\-().]/g, '');
    if (/^\+380\d{9}$/.test(s)) return s;
    if (/^380\d{9}$/.test(s)) return '+' + s;
    if (/^0\d{9}$/.test(s)) return '+38' + s;
    return '';
  }
  function formatPhone(p) {
    return p.replace(/^(\+380)(\d{2})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
  }
  /** Защита от формул в Google Таблице: текст, начинающийся с «=», превращаем в обычный текст. */
  function sanitizeCell(s) {
    s = String(s === undefined || s === null ? '' : s);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** Проверка формы клиента. Возвращает {ok, errors, clean}. */
  function validateClient(p) {
    var err = {}, clean = {};
    clean.name = cleanText(p.name, 60);
    if (clean.name.length < 2 || !/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(clean.name)) err.name = 'Вкажіть ім’я';
    clean.phone = normalizePhone(p.phone);
    if (!clean.phone) err.phone = 'Номер у форматі +380 XX XXX XX XX';
    clean.email = cleanText(p.email, 120).toLowerCase();
    if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email)) err.email = 'Перевірте пошту';
    clean.comment = cleanText(p.comment, 500);
    return { ok: Object.keys(err).length === 0, errors: err, clean: clean };
  }

  /**
   * Что делать с попыткой записи. activeCount — сколько у клиента уже будущих записей,
   * recentCount — попыток за сутки. 'ok' — записываем, 'limit' — просим позвонить, 'shadow' — тихо делаем вид.
   */
  function decideAttempt(activeCount, recentCount) {
    if (recentCount >= 6) return 'shadow';
    if (activeCount >= 3) return 'limit';
    return 'ok';
  }

  return {
    DEFAULTS: DEFAULTS, parseSettings: parseSettings, parseMasters: parseMasters, parseServices: parseServices,
    publicMasters: publicMasters, combineServices: combineServices, fmt: fmt, hm: hm, isoWeekday: isoWeekday, addDays: addDays, validDay: validDay,
    availableDays: availableDays, masterFree: masterFree, freeTimes: freeTimes, pickMaster: pickMaster,
    normalizePhone: normalizePhone, formatPhone: formatPhone, cleanText: cleanText, sanitizeCell: sanitizeCell,
    escapeHtml: escapeHtml, validateClient: validateClient, decideAttempt: decideAttempt
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CORE;   // для тестов в Node; в Google игнорируется
