#!/usr/bin/env node
/**
 * Наполнение базы демонстрационными данными.
 *
 *   node db/seed_demo.mjs           — залить демо
 *   node db/seed_demo.mjs --reset   — сначала очистить демо-данные
 *
 * Начисления считаются настоящим кодом из lib/commissions.js, поэтому
 * демо всегда согласовано с боевой логикой: welcome один раз, второй
 * уровень от комиссии, коэффициент выплаты у получателя.
 *
 * ВНИМАНИЕ: скрипт для демо-контура. На боевой базе с реальными
 * партнёрами не запускать.
 */
import pg from 'pg';
import { computeLedger, syncLedger, summarize } from '../lib/commissions.js';
import {
  partners, dealsByPartner, leads, training, withdrawals,
  exchange, adminUsers, POINTS,
} from './demo/dataset.mjs';

const CONTACT_IDS = partners.map((p) => p.contactId);

function sslConfig() {
  if (process.env.DB_SSL === 'off') return false;
  if (process.env.DB_CA_CERT) return { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

const fmt = (n) => Number(n).toLocaleString('ru-RU') + ' ₽';
const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);

async function reset(c) {
  const { rows } = await c.query('SELECT id FROM partners WHERE bitrix_contact_id = ANY($1::bigint[])', [CONTACT_IDS]);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await c.query('DELETE FROM commissions WHERE partner_id = ANY($1::bigint[])', [ids]);
    await c.query('DELETE FROM leads WHERE partner_id = ANY($1::bigint[])', [ids]);
    await c.query('DELETE FROM points_log WHERE partner_id = ANY($1::bigint[])', [ids]);
    await c.query('DELETE FROM training_progress WHERE partner_id = ANY($1::bigint[])', [ids]);
    await c.query('DELETE FROM withdrawals WHERE partner_id = ANY($1::bigint[])', [ids]);
    await c.query('UPDATE lead_exchange SET assigned_partner_id = NULL WHERE assigned_partner_id = ANY($1::bigint[])', [ids]);
    await c.query('UPDATE partners SET upline_partner_id = NULL WHERE id = ANY($1::bigint[])', [ids]);
    await c.query('DELETE FROM partners WHERE id = ANY($1::bigint[])', [ids]);
  }
  await c.query('DELETE FROM lead_exchange');
  console.log('демо-данные очищены');
}

async function seed(c) {
  const settings = Object.fromEntries((await c.query('SELECT key, value FROM settings')).rows.map((r) => [r.key, r.value]));
  const idByContact = new Map();

  // 1. Партнёры — по порядку, чтобы пригласивший уже существовал
  for (const p of partners) {
    const uplineId = p.upline ? idByContact.get(p.upline) : null;
    const { rows } = await c.query(
      `INSERT INTO partners (bitrix_contact_id, refcode, status, tier, payer, pay_ratio,
                             upline_partner_id, activated_at, comm_welcome, comm_base)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - interval '6 months', 20, 10)
       ON CONFLICT (bitrix_contact_id) DO UPDATE SET
         refcode = EXCLUDED.refcode, status = EXCLUDED.status, tier = EXCLUDED.tier,
         payer = EXCLUDED.payer, pay_ratio = EXCLUDED.pay_ratio,
         upline_partner_id = EXCLUDED.upline_partner_id
       RETURNING id`,
      [p.contactId, p.refcode, p.status, p.tier, p.payer, p.payRatio, uplineId]
    );
    idByContact.set(p.contactId, rows[0].id);

    await c.query(
      `INSERT INTO accounts (partner_id, telegram_id, email, email_verified)
       VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`,
      [rows[0].id, p.telegramId, `${p.refcode.toLowerCase()}@example.com`]
    );
  }
  console.log(`партнёров: ${partners.length}`);

  // 2. Начисления — настоящим расчётом
  for (const p of partners) {
    const id = idByContact.get(p.contactId);
    const deals = dealsByPartner[p.contactId] || [];
    const uplineId = p.upline ? idByContact.get(p.upline) : null;
    const uplineDef = partners.find((x) => x.contactId === p.upline);

    const { rows } = computeLedger({
      partner: { id, commWelcome: 20, commBase: 10, payRatio: p.payRatio },
      deals,
      upline: uplineId ? { id: uplineId, payRatio: uplineDef.payRatio, active: true } : null,
      settings,
    });
    await syncLedger(c, { partnerId: id, rows, dealIds: deals.filter((d) => d.isWon).map((d) => d.id) });
  }
  const ledgerCount = (await c.query('SELECT count(*)::int n FROM commissions')).rows[0].n;
  console.log(`строк леджера: ${ledgerCount}`);

  // 3. Лиды
  for (const l of leads) {
    await c.query(
      `INSERT INTO leads (partner_id, client_name, phone, phone_norm, product_slug, status,
                          dup_review, comment, lock_until, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, $9::date + 60, $9::date)`,
      [idByContact.get(l.contactId), l.clientName, l.phone, l.phone.replace(/\D/g, ''),
       l.product, l.status, l.dupReview, l.comment || null, daysAgo(l.daysAgo)]
    );
  }
  console.log(`лидов: ${leads.length}`);

  // 4. Обучение
  let trainingCount = 0;
  for (const [contactId, slugs] of Object.entries(training)) {
    for (const slug of slugs) {
      await c.query(
        `INSERT INTO training_progress (partner_id, product_slug, watched_at, certified_at)
         VALUES ($1,$2, now() - interval '30 days', now() - interval '30 days')
         ON CONFLICT DO NOTHING`,
        [idByContact.get(Number(contactId)), slug]
      );
      trainingCount++;
    }
  }
  console.log(`пройдено курсов: ${trainingCount}`);

  // 5. Выплаты
  for (const w of withdrawals) {
    const p = partners.find((x) => x.contactId === w.contactId);
    await c.query(
      `INSERT INTO withdrawals (partner_id, amount, payout_amount, pay_ratio, status, requested_at, processed_at)
       VALUES ($1,$2,$3,$4,$5, $6::date, CASE WHEN $5 = 'Выплачено' THEN $6::date + 2 ELSE NULL END)`,
      [idByContact.get(w.contactId), w.amount, Math.round(w.amount * p.payRatio), p.payRatio, w.status, daysAgo(w.daysAgo)]
    );
  }
  console.log(`выплат: ${withdrawals.length}`);

  // 6. Биржа лидов
  for (const e of exchange) {
    await c.query(
      `INSERT INTO lead_exchange (title, description, product_slug, region, status, assigned_partner_id, assigned_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 = 'assigned' THEN now() ELSE NULL END)`,
      [e.title, e.description, e.product, e.region, e.status, e.assignedTo ? idByContact.get(e.assignedTo) : null]
    );
  }
  console.log(`заявок на бирже: ${exchange.length}`);

  // 7. Баллы — начисляем по фактическим действиям
  for (const p of partners) {
    const id = idByContact.get(p.contactId);
    const events = [];
    const wonDeals = (dealsByPartner[p.contactId] || []).filter((d) => d.isWon);
    wonDeals.forEach((d) => events.push(['deal_won', POINTS.deal_won, 'deal', String(d.id)]));
    leads.filter((l) => l.contactId === p.contactId)
      .forEach((l) => events.push(['lead_created', POINTS.lead_created, 'lead', l.clientName]));
    (training[p.contactId] || [])
      .forEach((s) => events.push(['training_done', POINTS.training_done, 'product', s]));
    partners.filter((x) => x.upline === p.contactId)
      .forEach((x) => events.push(['partner_activated', POINTS.partner_activated, 'partner', String(x.contactId)]));

    for (const [action, pts, refType, refId] of events) {
      await c.query(
        `INSERT INTO points_log (partner_id, action, points, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5)`,
        [id, action, pts, refType, refId]
      );
    }
    const total = events.reduce((a, e) => a + e[1], 0);
    const tier = total >= Number(settings['tier.platinum_from'] ?? 600) ? 'Платина'
      : total >= Number(settings['tier.gold_from'] ?? 200) ? 'Голд' : 'Сильвер';
    await c.query('UPDATE partners SET points = $2, tier = $3 WHERE id = $1', [id, total, tier]);
  }
  console.log('баллы и тиры пересчитаны');

  // 8. Администраторы (пароль демо-контура: demo1234)
  const DEMO_HASH = 'demo$2b$10$replace-me-with-real-bcrypt-hash';
  for (const a of adminUsers) {
    await c.query(
      `INSERT INTO admin_users (login, password_hash, name, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (login) DO NOTHING`,
      [a.login, DEMO_HASH, a.name, a.role]
    );
  }
  console.log(`администраторов: ${adminUsers.length}`);

  return idByContact;
}

