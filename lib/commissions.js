/**
 * Слой начислений партнёрского кабинета.
 *
 * Модель вознаграждения:
 *   Уровень 1 — тот, кто привёл клиента.
 *       welcome-бонус 20% — ОДИН РАЗ, с первого приведённого клиента;
 *       все последующие вознаграждения — 10% от суммы сделки.
 *   Уровень 2 — тот, кто пригласил партнёра: 10% ОТ КОМИССИИ уровня 1
 *       (не от суммы сделки).
 *   Уровень 3 — выключен настройкой, включается без правки кода.
 *
 * Выплата: amount * payRatio (0.8 для физлица на карту, 1.0 для ИП/юрлица).
 * Коэффициент берётся у ПОЛУЧАТЕЛЯ строки: у уровня 2 — коэффициент пригласившего.
 *
 * Функция computeLedger чистая: не ходит в сеть и в базу, поэтому
 * полностью покрывается тестами. Запись в базу — отдельно, в syncLedger.
 */

// --- деньги: считаем в копейках, чтобы не накапливать ошибку float ---
const toKop = (rub) => Math.round(Number(rub || 0) * 100);
const toRub = (kop) => Math.round(kop) / 100;
const percentOf = (rub, rate) => toRub((toKop(rub) * Number(rate)) / 100);
const applyRatio = (rub, ratio) => toRub(toKop(rub) * Number(ratio));

export const DEFAULT_SETTINGS = {
  'commission.welcome_rate': 20,
  'commission.base_rate': 10,
  'commission.level2_rate': 10,
  'commission.level3_enabled': false,
  'commission.level3_rate': 10,
  // Трек «Приложения»: плоская ставка с каждой оплаты, без welcome (30% lifetime).
  'commission.app_rate': 30,
};

/** Статус комиссии из Bitrix → статус строки леджера. */
function mapStatus(commStatus) {
  switch (commStatus) {
    case 'Выплачена':
      return { status: 'paid', reconciled: true };
    case 'К выплате':
      return { status: 'payable', reconciled: true };
    default:
      // «Не начислена» и всё неизвестное: считаем сами, но помечаем
      // как несверённое — кабинет такие суммы показывает как «уточняется».
      return { status: 'accrued', reconciled: false };
  }
}

const isWon = (d) =>
  d.isWon === true || (d.isWon === undefined && typeof d.stageId === 'string' && /(?::|^)WON$/.test(d.stageId));

const isLost = (d) =>
  d.isLost === true || (d.isLost === undefined && typeof d.stageId === 'string' && /(?::|^)LOSE$/.test(d.stageId));

/**
 * Определить, какая сделка закрывает welcome-бонус.
 *
 * Приоритет источников:
 *   1. welcomeDealId из карточки Bitrix — правда о том, что бонус израсходован;
 *   2. флаг isWelcome на самой сделке;
 *   3. первая по дате выигранная сделка.
 *
 * Если дат нет (gateway их пока не отдаёт) и в Bitrix ничего не проставлено —
 * welcome НЕ назначаем. Лучше недоначислить и потом добавить, чем переплатить
 * и забирать назад.
 */
function pickWelcomeDeal(wonDeals, partner) {
  if (partner.welcomeDealId) {
    const byId = wonDeals.find((d) => String(d.id) === String(partner.welcomeDealId));
    if (byId) return { deal: byId, reason: 'bitrix_welcome_deal' };
  }

  const flagged = wonDeals.find((d) => d.isWelcome === true);
  if (flagged) return { deal: flagged, reason: 'deal_flag' };

  // Бонус уже израсходован, но на какой сделке — неизвестно: не назначаем повторно.
  if (partner.welcomeUsed) return { deal: null, reason: 'already_used_unknown_deal' };

  const dated = wonDeals.filter((d) => d.createdAt);
  if (dated.length === 0) return { deal: null, reason: 'no_dates_available' };
  if (dated.length !== wonDeals.length) {
    // Часть сделок без дат — определить «первую» достоверно нельзя.
    return { deal: null, reason: 'incomplete_dates' };
  }

  const first = dated.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  return { deal: first, reason: 'earliest_deal' };
}

/**
 * Собрать строки леджера по одному партнёру.
 *
 * @param {object}   partner  { id, contactId, commWelcome, commBase, payRatio, welcomeUsed, welcomeDealId }
 * @param {object[]} deals    сделки из gateway
 * @param {object}   upline   пригласивший: { id, contactId, payRatio, active } либо null
 * @param {object}   settings значения из таблицы settings
 * @returns {{ rows: object[], welcome: object }}
 */
