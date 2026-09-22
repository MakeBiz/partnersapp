/** Карточка партнёра для админки: анкета, задачи заведения, приглашения, журнал. */
import { pool } from '../../../../../lib/db.js';
import { requireSession, jsonError } from '../../../../../lib/auth.js';
import { onboardingStatus } from '../../../../../lib/jobs.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try { await requireSession(pool, req, { admin: ['admin', 'assistant'] }); } catch (r) { return r; }
  const id = Number(params.id);
  const { rows } = await pool.query(
    `SELECT p.*, up.name AS upline_name, up.refcode AS upline_refcode
       FROM partners p LEFT JOIN partners up ON up.id = p.upline_partner_id
      WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) return jsonError(404, 'not_found');
  const [jobs, invites, audit] = await Promise.all([
    pool.query(`SELECT id, kind, status, attempts, last_error, result, created_at, updated_at
                  FROM jobs WHERE partner_id = $1 ORDER BY id`, [id]),
    pool.query(`SELECT id, email, created_at, expires_at, used_at
                  FROM invites WHERE partner_id = $1 ORDER BY id DESC`, [id]),
    pool.query(`SELECT a.action, a.payload, a.created_at, u.name AS admin_name
                  FROM admin_audit a LEFT JOIN admin_users u ON u.id = a.admin_id
                 WHERE a.target_partner_id = $1 ORDER BY a.id DESC LIMIT 50`, [id]),
  ]);
  const p = rows[0];
  return Response.json({
    partner: p,
    onboarding: onboardingStatus(jobs.rows, {
      inviteUsed: invites.rows.some((i) => i.used_at), hasEmail: Boolean(p.email),
    }),
    jobs: jobs.rows,
    invites: invites.rows,
    audit: audit.rows,
  });
}