async function report(c, idByContact) {
  console.log('\n================ ЧТО ПОЛУЧИЛОСЬ ================\n');
  for (const p of partners) {
    const id = idByContact.get(p.contactId);
    const { rows } = await c.query(
      `SELECT level, status, amount, payout_amount, is_welcome FROM commissions WHERE partner_id = $1`,
      [id]
    );
    const s = summarize(
      rows.map((r) => ({
        partnerId: id, level: r.level, status: r.status,
        amount: Number(r.amount), payoutAmount: Number(r.payout_amount),
      })),
      id
    );
    const own = rows.filter((r) => r.level === 1).length;
    const net = rows.filter((r) => r.level === 2).length;
    const w = rows.find((r) => r.is_welcome);
    const pts = (await c.query('SELECT points, tier FROM partners WHERE id = $1', [id])).rows[0];
    const upline = p.upline ? partners.find((x) => x.contactId === p.upline).name : '—';

    console.log(`${p.name}  (${p.payer}, коэф. ${p.payRatio})`);
    console.log(`  пригласил его: ${upline}`);
    console.log(`  начислений: свои ${own}, с приглашённых ${net}${w ? ', welcome есть' : ''}`);
    console.log(`  выплачено ${fmt(s.paid)} · к выплате ${fmt(s.payable)} (на руки ${fmt(s.payoutPayable)}) · уточняется ${fmt(s.pending)}`);
    console.log(`  баллы ${pts.points} → ${pts.tier}\n`);
  }

  const t = await c.query(
    `SELECT count(*)::int rows, count(*) FILTER (WHERE level=2)::int lvl2,
            count(*) FILTER (WHERE is_welcome)::int welcome,
            sum(amount)::numeric total FROM commissions`
  );
  const r = t.rows[0];
  console.log('------------------------------------------------');
  console.log(`всего строк леджера: ${r.rows} (из них второй уровень: ${r.lvl2})`);
  console.log(`welcome-бонусов: ${r.welcome} — по одному на партнёра со сделками`);
  console.log(`общая сумма начислений: ${fmt(r.total)}`);
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Нет DATABASE_URL / DIRECT_URL в окружении.');
    process.exit(1);
  }
  const c = new pg.Client({ connectionString: url, ssl: sslConfig() });
  await c.connect();
  try {
    if (process.argv.includes('--reset')) await reset(c);
    const ids = await seed(c);
    await report(c, ids);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
