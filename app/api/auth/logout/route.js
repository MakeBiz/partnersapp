import { pool } from '../../../../lib/db.js';
import { destroySession, sessionTokenFrom, clearSessionCookie } from '../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  await destroySession(pool, sessionTokenFrom(req));
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
