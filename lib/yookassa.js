/**
 * Адаптер уведомлений ЮKassa → нормализованная оплата приложения.
 *
 * ЮKassa шлёт объект вида { event, object }. Нас интересуют два события:
 *   payment.succeeded — успешная оплата (начисляем 20%);
 *   refund.succeeded  — возврат (отменяем начисление по исходному платежу).
 *
 * Партнёр определяется по реф-коду, который сайт продукта (Solara) кладёт в
 * metadata платежа: metadata.refcode. Продукт — metadata.product (по умолчанию
 * solara). Чистая функция без побочных эффектов — покрыта юнит-тестами.
 */

export function normalizeYookassa(body) {
  const event = body?.event;
  const obj = body?.object;
  if (!obj) return null;

  const amount = Number(obj.amount?.value);
  const currency = obj.amount?.currency || 'RUB';
  const refcode = obj.metadata?.refcode ?? null;
  const productSlug = obj.metadata?.product ?? 'solara';

  if (event === 'payment.succeeded') {
    return {
      provider: 'yookassa',
      extId: String(obj.id),
      amount,
      currency,
      status: 'succeeded',
      refcode,
      productSlug,
      occurredAt: obj.captured_at || obj.created_at || null,
      raw: obj,
    };
  }

  if (event === 'refund.succeeded') {
    // Возврат привязываем к ИСХОДНОМУ платежу (payment_id): по нему уже есть
    // строка app_payments, её и переводим в refunded → начисление отменится.
    return {
      provider: 'yookassa',
      extId: String(obj.payment_id),
      amount,
      currency,
      status: 'refunded',
      refcode,
      productSlug,
      occurredAt: obj.created_at || null,
      raw: obj,
    };
  }

  return null; // прочие события игнорируем (роут ответит 200, чтобы не было ретраев)
}
