import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, readCookie, sessionCookie, sha256 } from './auth.js';

test('пароль: хеш проверяется, чужой пароль нет', () => {
  const h = hashPassword('correct horse');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse', h), true);
  assert.equal(verifyPassword('wrong horse', h), false);
});

test('пароль: одинаковые пароли дают разные хеши (соль)', () => {
  assert.notEqual(hashPassword('same-password'), hashPassword('same-password'));
});

test('пароль: короткий отклоняется', () => {
  assert.throws(() => hashPassword('short'));
});

test('пароль: мусор вместо хеша не роняет проверку', () => {
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(verifyPassword('x', null), false);
});

test('кука: читается из заголовка', () => {
  assert.equal(readCookie('a=1; mb_session=abc%3D; b=2', 'mb_session'), 'abc=');
  assert.equal(readCookie('a=1', 'mb_session'), null);
  assert.equal(readCookie(null, 'mb_session'), null);
});

test('кука сессии httpOnly и secure', () => {
  const c = sessionCookie('tok');
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
});

test('в базе хранится хеш токена, а не токен', () => {
  assert.equal(sha256('tok').length, 64);
  assert.notEqual(sha256('tok'), 'tok');
});
