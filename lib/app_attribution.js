/**
 * Атрибуция оплат в приложениях (self-serve) партнёру и начисление.
 *
 * Приложения (Solara и будущие) продаются онлайн: клиент платит на сайте
 * продукта через ЮKassa, сделки в Bitrix нет. Партнёр определяется по реф-коду
 * из метаданных платежа. Начисление — плоские 20% первому уровню + 10% от
 * комиссии пригласившему (второй уровень), логика в computeAppLedger.
 *
 * Идемпотентность: платёж фиксируется по (provider, ext_id), строки леджера —
 * по (app_payment_id, partner_id, level). Повтор вебхука ничего не дублирует;
 * возврат (status=refunded) переводит начисление в cancelled.
 */
import { computeAppLedger, syncAppLedger } from './commissions.js';
import { upsertPartner, findPartnerByContact } from './sync.js';
import { resolveByRefcode as gwResolveByRefcode, getProfile as gwGetProfile } from './gateway.js';

/** Партнёр по реф-коду в локальной базе (быстрый путь). */
export async function findPartnerByRefcode(client, refcode) {
  if (!refcode) return null;
  const { rows } = await client.query('SELECT * FROM partners WHERE refcode = $1', [refcode]);
  return rows[0] || null;
}

async function loadSettings(client) {
  const { rows } = await client.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function loadUpline(client, uplinePartnerId) {
  if (!uplinePartnerId) return null;
  const { rows } = await client.query(
    'SELECT id, pay_ratio, blocked, status FROM partners WHERE id = $1',
    [uplinePartnerId]
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    payRatio: Number(u.pay_ratio),
    active: u.blocked !== true && u.status !== 'Отказ',
  };
}

/**
 * Партнёр по реф-коду через gateway, если локально его ещё нет (оплата пришла
 * раньше, чем партнёр открыл кабинет). Заводит и его, и пригласившего.
 */
async function resolvePartnerViaGateway(client, refcode, deps) {
  const resolve = deps.resolveByRefcode ?? gwResolveByRefcode;
  const getProfile = deps.getProfile ?? gwGetProfile;

  let resolved = null;
  try { resolved = await resolve(refcode); } catch { resolved = null; }
  if (!resolved || !resolved.contactId || resolved.access === 'no_access') return null;

  let profile = null;
  try { profile = await getProfile(resolved.contactId); } catch { profile = null; }
  if (!profile) return null;

  let uplinePartner = null;
  if (profile.uplineContactId) {
    uplinePartner = await findPartnerByContact(client, profile.uplineContactId);
    if (!uplinePartner) {
      try {
        uplinePartner = await upsertPartner(client, await getProfile(profile.uplineContactId));
      } catch { uplinePartner = null; }
    }
  }
  return upsertPartner(client, profile, { uplinePartnerId: uplinePartner?.id ?? null });
}

/**
 * Атрибутировать платёж и начислить вознаграждение. Вызывать в транзакции.
 *
 * @param client   pg-клиент
 * @param payment  { provider, extId, productSlug, refcode, amount, currency, status, occurredAt, raw }
 * @param deps     инъекции для тестов: { resolveByRefcode, getProfile, settings }
 * @returns        { attributed, appPaymentId, partnerId?, rowsWritten?, reason? }
 */
export async function attributeAppPayment(client, payment, deps = {}) {
  const {
    provider = 'yookassa', extId, productSlug = null, refcode = null,
    amount, currency = 'RUB', status = 'succeeded', occurredAt = null, raw = null,
  } = payment;

  if (!extId) throw new Error('attributeAppPayment: нужен extId платежа');

  // 1. Найти партнёра: сперва локально по реф-коду, затем через gateway.
  let partner = await findPartnerByRefcode(client, refcode);
  if (!partner && refcode) {
    partner = await resolvePartnerViaGateway(client, refcode, deps);
  }

  // 2. Зафиксировать платёж идемпотентно (provider + ext_id).
  const { rows: payRows } = await client.query(
    `INSERT INTO app_payments
       (provider, ext_id, product_slug, refcode, partner_id, amount, currency, status, occurred_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, now()), $10::jsonb)
     ON CONFLICT (provider, ext_id) DO UPDATE SET
       status       = EXCLUDED.status,
       partner_id   = COALESCE(app_payments.partner_id, EXCLUDED.partner_id),
       product_slug = COALESCE(EXCLUDED.product_slug, app_payments.product_slug),
       refcode      = COALESCE(app_payments.refcode, EXCLUDED.refcode),
       raw          = COALESCE(EXCLUDED.raw, app_payments.raw)
     RETURNING *`,
    [provider, extId, productSlug, refcode, partner?.id ?? null,
     amount, currency, status, occurredAt, raw ? JSON.stringify(raw) : null]
  );
  const appPayment = payRows[0];

  // 3. Реф-код не привязан к партнёру — платёж сохранён, начислений нет.
  //    (реф-коды в Bitrix могут быть ещё не сгенерированы — платёж не теряем)
  if (!partner) {
    return {
      attributed: false,
      appPaymentId: appPayment.id,
      reason: refcode ? 'partner_not_found' : 'no_refcode',
    };
  }

  // 4. Посчитать и записать леджер (идемпотентно).
  const upline = await loadUpline(client, partner.upline_partner_id);
  const settings = deps.settings ?? (await loadSettings(client));
  const { rows } = computeAppLedger({
    payment: { id: appPayment.id, amount: Number(appPayment.amount), status: appPayment.status },
    partner: { id: partner.id, payRatio: Number(partner.pay_ratio) },
    upline,
    settings,
  });
  const rowsWritten = await syncAppLedger(client, { rows });

  return {
    attributed: true,
    appPaymentId: appPayment.id,
    partnerId: partner.id,
    hasLevel2: Boolean(upline),
    status: appPayment.status,
    rowsWritten,
  };
}
