/** Новая ссылка-приглашение (старая просрочилась или потерялась). По желанию письмо. */
import { withTransaction } from '../../../../../../lib/db.js';
import { pool } from '../../../../../../lib/db.js';
import { requireSession, jsonError } from '../../../../../../lib/auth.js';
import { createInvite } from '../../../../../../lib/partners.js';
import { enqueue, JOB_KINDS } from '../../../../../../lib/jobs.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  let me;
  try { me = await requireSession(pool, req, { admin: ['admin', 'assistant'] }); } catch (r) { return r; }
  const id = Number(params.id);
  let body = {};
  try { body = await req.json(); } catch { /* пустое тело — ок */ }

  const res = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, email FROM partners WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const inviteUrl = await createInvite(client, { partnerId: id, email: rows[0].email, adminId: me.id });
    if (body.sendEmail && rows[0].email) {
      await enqueue(client, JOB_KINDS.EMAIL_INVITE, { partnerId: id, payload: { inviteUrl, email: rows[0].email } });
    }
    await client.query(
      `INSERT INTO admin_audit (admin_id, action, target_partner_id) VALUES ($1, 'new_invite', $2)`,
      [me.id, id]
    );
    return { inviteUrl };
  });
  if (!res) return jsonError(404, 'not_found');
  return Response.json({ ok: true, ...res });
}
