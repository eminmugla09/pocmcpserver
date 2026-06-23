-- Idempotent schema updates for existing databases.
-- Applied by migrate-db.js on every startup after the bootstrap check.

ALTER TABLE premises ADD COLUMN IF NOT EXISTS recorded_date DATE;
ALTER TABLE premises ADD COLUMN IF NOT EXISTS closing_date DATE;
ALTER TABLE premises ADD COLUMN IF NOT EXISTS purchase_date DATE;
ALTER TABLE premises ADD COLUMN IF NOT EXISTS sale_price DECIMAL(15, 2);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS assessed_value DECIMAL(15, 2);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS county VARCHAR(100);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS parcel_id VARCHAR(50);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS legal_description TEXT;
ALTER TABLE premises ADD COLUMN IF NOT EXISTS document_number VARCHAR(50);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS book_page VARCHAR(50);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS property_record_source VARCHAR(255);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS property_record_confidence VARCHAR(20);
ALTER TABLE premises ADD COLUMN IF NOT EXISTS previous_owner VARCHAR(255);
