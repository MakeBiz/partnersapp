/**
 * Тесты клиента gateway. Сеть не используется — fetch подменяется.
 * Запуск: node --test lib/gateway.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimVerify, getProfile, getDeals, mapProfile, mapDeal,
  payRatioFor, checkAccess, GatewayError,
} from './gateway.js';

const OPTS = { baseUrl: 'https://gw.test', key: 'secret-key' };
const fake = (status, payload, capture) => async (url, init) => {
  if (capture) Object.assign(capture, { url, init });
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? '' : JSON.stringify(payload)),
  };
};

// реальный ответ gateway на 13.08.2026
const REAL_PROFILE = {
  contactId: 2, name: 'Александ Серов', telegramId: '300776705',
  tgLink: 'https://t.me/MrSerOFF', status: 'Действующий', tier: null, score: null,
  commType: 'Welcome 20% + 10%', comm1: 20, comm2: 10, refcode: null,
  payer: null, payout: null, requisitesMasked: null, contractUrl: null, currency: 'RUB',
};

test('ключ уходит в заголовке, на клиент не попадает', async () => {
  const cap = {};
  await getProfile(2, { ...OPTS, fetchImpl: fake(200, REAL_PROFILE, cap) });
  assert.equal(cap.init.headers.Authorization, 'Bearer secret-key');
  assert.equal(cap.url, 'https://gw.test/partner/2/profile');
});

test('claim/verify отправляет код методом POST', async () => {
  const cap = {};
  const r = await claimVerify('MKB-4213', {
    ...OPTS, fetchImpl: fake(200, { contactId: 2, telegramId: '300776705', name: 'Serov' }, cap),
  });
  assert.equal(cap.init.method, 'POST');
  assert.deepEqual(JSON.parse(cap.init.body), { code: 'MKB-4213' });
  assert.equal(r.contactId, 2);
});

test('просроченный код — понятная ошибка, а не падение', async () => {
  await assert.rejects(
    () => claimVerify('X', { ...OPTS, fetchImpl: fake(404, { error: 'invalid_or_expired_code' }) }),
    (e) => e instanceof GatewayError && e.code === 'invalid_or_expired_code'
  );
});

test('неверный ключ — 401', async () => {
  await assert.rejects(
    () => getProfile(2, { ...OPTS, fetchImpl: fake(401, {}) }),
    (e) => e.code === 'unauthorized' && e.status === 401
  );
});

test('не-JSON в ответе не роняет кабинет', async () => {
  const bad = async () => ({ ok: true, status: 200, text: async () => '<html>502</html>' });
  await assert.rejects(() => getProfile(2, { ...OPTS, fetchImpl: bad }), (e) => e.code === 'bad_response');
});

test('сетевая ошибка нормализуется', async () => {
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(() => getProfile(2, { ...OPTS, fetchImpl: boom }), (e) => e.code === 'network');
});

test('без настроек — явная ошибка, а не молчаливый сбой', async () => {
  await assert.rejects(
    () => getProfile(2, { baseUrl: 'https://gw.test', key: '', fetchImpl: fake(200, {}) }),
    (e) => e.code === 'not_configured'
  );
});

test('реальный ответ профиля раскладывается верно', () => {
  const p = mapProfile(REAL_PROFILE);
  assert.equal(p.commWelcome, 20, 'comm1 — это ставка welcome');
  assert.equal(p.commBase, 10, 'comm2 — базовая');
  assert.equal(p.status, 'Действующий');
  assert.equal(p.uplineContactId, null, 'поля пока нет — второго уровня не будет');
  assert.equal(p.currency, 'RUB');
});

test('коэффициент выплаты: явное значение важнее типа плательщика', () => {
  assert.equal(payRatioFor('Физлицо (карта)', undefined), 0.8);
  assert.equal(payRatioFor('ИП', undefined), 1.0);
  assert.equal(payRatioFor('Самозанятый', undefined), 1.0);
  assert.equal(payRatioFor('Физлицо (карта)', 0.9), 0.9, 'payRatio из Bitrix имеет приоритет');
  assert.equal(payRatioFor(null, undefined), 1.0, 'без данных ничего не удерживаем');
});

test('сделка: выигранность выводится из стадии, если флага нет', () => {
  assert.equal(mapDeal({ id: 1, stageId: 'C1:WON' }).isWon, true);
  assert.equal(mapDeal({ id: 1, stageId: 'C1:LOSE' }).isLost, true);
  assert.equal(mapDeal({ id: 1, stageId: 'C1:2' }).isWon, false);
  assert.equal(mapDeal({ id: 1, stageId: 'C1:WON', isWon: false }).isWon, false, 'явный флаг важнее');
});

test('отсутствие createdAt переживается без ошибки', () => {
  const d = mapDeal({ id: 1, stageId: 'C1:WON', amount: '600000' });
  assert.equal(d.createdAt, null);
  assert.equal(d.amount, 600000, 'сумма приводится к числу');
});

test('пустой список сделок — это пустой массив, а не падение', async () => {
  const d = await getDeals(2, { ...OPTS, fetchImpl: fake(200, []) });
  assert.deepEqual(d, []);
});

test('гейт доступа', () => {
  assert.equal(checkAccess({ access: 'ok' }).allowed, true);
  assert.equal(checkAccess({ access: 'blocked' }).reason, 'blocked');
  assert.equal(checkAccess({ access: 'no_access' }).reason, 'no_access');
  assert.equal(checkAccess(mapProfile(REAL_PROFILE)).allowed, true, 'пока поля нет — доступ открыт');
});
