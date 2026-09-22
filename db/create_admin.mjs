#!/usr/bin/env node
/**
 * Создать или обновить пользователя команды (админ/ассистент).
 *
 *   node db/create_admin.mjs --login anton --name "Антон Чернобаев" --role admin --telegram Anton_MakeBiz
 *   node db/create_admin.mjs --login assistant --name "Ассистент" --role assistant --telegram assistant_nick
 *
 * Пароль: из ADMIN_PASSWORD, иначе генерируется и печатается один раз.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../lib/auth.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const login = (args.login || '').toLowerCase();
const role = args.role || 'assistant';
if (!login || !['admin', 'assistant'].includes(role)) {
  console.error('Нужно: --login <логин> [--name …] [--role admin|assistant] [--telegram ник] [--email …]');
  process.exit(1);
}
const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const ssl = process.env.DB_SSL === 'off' ? false
  : process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT, rejectUnauthorized: true } : { rejectUnauthorized: false };
const c = new pg.Client({ connectionString: url, ssl });
await c.connect();
await c.query(
  `INSERT INTO admin_users (login, password_hash, name, role, email, telegram_username)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (login) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name,
     role = EXCLUDED.role, email = EXCLUDED.email, telegram_username = EXCLUDED.telegram_username, active = TRUE`,
  [login, hashPassword(password), args.name || login, role, args.email || null, (args.telegram || '').replace(/^@/, '') || null]
);
await c.end();
console.log(`Готово: ${login} (${role}).`);
if (generated) console.log(`Пароль (покажется один раз): ${password}`);
