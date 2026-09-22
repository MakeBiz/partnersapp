/** Вход по логину/почте и паролю: сначала команда (admin_users), потом партнёры (accounts). */
import { pool } from '../../../../lib/db.js';
import { verifyPassword, createSession, sessionCookie, clientMeta, jsonError } from '../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pause = () => new Promise((r) => setTimeout(r, 400));

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'bad_json'); }
  const login = String(body.login || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!login || !password) return jsonError(400, 'missing_credentials');
  const meta = clientMeta(req);

  const { rows: admins } = await pool.query(
    `SELECT id, password_hash, active FROM admin_users
      WHERE lower(login) = $1 OR lower(email) = $1 LIMIT 1`,
    [login]
  );
  const a = admins[0];
  if (a && a.active && verifyPassword(password, a.password_hash)) {
    const token = await createSession(pool, { type: 'admin', id: a.id, ...meta });
    return Response.json({ ok: true, type: 'admin', redirect: '/admin' },
      { headers: { 'Set-Cookie': sessionCookie(token) } });
  }

  const { rows: accs } = await pool.query(
    `SELECT a.id, a.partner_id, a.password_hash, p.blocked
       FROM accounts a JOIN partners p ON p.id = a.partner_id
      WHERE (lower(a.email) = $1 OR lower(a.login) = $1) AND a.password_hash IS NOT NULL
      LIMIT 1`,
    [login]
  );
  const p = accs[0];
  if (p && !p.blocked && verifyPassword(password, p.password_hash)) {
    await pool.query('UPDATE accounts SET last_login = now() WHERE id = $1', [p.id]);
    const token = await createSession(pool, { type: 'partner', id: p.partner_id, ...meta });
    return Response.json({ ok: true, type: 'partner', redirect: '/' },
      { headers: { 'Set-Cookie': sessionCookie(token) } });
  }

  await pause();
  return jsonError(401, 'invalid_credentials');
}
