#!/usr/bin/env node
/**
 * Разовый вход в Telegram-аккаунт, от которого воркер создаёт группы партнёров.
 * Запускать на сервере вручную:  TG_API_ID=… TG_API_HASH=… node worker/tg-login.mjs
 * (api_id / api_hash берутся на my.telegram.org → API development tools)
 *
 * Спросит телефон, код из Telegram и пароль 2FA, затем напечатает строку сессии.
 * Её положить в секреты сервера как TG_SESSION. В чат и в репозиторий НЕ отправлять:
 * это полный доступ к аккаунту.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
if (!apiId || !apiHash) { console.error('Нужны TG_API_ID и TG_API_HASH'); process.exit(1); }

const rl = readline.createInterface({ input, output });
const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
await client.start({
  phoneNumber: () => rl.question('Телефон (+971…): '),
  phoneCode: () => rl.question('Код из Telegram: '),
  password: () => rl.question('Пароль 2FA (если есть): '),
  onError: (e) => console.error(e.message),
});
const me = await client.getMe();
console.log(`\nВошли как @${me.username || me.firstName}. Строка сессии (TG_SESSION):\n`);
console.log(client.session.save());
await client.disconnect();
rl.close();
process.exit(0);