export function computeLedger({ partner, deals = [], upline = null, settings = {} }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };

  const welcomeRate = Number(partner.commWelcome ?? cfg['commission.welcome_rate']);
  const baseRate = Number(partner.commBase ?? cfg['commission.base_rate']);
  const level2Rate = Number(cfg['commission.level2_rate']);
  const level3On = Boolean(cfg['commission.level3_enabled']);
  const level3Rate = Number(cfg['commission.level3_rate']);
  const partnerRatio = Number(partner.payRatio ?? 1);

  const won = deals.filter((d) => isWon(d) && !isLost(d));
  const welcome = pickWelcomeDeal(won, partner);
  const rows = [];

  for (const deal of won) {
    const isWelcomeDeal = welcome.deal != null && String(deal.id) === String(welcome.deal.id);
    const rate = isWelcomeDeal ? welcomeRate : baseRate;
    const amount = percentOf(deal.amount, rate);
    const { status, reconciled } = mapStatus(deal.commStatus);

    const l1 = {
      key: `${deal.id}:${partner.id}:1`,
      bitrixDealId: deal.id,
      partnerId: partner.id,
      level: 1,
      baseType: 'deal',
      baseAmount: Number(deal.amount || 0),
      rate,
      amount,
      isWelcome: isWelcomeDeal,
      paymentNo: isWelcomeDeal ? 'first' : 'subsequent',
      payRatio: partnerRatio,
      payoutAmount: applyRatio(amount, partnerRatio),
      status,
      reconciled,
      licDate: deal.licDate || null,
      parentKey: null,
    };
    rows.push(l1);

    // Уровень 2: начисляем, пока пригласивший активен.
    if (upline && upline.active !== false && amount > 0) {
      const uplineRatio = Number(upline.payRatio ?? 1);
      const l2Amount = percentOf(amount, level2Rate);
      const l2 = {
        key: `${deal.id}:${upline.id}:2`,
        bitrixDealId: deal.id,
        partnerId: upline.id,
        level: 2,
        baseType: 'commission',
        baseAmount: amount,
        rate: level2Rate,
        amount: l2Amount,
        isWelcome: false,
        paymentNo: l1.paymentNo,
        payRatio: uplineRatio,
        payoutAmount: applyRatio(l2Amount, uplineRatio),
        status,
        reconciled,
        licDate: deal.licDate || null,
        parentKey: l1.key,
      };
      rows.push(l2);

      if (level3On && upline.upline && upline.upline.active !== false) {
        const u3 = upline.upline;
        const r3 = Number(u3.payRatio ?? 1);
        const l3Amount = percentOf(l2Amount, level3Rate);
        rows.push({
          key: `${deal.id}:${u3.id}:3`,
          bitrixDealId: deal.id,
          partnerId: u3.id,
          level: 3,
          baseType: 'commission',
          baseAmount: l2Amount,
          rate: level3Rate,
          amount: l3Amount,
          isWelcome: false,
          paymentNo: l1.paymentNo,
          payRatio: r3,
          payoutAmount: applyRatio(l3Amount, r3),
          status,
          reconciled,
          licDate: deal.licDate || null,
          parentKey: l2.key,
        });
      }
    }
  }

  return { rows, welcome };
}

/** Свод для экрана «Мои комиссии»: считаем только сверенное с Финансистом. */
export function summarize(rows, partnerId) {
  const mine = rows.filter((r) => r.partnerId === partnerId && r.status !== 'cancelled');
  const sum = (f) => toRub(mine.reduce((a, r) => a + (f(r) ? toKop(r.amount) : 0), 0));
  const paid = sum((r) => r.status === 'paid');
  const payable = sum((r) => r.status === 'payable');
  const pending = sum((r) => r.status === 'accrued');
  const payoutPayable = toRub(
    mine.reduce((a, r) => a + (r.status === 'payable' ? toKop(r.payoutAmount) : 0), 0)
  );
  return {
    accrued: toRub(toKop(paid) + toKop(payable)),
    payable,
    paid,
    pending, // рассчитано, но ещё не сверено с Финансистом
    payoutPayable, // сколько реально придёт с учётом способа выплаты
    currency: 'RUB',
  };
}

/**
 * Записать леджер в базу. Идемпотентно: повторный вызов не плодит строки
 * (уникальный ключ сделка × партнёр × уровень), суммы обновляются.
 *
 * Строки по сделкам, которых больше нет среди выигранных, помечаются cancelled;
 * уровень 2 снимается каскадом через parent_commission_id.
 */
