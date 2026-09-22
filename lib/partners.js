/**
 * Заведение партнёра из кабинета.
 *
 * Одна операция для ассистентки: проверка на дубль → партнёр в нашей базе →
 * реф-код → аккаунт для входа → приглашение → задачи воркеру (контакт в
 * выбранном Битриксе, группа в Telegram, письмо) → запись в журнал.
 * Всё в одной транзакции: либо заведено целиком, либо ничего.
 */
import { newToken, sha256, INVITE_DAYS } from './auth.js';
import { enqueue, JOB_KINDS, onboardingStatus } from './jobs.js';

export const PORTALS = { main: 'Основной CRM', biryuza: 'Бирюза' };
export const PAYERS = ['Физлицо (карта)', 'Самозанятый', 'ИП', 'Юрлицо'];

const RATIO_BY_PAYER = { 'Физлицо (карта)': 0.8, Самозанятый: 1.0, ИП: 1.0, Юрлицо: 1.0 };

/** Телефон → только цифры, 8XXXXXXXXXX → 7XXXXXXXXXX. */
export function normPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d || null;
}

/** @Ник, t.me/ник, https://t.me/ник → ник. */
export function normTelegram(value) {
  let v = String(value || '').trim();
  if (!v) return null;
  v = v.replace(/^https?:\/\//i, '').replace(/^(t|telegram)\.me\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{4,32}$/.test(v) ? v : undefined; // undefined = неверный формат
}

const TRANSLIT = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'Z', з: 'Z', и: 'I', й: 'Y', к: 'K',
  л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'C',
  ч: 'C', ш: 'S', щ: 'S', ы: 'Y', э: 'E', ю: 'U', я: 'Y',
};

/** Инициалы латиницей: «Игорь Соколов» → «ISOK», одно слово → первые 4 буквы. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const lat = (w) => [...w.toLowerCase()].map((c) => TRANSLIT[c] ?? (/[a-z]/.test(c) ? c.toUpperCase() : '')).join('');
  if (words.length >= 2) return (lat(words[0]).slice(0, 1) + lat(words[1]).slice(0, 3)).padEnd(4, 'X');
  return (lat(words[0] || '') || 'MKB').slice(0, 4).padEnd(4, 'X');
}

/** Реф-код формата MKB-ISOK-4213. random — для тестов. */
export function makeRefcode(name, random = Math.random) {
  const n = String(Math.floor(random() * 9000) + 1000);
  return `MKB-${initials(name)}-${n}`;
}

/** Проверка анкеты из формы. */
export function validateNewPartner(input = {}) {
  const errors = {};
  const name = String(input.name || '').trim();
  if (name.length < 2) errors.name = 'Укажите имя партнёра';

  const phone = String(input.phone || '').trim() || null;
  const phoneNorm = normPhone(phone);
  if (phone && (!phoneNorm || phoneNorm.length < 10)) errors.phone = 'Неверный телефон';

  const email = String(input.email || '').trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Неверная почта';

  const tg = normTelegram(input.telegram);
  if (tg === undefined) errors.telegram = 'Ник в Telegram: 4–32 символа, латиница, цифры, _';

  if (!phoneNorm && !email && !tg) errors.contact = 'Нужен хотя бы один контакт: телефон, почта или Telegram';

  const portal = input.portal || 'main';
  if (!PORTALS[portal]) errors.portal = 'Выберите портал';

  const payer = input.payer || 'Физлицо (карта)';
  if (!PAYERS.includes(payer)) errors.payer = 'Выберите форму выплаты';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: {
      name, phone, phoneNorm, email, telegram: tg || null, portal, payer,
      payRatio: RATIO_BY_PAYER[payer],
      uplineRefcode: String(input.uplineRefcode || '').trim().toUpperCase() || null,
      createChat: input.createChat !== false,
      sendEmail: input.sendEmail !== false,
      note: String(input.note || '').trim() || null,
    },
  };
}

/** Уже есть такой партнёр? Совпадение по телефону, почте или Telegram. */
export async function findDuplicates(client, { phoneNorm, email, telegram }) {
  const { rows } = await client.query(
    `SELECT id, name, refcode, phone, email, telegram_username
       FROM partners
      WHERE ($1::text IS NOT NULL AND phone_norm = $1)
         OR ($2::text IS NOT NULL AND lower(email) = $2)
         OR ($3::text IS NOT NULL AND lower(telegram_username) = lower($3))
      LIMIT 5`,
    [phoneNorm, email, telegram]
  );
  return rows;
}

async function uniqueRefcode(client, name) {
  for (let i = 0; i < 20; i++) {
    const code = makeRefcode(name);
    const { rowCount } = await client.query('SELECT 1 FROM partners WHERE refcode = $1', [code]);
    if (!rowCount) return code;
  }
  throw new Error('Не удалось подобрать уникальный реф-код');
}

export function appUrl() {
  return (process.env.APP_URL || 'https://partners.makebiztehnologies.com').replace(/\/+$/, '');
}

