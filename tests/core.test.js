// Тесты логики. Открываются в браузере: tests/index.html (заголовок вкладки покажет PASS N или FAIL N)
let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log('FAIL', name, '\n  получено', JSON.stringify(got), '\n  ожидалось', JSON.stringify(want)));
}

const cfg = CORE.parseSettings({});
const masters = CORE.parseMasters([
  ['m1', 'Марія', '1,2,3,4,5', '10:00', '19:00', '14:00', '15:00', 'cal1', 'a@x.com'],
  ['m2', 'Олена', '2,3,4,5,6', '11:00', '20:00', '', '', 'cal2', '']
]);
const now = { day: '2026-12-01', min: 8 * 60 }; // вівторок 08:00

t('мастера разобраны', masters.length, 2);
t('календарь не уходит на сайт', CORE.publicMasters(masters), [{ id: 'm1', name: 'Марія' }, { id: 'm2', name: 'Олена' }]);

// Марія, вівторок, 60 хв: обід 14:00–15:00 пропускаем
const m1 = CORE.masterFree(masters[0], cfg, 60, '2026-12-02', [], now).map(CORE.fmt);
t('Марія не ставит запись на обед', m1.includes('14:00') || m1.includes('13:30'), false);
t('Марія с утра', m1[0], '10:00');
t('Марія последняя 18:00', m1[m1.length - 1], '18:00');

// Олена в понеділок не работает
t('выходной мастера', CORE.masterFree(masters[1], cfg, 60, '2026-12-07', [], now), []);

// Занятость: Марія занята 10:00–11:00 → 10:00 и 10:30 недоступны
const busy = { m1: [{ s: 600, e: 660 }] };
const m1b = CORE.masterFree(masters[0], cfg, 60, '2026-12-02', busy.m1, now).map(CORE.fmt);
t('занято 10:00', m1b.includes('10:00') || m1b.includes('10:30'), false);
t('11:00 свободно', m1b[0], '11:00');

// Длинная услуга не влезает в конец дня
const long = CORE.masterFree(masters[0], cfg, 150, '2026-12-02', [], now).map(CORE.fmt);
t('150 мин: последняя начинается не позже 16:30', long[long.length - 1], '16:30');

// Сегодня: «не раньше чем через 2 часа»
const nowLate = { day: '2026-12-02', min: 12 * 60 };
const today = CORE.masterFree(masters[0], cfg, 60, '2026-12-02', [], nowLate).map(CORE.fmt);
t('сегодня с 15:00 (12:00 + 2 ч, обед до 15:00)', today[0], '15:00');

// В прошлое нельзя
t('прошлое', CORE.masterFree(masters[0], cfg, 60, '2026-11-30', [], now), []);
// За горизонтом нельзя
t('за горизонтом', CORE.masterFree(masters[0], cfg, 60, '2027-03-01', [], now), []);
// Невалидная дата
t('2026-02-31', CORE.validDay('2026-02-31'), false);

// «Любой мастер»: объединение. Вівторок: Марія 10:00+, Олена 11:00+
const any = CORE.freeTimes(masters, cfg, 60, '2026-12-02', {}, now, 'any');
t('любой мастер начинает с 10:00', any[0], '10:00');
const only2 = CORE.freeTimes(masters, cfg, 60, '2026-12-02', {}, now, 'm2');
t('только Олена с 11:00', only2[0], '11:00');

// Любой мастер: если Марія занята, берём Олену
t('pickMaster любой → Марія', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', {}, now, 'any'), 'm1');
t('pickMaster любой, Марія занята → Олена', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', { m1: [{ s: 660, e: 720 }] }, now, 'any'), 'm2');
t('pickMaster никто', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', { m1: [{ s: 660, e: 720 }], m2: [{ s: 660, e: 720 }] }, now, 'any'), '');
t('pickMaster конкретный занят', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', { m1: [{ s: 660, e: 720 }] }, now, 'm1'), '');

// Телефон и данные
t('телефон 0XX', CORE.normalizePhone('050 123 45 67'), '+380501234567');
t('телефон +380', CORE.normalizePhone('+380501234567'), '+380501234567');
t('телефон плохой', CORE.normalizePhone('12345'), '');
t('формула в таблице', CORE.sanitizeCell('=1+1'), "'=1+1");
const v = CORE.validateClient({ name: 'А', phone: '1', email: 'bad' });
t('валидация ловит ошибки', Object.keys(v.errors).sort(), ['email', 'name', 'phone']);
t('валидация ок, почта необязательна', CORE.validateClient({ name: 'Анна', phone: '0501234567' }).ok, true);

// Защита от злоупотреблений
t('ok', CORE.decideAttempt(0, 0), 'ok');
t('3 активные → limit', CORE.decideAttempt(3, 1), 'limit');
t('много попыток → shadow', CORE.decideAttempt(0, 6), 'shadow');

// Услуги: неактивные не показываем
t('услуги', CORE.parseServices([['s1', 'Манікюр', '60', '450', 'так'], ['s2', 'Старе', '30', '100', 'ні']]).map(s => s.id), ['s1']);

document.title = fail ? 'FAIL ' + fail : 'PASS ' + pass;
document.body.textContent = (fail ? 'FAILED ' + fail : 'ALL OK') + ' — pass ' + pass + (window.__log || []).join(' | ');
