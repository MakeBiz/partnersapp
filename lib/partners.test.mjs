import test from 'node:test';
import assert from 'node:assert/strict';
import { normPhone, normTelegram, initials, makeRefcode, validateNewPartner } from './partners.js';

test('телефон нормализуется к 7XXXXXXXXXX', () => {
  assert.equal(normPhone('+7 (916) 123-45-67'), '79161234567');
  assert.equal(normPhone('8 916 123 45 67'), '79161234567');
  assert.equal(normPhone('9161234567'), '79161234567');
  assert.equal(normPhone('+971 50 262 0927'), '971502620927');
  assert.equal(normPhone(''), null);
});

test('Telegram-ник из любого формата', () => {
  assert.equal(normTelegram('@Igor_Sokolov'), 'Igor_Sokolov');
  assert.equal(normTelegram('https://t.me/igor_sokolov'), 'igor_sokolov');
  assert.equal(normTelegram('t.me/igor_sokolov?start=1'), 'igor_sokolov');
  assert.equal(normTelegram(''), null);
  assert.equal(normTelegram('@ab'), undefined, 'слишком короткий');
  assert.equal(normTelegram('игорь'), undefined, 'кириллица');
});

test('инициалы для реф-кода: транслит, 4 буквы', () => {
  assert.equal(initials('Игорь Соколов'), 'ISOK');
  assert.equal(initials('Ольга Рябова'), 'ORYB');
  assert.equal(initials('John Smith'), 'JSMI');
  assert.equal(initials('Мадонна'), 'MADO');
  assert.equal(initials(''), 'MKBX');
});

test('реф-код формата MKB-XXXX-NNNN', () => {
  assert.equal(makeRefcode('Игорь Соколов', () => 0.3569), 'MKB-ISOK-4212');
  assert.match(makeRefcode('Анна Ли'), /^MKB-[A-Z]{4}-\d{4}$/);
});

test('анкета: минимум имя и один контакт', () => {
  const bad = validateNewPartner({ name: 'И' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.name);
  assert.ok(bad.errors.contact);

  const ok = validateNewPartner({ name: 'Игорь Соколов', telegram: '@igor_sok', portal: 'biryuza', payer: 'ИП' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.telegram, 'igor_sok');
  assert.equal(ok.data.portal, 'biryuza');
  assert.equal(ok.data.payRatio, 1);
});

test('анкета: физлицо на карту → коэффициент 0.8, портал по умолчанию основной', () => {
  const v = validateNewPartner({ name: 'Ольга Рябова', phone: '+7 916 000-00-00' });
  assert.equal(v.data.payRatio, 0.8);
  assert.equal(v.data.portal, 'main');
  assert.equal(v.data.phoneNorm, '79160000000');
});

test('анкета: неверные почта, портал, ник', () => {
  const v = validateNewPartner({ name: 'Тест Тестов', email: 'not-an-email', portal: 'other', telegram: '@x' });
  assert.ok(v.errors.email);
  assert.ok(v.errors.portal);
  assert.ok(v.errors.telegram);
});
