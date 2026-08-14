#!/usr/bin/env node
/**
 * Раннер миграций партнёрского кабинета.
 *
 * Запуск:  node db/migrate.mjs          — применить новые миграции
 *          node db/migrate.mjs --status — показать, что применено
 *
 * Использует DIRECT_URL (session-режим PgBouncer), т.к. DDL и advisory-локи
 * не работают в transaction-режиме. Приложение работает через DATABASE_URL.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_ID = 8724408372; // произвольный, чтобы два раннера не пересеклись

function connectionString() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Нет DIRECT_URL (или DATABASE_URL) в окружении.');
    process.exit(1);
  }
  if (!process.env.DIRECT_URL) {
    console.warn('! DIRECT_URL не задан — использую DATABASE_URL. В transaction-режиме миграции могут упасть.');
  }
  return url;
}

// Сертификат самоподписанный. Если задан DB_CA_CERT — проверяем по-настоящему,
// иначе шифруем без проверки (слабее: не защищает от MITM).
function sslConfig() {
  // Локальная база без TLS (тесты, dev): DB_SSL=off
  if (process.env.DB_SSL === 'off') return false;
  if (process.env.DB_CA_CERT) {
    return { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

async function main() {
  const status = process.argv.includes('--status');
  const client = new pg.Client({ connectionString: connectionString(), ssl: sslConfig() });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    const applied = new Set(rows.map((r) => r.name));

    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();

    if (status) {
      for (const f of files) console.log(`${applied.has(f) ? '✓' : '·'} ${f}`);
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log('Новых миграций нет.');
      return;
    }

    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    try {
      for (const file of pending) {
        const sql = await readFile(join(DIR, file), 'utf8');
        process.stdout.write(`→ ${file} ... `);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log('ок');
        } catch (err) {
          await client.query('ROLLBACK');
          console.log('ОШИБКА');
          throw err;
        }
      }
      console.log(`Применено миграций: ${pending.length}`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
