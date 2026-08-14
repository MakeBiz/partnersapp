/**
 * Тесты слоя начислений. Запуск: node --test lib/commissions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLedger, summarize } from './commissions.js';

const PARTNER = { id: 2, contactId: 1002, commWelcome: 20, commBase: 10, payRatio: 0.8 };
const UPLINE = { id: 1, contactId: 1001, payRatio: 1.0, active: true };

const deal = (o) => ({
  id: 1, amount: 600000, stageId: 'C1:WON', isWon: true, isLost: false,
  commStatus: 'К выплате', createdAt: '2026-02-11', ...o,
});

const l1 = (rows) => rows.filter((r) => r.level === 1);
const l2 = (rows) => rows.filter((r) => r.level === 2);

test('без сделок — пустой леджер', () => {
  const { rows } = computeLedger({ partner: PARTNER, deals: [] });
  assert.equal(rows.length, 0);
});

test('welcome: 20% с первой сделки, 10% с остальных', () => {
  const deals = [
    deal({ id: 10, createdAt: '2026-02-11', amount: 600000 }),
    deal({ id: 11, createdAt: '2026-03-30', amount: 320000 }),
    deal({ id: 12, createdAt: '2026-05-14', amount: 750000 }),
  ];
  const { rows, welcome } = computeLedger({ partner: PARTNER, deals });
  assert.equal(welcome.reason, 'earliest_deal');

  const byId = Object.fromEntries(l1(rows).map((r) => [r.bitrixDealId, r]));
  assert.equal(byId[10].rate, 20);
  assert.equal(byId[10].amount, 120000);
  assert.equal(byId[10].isWelcome, true);
  assert.equal(byId[11].rate, 10);
  assert.equal(byId[11].amount, 32000);
  assert.equal(byId[12].amount, 75000);

  assert.equal(l1(rows).filter((r) => r.isWelcome).length, 1, 'welcome ровно один раз');
});

test('порядок сделок во входных данных не влияет на welcome', () => {
  const deals = [
    deal({ id: 12, createdAt: '2026-05-14' }),
    deal({ id: 10, createdAt: '2026-02-11' }),
    deal({ id: 11, createdAt: '2026-03-30' }),
  ];
  const { rows } = computeLedger({ partner: PARTNER, deals });
  const w = l1(rows).find((r) => r.isWelcome);
  assert.equal(w.bitrixDealId, 10);
});

test('welcomeDealId из Bitrix важнее дат', () => {
  const deals = [
    deal({ id: 10, createdAt: '2026-02-11' }),
    deal({ id: 11, createdAt: '2026-03-30' }),
  ];
  const partner = { ...PARTNER, welcomeUsed: true, welcomeDealId: 11 };
  const { rows, welcome } = computeLedger({ partner, deals });
  assert.equal(welcome.reason, 'bitrix_welcome_deal');
  assert.equal(l1(rows).find((r) => r.isWelcome).bitrixDealId, 11);
});

test('без дат welcome не назначается (лучше недоначислить, чем переплатить)', () => {
  const deals = [deal({ id: 10, createdAt: undefined }), deal({ id: 11, createdAt: undefined })];
  const { rows, welcome } = computeLedger({ partner: PARTNER, deals });
  assert.equal(welcome.reason, 'no_dates_available');
  assert.equal(l1(rows).filter((r) => r.isWelcome).length, 0);
  assert.ok(l1(rows).every((r) => r.rate === 10), 'все по базовой ставке');
});

test('частичные даты — welcome тоже не назначается', () => {
  const deals = [deal({ id: 10, createdAt: '2026-02-11' }), deal({ id: 11, createdAt: undefined })];
  const { welcome } = computeLedger({ partner: PARTNER, deals });
  assert.equal(welcome.reason, 'incomplete_dates');
});

test('бонус израсходован, сделка неизвестна — повторно не начисляем', () => {
  const partner = { ...PARTNER, welcomeUsed: true };
  const { rows, welcome } = computeLedger({ partner, deals: [deal({ id: 10 })] });
  assert.equal(welcome.reason, 'already_used_unknown_deal');
  assert.equal(l1(rows)[0].rate, 10);
});

test('уровень 2: 10% от комиссии, а не от суммы сделки', () => {
  const { rows } = computeLedger({ partner: PARTNER, deals: [deal({ id: 10 })], upline: UPLINE });
  const a = l1(rows)[0];
  const b = l2(rows)[0];
  assert.equal(a.amount, 120000);
  assert.equal(b.baseType, 'commission');
  assert.equal(b.baseAmount, 120000);
  assert.equal(b.amount, 12000, '10% от 120000, а не от 600000');
  assert.equal(b.partnerId, UPLINE.id);
  assert.equal(b.parentKey, a.key, 'связь для каскадной отмены');
});

test('коэффициент выплаты берётся у получателя строки', () => {
  const { rows } = computeLedger({ partner: PARTNER, deals: [deal({ id: 10 })], upline: UPLINE });
  const a = l1(rows)[0];
  const b = l2(rows)[0];
  assert.equal(a.payoutAmount, 96000, 'физлицо на карту: 120000 × 0.8');
  assert.equal(b.payoutAmount, 12000, 'ИП: без вычета');
});

test('неактивный пригласивший — второй уровень не начисляется', () => {
  const { rows } = computeLedger({
    partner: PARTNER, deals: [deal({ id: 10 })], upline: { ...UPLINE, active: false },
  });
  assert.equal(l2(rows).length, 0);
});

test('третий уровень выключен по умолчанию, включается настройкой', () => {
  const upline = { ...UPLINE, upline: { id: 99, payRatio: 1, active: true } };
  const off = computeLedger({ partner: PARTNER, deals: [deal({ id: 10 })], upline });
  assert.equal(off.rows.filter((r) => r.level === 3).length, 0);

  const on = computeLedger({
    partner: PARTNER, deals: [deal({ id: 10 })], upline,
    settings: { 'commission.level3_enabled': true },
  });
  const third = on.rows.find((r) => r.level === 3);
  assert.equal(third.amount, 1200, '10% от 12000');
});

test('проигранные и незакрытые сделки не начисляются', () => {
  const deals = [
    deal({ id: 10, isWon: false, isLost: true, stageId: 'C1:LOSE' }),
    deal({ id: 11, isWon: false, isLost: false, stageId: 'C1:2' }),
  ];
  const { rows } = computeLedger({ partner: PARTNER, deals });
  assert.equal(rows.length, 0);
});

test('стадия распознаётся без явных флагов', () => {
  const deals = [deal({ id: 10, isWon: undefined, isLost: undefined, stageId: 'C1:WON' })];
  const { rows } = computeLedger({ partner: PARTNER, deals });
  assert.equal(rows.length, 1);
});

test('статусы комиссии переносятся из Bitrix', () => {
  const deals = [
    deal({ id: 10, commStatus: 'Выплачена' }),
    deal({ id: 11, commStatus: 'К выплате' }),
    deal({ id: 12, commStatus: 'Не начислена' }),
  ];
  const { rows } = computeLedger({ partner: PARTNER, deals });
  const by = Object.fromEntries(l1(rows).map((r) => [r.bitrixDealId, r]));
  assert.equal(by[10].status, 'paid');
  assert.equal(by[11].status, 'payable');
  assert.equal(by[12].status, 'accrued');
  assert.equal(by[12].reconciled, false, 'несверённое помечено');
});

test('свод считает только сверенное, отдельно показывая расчётное', () => {
  const deals = [
    deal({ id: 10, amount: 600000, commStatus: 'Выплачена', createdAt: '2026-02-11' }),
    deal({ id: 11, amount: 300000, commStatus: 'К выплате', createdAt: '2026-05-02' }),
    deal({ id: 12, amount: 400000, commStatus: 'Не начислена', createdAt: '2026-07-01' }),
  ];
  const { rows } = computeLedger({ partner: PARTNER, deals });
  const s = summarize(rows, PARTNER.id);
  assert.equal(s.paid, 120000, 'welcome 20%');
  assert.equal(s.payable, 30000);
  assert.equal(s.pending, 40000, 'рассчитано, но не сверено');
  assert.equal(s.accrued, 150000, 'в начисленное несверённое не входит');
  assert.equal(s.payoutPayable, 24000, '30000 × 0.8');
});

test('округление до копеек без накопления ошибки', () => {
  const deals = [deal({ id: 10, amount: 333333.33, createdAt: '2026-01-01' })];
  const { rows } = computeLedger({ partner: PARTNER, deals, upline: UPLINE });
  assert.equal(l1(rows)[0].amount, 66666.67, '20% от 333333.33');
  assert.equal(l2(rows)[0].amount, 6666.67, '10% от комиссии');
  assert.ok(Number.isInteger(Math.round(l1(rows)[0].amount * 100)));
});

test('повторный расчёт даёт тот же результат', () => {
  const deals = [deal({ id: 10 }), deal({ id: 11, createdAt: '2026-04-01', amount: 240000 })];
  const a = computeLedger({ partner: PARTNER, deals, upline: UPLINE });
  const b = computeLedger({ partner: PARTNER, deals, upline: UPLINE });
  assert.deepEqual(a.rows, b.rows);
});

test('ключи строк уникальны — база не отклонит вставку', () => {
  const deals = [deal({ id: 10 }), deal({ id: 11, createdAt: '2026-04-01' })];
  const { rows } = computeLedger({ partner: PARTNER, deals, upline: UPLINE });
  const keys = rows.map((r) => `${r.bitrixDealId}:${r.partnerId}:${r.level}`);
  assert.equal(new Set(keys).size, keys.length);
});
