-- Партнёрский кабинет MakeBiz — начальная схема
-- Postgres 14+. Запускать через DIRECT_URL (session-режим PgBouncer).
--
-- Принцип разделения данных:
--   Bitrix        — правда о сделках, деньгах, карточке партнёра
--   Эта база      — правда о партнёрской механике: дерево приглашений,
--                   леджер начислений, лиды из кабинета, обучение, баллы, аккаунты
--
-- Денежные суммы — NUMERIC, никогда не float.

-- ---------------------------------------------------------------------------
-- 1. Настройки программы (ставки и правила — конфигом, не в коде)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE settings IS 'Настраиваемые параметры программы: ставки уровней, срок закрепления лида, пороги тиров';

-- ---------------------------------------------------------------------------
-- 2. Партнёры и дерево приглашений
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partners (
  id                 BIGSERIAL PRIMARY KEY,
  bitrix_contact_id  BIGINT        NOT NULL UNIQUE,
  upline_partner_id  BIGINT        REFERENCES partners(id) ON DELETE SET NULL,
  refcode            TEXT          NOT NULL UNIQUE,

  -- зеркало карточки Bitrix (обновляется синхронизацией, правда — в Bitrix)
  status             TEXT,
  tier               TEXT          NOT NULL DEFAULT 'Сильвер',
  points             INTEGER       NOT NULL DEFAULT 0,

  -- условия вознаграждения
  comm_welcome       NUMERIC(5,2)  NOT NULL DEFAULT 20.00,  -- welcome-бонус, один раз
  comm_base          NUMERIC(5,2)  NOT NULL DEFAULT 10.00,  -- базовая ставка
  welcome_used       BOOLEAN       NOT NULL DEFAULT FALSE,
  welcome_deal_id    BIGINT,

  -- выплаты
  payer              TEXT,                                   -- Физлицо (карта) | ИП | Юрлицо | Самозанятый
  pay_ratio          NUMERIC(3,2)  NOT NULL DEFAULT 1.00,    -- 0.80 для физлица на карту

  blocked            BOOLEAN       NOT NULL DEFAULT FALSE,
  activated_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT partners_no_self_referral CHECK (upline_partner_id IS NULL OR upline_partner_id <> id),
  CONSTRAINT partners_pay_ratio_range  CHECK (pay_ratio > 0 AND pay_ratio <= 1),
  CONSTRAINT partners_rates_range      CHECK (comm_welcome >= 0 AND comm_welcome <= 100
                                          AND comm_base    >= 0 AND comm_base    <= 100)
);

CREATE INDEX IF NOT EXISTS partners_upline_idx  ON partners(upline_partner_id);
CREATE INDEX IF NOT EXISTS partners_bitrix_idx  ON partners(bitrix_contact_id);

COMMENT ON COLUMN partners.comm_welcome IS 'Welcome-бонус: 20% один раз с первого приведённого клиента';
COMMENT ON COLUMN partners.pay_ratio    IS 'Коэффициент выплаты: 0.8 — физлицо на карту, 1.0 — ИП/юрлицо';

-- Защита дерева: запрет самореферала и циклов (А→Б→А)
CREATE OR REPLACE FUNCTION partners_check_upline() RETURNS trigger AS $$
DECLARE
  cur  BIGINT;
  hops INTEGER := 0;
BEGIN
  IF NEW.upline_partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.upline_partner_id = NEW.id THEN
    RAISE EXCEPTION 'Самореферал запрещён (партнёр %)', NEW.id;
  END IF;

  cur := NEW.upline_partner_id;
  WHILE cur IS NOT NULL LOOP
    hops := hops + 1;
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Цикл в дереве приглашений: партнёр % уже выше по цепочке', NEW.id;
    END IF;
    IF hops > 50 THEN
      RAISE EXCEPTION 'Слишком длинная цепочка приглашений (>50)';
    END IF;
    SELECT upline_partner_id INTO cur FROM partners WHERE id = cur;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partners_upline_guard ON partners;
CREATE TRIGGER partners_upline_guard
  BEFORE INSERT OR UPDATE OF upline_partner_id ON partners
  FOR EACH ROW EXECUTE FUNCTION partners_check_upline();

