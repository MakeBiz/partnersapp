-- 0005: заведение партнёров из кабинета, вход, очередь фоновых задач
--
-- Кабинет становится хозяином партнёра: анкета, доступы, реф-код, чат.
-- Битрикс остаётся правдой по сделкам и деньгам. Партнёр сначала создаётся
-- здесь, а контакт в Битриксе (основной портал или Бирюза) заводит воркер,
-- поэтому bitrix_contact_id появляется позже и может быть пустым.

-- ---------------------------------------------------------------------------
-- 1. Партнёр: анкета, портал, Telegram, статус заведения
-- ---------------------------------------------------------------------------
ALTER TABLE partners ADD COLUMN IF NOT EXISTS name              TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone             TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone_norm        TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bitrix_portal     TEXT NOT NULL DEFAULT 'main';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bitrix_deal_id    BIGINT;   -- сделка партнёра в воронке привлечения (C2)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS telegram_chat_id  BIGINT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS telegram_invite   TEXT;     -- ссылка-приглашение в группу
ALTER TABLE partners ADD COLUMN IF NOT EXISTS created_by_admin  BIGINT REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS note              TEXT;

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_portal_chk;
ALTER TABLE partners ADD  CONSTRAINT partners_portal_chk CHECK (bitrix_portal IN ('main', 'biryuza'));

-- Контакт появляется после работы воркера
ALTER TABLE partners ALTER COLUMN bitrix_contact_id DROP NOT NULL;

-- ID контактов в двух порталах независимы и могут совпасть:
-- уникальность теперь по паре (портал, контакт)
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_bitrix_contact_id_key;
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_portal_contact_uniq;
ALTER TABLE partners ADD  CONSTRAINT partners_portal_contact_uniq UNIQUE (bitrix_portal, bitrix_contact_id);

CREATE INDEX IF NOT EXISTS partners_phone_norm_idx ON partners(phone_norm);
CREATE INDEX IF NOT EXISTS partners_email_idx      ON partners(lower(email));
CREATE INDEX IF NOT EXISTS partners_tg_idx         ON partners(lower(telegram_username));

COMMENT ON COLUMN partners.bitrix_portal IS 'main — основной портал makebiz.bitrix24.com; biryuza — портал Бирюзы';

-- ---------------------------------------------------------------------------
-- 2. Команда: Telegram админов, чтобы добавлять их в группы партнёров
-- ---------------------------------------------------------------------------
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS add_to_partner_chats BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- 3. Сессии входа (и админы, и партнёры). Храним только хеш токена.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT        PRIMARY KEY,
  subject_type TEXT        NOT NULL,          -- admin | partner
  subject_id   BIGINT      NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  CONSTRAINT sessions_subject_chk CHECK (subject_type IN ('admin', 'partner'))
);
CREATE INDEX IF NOT EXISTS sessions_subject_idx ON sessions(subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- 4. Приглашения в кабинет: партнёр сам задаёт пароль по ссылке
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  id          BIGSERIAL   PRIMARY KEY,
  partner_id  BIGINT      NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  email       TEXT,
  created_by  BIGINT      REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invites_partner_idx ON invites(partner_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Очередь фоновых задач (outbox). Её разбирает воркер.
--    kind: bitrix.create_partner | telegram.create_group | email.send_invite | ...
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id          BIGSERIAL   PRIMARY KEY,
  kind        TEXT        NOT NULL,
  partner_id  BIGINT      REFERENCES partners(id) ON DELETE CASCADE,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT        NOT NULL DEFAULT 'pending',
  attempts    INTEGER     NOT NULL DEFAULT 0,
  last_error  TEXT,
  result      JSONB,
  run_after   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jobs_status_chk CHECK (status IN ('pending', 'running', 'done', 'failed'))
);
CREATE INDEX IF NOT EXISTS jobs_pick_idx    ON jobs(status, run_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS jobs_partner_idx ON jobs(partner_id, kind);

DROP TRIGGER IF EXISTS jobs_set_updated_at ON jobs;
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Клиент ↔ партнёр: на ком «висит» клиент. Нужна для повторных сделок,
--    проверки дублей и окна 12 месяцев (дата первой оплаты клиента).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_links (
  id                BIGSERIAL   PRIMARY KEY,
  partner_id        BIGINT      NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  bitrix_portal     TEXT        NOT NULL DEFAULT 'main',
  entity_type       TEXT        NOT NULL,          -- company | contact
  entity_id         BIGINT      NOT NULL,
  client_name       TEXT,
  inn               TEXT,
  phone_norm        TEXT,
  first_paid_at     DATE,                          -- первая оплата клиента: старт окна 12 месяцев
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_links_entity_chk CHECK (entity_type IN ('company', 'contact')),
  CONSTRAINT client_links_portal_chk CHECK (bitrix_portal IN ('main', 'biryuza')),
  CONSTRAINT client_links_uniq UNIQUE (bitrix_portal, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS client_links_partner_idx ON client_links(partner_id);
CREATE INDEX IF NOT EXISTS client_links_inn_idx     ON client_links(inn);
CREATE INDEX IF NOT EXISTS client_links_phone_idx   ON client_links(phone_norm);

COMMENT ON TABLE client_links IS 'Клиент закреплён за партнёром: все сделки клиента, включая повторные, считаются партнёрскими';
