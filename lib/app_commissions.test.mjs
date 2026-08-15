/**
 * Тесты трека «Приложения» (self-serve, плоские 30% lifetime).
 * Запуск: node --test lib/app_commissions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAppLedger, summarize } from './commissions.js';

const PARTNER = { id: 2, payRatio: 0.8 };            // физлицо на карту
const UPLINE = { id: 1, payRatio: 1.0, active: true }; // ИП
const payment = (o) => ({ id: 'pay_1', amount: 1490, status: 'succeeded', ...o });
const lvl = (rows, n) => rows.filter((r) => r.level === n);

test('плоские 30% с оплаты, без welcome', () => {
  const { rows } = computeAppLedger({ payment: payment(), partner: PARTNER });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.level, 1);
  assert.equal(r.rate, 30);
  assert.equal(r.amount, 447, '30% от 1490');
  assert.equal(r.isWelcome, false);
  assert.equal(r.sourceType, 'app_payment');
  assert.equal(r.productType, 'app');
  assert.equal(r.baseType, 'app_payment');
  assert.equal(r.status, 'payable');
  assert.equal(r.reconciled, true);
});

test('recurring: 30% с каждой оплаты клиента, welcome не появляется', () => {
  const a = computeAppLedger({ payment: payment({ id: 'p1', amount: 1490 }), partner: PARTNER });
  const b = computeAppLedger({ payment: payment({ id: 'p2', amount: 690 }), partner: PARTNER });
  assert.equal(a.rows[0].amount, 447);
  assert.equal(b.rows[0].amount, 207, '30% от 690');
  assert.ok([...a.rows, ...b.rows].every((r) => r.isWelcome === false));
});

test('второй уровень: 10% от комиссии, а не от суммы оплаты', () => {
  const { rows } = computeAppLedger({ payment: payment(), partner: PARTNER, upline: UPLINE });
  const l1 = lvl(rows, 1)[0];
  const l2 = lvl(rows, 2)[0];
  assert.equal(l1.amount, 447);
  assert.equal(l2.baseType, 'commission');
  assert.equal(l2.baseAmount, 447);
  assert.equal(l2.amount, 44.7, '10% от 447, не от 1490');
  assert.equal(l2.partnerId, UPLINE.id);
  assert.equal(l2.parentKey, l1.key, 'связь для каскадной отмены');
  assert.equal(l2.productType, 'app');
});

test('коэффициент выплаты берётся у получателя строки', () => {
  const { rows } = computeAppLedger({ payment: payment(), partner: PARTNER, upline: UPLINE });
  assert.equal(lvl(rows, 1)[0].payoutAmount, 357.6, 'физлицо на карту: 447 × 0.8');
  assert.equal(lvl(rows, 2)[0].payoutAmount, 44.7, 'ИП: без вычета');
});

test('неактивный пригласивший — второй уровень не начисляется', () => {
  const { rows } = computeAppLedger({
    payment: payment(), partner: PARTNER, upline: { ...UPLINE, active: false },
  });
  assert.equal(lvl(rows, 2).length, 0);
});

test('возврат оплаты — все строки отменяются', () => {
  const { rows } = computeAppLedger({ payment: payment({ status: 'refunded' }), partner: PARTNER, upline: UPLINE });
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => r.status === 'cancelled'));
  assert.ok(rows.every((r) => r.reconciled === false));
});

test('нулевая или отрицательная сумма — пустой леджер', () => {
  assert.equal(computeAppLedger({ payment: payment({ amount: 0 }), partner: PARTNER }).rows.length, 0);
  assert.equal(computeAppLedger({ payment: payment({ amount: -100 }), partner: PARTNER }).rows.length, 0);
});

test('ставку приложений можно переопределить настройкой и у партнёра', () => {
  const bySetting = computeAppLedger({ payment: payment(), partner: PARTNER, settings: { 'commission.app_rate': 20 } });
  assert.equal(bySetting.rows[0].rate, 20);
  assert.equal(bySetting.rows[0].amount, 298, '20% от 1490 (переопределение)');

  const byPartner = computeAppLedger({ payment: payment(), partner: { ...PARTNER, appRate: 25 } });
  assert.equal(byPartner.rows[0].rate, 25);
  assert.equal(byPartner.rows[0].amount, 372.5, '25% от 1490');
});

test('третий уровень выключен по умолчанию, включается настройкой', () => {
  const upline = { ...UPLINE, upline: { id: 99, payRatio: 1, active: true } };
  const off = computeAppLedger({ payment: payment(), partner: PARTNER, upline });
  assert.equal(off.rows.filter((r) => r.level === 3).length, 0);

  const on = computeAppLedger({
    payment: payment(), partner: PARTNER, upline,
    settings: { 'commission.level3_enabled': true },
  });
  const l3 = on.rows.find((r) => r.level === 3);
  assert.equal(l3.amount, 4.47, '10% от 44.7');
  assert.equal(l3.productType, 'app');
});

test('округление до копеек без накопления ошибки', () => {
  const { rows } = computeAppLedger({ payment: payment({ amount: 999 }), partner: PARTNER, upline: UPLINE });
  assert.equal(lvl(rows, 1)[0].amount, 299.7, '30% от 999');
  assert.equal(lvl(rows, 2)[0].amount, 29.97, '10% от 299.7');
  assert.ok(Number.isInteger(Math.round(lvl(rows, 1)[0].amount * 100)));
});

test('ключи строк уникальны и в пространстве app', () => {
  const { rows } = computeAppLedger({ payment: payment(), partner: PARTNER, upline: UPLINE });
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((k) => k.startsWith('app:')));
});

test('свод показывает app-начисления как к выплате', () => {
  const { rows } = computeAppLedger({ payment: payment(), partner: PARTNER, upline: UPLINE });
  const s = summarize(rows, PARTNER.id);
  assert.equal(s.payable, 447);
  assert.equal(s.payoutPayable, 357.6, '447 × 0.8');
});
