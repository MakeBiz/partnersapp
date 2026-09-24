/**
 * Общие настройки подключения к Postgres для сайта, воркера и скриптов.
 *
 * - SSL: DB_SSL=off выключает; DB_CA_CERT включает полную проверку сертификата;
 *   иначе канал шифруется без проверки подлинности сервера.
 * - Параметр sslmode из строки подключения убираем: pg иначе перекрывает им наши
 *   SSL-настройки и падает на самоподписанном сертификате облачной базы
 *   (Timeweb выдаёт строку с ?sslmode=verify-full).
 * - DB_SCHEMA: работать в отдельной схеме (например, в общей базе кластера).
 *   Таблицы кабинета живут в ней, не пересекаясь с чужими.
 */
export function sslConfig(env = process.env) {
  if (env.DB_SSL === 'off') return false;
  if (env.DB_CA_CERT) return { ca: env.DB_CA_CERT, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function cleanConnectionString(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

export const dbSchema = (env = process.env) => {
  const s = (env.DB_SCHEMA || '').trim();
  if (!s) return null;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new Error('DB_SCHEMA: только латиница в нижнем регистре, цифры и _');
  return s;
};

export function pgConfig(url, env = process.env) {
  const schema = dbSchema(env);
  return {
    connectionString: cleanConnectionString(url),
    ssl: sslConfig(env),
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  };
}
