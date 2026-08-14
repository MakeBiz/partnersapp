-- Личная заметка партнёра к приведённому клиенту (сделке).
--
-- Сделки живут в Bitrix, а это приватная пометка партнёра «для себя»,
-- в CRM ей не место. Поэтому храним в базе кабинета, привязку — по
-- bitrix_deal_id. Одна заметка на партнёра и сделку.

CREATE TABLE IF NOT EXISTS deal_notes (
  partner_id     BIGINT      NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  bitrix_deal_id BIGINT      NOT NULL,
  comment        TEXT        NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, bitrix_deal_id)
);

DROP TRIGGER IF EXISTS deal_notes_set_updated_at ON deal_notes;
CREATE TRIGGER deal_notes_set_updated_at BEFORE UPDATE ON deal_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
