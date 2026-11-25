/**
 * Демо-«сервер» прямо в браузере: тот же мозг (core.js), но вместо Google Календаря
 * записи лежат в localStorage этого браузера. Нужен, чтобы портфолио работало без Google.
 */
window.DEMO_API = (function () {
  var cfg = CORE.parseSettings({ 'Назва': 'Запис на манікюр', 'Підзаголовок': 'Оберіть послугу, майстра та зручний час' });
  var masters = CORE.parseMasters([
    ['m1', 'Марія', '1,2,3,4,5', '10:00', '19:00', '14:00', '15:00', '', ''],
    ['m2', 'Олена', '2,3,4,5,6', '11:00', '20:00', '', '', '', '']
  ]);
  var services = CORE.parseServices([
    ['s1', 'Манікюр класичний', 60, 450, 'так'],
    ['s2', 'Манікюр + гель-лак', 120, 700, 'так'],
    ['s3', 'Нарощування', 150, 1100, 'так'],
    ['s4', 'Педикюр', 90, 700, 'так'],
    ['s5', 'Зняття покриття', 30, 150, 'так']
  ]);
  var KEY = 'nails_demo_bookings';

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* нет места/запрещено */ } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowLocal() {
    var d = new Date();
    return { day: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), min: d.getHours() * 60 + d.getMinutes() };
  }
  function hash(str) { var h = 7; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }

  /** «Чужие» записи, чтобы календарь выглядел живым: 1–3 занятых блока на мастера в день. */
  function fakeBusy(masterId, day) {
    var h = hash(masterId + day), out = [], n = 1 + (h % 3);
    for (var k = 0; k < n; k++) {
      var s = 600 + ((h >> (k * 4 + 3)) % 16) * 30, len = (k % 2 ? 90 : 60);
      out.push({ s: s, e: s + len });
    }
    return out;
  }
  function busyOnDay(day) {
    var o = {};
    masters.forEach(function (m) { o[m.id] = fakeBusy(m.id, day); });
    load().forEach(function (b) {
      if (b.status === 'Записано' && b.day === day) o[b.master].push({ s: CORE.hm(b.time, 0), e: CORE.hm(b.time, 0) + b.durationMin });
    });
    return o;
  }
  function later(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 250); }); }
  function service(ids) { return CORE.combineServices(services, ids); }   // 's1,s3' → одна составная услуга
  function masterName(id) { return masters.filter(function (m) { return m.id === id; })[0].name; }

  return {
    config: function () {
      return later({ ok: true, accepting: true, title: cfg.title, subtitle: cfg.subtitle, services: services, masters: CORE.publicMasters(masters) });
    },
    slots: function (serviceId, masterId) {
      var sv = service(serviceId), now = nowLocal(), out = {};
      if (!sv) return later({ ok: false, error: 'VALIDATION' });
      CORE.availableDays(cfg, now).forEach(function (d) {
        out[d] = CORE.freeTimes(masters, cfg, sv.durationMin, d, busyOnDay(d), now, masterId);
      });
      return later({ ok: true, accepting: true, days: out });
    },
    book: function (p) {
      var v = CORE.validateClient(p);
      if (!v.ok) return later({ ok: false, error: 'VALIDATION', fields: v.errors });
      var sv = service(p.service), now = nowLocal();
      if (!sv || !CORE.validDay(p.day)) return later({ ok: false, error: 'TAKEN' });
      var id = CORE.pickMaster(masters, cfg, sv.durationMin, p.day, p.time, busyOnDay(p.day), now, p.master || 'any');
      if (!id) return later({ ok: false, error: 'TAKEN' });
      var token = 'demo-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
      var list = load();
      list.push({ token: token, master: id, day: p.day, time: p.time, durationMin: sv.durationMin, service: sv.name, status: 'Записано' });
      save(list);
      return later({ ok: true, booking: { token: token, day: p.day, time: p.time, service: sv.name, master: masterName(id) } });
    },
    booking: function (token) {
      var b = load().filter(function (x) { return x.token === token; })[0];
      if (!b) return later({ ok: false, error: 'NOT_FOUND' });
      return later({ ok: true, status: b.status, day: b.day, time: b.time, service: b.service, master: masterName(b.master) });
    },
    cancel: function (token) {
      var list = load(), b = list.filter(function (x) { return x.token === token && x.status === 'Записано'; })[0];
      if (!b) return later({ ok: false, error: 'NOT_FOUND' });
      b.status = 'Скасовано'; save(list);
      return later({ ok: true });
    }
  };
})();
