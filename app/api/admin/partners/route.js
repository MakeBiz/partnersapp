/**
 * Админка: список партнёров и заведение нового.
 * Доступ: роли admin и assistant.
 */
import { pool, withTransaction } from '../../../../lib/db.js';
import { requireSession, jsonError } from '../../../../lib/auth.js';
import {
  validateNewPartner, createPartner, listPartners, overview, PORTALS, PAYERS,
} from '../../../../lib/partners.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM = ['admin', 'assistant'];

export async function GET(req) {
  let me;
  try { me = await requireSession(pool, req, { admin: TEAM }); } catch (r) { return r; }
  const search = new URL(req.url).searchParams.get('q');
  const [partners, stats] = await Promise.all([listPartners(pool, { search }), overview(pool)]);
  return Response.json({ me, stats, partners, portals: PORTALS, payers: PAYERS });
}

export async function POST(req) {
  let me;
  try { me = await requireSession(pool, req, { admin: TEAM }); } catch (r) { return r; }

  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'bad_json'); }
  const v = validateNewPartner(body);
  if (!v.ok) return jsonError(422, 'validation', { fields: v.errors });

  try {
    const res = await withTransaction((client) =>
      createPartner(client, v.data, { adminId: me.id, force: body.force === true }));
    if (res.duplicates) return jsonError(409, 'duplicate', { duplicates: res.duplicates });
    return Response.json({
      ok: true,
      partner: { id: Number(res.partner.id), name: res.partner.name, refcode: res.partner.refcode },
      inviteUrl: res.inviteUrl,
      jobs: res.jobs.map((j) => j.kind),
    }, { status: 201 });
  } catch (e) {
    if (e.field) return jsonError(422, 'validation', { fields: { [e.field]: e.message } });
    if (e.code === '23505') return jsonError(409, 'duplicate', { detail: e.detail });
    throw e;
  }
}
