/**
 * Тесты адаптера уведомлений ЮKassa. Запуск: node --test lib/yookassa.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYookassa } from './yookassa.js';

test('payment.succeeded → нормализованная оплата', () => {
  const n = normalizeYookassa({
    event: 'payment.succeeded',
    object: {
      id: '2d8f...abc',
      amount: { value: '1490.00', currency: 'RUB' },
      metadata: { refcode: 'MKB-IGSK-4213', product: 'solara' },
      captured_at: '2026-08-14T10:00:00.000Z',
    },
  });
  assert.equal(n.provider, 'yookassa');
  assert.equal(n.extId, '2d8f...abc');
  assert.equal(n.amount, 1490);
  assert.equal(n.currency, 'RUB');
  assert.equal(n.status, 'succeeded');
  assert.equal(n.refcode, 'MKB-IGSK-4213');
  assert.equal(n.productSlug, 'solara');
  assert.equal(n.occurredAt, '2026-08-14T10:00:00.000Z');
});

test('refund.succeeded → возврат по исходному платежу', () => {
  const n = normalizeYookassa({
    event: 'refund.succeeded',
    object: { id: 'rf_1', payment_id: 'pay_1', amount: { value: '1490.00', currency: 'RUB' } },
  });
  assert.equal(n.status, 'refunded');
  assert.equal(n.extId, 'pay_1', 'ключ — исходный платёж, чтобы отменить его начисление');
});

test('прочие события игнорируются', () => {
  assert.equal(normalizeYookassa({ event: 'payment.waiting_for_capture', object: { id: 'x' } }), null);
  assert.equal(normalizeYookassa({ event: 'payment.canceled', object: { id: 'x' } }), null);
  assert.equal(normalizeYookassa({}), null);
  assert.equal(normalizeYookassa({ event: 'payment.succeeded' }), null);
});

test('без refcode оплата всё равно нормализуется (атрибуция решит позже)', () => {
  const n = normalizeYookassa({
    event: 'payment.succeeded',
    object: { id: 'p', amount: { value: '690.00', currency: 'RUB' }, metadata: {} },
  });
  assert.equal(n.refcode, null);
  assert.equal(n.amount, 690);
  assert.equal(n.productSlug, 'solara', 'продукт по умолчанию — solara');
});