export async function syncLedger(client, { partnerId, rows, dealIds }) {
  const idByKey = new Map();

  // Сначала уровень 1 — на него ссылается уровень 2.
  for (const row of [...rows].sort((a, b) => a.level - b.level)) {
    const parentId = row.parentKey ? idByKey.get(row.parentKey) ?? null : null;
    const { rows: out } = await client.query(
      `INSERT INTO commissions
         (bitrix_deal_id, partner_id, level, base_type, base_amount, rate, amount,
          is_welcome, payment_no, pay_ratio, payout_amount, status,
          parent_commission_id, lic_date, reconciled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $15 THEN now() ELSE NULL END)
       ON CONFLICT (bitrix_deal_id, partner_id, level) DO UPDATE SET
         base_amount   = EXCLUDED.base_amount,
         rate          = EXCLUDED.rate,
         amount        = EXCLUDED.amount,
         is_welcome    = EXCLUDED.is_welcome,
         payment_no    = EXCLUDED.payment_no,
         pay_ratio     = EXCLUDED.pay_ratio,
         payout_amount = EXCLUDED.payout_amount,
         status        = EXCLUDED.status,
         lic_date      = EXCLUDED.lic_date,
         reconciled_at = COALESCE(commissions.reconciled_at, EXCLUDED.reconciled_at)
       RETURNING id`,
      [
        row.bitrixDealId, row.partnerId, row.level, row.baseType, row.baseAmount,
        row.rate, row.amount, row.isWelcome, row.paymentNo, row.payRatio,
        row.payoutAmount, row.status, parentId, row.licDate, row.reconciled,
      ]
    );
    idByKey.set(row.key, out[0].id);
  }

  // Сделки, которые перестали быть выигранными → отменяем начисления.
  //
  // Важно: гасим ТОЛЬКО строки уровня 1 этого партнёра. Строки уровня 2
  // принадлежат ему же, но порождены сделками нижних партнёров — при
  // синхронизации его собственных сделок их трогать нельзя, иначе
  // заработок с приглашённых будет обнуляться на каждом прогоне.
  if (Array.isArray(dealIds)) {
    await client.query(
      `UPDATE commissions SET status = 'cancelled'
        WHERE partner_id = $1 AND level = 1 AND status <> 'paid'
          AND NOT (bitrix_deal_id = ANY($2::bigint[]))`,
      [partnerId, dealIds]
    );
    // Снятый уровень 1 тянет за собой свои дочерние строки.
    await client.query(
      `UPDATE commissions child SET status = 'cancelled'
         FROM commissions parent
        WHERE child.parent_commission_id = parent.id
          AND parent.status = 'cancelled'
          AND child.status <> 'paid'`
    );
  }

  return idByKey.size;
}

// ===========================================================================
// Трек «Приложения» (реф-продукты, self-serve)
// ===========================================================================
//
// Услуги считаются от сделок Bitrix (welcome 20% один раз, далее 10%).
// Приложения (Solara и будущие) — клиент платит сам на сайте продукта через
// ЮKassa, сделки в Bitrix нет. Модель: ПЛОСКИЕ 20% с каждой оплаты, без
// welcome; второй уровень 10% от комиссии — как и на услугах.
//
// Один app-платёж порождает строки нескольким партнёрам, как и одна сделка.
// Идемпотентность — по (app_payment_id, partner_id, level).

/**
 * Собрать строки леджера по одной оплате в приложении.
 *
 * @param {object} payment  { id, amount, status }  status: succeeded | refunded
 * @param {object} partner  { id, payRatio, appRate? }  appRate переопределяет ставку
 * @param {object} upline   пригласивший: { id, payRatio, active, upline? } либо null
 * @param {object} settings значения из таблицы settings
 * @returns {{ rows: object[] }}
 */
