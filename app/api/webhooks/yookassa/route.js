/**
 * Вебхук оплат приложений (ЮKassa) → атрибуция партнёру и начисление.
 *
 * ЮKassa шлёт payment.succeeded / refund.succeeded. Аутентификация — общий
 * секрет APP_WEBHOOK_SECRET (заголовок X-Webhook-Secret или ?secret=). Так как
 * ЮKassa не подписывает вебхуки, секрет обязателен; без него роут отвечает 503.
 *
 * Обработка идемпотентна: повтор того же платежа ничего не дублирует, возврат
 * отменяет начисление. Логика — в lib/app_attribution.js.
 */
import { withTransaction } from '../../../../lib/db.js';
import { attributeAppPayment } from '../../../../lib/app_attribution.js';
import { normalizeYookassa } from '../../../../lib/yookassa.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export async function POST(req) {
  const secret = process.env.APP_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'not_configured' }, 503);

  const provided =
    req.headers.get('x-webhook-secret') || new URL(req.url).searchParams.get('secret');
  if (!provided || provided !== secret) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const payment = normalizeYookassa(body);
  if (!payment) return json({ ignored: true }, 200); // не наше событие — 200, чтобы ЮKassa не ретраила

  if (!payment.extId || !(Number(payment.amount) >= 0)) {
    return json({ error: 'bad_payload' }, 400);
  }

  try {
    const result = await withTransaction((client) => attributeAppPayment(client, payment));
    return json({ ok: true, ...result }, 200);
  } catch (err) {
    return json({ error: 'attribution_failed', message: err.message }, 500);
  }
}
