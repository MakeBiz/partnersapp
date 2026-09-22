/**
 * Первый вход без терминала: если в секретах сервера заданы
 *   ADMIN_BOOTSTRAP_LOGIN, ADMIN_BOOTSTRAP_PASSWORD
 *   (опц.) ADMIN_BOOTSTRAP_NAME, ADMIN_BOOTSTRAP_ROLE=admin|assistant, ADMIN_BOOTSTRAP_TELEGRAM
 * и такого логина ещё нет, воркер при старте создаёт пользователя команды.
 * Существующих не трогает (пароль не перезаписывает). После первого входа
 * ADMIN_BOOTSTRAP_PASSWORD из секретов лучше удалить.
 */
import { hashPassword } from '../lib/auth.js';

export async function bootstrapAdmin(db, env = process.env) {
  const login = (env.ADMIN_BOOTSTRAP_LOGIN || '').trim().toLowerCase();
  const password = env.ADMIN_BOOTSTRAP_PASSWORD || '';
  if (!login || !password) return null;
  const role = env.ADMIN_BOOTSTRAP_ROLE === 'assistant' ? 'assistant' : 'admin';
  const { rows } = await db.query(
    `INSERT INTO admin_users (login, password_hash, name, role, telegram_username)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (login) DO NOTHING
     RETURNING id`,
    [login, hashPassword(password), env.ADMIN_BOOTSTRAP_NAME || login, role,
      (env.ADMIN_BOOTSTRAP_TELEGRAM || '').replace(/^@/, '') || null]
  );
  return rows[0] ? { created: login, role } : { exists: login };
}
