import pg from 'pg';

/**
 * Пул соединений к базе кабинета.
 *
 * Идёт через DATABASE_URL — это PgBouncer в transaction-режиме, поэтому:
 *   - именованные prepared statements использовать нельзя;
 *   - обычные параметризованные запросы ($1, $2) работают нормально;
 *   - LISTEN/NOTIFY и сессионные настройки недоступны.
 *
 * Пул держим маленьким: serverless-функций много, соединений на каждую мало.
 */

// Числовые типы Postgres приходят строками — деньги парсим осознанно,
// чтобы не терять точность на больших суммах.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // NUMERIC

function sslConfig() {
  // Локальная база без TLS (тесты, dev): DB_SSL=off
  if (process.env.DB_SSL === 'off') return false;
  // Сертификат сервера самоподписанный. С DB_CA_CERT проверяем цепочку
  // по-настоящему; без него канал шифруется, но подлинность сервера
  // не проверяется (риск MITM) — задать DB_CA_CERT желательно.
  if (process.env.DB_CA_CERT) {
    return { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const globalForDb = globalThis;

export const pool =
  globalForDb.__partnersPool ||
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig(),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });

if (!globalForDb.__partnersPool) globalForDb.__partnersPool = pool;

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Настройки программы из таблицы settings, с кешем на время жизни инстанса. */
let settingsCache = null;
export async function getSettings() {
  if (settingsCache) return settingsCache;
  const { rows } = await query('SELECT key, value FROM settings');
  settingsCache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return settingsCache;
}
