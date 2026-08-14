-- Начальные данные: настройки программы и каталог продуктов

-- ---------------------------------------------------------------------------
-- Настройки (ставки и правила — конфигом, чтобы менять без правки кода)
-- ---------------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('commission.welcome_rate',    '20'::jsonb),
  ('commission.base_rate',       '10'::jsonb),
  -- уровень 2: 10% ОТ КОМИССИИ нижнего партнёра (не от суммы сделки)
  ('commission.level2_rate',     '10'::jsonb),
  ('commission.level3_enabled',  'false'::jsonb),
  ('commission.level3_rate',     '10'::jsonb),
  ('leads.lock_days',            '60'::jsonb),
  ('leads.attribution_days',     '90'::jsonb),
  ('payout.ratio_individual',    '0.8'::jsonb),
  ('payout.ratio_ip',            '1.0'::jsonb),
  ('payout.ratio_company',       '1.0'::jsonb),
  -- «Самозанятый» — коэффициент не подтверждён Антоном, поставлен предварительно
  ('payout.ratio_selfemployed',  '1.0'::jsonb),
  ('points.lead_created',        '5'::jsonb),
  ('points.lead_qualified',      '15'::jsonb),
  ('points.deal_won',            '50'::jsonb),
  ('points.training_done',       '20'::jsonb),
  ('points.partner_activated',   '100'::jsonb),
  ('tier.gold_from',             '200'::jsonb),
  ('tier.platinum_from',         '600'::jsonb),
  ('rating.window_months',       '12'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Продукты партнёрской программы
-- Видео и материалы заполняются позже через админку
-- ---------------------------------------------------------------------------
INSERT INTO products (slug, name, short_desc, landing_path, sort) VALUES
  ('bitrix24',  'Bitrix24 CRM', 'Внедрение и перезапуск CRM: процессы, интеграции, телефония, поддержка', '/bitrix24',  10),
  ('vector',    'Vector',       'AI-аналитика звонков и контроль качества продаж',                        '/vector',    20),
  ('ai-custom', 'AI-кастом',    'Кастомная разработка AI-агентов под задачи компании',                    '/ai',        30),
  ('intdoc',    'IntDoc',       'AI-обработка документов: КП, прайсы, спецификации',                      '/intdoc',    40),
  ('optimize',  'Оптимизация',  'Новая разработка MakeBiz — описание уточняется',                         '/optimize',  50)
ON CONFLICT (slug) DO NOTHING;
