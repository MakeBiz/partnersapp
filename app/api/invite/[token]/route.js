/**
 * Приглашение в кабинет: партнёр открывает ссылку и сам задаёт пароль.
 * GET  — проверить ссылку (имя, почта)
 * POST — { password } → пароль сохранён, ссылка погашена, сразу вход
 */
import { pool, withTransaction } from '../../../../lib/db.js';
import {
  sha256, hashPassword, createSession, sessionCookie, clientMeta, jsonError,
} from '../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function findInvite(client, token, lock = false) {
  const { rows } = await client.query(
    `SELECT i.id, i.partner_id, i.email, i.expires_at, i.used_at, p.name, p.refcode
       FROM invites i JOIN partners p ON p.id = i.partner_id
      WHERE i.token_hash = $1 ${lock ? 'FOR UPDATE OF i' : ''}`,
    [sha256(token)]
  );
  return rows[0] || null;
}

const state = (inv) => (!inv ? 'not_found'
  : inv.used_at ? 'used'
    : new Date(inv.expires_at) < new Date() ? 'expired' : 'ok');

export async function GET(_req, { params }) {
  const inv = await findInvite(pool, params.token);
  const s = state(inv);
  if (s !== 'ok') return jsonError(410, s);
  return Response.json({ name: inv.name, email: inv.email, refcode: inv.refcode });
}

export async function POST(req, { params }) {
  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'bad_json'); }
  const password = String(body.password || '');
  if (password.length < 8) return jsonError(422, 'weak_password');

  try {
    const token = await withTransaction(async (client) => {
      const inv = await findInvite(client, params.token, true);
      const s = state(inv);
      if (s !== 'ok') throw jsonError(410, s);

      const hash = hashPassword(password);
      const upd = await client.query(
        'UPDATE accounts SET password_hash = $2 WHERE partner_id = $1',
        [inv.partner_id, hash]
      );
      if (!upd.rowCount) {
        await client.query(
          'INSERT INTO accounts (partner_id, email, login, password_hash) VALUES ($1, $2, $2, $3)',
          [inv.partner_id, inv.email, hash]
        );
      }
      await client.query('UPDATE invites SET used_at = now() WHERE id = $1', [inv.id]);
      return createSession(client, { type: 'partner', id: inv.partner_id, ...clientMeta(req) });
    });
    return Response.json({ ok: true, redirect: '/' }, { headers: { 'Set-Cookie': sessionCookie(token) } });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
