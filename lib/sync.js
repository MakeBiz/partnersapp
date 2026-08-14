/**
 * Синхронизация партнёра: gateway → база кабинета.
 *
 * Что делает:
 *   1. читает профиль и сделки из gateway;
 *   2. заводит или обновляет строку партнёра (и, если известен, пригласившего);
 *   3. пересчитывает леджер начислений и пишет его идемпотентно.
 *
 * Правда о деньгах и карточке остаётся в Bitrix — здесь только зеркало
 * и производные начисления.
 */
import { getProfile, getDeals } from './gateway.js';
import { computeLedger, syncLedger } from './commissions.js';

// db.js подтягивается лениво: когда настройки передают снаружи (тесты,
// пакетная синхронизация), драйвер базы этому модулю не нужен.
async function loadSettings() {
  const { getSettings } = await import('./db.js');
  return getSettings();
}

/** Завести или обновить партнёра по данным профиля. Возвращает строку из базы. */
export async function upsertPartner(client, profile, { uplinePartnerId = null } = {}) {
  const refcode = profile.refcode || `TMP-${profile.contactId}`; // refcode обязателен в схеме
  const { rows } = await client.query(
    `INSERT INTO partners
       (bitrix_contact_id, refcode, status, tier, points, comm_welcome, comm_base,
        welcome_used, welcome_deal_id, payer, pay_ratio, upline_partner_id)
     -- tier NOT NULL: gateway пока присылает null и перебил бы дефолт схемы
     VALUES ($1,$2,$3,COALESCE($4,'Сильвер'),0,$5,$6,COALESCE($7,false),$8,$9,$10,$11)
     ON CONFLICT (bitrix_contact_id) DO UPDATE SET
       status          = EXCLUDED.status,
       tier            = COALESCE(EXCLUDED.tier, partners.tier),
       comm_welcome    = EXCLUDED.comm_welcome,
       comm_base       = EXCLUDED.comm_base,
       welcome_used    = EXCLUDED.welcome_used,
       welcome_deal_id = COALESCE(EXCLUDED.welcome_deal_id, partners.welcome_deal_id),
       payer           = COALESCE(EXCLUDED.payer, partners.payer),
       pay_ratio       = EXCLUDED.pay_ratio,
       -- реф-код и пригласившего не перетираем пустыми значениями
       refcode         = CASE WHEN EXCLUDED.refcode LIKE 'TMP-%' THEN partners.refcode
                              ELSE EXCLUDED.refcode END,
       upline_partner_id = COALESCE(EXCLUDED.upline_partner_id, partners.upline_partner_id)
     RETURNING *`,
    [
      profile.contactId, refcode, profile.status, profile.tier,
      profile.commWelcome, profile.commBase,
      profile.welcomeUsed, profile.welcomeDealId,
      profile.payer, profile.payRatio, uplinePartnerId,
    ]
  );
  return rows[0];
}

/** Найти партнёра по контакту Bitrix. */
export async function findPartnerByContact(client, contactId) {
  const { rows } = await client.query(
    'SELECT * FROM partners WHERE bitrix_contact_id = $1',
    [contactId]
  );
  return rows[0] || null;
}

/**
 * Убедиться, что пригласивший заведён. Если его ещё нет в базе — создаём
 * минимальную заготовку: без неё не построить второй уровень.
 */
async function ensureUpline(client, uplineContactId) {
  if (!uplineContactId) return null;
  const existing = await findPartnerByContact(client, uplineContactId);
  if (existing) return existing;

  try {
    const profile = await getProfile(uplineContactId);
    return await upsertPartner(client, profile);
  } catch {
    // Профиль пригласившего недоступен — заводим заглушку, чтобы дерево
    // не потерялось; данные подтянутся при его собственной синхронизации.
    const { rows } = await client.query(
      `INSERT INTO partners (bitrix_contact_id, refcode)
       VALUES ($1, $2)
       ON CONFLICT (bitrix_contact_id) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [uplineContactId, `TMP-${uplineContactId}`]
    );
    return rows[0];
  }
}

/**
 * Полная синхронизация одного партнёра.
 *
 * @returns {{ partner, deals, ledgerRows, welcome }}
 */
export async function syncPartner(client, contactId, opts = {}) {
  const profile = opts.profile ?? (await getProfile(contactId));
  const deals = opts.deals ?? (await getDeals(contactId));

  const upline = await ensureUpline(client, profile.uplineContactId);
  const partner = await upsertPartner(client, profile, { uplinePartnerId: upline?.id ?? null });

  const settings = opts.settings ?? (await loadSettings());

  const { rows, welcome } = computeLedger({
    partner: {
      id: partner.id,
      commWelcome: Number(partner.comm_welcome),
      commBase: Number(partner.comm_base),
      payRatio: Number(partner.pay_ratio),
      welcomeUsed: partner.welcome_used,
      welcomeDealId: partner.welcome_deal_id,
    },
    deals,
    upline: upline
      ? {
          id: upline.id,
          payRatio: Number(upline.pay_ratio),
          active: upline.blocked !== true && upline.status !== 'Отказ',
        }
      : null,
    settings,
  });

  await syncLedger(client, {
    partnerId: partner.id,
    rows,
    dealIds: deals.filter((d) => d.isWon && !d.isLost).map((d) => d.id),
  });

  return { partner, deals, ledgerRows: rows, welcome };
}