-- ---------------------------------------------------------------------------
-- 3. Аккаунты входа (Telegram / email / Google / логин-пароль от админа)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id             BIGSERIAL PRIMARY KEY,
  partner_id     BIGINT      NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  telegram_id    TEXT,
  email          TEXT,
  email_verified BOOLEAN     NOT NULL DEFAULT FALSE,
  google_sub     TEXT,
  login          TEXT,                                  -- выдаётся админом
  password_hash  TEXT,                                  -- только хеш, никогда не пароль
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_telegram_uidx ON accounts(telegram_id)      WHERE telegram_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uidx    ON accounts(lower(email))     WHERE email       IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_google_uidx   ON accounts(google_sub)       WHERE google_sub  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_login_uidx    ON accounts(lower(login))     WHERE login       IS NOT NULL;
CREATE INDEX        IF NOT EXISTS accounts_partner_idx   ON accounts(partner_id);

-- Одноразовых кодов привязки здесь НЕТ намеренно.
-- Они живут на стороне gateway: vitrina_db, таблица miniapp.partner_claim_codes.
-- Их пишет партнёрский агент при генерации кода, гасит ручка
-- POST /partner/claim/verify. Держать вторую копию здесь нельзя —
-- получилось бы два источника правды по одному и тому же коду.

-- ---------------------------------------------------------------------------
-- 4. Администраторы и журнал действий
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            BIGSERIAL PRIMARY KEY,
  login         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  name          TEXT,
  role          TEXT        NOT NULL DEFAULT 'assistant',
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_role_chk CHECK (role IN ('admin', 'assistant'))
);

