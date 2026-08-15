/**
 * Клиент партнёрского API на gateway (agw.makebiztehnologies.com).
 *
 * Кабинет НИКОГДА не ходит в Bitrix напрямую — только через эти ручки.
 * Ключ живёт в env (GATEWAY_KEY) и на клиент не попадает: вызовы делаются
 * только из серверных роутов.
 *
 * Слой отвечает ещё за одно: приводит ответы gateway к тому виду, который
 * ждёт расчёт начислений. Часть полей gateway пока не отдаёт — здесь же
 * лежат безопасные подстановки, чтобы кабинет работал уже сейчас.
 */

export class GatewayError extends Error {
  constructor(message, { status = 0, code = 'gateway_error' } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

function config(overrides = {}) {
  const baseUrl = overrides.baseUrl ?? process.env.GATEWAY_URL;
  const key = overrides.key ?? process.env.GATEWAY_KEY;
  if (!baseUrl) throw new GatewayError('Не задан GATEWAY_URL', { code: 'not_configured' });
  if (!key) throw new GatewayError('Не задан GATEWAY_KEY', { code: 'not_configured' });
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    key,
    timeout: overrides.timeout ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
  };
}

async function request(path, { method = 'GET', body, ...opts } = {}) {
  const cfg = config(opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);

  let res;
  try {
    res = await cfg.fetchImpl(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GatewayError('Gateway не ответил вовремя', { code: 'timeout' });
    }
    throw new GatewayError(`Сеть недоступна: ${err.message}`, { code: 'network' });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new GatewayError('Gateway вернул не JSON', { status: res.status, code: 'bad_response' });
  }

  if (!res.ok) {
    const code = data?.error || (res.status === 401 ? 'unauthorized' : 'http_error');
    throw new GatewayError(`Gateway ответил ${res.status}`, { status: res.status, code });
  }
  return data;
}

// --- коэффициент выплаты, пока gateway не отдаёт payRatio ---
const RATIO_BY_PAYER = {
  'Физлицо (карта)': 0.8,
  Физлицо: 0.8,
  ИП: 1.0,
  Юрлицо: 1.0,
  Самозанятый: 1.0, // предварительно, Антон не подтверждал
};

export function payRatioFor(payer, explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit);
  if (payer && RATIO_BY_PAYER[payer] !== undefined) return RATIO_BY_PAYER[payer];
  return 1.0; // без данных не удерживаем — недоудержать безопаснее, чем удержать лишнее
}

/**
 * Профиль gateway → форма, понятная расчёту начислений.
 * gateway отдаёт comm1/comm2; для нас это ставка welcome и базовая ставка.
 */
export function mapProfile(raw) {
  return {
    contactId: raw.contactId,
    name: raw.name ?? null,
    telegramId: raw.telegramId ?? null,
    status: raw.status ?? null,
    tier: raw.tier ?? null,
    score: raw.score ?? null,
    refcode: raw.refcode ?? null,
    email: raw.email ?? null,
    commWelcome: Number(raw.comm1 ?? 20),
    commBase: Number(raw.comm2 ?? 10),
    welcomeUsed: raw.welcomeUsed ?? null,
    welcomeDealId: raw.welcomeDealId ?? null,
    uplineContactId: raw.uplineContactId ?? null,
    payer: raw.payer ?? null,
    payRatio: payRatioFor(raw.payer, raw.payRatio),
    requisitesMasked: raw.requisitesMasked ?? null,
    contractUrl: raw.contractUrl ?? null,
    currency: raw.currency ?? 'RUB',
    // gateway пока не отдаёт признак доступа — считаем разрешённым,
    // пока он не появится (гейт C2:WON стоит на стороне gateway).
    access: raw.access ?? 'ok',
  };
}

const WON_RE = /(?::|^)WON$/;
const LOSE_RE = /(?::|^)LOSE$/;

/** Сделка gateway → форма для расчёта. */
export function mapDeal(raw) {
  const stageId = raw.stageId ?? null;
  return {
    id: raw.id,
    client: raw.client ?? null,
    product: raw.product ?? null,
    amount: Number(raw.amount ?? 0),
    currency: raw.currency ?? 'RUB',
    stageId,
    stageName: raw.stageName ?? null,
    isWon: raw.isWon ?? (stageId ? WON_RE.test(stageId) : false),
    isLost: raw.isLost ?? (stageId ? LOSE_RE.test(stageId) : false),
    createdAt: raw.createdAt ?? null, // пока не отдаётся — welcome не назначается
    isWelcome: raw.isWelcome ?? undefined,
    fromPartner: raw.fromPartner ?? null,
    commSum: raw.commSum ?? null,
    commStatus: raw.commStatus ?? null,
    licDate: raw.licDate ?? null,
  };
}

// --- ручки ---

/** Привязка кабинета к партнёру по одноразовому коду. */
export async function claimVerify(code, opts = {}) {
  return request('/partner/claim/verify', { method: 'POST', body: { code }, ...opts });
}

export async function getProfile(contactId, opts = {}) {
  const raw = await request(`/partner/${encodeURIComponent(contactId)}/profile`, opts);
  return mapProfile(raw);
}

export async function getDeals(contactId, opts = {}) {
  const raw = await request(`/partner/${encodeURIComponent(contactId)}/deals`, opts);
  return (Array.isArray(raw) ? raw : []).map(mapDeal);
}

/**
 * Владелец реф-кода и его доступ — для атрибуции реф-ссылок и оплат приложений.
 * gateway ищет партнёра по refcode (§4.1 /partner/resolve).
 */
export async function resolveByRefcode(refcode, opts = {}) {
  const raw = await request(`/partner/resolve?refcode=${encodeURIComponent(refcode)}`, opts);
  return {
    contactId: raw.contactId ?? null,
    name: raw.name ?? null,
    access: raw.access ?? 'ok',
    refcode: raw.refcode ?? refcode,
    telegramId: raw.telegramId ?? null,
  };
}

/** Есть ли доступ в кабинет. Гейт C2:WON и блокировка — на стороне gateway. */
export function checkAccess(profile) {
  if (profile.access === 'blocked') return { allowed: false, reason: 'blocked' };
  if (profile.access === 'no_access') return { allowed: false, reason: 'no_access' };
  return { allowed: true };
}
