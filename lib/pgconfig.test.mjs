import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanConnectionString, pgConfig, dbSchema } from './pgconfig.js';

test('sslmode убирается из строки подключения, остальное сохраняется', () => {
  const u = cleanConnectionString('postgresql://u:p%40ss@h.twc1.net:5432/default_db?sslmode=verify-full&application_name=x');
  assert.equal(u, 'postgresql://u:p%40ss@h.twc1.net:5432/default_db?application_name=x');
});

test('схема попадает в search_path, без схемы options нет', () => {
  assert.equal(pgConfig('postgres://a@b/c', { DB_SCHEMA: 'partners' }).options, '-c search_path=partners,public');
  assert.equal(pgConfig('postgres://a@b/c', {}).options, undefined);
});

test('недопустимое имя схемы отклоняется', () => {
  assert.throws(() => dbSchema({ DB_SCHEMA: 'x; drop table' }));
  assert.equal(dbSchema({ DB_SCHEMA: ' partners ' }), 'partners');
});

test('SSL: off, с CA и по умолчанию', () => {
  assert.equal(pgConfig('postgres://a@b/c', { DB_SSL: 'off' }).ssl, false);
  assert.deepEqual(pgConfig('postgres://a@b/c', {}).ssl, { rejectUnauthorized: false });
});