export function computeAppLedger({ payment, partner, upline = null, settings = {} }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };

  const appRate = Number(partner.appRate ?? cfg['commission.app_rate']);
  const level2Rate = Number(cfg['commission.level2_rate']);
  const level3On = Boolean(cfg['commission.level3_enabled']);
  const level3Rate = Number(cfg['commission.level3_rate']);
  const partnerRatio = Number(partner.payRatio ?? 1);

  const amountBase = Number(payment.amount || 0);
  const rows = [];
  if (!(amountBase > 0)) return { rows };

  // Оплата подтверждена провайдером — это и есть «сверка» для приложений,
  // поэтому строка сразу к выплате. Возврат — отмена начисления.
  const refunded = payment.status === 'refunded';
  const status = refunded ? 'cancelled' : 'payable';
  const reconciled = !refunded;

  const pid = payment.id;
  const l1Amount = percentOf(amountBase, appRate);

  const l1 = {
    key: `app:${pid}:${partner.id}:1`,
    appPaymentId: pid,
    bitrixDealId: null,
    sourceType: 'app_payment',
    productType: 'app',
    partnerId: partner.id,
    level: 1,
    baseType: 'app_payment',
    baseAmount: amountBase,
    rate: appRate,
    amount: l1Amount,
    isWelcome: false,          // у приложений welcome нет
    paymentNo: 'subsequent',
    payRatio: partnerRatio,
    payoutAmount: applyRatio(l1Amount, partnerRatio),
    status,
    reconciled,
    licDate: null,
    parentKey: null,
  };
  rows.push(l1);

  // Второй уровень: 10% от комиссии первого, пока пригласивший активен.
  if (upline && upline.active !== false && l1Amount > 0) {
    const uplineRatio = Number(upline.payRatio ?? 1);
    const l2Amount = percentOf(l1Amount, level2Rate);
    const l2 = {
      key: `app:${pid}:${upline.id}:2`,
      appPaymentId: pid,
      bitrixDealId: null,
      sourceType: 'app_payment',
      productType: 'app',
      partnerId: upline.id,
      level: 2,
      baseType: 'commission',
      baseAmount: l1Amount,
      rate: level2Rate,
      amount: l2Amount,
      isWelcome: false,
      paymentNo: 'subsequent',
      payRatio: uplineRatio,
      payoutAmount: applyRatio(l2Amount, uplineRatio),
      status,
      reconciled,
      licDate: null,
      parentKey: l1.key,
    };
    rows.push(l2);

    if (level3On && upline.upline && upline.upline.active !== false) {
      const u3 = upline.upline;
      const r3 = Number(u3.payRatio ?? 1);
      const l3Amount = percentOf(l2Amount, level3Rate);
      rows.push({
        key: `app:${pid}:${u3.id}:3`,
        appPaymentId: pid,
        bitrixDealId: null,
        sourceType: 'app_payment',
        productType: 'app',
        partnerId: u3.id,
        level: 3,
        baseType: 'commission',
        baseAmount: l2Amount,
        rate: level3Rate,
        amount: l3Amount,
        isWelcome: false,
        paymentNo: 'subsequent',
        payRatio: r3,
        payoutAmount: applyRatio(l3Amount, r3),
        status,
        reconciled,
        licDate: null,
        parentKey: l2.key,
      });
    }
  }

  return { rows };
}

/**
 * Записать app-строки леджера. Идемпотентно по (app_payment_id, partner_id,
 * level): повторный вебхук того же платежа не плодит строки, а возврат
 * (refunded) переводит строки в cancelled — оба уровня пересчитываются разом,
 * каскад не нужен.
 */
export async function syncAppLedger(client, { rows }) {
  const idByKey = new Map();

  for (const row of [...rows].sort((a, b) => a.level - b.level)) {
    const parentId = row.parentKey ? idByKey.get(row.parentKey) ?? null : null;
    const { rows: out } = await client.query(
      `INSERT INTO commissions
         (bitrix_deal_id, app_payment_id, source_type, product_type,
          partner_id, level, base_type, base_amount, rate, amount,
          is_welcome, payment_no, pay_ratio, payout_amount, status,
          parent_commission_id, lic_date, reconciled_at)
       VALUES (NULL,$1,'app_payment','app',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               CASE WHEN $15 THEN now() ELSE NULL END)
       ON CONFLICT (app_payment_id, partner_id, level) DO UPDATE SET
         base_amount   = EXCLUDED.base_amount,
         rate          = EXCLUDED.rate,
         amount        = EXCLUDED.amount,
         payment_no    = EXCLUDED.payment_no,
         pay_ratio     = EXCLUDED.pay_ratio,
         payout_amount = EXCLUDED.payout_amount,
         status        = EXCLUDED.status,
         reconciled_at = COALESCE(commissions.reconciled_at, EXCLUDED.reconciled_at)
       RETURNING id`,
      [
        row.appPaymentId, row.partnerId, row.level, row.baseType, row.baseAmount,
        row.rate, row.amount, row.isWelcome, row.paymentNo, row.payRatio,
        row.payoutAmount, row.status, parentId, row.licDate, row.reconciled,
      ]
    );
    idByKey.set(row.key, out[0].id);
  }

  return idByKey.size;
}
