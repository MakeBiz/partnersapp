/**
 * Задача telegram.create_group: группа партнёра в Telegram.
 *
 * Группу может создать только пользовательский аккаунт (боты не умеют), поэтому
 * воркер работает от личного аккаунта Антона через MTProto (gramjs).
 * Сессия аккаунта: TG_SESSION в секретах сервера, в код и репозиторий не попадает.
 *
 * Шаги: супергруппа «MakeBiz × Имя» → участники (команда, бот, партнёр) →
 * бот админом → ссылка-приглашение → приветствие. Кого добавить не удалось
 * (закрытая приватность), тем уходит ссылка в личку.
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

let clientPromise = null;

export const telegramConfigured = () =>
  Boolean(process.env.TG_API_ID && process.env.TG_API_HASH && process.env.TG_SESSION);

async function tg() {
  if (!clientPromise) {
    const client = new TelegramClient(
      new StringSession(process.env.TG_SESSION),
      Number(process.env.TG_API_ID),
      process.env.TG_API_HASH,
      { connectionRetries: 5 }
    );
    client.setLogLevel('error');
    clientPromise = client.connect().then(() => client).catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

const at = (u) => (u ? (String(u).startsWith('@') ? String(u) : `@${u}`) : null);

async function botSend(chatId, text) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return r.ok;
}

function welcomeText(p, inviteUrl) {
  const lines = [
    `Привет, ${p.name?.split(' ')[0] || 'партнёр'}! Это рабочий чат с командой MakeBiz 👋`,
    '',
    'Сюда можно передавать клиентов, задавать вопросы и получать новости по вашим сделкам.',
    '',
    `Ваш реф-код: ${p.refcode}`,
  ];
  if (inviteUrl) lines.push(`Вход в личный кабинет: ${inviteUrl}`, '(по ссылке задаёте свой пароль, она действует 7 дней)');
  lines.push('', 'Условия: услуги 20% с первой оплаты клиента и 10% с оплат в течение 12 месяцев, приложения 30% с каждой оплаты весь срок жизни клиента.');
  return lines.join('\n');
}

export async function handleTelegramGroup(db, job) {
  if (!telegramConfigured()) {
    const e = new Error('Telegram-аккаунт не подключён (TG_API_ID / TG_API_HASH / TG_SESSION)');
    e.permanent = true;
    throw e;
  }
  const { rows } = await db.query('SELECT * FROM partners WHERE id = $1', [job.partner_id]);
  const p = rows[0];
  if (!p) { const e = new Error('партнёр удалён'); e.permanent = true; throw e; }
  if (p.telegram_chat_id) {
    return { chatId: String(p.telegram_chat_id), inviteLink: p.telegram_invite, already: true };
  }

  const client = await tg();
  const me = await client.getMe();
  const myUsername = (me.username || '').toLowerCase();

  // Команда: из админки (add_to_partner_chats) + TG_TEAM_USERNAMES
  const { rows: team } = await db.query(
    `SELECT telegram_username FROM admin_users
      WHERE active AND add_to_partner_chats AND telegram_username IS NOT NULL`
  );
  const teamNames = new Set([
    ...team.map((t) => t.telegram_username),
    ...String(process.env.TG_TEAM_USERNAMES || '').split(',').map((s) => s.trim()).filter(Boolean),
  ].map((u) => u.replace(/^@/, '').toLowerCase()).filter((u) => u && u !== myUsername));

  const bot = (process.env.TG_BOT_USERNAME || '').replace(/^@/, '') || null;
  const title = `MakeBiz × ${p.name}`.slice(0, 128);

  const created = await client.invoke(new Api.channels.CreateChannel({
    title,
    about: `Рабочий чат партнёра ${p.name} (${p.refcode}) и команды MakeBiz`,
    megagroup: true,
  }));
  const channel = created.chats[0];
  const chatId = `-100${channel.id.toString()}`;
  // Сохраняем сразу: если дальше что-то упадёт, повтор не создаст вторую группу
  await db.query('UPDATE partners SET telegram_chat_id = $2 WHERE id = $1', [p.id, chatId]);

  const notAdded = [];
  const members = [...teamNames, bot, p.telegram_username].filter(Boolean);
  for (const u of members) {
    try {
      const user = await client.getInputEntity(at(u));
      await client.invoke(new Api.channels.InviteToChannel({ channel, users: [user] }));
    } catch (e) {
      notAdded.push(at(u));
    }
  }

  if (bot && !notAdded.includes(at(bot))) {
    try {
      await client.invoke(new Api.channels.EditAdmin({
        channel,
        userId: await client.getInputEntity(at(bot)),
        adminRights: new Api.ChatAdminRights({
          changeInfo: true, deleteMessages: true, banUsers: true, inviteUsers: true,
          pinMessages: true, manageCall: true, other: true,
        }),
        rank: 'бот MakeBiz',
      }));
    } catch { /* бот в группе, но без админки — не критично */ }
  }

  const invite = await client.invoke(new Api.messages.ExportChatInvite({ peer: channel }));
  const inviteLink = invite.link;
  await db.query('UPDATE partners SET telegram_invite = $2 WHERE id = $1', [p.id, inviteLink]);

  // Приветствие: от бота, если есть токен, иначе от аккаунта
  const text = welcomeText(p, job.payload?.inviteUrl);
  const sentByBot = bot && !notAdded.includes(at(bot)) ? await botSend(chatId, text).catch(() => false) : false;
  if (!sentByBot) await client.sendMessage(channel, { message: text, linkPreview: false });

  // Кто не добавился — пробуем отправить ссылку в личку
  const dmFailed = [];
  for (const u of notAdded) {
    if (u === at(bot)) continue;
    try {
      await client.sendMessage(u, { message: `Добавляю вас в рабочий чат MakeBiz: ${inviteLink}`, linkPreview: false });
    } catch { dmFailed.push(u); }
  }

  return { chatId, inviteLink, title, notAdded, dmFailed };
}
