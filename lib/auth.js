/**
 * Вход в кабинет: пароли, сессии, роли.
 *
 * Два вида пользователей:
 *   admin    — команда MakeBiz (таблица admin_users, роли admin | assistant);
 *   partner  — партнёр (таблица accounts → partners).
 *
 * Пароли: scrypt с солью, строка вида scrypt$N$r$p$salt$hash.
 * Сессии: случайный токен в httpOnly-куке, в базе только его sha256.
 */
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'mb_session';
export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Пароль должен быть не короче 8 символов');
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  let actual;
  try {
    actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** Разобрать заголовок Cookie без зависимостей. */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token, maxAgeSec = SESSION_DAYS * 86400) {
  const secure = process.env.COOKIE_INSECURE === '1' ? '' : '; Secure';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export const clearSessionCookie = () => sessionCookie('', 0);

export async function createSession(client, { type, id, ip = null, userAgent = null }) {
  const token = newToken();
  await client.query(
    `INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6)`,
    [sha256(token), type, id, String(SESSION_DAYS), ip, userAgent]
  );
  return token;
}

export async function destroySession(client, token) {
  if (!token) return;
  await client.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

/**
 * Кто сделал запрос. Возвращает null или
 *   { type: 'admin', id, role, name, login }
 *   { type: 'partner', id, partnerId, name, refcode }
 */
export async function loadSession(client, token) {
  if (!token) return null;
  const { rows } = await client.query(
    `SELECT subject_type, subject_id FROM sessions
      WHERE token_hash = $1 AND expires_at > now()`,
    [sha256(token)]
  );
  const s = rows[0];
  if (!s) return null;

  if (s.subject_type === 'admin') {
    const { rows: a } = await client.query(
      'SELECT id, login, name, role, active FROM admin_users WHERE id = $1',
      [s.subject_id]
    );
    if (!a[0] || !a[0].active) return null;
    return { type: 'admin', id: Number(a[0].id), role: a[0].role, name: a[0].name, login: a[0].login };
  }

  const { rows: p } = await client.query(
    'SELECT id, name, refcode, blocked FROM partners WHERE id = $1',
    [s.subject_id]
  );
  if (!p[0] || p[0].blocked) return null;
  return { type: 'partner', id: Number(p[0].id), partnerId: Number(p[0].id), name: p[0].name, refcode: p[0].refcode };
}

export function sessionTokenFrom(request) {
  return readCookie(request.headers.get('cookie'), SESSION_COOKIE);
}

/** Ответ-ошибка в JSON. */
export const jsonError = (status, error, extra = {}) =>
  Response.json({ error, ...extra }, { status });

/**
 * Проверка доступа в API. Бросает Response, который роут возвращает как есть.
 *   await requireSession(client, req, { admin: ['admin','assistant'] })
 *   await requireSession(client, req, { partner: true })
 */
export async function requireSession(client, request, { admin = null, partner = false } = {}) {
  const session = await loadSession(client, sessionTokenFrom(request));
  if (!session) throw jsonError(401, 'unauthorized');
  if (session.type === 'admin' && admin && admin.includes(session.role)) return session;
  if (session.type === 'partner' && partner) return session;
  throw jsonError(403, 'forbidden');
}

export function clientMeta(request) {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || null,
    userAgent: request.headers.get('user-agent') || null,
  };
}
