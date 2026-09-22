/**
 * Задача email.send_invite: письмо с приглашением в кабинет.
 * SMTP_URL, например smtps://user:pass@smtp.timeweb.ru:465, MAIL_FROM — от кого.
 */
import nodemailer from 'nodemailer';

let transport = null;

export async function handleInviteEmail(db, job) {
  if (!process.env.SMTP_URL) {
    const e = new Error('почта не настроена (SMTP_URL)');
    e.permanent = true;
    throw e;
  }
  const { rows } = await db.query('SELECT name, refcode FROM partners WHERE id = $1', [job.partner_id]);
  const p = rows[0];
  const { inviteUrl, email } = job.payload || {};
  if (!p || !inviteUrl || !email) { const e = new Error('нет данных для письма'); e.permanent = true; throw e; }

  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  const first = p.name?.split(' ')[0] || 'партнёр';
  const info = await transport.sendMail({
    from: process.env.MAIL_FROM || 'MakeBiz Partners <partners@makebiztehnologies.com>',
    to: email,
    subject: 'Ваш личный кабинет партнёра MakeBiz',
    text: [
      `${first}, добро пожаловать в партнёрскую программу MakeBiz!`,
      '',
      'Задайте пароль и войдите в личный кабинет по ссылке (действует 7 дней):',
      inviteUrl,
      '',
      `Ваш реф-код: ${p.refcode}`,
      'В кабинете: ваши клиенты и сделки, начисления, реф-ссылки и материалы.',
      '',
      'Команда MakeBiz',
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;color:#03235F;font-size:15px;line-height:1.6">
      <p>${first}, добро пожаловать в партнёрскую программу MakeBiz!</p>
      <p>Задайте пароль и войдите в личный кабинет:</p>
      <p><a href="${inviteUrl}" style="display:inline-block;background:#013CA4;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:bold">Открыть кабинет</a></p>
      <p style="color:#6b7590;font-size:13px">Ссылка действует 7 дней. Ваш реф-код: <b>${p.refcode}</b></p>
      <p>Команда MakeBiz</p></div>`,
  });
  return { messageId: info.messageId };
}
