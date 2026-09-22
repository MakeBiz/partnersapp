/**
 * Очередь фоновых задач (таблица jobs). Кабинет кладёт задачи, воркер разбирает.
 *
 * Зачем очередь, а не вызов «сразу»: создание контакта в Битриксе и группы в
 * Telegram может упасть (сеть, лимиты, приватность). Партнёр при этом уже
 * заведён, задача повторится сама, а ассистентка видит статус и кнопку «Повторить».
 */

export const JOB_KINDS = {
  BITRIX_PARTNER: 'bitrix.create_partner',
  TG_GROUP: 'telegram.create_group',
  EMAIL_INVITE: 'email.send_invite',
};

export const MAX_ATTEMPTS = 5;

/** Пауза перед повтором: 30 с, 2 мин, 8 мин, 32 мин. */
export const backoffSeconds = (attempt) => 30 * 4 ** Math.max(0, attempt - 1);

export async function enqueue(client, kind, { partnerId = null, payload = {}, delaySec = 0 } = {}) {
  const { rows } = await client.query(
    `INSERT INTO jobs (kind, partner_id, payload, run_after)
     VALUES ($1, $2, $3::jsonb, now() + ($4 || ' seconds')::interval)
     RETURNING *`,
    [kind, partnerId, JSON.stringify(payload), String(delaySec)]
  );
  return rows[0];
}

/** Забрать одну задачу. SKIP LOCKED: несколько воркеров не возьмут одну и ту же. */
export async function claimNext(client, kinds = null) {
  const { rows } = await client.query(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
         WHERE status = 'pending' AND run_after <= now()
           AND ($1::text[] IS NULL OR kind = ANY($1::text[]))
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`,
    [kinds]
  );
  return rows[0] || null;
}

/**
 * Успех. Чувствительные поля payload (ссылка-приглашение) после выполнения
 * стираем, чтобы в базе не лежал действующий токен в открытом виде.
 */
export async function complete(client, job, result = {}) {
  await client.query(
    `UPDATE jobs SET status = 'done', result = $2::jsonb, last_error = NULL,
            payload = payload - 'inviteUrl'
      WHERE id = $1`,
    [job.id, JSON.stringify(result)]
  );
}

export async function fail(client, job, error) {
  const message = String(error?.message || error).slice(0, 1000);
  if (job.attempts >= MAX_ATTEMPTS || error?.permanent) {
    await client.query(
      `UPDATE jobs SET status = 'failed', last_error = $2 WHERE id = $1`,
      [job.id, message]
    );
    return 'failed';
  }
  await client.query(
    `UPDATE jobs SET status = 'pending', last_error = $2,
            run_after = now() + ($3 || ' seconds')::interval
      WHERE id = $1`,
    [job.id, message, String(backoffSeconds(job.attempts))]
  );
  return 'retry';
}

/** Задачи, застрявшие в running (воркер упал посреди работы), возвращаем в очередь. */
export async function releaseStuck(client, minutes = 10) {
  const { rowCount } = await client.query(
    `UPDATE jobs SET status = 'pending'
      WHERE status = 'running' AND updated_at < now() - ($1 || ' minutes')::interval`,
    [String(minutes)]
  );
  return rowCount;
}

/** Кнопка «Повторить» в админке: упавшие задачи партнёра снова в очередь. */
export async function retryPartnerJobs(client, partnerId) {
  const { rowCount } = await client.query(
    `UPDATE jobs SET status = 'pending', attempts = 0, run_after = now()
      WHERE partner_id = $1 AND status = 'failed'`,
    [partnerId]
  );
  return rowCount;
}

/** Сводный статус заведения по последней задаче каждого вида. */
export function onboardingStatus(jobs = [], { inviteUsed = false, hasEmail = true } = {}) {
  const last = {};
  for (const j of jobs) {
    if (!last[j.kind] || Number(j.id) > Number(last[j.kind].id)) last[j.kind] = j;
  }
  const st = (kind) => {
    const j = last[kind];
    if (!j) return { state: 'none' };
    const state = j.status === 'done' ? 'done'
      : j.status === 'failed' ? 'failed'
        : j.status === 'running' ? 'running' : 'pending';
    return { state, error: j.last_error || null, attempts: j.attempts, result: j.result || null };
  };
  const email = hasEmail ? st(JOB_KINDS.EMAIL_INVITE) : { state: 'skipped' };
  return {
    crm: st(JOB_KINDS.BITRIX_PARTNER),
    chat: st(JOB_KINDS.TG_GROUP),
    email,
    cabinet: { state: inviteUsed ? 'done' : 'pending' },
  };
}
