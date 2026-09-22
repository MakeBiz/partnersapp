#!/usr/bin/env node
/**
 * Воркер партнёрского кабинета: разбирает очередь jobs.
 *   bitrix.create_partner  → контакт партнёра в выбранном Битриксе (через gateway)
 *   telegram.create_group  → группа партнёра в Telegram
 *   email.send_invite      → письмо с приглашением в кабинет
 *
 * Запуск: npm run worker. Слушает PORT для health-check (Timeweb Apps).
 */
import http from 'node:http';
import { pool } from '../lib/db.js';
import { claimNext, complete, fail, releaseStuck, JOB_KINDS } from '../lib/jobs.js';
import { handleBitrixPartner } from './bitrix.mjs';
import { handleTelegramGroup, telegramConfigured } from './telegram.mjs';
import { handleInviteEmail } from './mailer.mjs';
import { bootstrapAdmin } from './bootstrap.mjs';

const HANDLERS = {
  [JOB_KINDS.BITRIX_PARTNER]: handleBitrixPartner,
  [JOB_KINDS.TG_GROUP]: handleTelegramGroup,
  [JOB_KINDS.EMAIL_INVITE]: handleInviteEmail,
};

const IDLE_MS = 3000;
const JOB_TIMEOUT_MS = 120_000;
const stats = { startedAt: new Date().toISOString(), lastTick: null, done: 0, failed: 0, retried: 0, lastError: null };
let stopping = false;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`таймаут ${ms / 1000} с`)), ms); })])
    .finally(() => clearTimeout(t));
}

async function runOne() {
  const job = await claimNext(pool, Object.keys(HANDLERS));
  if (!job) return false;
  const handler = HANDLERS[job.kind];
  try {
    const result = await withTimeout(handler(pool, job), JOB_TIMEOUT_MS);
    await complete(pool, job, result || {});
    stats.done++;
    log('done', job.kind, `#${job.id}`, `partner=${job.partner_id}`);
  } catch (e) {
    const outcome = await fail(pool, job, e);
    stats[outcome === 'failed' ? 'failed' : 'retried']++;
    stats.lastError = `${job.kind}: ${e.message}`;
    log(outcome, job.kind, `#${job.id}`, e.message);
  }
  return true;
}

async function loop() {
  let lastRelease = 0;
  while (!stopping) {
    stats.lastTick = new Date().toISOString();
    try {
      if (Date.now() - lastRelease > 60_000) {
        const n = await releaseStuck(pool);
        if (n) log('released stuck jobs:', n);
        lastRelease = Date.now();
      }
      const worked = await runOne();
      if (!worked) await sleep(IDLE_MS);
    } catch (e) {
      stats.lastError = e.message;
      log('loop error', e.message);
      await sleep(IDLE_MS * 3);
    }
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true, ...stats,
    configured: {
      db: Boolean(process.env.DATABASE_URL),
      gateway: Boolean(process.env.GATEWAY_URL && process.env.GATEWAY_KEY),
      telegram: telegramConfigured(),
      bot: Boolean(process.env.TG_BOT_USERNAME),
      smtp: Boolean(process.env.SMTP_URL),
    },
  }));
});
server.listen(Number(process.env.PORT || 8080), () => log('worker health on', process.env.PORT || 8080));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    log('stopping…');
    stopping = true;
    server.close();
    setTimeout(() => process.exit(0), 5000).unref();
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

log('worker started');
bootstrapAdmin(pool)
  .then((r) => r && log('bootstrap admin:', JSON.stringify(r)))
  .catch((e) => log('bootstrap admin error:', e.message))
  .finally(loop);
