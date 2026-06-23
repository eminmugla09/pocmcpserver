-- Idempotent schema updates for existing databases.
-- Applied by migrate-db.js on every startup after the bootstrap check.

-- Public-record fields are intentionally stored in the public-property records
-- connector, not in the FPL premises table. Drop them if they were previously added.
ALTER TABLE premises DROP COLUMN IF EXISTS new_owner_on_record;
ALTER TABLE premises DROP COLUMN IF EXISTS recorded_date;
ALTER TABLE premises DROP COLUMN IF EXISTS closing_date;
ALTER TABLE premises DROP COLUMN IF EXISTS purchase_date;
ALTER TABLE premises DROP COLUMN IF EXISTS sale_price;
ALTER TABLE premises DROP COLUMN IF EXISTS assessed_value;
ALTER TABLE premises DROP COLUMN IF EXISTS county;
ALTER TABLE premises DROP COLUMN IF EXISTS parcel_id;
ALTER TABLE premises DROP COLUMN IF EXISTS legal_description;
ALTER TABLE premises DROP COLUMN IF EXISTS document_number;
ALTER TABLE premises DROP COLUMN IF EXISTS book_page;
ALTER TABLE premises DROP COLUMN IF EXISTS property_record_source;
ALTER TABLE premises DROP COLUMN IF EXISTS property_record_confidence;
ALTER TABLE premises DROP COLUMN IF EXISTS previous_owner;
