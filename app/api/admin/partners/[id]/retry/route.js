/** Кнопка «Повторить»: упавшие задачи заведения снова в очередь. */
import { pool } from '../../../../../../lib/db.js';
import { requireSession } from '../../../../../../lib/auth.js';
import { retryPartnerJobs } from '../../../../../../lib/jobs.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  let me;
  try { me = await requireSession(pool, req, { admin: ['admin', 'assistant'] }); } catch (r) { return r; }
  const id = Number(params.id);
  const n = await retryPartnerJobs(pool, id);
  await pool.query(
    `INSERT INTO admin_audit (admin_id, action, target_partner_id, payload) VALUES ($1, 'retry_jobs', $2, $3::jsonb)`,
    [me.id, id, JSON.stringify({ requeued: n })]
  );
  return Response.json({ ok: true, requeued: n });
}