-- Журнал обязателен: любой вход в чужой кабинет и действие от имени партнёра
CREATE TABLE IF NOT EXISTS admin_audit (
  id                BIGSERIAL PRIMARY KEY,
  admin_id          BIGINT      REFERENCES admin_users(id) ON DELETE SET NULL,
  action            TEXT        NOT NULL,   -- impersonate | create_partner | block | add_lead | ...
  target_partner_id BIGINT      REFERENCES partners(id) ON DELETE SET NULL,
  payload           JSONB,
  ip                TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_admin_idx  ON admin_audit(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit(target_partner_id, created_at DESC);

COMMENT ON TABLE admin_audit IS 'Аудит действий администратора. Пишется всегда, удалять записи нельзя';

-- ---------------------------------------------------------------------------
-- 5. Продукты и обучение
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  slug         TEXT PRIMARY KEY,
  name         TEXT        NOT NULL,
  short_desc   TEXT,
  who_to_sell  TEXT,
  video_url    TEXT,                       -- YouTube
  landing_path TEXT,                       -- путь на основном сайте для реф-ссылки
  materials    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sort         INTEGER     NOT NULL DEFAULT 100,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_progress (
  partner_id   BIGINT      NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  product_slug TEXT        NOT NULL REFERENCES products(slug) ON DELETE CASCADE,
  watched_at   TIMESTAMPTZ,
  certified_at TIMESTAMPTZ,
  PRIMARY KEY (partner_id, product_slug)
);

-- ---------------------------------------------------------------------------
-- 6. Лиды из кабинета
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id              BIGSERIAL PRIMARY KEY,
  partner_id      BIGINT      NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  bitrix_lead_id  BIGINT,
  bitrix_deal_id  BIGINT,

  client_name     TEXT        NOT NULL,
  phone           TEXT,
  phone_norm      TEXT,                    -- только цифры, для поиска дублей
  email           TEXT,
  product_slug    TEXT        REFERENCES products(slug) ON DELETE SET NULL,
  comment         TEXT,

  source          TEXT        NOT NULL DEFAULT 'manual',
  status          TEXT        NOT NULL DEFAULT 'Новый',
  dup_review      BOOLEAN     NOT NULL DEFAULT FALSE,
  lock_until      DATE,                    -- закрепление за партнёром, 60 дней

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT leads_source_chk CHECK (source IN ('manual', 'reflink', 'exchange'))
);

CREATE INDEX IF NOT EXISTS leads_partner_idx    ON leads(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_norm_idx ON leads(phone_norm);
CREATE INDEX IF NOT EXISTS leads_bitrix_idx     ON leads(bitrix_lead_id);

COMMENT ON COLUMN leads.dup_review IS 'Совпал телефон — НЕ отказ, решение принимает менеджер вручную';

-- ---------------------------------------------------------------------------
-- 7. Клики по реферальным ссылкам
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
  id           BIGSERIAL PRIMARY KEY,
  refcode      TEXT        NOT NULL,
  product_slug TEXT,
  utm          JSONB,
  ip_hash      TEXT,                       -- хеш, не сам адрес
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clicks_refcode_idx ON clicks(refcode, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. Леджер начислений (ядро денег)
-- ---------------------------------------------------------------------------
-- Одна сделка порождает начисления нескольким партнёрам:
--   уровень 1 — тот, кто привёл клиента (welcome 20% один раз, далее 10% от суммы сделки)
--   уровень 2 — тот, кто пригласил партнёра (10% ОТ КОМИССИИ уровня 1)
CREATE TABLE IF NOT EXISTS commissions (
  id                   BIGSERIAL PRIMARY KEY,
  bitrix_deal_id       BIGINT        NOT NULL,
  partner_id           BIGINT        NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  level                SMALLINT      NOT NULL,

  base_type            TEXT          NOT NULL,          -- deal | commission
  base_amount          NUMERIC(14,2) NOT NULL,
  rate                 NUMERIC(5,2)  NOT NULL,
  amount               NUMERIC(14,2) NOT NULL,

  is_welcome           BOOLEAN       NOT NULL DEFAULT FALSE,
  payment_no           TEXT          NOT NULL DEFAULT 'first',

  pay_ratio            NUMERIC(3,2)  NOT NULL DEFAULT 1.00,  -- зафиксирован на момент начисления
  payout_amount        NUMERIC(14,2) NOT NULL,               -- amount * pay_ratio

  status               TEXT          NOT NULL DEFAULT 'accrued',
  parent_commission_id BIGINT        REFERENCES commissions(id) ON DELETE CASCADE,

  lic_date             DATE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  reconciled_at        TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,

  CONSTRAINT commissions_level_chk     CHECK (level IN (1, 2, 3)),
  CONSTRAINT commissions_base_chk      CHECK (base_type  IN ('deal', 'commission')),
  CONSTRAINT commissions_status_chk    CHECK (status     IN ('accrued', 'payable', 'paid', 'cancelled')),
  CONSTRAINT commissions_payment_chk   CHECK (payment_no IN ('first', 'subsequent')),
  CONSTRAINT commissions_amount_chk    CHECK (amount >= 0 AND payout_amount >= 0),
  -- идемпотентность: пересчёт не плодит дубли
  CONSTRAINT commissions_unique_row    UNIQUE (bitrix_deal_id, partner_id, level)
);

CREATE INDEX IF NOT EXISTS commissions_partner_idx ON commissions(partner_id, status);
CREATE INDEX IF NOT EXISTS commissions_deal_idx    ON commissions(bitrix_deal_id);
CREATE INDEX IF NOT EXISTS commissions_parent_idx  ON commissions(parent_commission_id);

COMMENT ON CONSTRAINT commissions_unique_row ON commissions IS 'Одна строка на партнёра × сделку × уровень — пересчёт идемпотентен';
COMMENT ON COLUMN commissions.parent_commission_id IS 'Строка уровня 2 ссылается на уровень 1: отмена каскадом';

-- ---------------------------------------------------------------------------
-- 9. Выводы средств
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
  id                 BIGSERIAL PRIMARY KEY,
  partner_id         BIGINT        NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  amount             NUMERIC(14,2) NOT NULL,
  payout_amount      NUMERIC(14,2) NOT NULL,
  pay_ratio          NUMERIC(3,2)  NOT NULL,
  status             TEXT          NOT NULL DEFAULT 'Создана',
  gateway_request_id TEXT,
  comment            TEXT,
  requested_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  CONSTRAINT withdrawals_amount_chk CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS withdrawals_partner_idx ON withdrawals(partner_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- 10. Баллы и рейтинг
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS points_log (
  id         BIGSERIAL PRIMARY KEY,
  partner_id BIGINT      NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  points     INTEGER     NOT NULL,
  ref_type   TEXT,
  ref_id     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS points_log_partner_idx ON points_log(partner_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 11. Биржа лидов (заготовка, распределение вручную менеджером)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_exchange (
  id                 BIGSERIAL PRIMARY KEY,
  title              TEXT        NOT NULL,
  description        TEXT,
  product_slug       TEXT        REFERENCES products(slug) ON DELETE SET NULL,
  region             TEXT,
  status             TEXT        NOT NULL DEFAULT 'open',
  assigned_partner_id BIGINT     REFERENCES partners(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at        TIMESTAMPTZ,
  CONSTRAINT lead_exchange_status_chk CHECK (status IN ('open', 'assigned', 'closed'))
);

CREATE INDEX IF NOT EXISTS lead_exchange_status_idx ON lead_exchange(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 12. Автообновление updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partners_set_updated_at ON partners;
CREATE TRIGGER partners_set_updated_at BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS leads_set_updated_at ON leads;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
