/**
 * Задача bitrix.create_partner: контакт партнёра в выбранном портале через gateway.
 * Кабинет в Битрикс напрямую не ходит (правило проекта), только через gateway.
 */
import { createPartnerContact } from '../lib/gateway.js';

export async function handleBitrixPartner(db, job) {
  if (!process.env.GATEWAY_URL || !process.env.GATEWAY_KEY) {
    const e = new Error('gateway не настроен (GATEWAY_URL / GATEWAY_KEY)');
    e.permanent = true;
    throw e;
  }
  const { rows } = await db.query(
    `SELECT p.*, up.bitrix_contact_id AS upline_contact_id, up.bitrix_portal AS upline_portal
       FROM partners p LEFT JOIN partners up ON up.id = p.upline_partner_id
      WHERE p.id = $1`,
    [job.partner_id]
  );
  const p = rows[0];
  if (!p) { const e = new Error('партнёр удалён'); e.permanent = true; throw e; }
  if (p.bitrix_contact_id) return { contactId: Number(p.bitrix_contact_id), dealId: p.bitrix_deal_id ? Number(p.bitrix_deal_id) : null, already: true };

  const portal = job.payload?.portal || p.bitrix_portal;
  const res = await createPartnerContact({
    portal,
    name: p.name,
    phone: p.phone,
    email: p.email,
    telegram: p.telegram_username,
    refcode: p.refcode,
    status: p.status || 'Действующий',
    payer: p.payer,
    payRatio: Number(p.pay_ratio),
    commWelcome: Number(p.comm_welcome),
    commBase: Number(p.comm_base),
    // пригласивший известен порталу, только если он заведён в том же портале
    uplineContactId: p.upline_portal === portal ? p.upline_contact_id : null,
    stage: 'C2:WON',
    source: 'cabinet',
    cabinetPartnerId: Number(p.id),
  });

  await db.query(
    'UPDATE partners SET bitrix_contact_id = $2, bitrix_deal_id = $3 WHERE id = $1',
    [p.id, res.contactId, res.dealId]
  );
  return res;
}
