import { pool } from '../../../../lib/db.js';
import { loadSession, sessionTokenFrom } from '../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const session = await loadSession(pool, sessionTokenFrom(req));
  return Response.json({ session });
}