/** Новое приглашение: токен в открытом виде уходит только в ссылку. */
export async function createInvite(client, { partnerId, email, adminId }) {
  const token = newToken();
  await client.query(
    `INSERT INTO invites (partner_id, token_hash, email, created_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
    [partnerId, sha256(token), email, adminId, String(INVITE_DAYS)]
  );
  return `${appUrl()}/invite/${token}`;
}

/**
 * Завести партнёра. client должен быть внутри транзакции.
 * @returns {{ partner, inviteUrl, jobs }} либо { duplicates } если нашёлся дубль и force не задан
 */
export async function createPartner(client, data, { adminId = null, force = false } = {}) {
  if (!force) {
    const duplicates = await findDuplicates(client, data);
    if (duplicates.length) return { duplicates };
  }

  let upline = null;
  if (data.uplineRefcode) {
    const { rows } = await client.query(
      'SELECT id, name, refcode FROM partners WHERE refcode = $1',
      [data.uplineRefcode]
    );
    upline = rows[0] || null;
    if (!upline) {
      const e = new Error('Пригласивший с таким реф-кодом не найден');
      e.field = 'uplineRefcode';
      throw e;
    }
  }

  const refcode = await uniqueRefcode(client, data.name);
  const { rows } = await client.query(
    `INSERT INTO partners
       (name, phone, phone_norm, email, telegram_username, bitrix_portal, refcode,
        status, payer, pay_ratio, upline_partner_id, created_by_admin, note, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Действующий',$8,$9,$10,$11,$12, now())
     RETURNING *`,
    [data.name, data.phone, data.phoneNorm, data.email, data.telegram, data.portal, refcode,
     data.payer, data.payRatio, upline?.id ?? null, adminId, data.note]
  );
  const partner = rows[0];

  // Аккаунт для входа: почта и Telegram; пароль партнёр задаст сам по приглашению
  await client.query(
    `INSERT INTO accounts (partner_id, email, login) VALUES ($1, $2, $3)`,
    [partner.id, data.email, data.email || refcode.toLowerCase()]
  );

  const inviteUrl = await createInvite(client, { partnerId: partner.id, email: data.email, adminId });

  const jobs = [];
  jobs.push(await enqueue(client, JOB_KINDS.BITRIX_PARTNER, {
    partnerId: partner.id,
    payload: { portal: data.portal },
  }));
  if (data.createChat) {
    jobs.push(await enqueue(client, JOB_KINDS.TG_GROUP, {
      partnerId: partner.id,
      payload: { inviteUrl },
    }));
  }
  if (data.email && data.sendEmail) {
    jobs.push(await enqueue(client, JOB_KINDS.EMAIL_INVITE, {
      partnerId: partner.id,
      payload: { inviteUrl, email: data.email },
    }));
  }

  await client.query(
    `INSERT INTO admin_audit (admin_id, action, target_partner_id, payload)
     VALUES ($1, 'create_partner', $2, $3::jsonb)`,
    [adminId, partner.id, JSON.stringify({ portal: data.portal, refcode, upline: upline?.refcode ?? null })]
  );

  return { partner, inviteUrl, jobs, upline };
}

/** Список для админки со статусом заведения и короткой статистикой. */
export async function listPartners(client, { search = null } = {}) {
  const { rows: partners } = await client.query(
    `SELECT p.id, p.name, p.phone, p.email, p.telegram_username, p.refcode, p.bitrix_portal,
            p.bitrix_contact_id, p.telegram_chat_id, p.telegram_invite, p.status, p.tier,
            p.payer, p.blocked, p.created_at,
            up.name AS upline_name, up.refcode AS upline_refcode,
            EXISTS (SELECT 1 FROM invites i WHERE i.partner_id = p.id AND i.used_at IS NOT NULL) AS invite_used,
            (SELECT count(*)::int FROM leads l WHERE l.partner_id = p.id) AS leads,
            (SELECT count(DISTINCT c.bitrix_deal_id)::int FROM commissions c
              WHERE c.partner_id = p.id AND c.level = 1 AND c.status <> 'cancelled') AS deals,
            (SELECT COALESCE(sum(c.amount), 0)::float8 FROM commissions c
              WHERE c.partner_id = p.id AND c.status IN ('payable', 'paid')) AS earned
       FROM partners p
       LEFT JOIN partners up ON up.id = p.upline_partner_id
      WHERE ($1::text IS NULL
             OR p.name ILIKE '%' || $1 || '%' OR p.refcode ILIKE '%' || $1 || '%'
             OR p.email ILIKE '%' || $1 || '%' OR p.telegram_username ILIKE '%' || $1 || '%'
             OR p.phone_norm LIKE '%' || regexp_replace($1, '\\D', '', 'g') || '%')
      ORDER BY p.created_at DESC
      LIMIT 500`,
    [search || null]
  );
  if (!partners.length) return [];

  const ids = partners.map((p) => p.id);
  const { rows: jobs } = await client.query(
    `SELECT id, kind, partner_id, status, attempts, last_error, result
       FROM jobs WHERE partner_id = ANY($1::bigint[])`,
    [ids]
  );
  const byPartner = new Map();
  for (const j of jobs) {
    const k = String(j.partner_id);
    if (!byPartner.has(k)) byPartner.set(k, []);
    byPartner.get(k).push(j);
  }
  return partners.map((p) => ({
    ...p,
    id: Number(p.id),
    onboarding: onboardingStatus(byPartner.get(String(p.id)) || [], {
      inviteUsed: p.invite_used,
      hasEmail: Boolean(p.email),
    }),
  }));
}

/** Сводные цифры для верхних карточек админки. */
export async function overview(client) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*)::int FROM partners WHERE NOT blocked) AS partners,
       (SELECT count(*)::int FROM partners WHERE created_at > now() - interval '30 days') AS new_30d,
       (SELECT count(DISTINCT partner_id)::int FROM leads WHERE created_at > now() - interval '90 days') AS active_90d,
       (SELECT count(DISTINCT partner_id)::int FROM commissions
         WHERE level = 1 AND status <> 'cancelled' AND created_at > now() - interval '90 days') AS productive_90d,
       (SELECT COALESCE(sum(amount), 0)::float8 FROM commissions WHERE status = 'payable') AS payable,
       (SELECT count(*)::int FROM jobs WHERE status = 'failed') AS failed_jobs`
  );
  return rows[0];
}
