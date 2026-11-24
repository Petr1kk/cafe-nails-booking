(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var DEMO = !CFG.API_URL;
  var $ = function (s) { return document.querySelector(s); };
  var esc = CORE.escapeHtml;   // любой текст с сервера вставляем на страницу только через экранирование

  var WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MON = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  var ERR = {
    TAKEN: 'Цей час щойно зайняли. Оберіть, будь ласка, інший.',
    BUSY: 'Забагато запитів. Спробуйте за хвилину.',
    LIMIT: 'У вас уже кілька записів. Щоб записатися ще, зателефонуйте нам.',
    CAP: 'На сьогодні онлайн-запис закрито. Спробуйте завтра або зателефонуйте.',
    CLOSED: 'Онлайн-запис тимчасово закрито.',
    SERVER: 'Щось пішло не так. Спробуйте ще раз.',
    NET: 'Немає зв’язку з сервером. Перевірте інтернет і спробуйте ще раз.',
    TIMEOUT: 'Сервер відповідає надто довго. Спробуйте ще раз.'
  };

  var state = { cfg: null, service: null, master: 'any', days: {}, day: null, time: null, openedAt: 0 };

  /* ---------- Связь с сервером ---------- */
  var api = DEMO ? window.DEMO_API : realApi();

  function realApi() {
    function req(url, init) {
      var ctl = window.AbortController ? new AbortController() : null, timer = null;
      init = init || {};
      if (ctl) { init.signal = ctl.signal; timer = setTimeout(function () { ctl.abort(); }, 35000); }
      return fetch(url, init).then(function (r) { return r.json(); })
        .catch(function (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'TIMEOUT' : 'NET' }; })
        .then(function (res) { if (timer) clearTimeout(timer); return res; });
    }
    function post(action, data) {
      // text/plain, чтобы браузер не делал предварительный запрос (Apps Script его не поддерживает)
      return req(CFG.API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action: action }, data)) });
    }
    return {
      config: function () { return req(CFG.API_URL + '?action=config'); },
      slots: function (service, master) { return req(CFG.API_URL + '?action=slots&service=' + encodeURIComponent(service) + '&master=' + encodeURIComponent(master)); },
      book: function (p) { return post('book', p); },
      booking: function (token) { return req(CFG.API_URL + '?action=booking&token=' + encodeURIComponent(token)); },
      cancel: function (token) { return post('cancel', { token: token }); }
    };
  }

  /* ---------- Показ экранов ---------- */
  var SCREENS = ['step1', 'step2', 'step3', 'done', 'cancelBox'];
  function show(id) {
    SCREENS.forEach(function (s) { $('#' + s).hidden = s !== id; });
    $('#loading').hidden = true;
    var n = { step1: 1, step2: 2, step3: 3 }[id];
    $('#steps').hidden = !n;
    document.querySelectorAll('#steps li').forEach(function (li) { li.classList.toggle('on', Number(li.dataset.s) <= (n || 0)); });
    window.scrollTo(0, 0);
  }
  function loading(on) { $('#loading').hidden = !on; if (on) SCREENS.forEach(function (s) { $('#' + s).hidden = true; }); }
  function fail(code) {
    $('#error').hidden = false;
    $('#error').innerHTML = esc(ERR[code] || ERR.SERVER) + ' <button class="back" id="retry">Спробувати ще</button>';
    $('#retry').onclick = function () { location.reload(); };
  }
  function prettyDay(d) {
    var p = d.split('-'), dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return { wd: WD[dt.getDay()], n: dt.getDate(), mon: MON[dt.getMonth()] };
  }
  function longDay(d) { var x = prettyDay(d); return x.wd + ', ' + x.n + ' ' + x.mon; }
  function masterLabel(id) {
    if (id === 'any') return 'будь-який майстер';
    var m = state.cfg.masters.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : '';
  }

  /* ---------- Крок 1: услуга и мастер ---------- */
  function renderStep1() {
    var c = state.cfg;
    $('#title').textContent = c.title; $('#subtitle').textContent = c.subtitle || '';
    document.title = c.title;
    $('#services').innerHTML = c.services.map(function (s) {
      return '<button class="opt" data-id="' + esc(s.id) + '"><span>' + esc(s.name) + '<small>' + s.durationMin + ' хв</small></span><span class="price">' + s.price + ' ₴</span></button>';
    }).join('');
    var ms = [{ id: 'any', name: 'Будь-який' }].concat(c.masters);
    $('#masters').innerHTML = ms.map(function (m) {
      return '<button class="chip' + (m.id === state.master ? ' sel' : '') + '" data-id="' + esc(m.id) + '">' + esc(m.name) + '</button>';
    }).join('');
    $('#services').onclick = function (e) {
      var b = e.target.closest('.opt'); if (!b) return;
      state.service = c.services.filter(function (s) { return s.id === b.dataset.id; })[0];
      document.querySelectorAll('#services .opt').forEach(function (x) { x.classList.toggle('sel', x === b); });
      $('#to2').disabled = false;
    };
    $('#masters').onclick = function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      state.master = b.dataset.id;
      document.querySelectorAll('#masters .chip').forEach(function (x) { x.classList.toggle('sel', x === b); });
    };
    show('step1');
  }

  /* ---------- Крок 2: день и время ---------- */
  function goStep2() {
    state.day = null; state.time = null; $('#to3').disabled = true;
    loading(true);
    api.slots(state.service.id, state.master).then(function (r) {
      if (!r.ok) { loading(false); return fail(r.error); }
      if (!r.accepting) { loading(false); return fail('CLOSED'); }
      state.days = r.days;
      renderStep2();
    });
  }
  function renderStep2() {
    $('#summary2').innerHTML = esc(state.service.name) + ' · ' + state.service.durationMin + ' хв · ' + state.service.price + ' ₴ · ' + esc(masterLabel(state.master));
    var free = Object.keys(state.days).sort().filter(function (d) { return state.days[d].length; });
    $('#nodays').hidden = free.length > 0;
    $('#days').innerHTML = free.map(function (d) {
      var x = prettyDay(d);
      return '<button class="chip day" data-d="' + d + '"><small>' + x.wd + '</small><b>' + x.n + '</b><small>' + x.mon + '</small></button>';
    }).join('');
    $('#times').innerHTML = '';
    $('#days').onclick = function (e) {
      var b = e.target.closest('.day'); if (!b) return;
      state.day = b.dataset.d; state.time = null; $('#to3').disabled = true;
      document.querySelectorAll('#days .day').forEach(function (x) { x.classList.toggle('sel', x === b); });
      $('#times').innerHTML = state.days[state.day].map(function (t) { return '<button class="time" data-t="' + t + '">' + t + '</button>'; }).join('');
    };
    $('#times').onclick = function (e) {
      var b = e.target.closest('.time'); if (!b) return;
      state.time = b.dataset.t;
      document.querySelectorAll('#times .time').forEach(function (x) { x.classList.toggle('sel', x === b); });
      $('#to3').disabled = false;
    };
    show('step2');
  }

  /* ---------- Крок 3: данные клиента ---------- */
  function renderStep3() {
    $('#summary3').innerHTML = esc(state.service.name) + '<br>' + esc(longDay(state.day)) + ', ' + state.time + ' · ' + esc(masterLabel(state.master));
    state.openedAt = Date.now();
    clearErrors();
    show('step3');
  }
  function clearErrors() {
    ['name', 'phone', 'email'].forEach(function (k) { $('#e-' + k).textContent = ''; $('#f-' + k).classList.remove('bad'); });
  }
  function showErrors(fields) {
    clearErrors();
    for (var k in fields) { if ($('#e-' + k)) { $('#e-' + k).textContent = fields[k]; $('#f-' + k).classList.add('bad'); } }
  }

  $('#form').addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {
      service: state.service.id, master: state.master, day: state.day, time: state.time,
      name: $('#f-name').value, phone: $('#f-phone').value, email: $('#f-email').value, comment: $('#f-comment').value,
      website: $('#f-website').value, elapsedMs: Date.now() - state.openedAt
    };
    // Проверка в браузере — для удобства гостя. Настоящая проверка всё равно будет на сервере.
    var v = CORE.validateClient(data);
    if (!v.ok) return showErrors(v.errors);
    clearErrors();
    var btn = $('#submit'); btn.disabled = true; btn.textContent = 'Записуємо…';
    api.book(data).then(function (r) {
      btn.disabled = false; btn.textContent = 'Записатися';
      if (r.ok) return renderDone(r.booking);
      if (r.error === 'VALIDATION') return showErrors(r.fields || {});
      if (r.error === 'TAKEN') { alert(ERR.TAKEN); return goStep2(); }
      alert(ERR[r.error] || ERR.SERVER);
    });
  });

  /* ---------- Готово ---------- */
  function renderDone(b) {
    $('#doneInfo').innerHTML = esc(b.service) + '<br><b>' + esc(longDay(b.day)) + ', ' + esc(b.time) + '</b><br>Майстер: ' + esc(b.master);
    var link = location.origin + location.pathname + '?cancel=' + encodeURIComponent(b.token);
    $('#cancelLink').value = link;
    show('done');
  }
  $('#copy').onclick = function () {
    var el = $('#cancelLink'); el.select();
    try { (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject()).catch(function () { document.execCommand('copy'); }); } catch (e) { document.execCommand('copy'); }
    $('#copy').textContent = 'Скопійовано ✓';
  };
  $('#again').onclick = function () { location.href = location.pathname; };

  /* ---------- Отмена по ссылке ---------- */
  function startCancel(token) {
    api.booking(token).then(function (r) {
      if (!r.ok || r.status !== 'Записано') {
        $('#cancelInfo').textContent = 'Запис не знайдено або вже скасовано.';
        $('#cancelBtn').hidden = true;
      } else if (r.past) {
        $('#cancelInfo').textContent = 'Цей запис уже минув.'; $('#cancelBtn').hidden = true;
      } else {
        $('#cancelInfo').innerHTML = esc(r.service) + '<br><b>' + esc(longDay(r.day)) + ', ' + esc(r.time) + '</b><br>Майстер: ' + esc(r.master);
      }
      show('cancelBox');
    });
    $('#cancelBtn').onclick = function () {
      var b = $('#cancelBtn'); b.disabled = true; b.textContent = 'Скасовуємо…';
      api.cancel(token).then(function (r) {
        $('#cancelInfo').textContent = r.ok ? 'Запис скасовано. Чекаємо на вас іншим разом!' : (ERR[r.error] || 'Не вдалося скасувати. Зателефонуйте нам.');
        b.hidden = true;
      });
    };
  }

  /* ---------- Кнопки навигации ---------- */
  $('#to2').onclick = goStep2;
  $('#to3').onclick = renderStep3;
  document.querySelectorAll('.back').forEach(function (b) {
    b.addEventListener('click', function () { b.dataset.back === '1' ? show('step1') : show('step2'); });
  });

  /* ---------- Старт ---------- */
  if (DEMO) $('#demo-banner').hidden = false;
  var token = new URLSearchParams(location.search).get('cancel');
  if (token) { loading(true); startCancel(token); }
  else {
    api.config().then(function (c) {
      if (!c.ok) { loading(false); return fail(c.error); }
      if (!c.accepting) { loading(false); return fail('CLOSED'); }
      state.cfg = c; renderStep1();
    });
  }
})();
