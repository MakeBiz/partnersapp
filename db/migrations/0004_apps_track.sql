-- 0004: трек «Приложения» (реф-продукты, self-serve)
--
-- Услуги (Bitrix24, AI-агенты) считаются от сделок Bitrix: welcome 20% один раз,
-- далее 10%. Приложения (Solara и будущие) — self-serve: клиент платит на сайте
-- продукта через ЮKassa, сделки в Bitrix нет. Модель приложений: ПЛОСКИЕ 20% с
-- каждой оплаты, без welcome; второй уровень 10% от комиссии — как и на услугах.
--
-- Чтобы обе модели жили в одном леджере, строка начисления получает источник
-- (сделка Bitrix | app-платёж) и тип продукта (услуга | приложение). Ставка уже
-- хранится в каждой строке, поэтому расчёты не конфликтуют.

-- ---------------------------------------------------------------------------
-- 1. Настройка: ставка приложений (плоские 20%, конфигом как и остальные)
-- ---------------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('commission.app_rate', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Продукты: вид (услуга|приложение) и ставка для приложений
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'service';
ALTER TABLE products ADD COLUMN IF NOT EXISTS rate NUMERIC(5,2);  -- ставка для kind='app'; у услуг NULL (ставки welcome/base)

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_chk;
ALTER TABLE products ADD  CONSTRAINT products_kind_chk CHECK (kind IN ('service', 'app'));

COMMENT ON COLUMN products.kind IS 'service — услуга (сделка Bitrix, welcome+10%); app — приложение (self-serve, плоские rate%)';
COMMENT ON COLUMN products.rate IS 'Плоская ставка вознаграждения для приложений, %. У услуг NULL';

-- Solara — первый продукт трека приложений (self-serve, 20% recurring)
INSERT INTO products (slug, name, short_desc, landing_path, sort, kind, rate) VALUES
  ('solara', 'Solara', 'Персональные астрологические разборы, оплата онлайн (mysolara.ru)', 'https://mysolara.ru', 60, 'app', 30)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. App-платежи — сырьё атрибуции приложений
--    Правда о факте оплаты приходит вебхуком от провайдера (ЮKassa),
--    здесь фиксируется идемпотентно; начисления считаются из этих строк.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_payments (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT          NOT NULL DEFAULT 'yookassa',  -- источник платежа
  ext_id       TEXT          NOT NULL,                      -- id платежа у провайдера
  product_slug TEXT          REFERENCES products(slug) ON DELETE SET NULL,
  refcode      TEXT,                                        -- реф-код партнёра из метаданных платежа
  partner_id   BIGINT        REFERENCES partners(id) ON DELETE SET NULL,
  amount       NUMERIC(14,2) NOT NULL,
  currency     TEXT          NOT NULL DEFAULT 'RUB',
  status       TEXT          NOT NULL DEFAULT 'succeeded',  -- succeeded | refunded
  occurred_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  raw          JSONB,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT app_payments_amount_chk  CHECK (amount >= 0),
  CONSTRAINT app_payments_status_chk  CHECK (status IN ('succeeded', 'refunded')),
  -- идемпотентность: один платёж провайдера — одна строка
  CONSTRAINT app_payments_ext_uniq    UNIQUE (provider, ext_id)
);

CREATE INDEX IF NOT EXISTS app_payments_partner_idx ON app_payments(partner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS app_payments_refcode_idx ON app_payments(refcode);

COMMENT ON TABLE app_payments IS 'Оплаты в приложениях (self-serve). Приходят вебхуком провайдера, атрибутируются партнёру по реф-коду';

-- ---------------------------------------------------------------------------
-- 4. Леджер: обобщаем источник строки (сделка Bitrix | app-платёж)
-- ---------------------------------------------------------------------------
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS source_type    TEXT   NOT NULL DEFAULT 'deal';     -- deal | app_payment
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS product_type   TEXT   NOT NULL DEFAULT 'service';  -- service | app
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS app_payment_id BIGINT REFERENCES app_payments(id) ON DELETE CASCADE;

-- у app-платежей сделки Bitrix нет
ALTER TABLE commissions ALTER COLUMN bitrix_deal_id DROP NOT NULL;

ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_source_chk;
ALTER TABLE commissions ADD  CONSTRAINT commissions_source_chk CHECK (source_type IN ('deal', 'app_payment'));

ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_producttype_chk;
ALTER TABLE commissions ADD  CONSTRAINT commissions_producttype_chk CHECK (product_type IN ('service', 'app'));

-- база строки: сделка | комиссия нижнего уровня | сумма app-платежа
ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_base_chk;
ALTER TABLE commissions ADD  CONSTRAINT commissions_base_chk CHECK (base_type IN ('deal', 'commission', 'app_payment'));

-- согласованность источника: ровно один вид ссылки
ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_source_consistency;
ALTER TABLE commissions ADD  CONSTRAINT commissions_source_consistency CHECK (
  (source_type = 'deal'        AND bitrix_deal_id IS NOT NULL AND app_payment_id IS NULL) OR
  (source_type = 'app_payment' AND app_payment_id IS NOT NULL AND bitrix_deal_id IS NULL)
);

-- идемпотентность app-строк: один платёж × партнёр × уровень
-- (для сделок остаётся commissions_unique_row по bitrix_deal_id; NULL-и не конфликтуют)
ALTER TABLE commissions DROP CONSTRAINT IF EXISTS commissions_unique_app;
ALTER TABLE commissions ADD  CONSTRAINT commissions_unique_app UNIQUE (app_payment_id, partner_id, level);

CREATE INDEX IF NOT EXISTS commissions_app_payment_idx ON commissions(app_payment_id);

COMMENT ON COLUMN commissions.source_type  IS 'deal — начисление от сделки Bitrix; app_payment — от оплаты в приложении';
COMMENT ON COLUMN commissions.product_type IS 'service | app — какой трек породил строку';
