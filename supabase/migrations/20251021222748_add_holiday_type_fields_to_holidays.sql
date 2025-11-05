/*
  # Add holiday type fields to holidays table

  1. Changes
    - Add `holiday_type` column (work_center, comunidad, municipio)
    - Add `comunidad` column  
    - Add `municipio` column

  2. Notes
    - These columns support the new holiday configuration system
    - Existing holidays will default to 'work_center' type
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'holidays' AND column_name = 'holiday_type'
  ) THEN
    ALTER TABLE holidays ADD COLUMN holiday_type text DEFAULT 'work_center';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'holidays' AND column_name = 'comunidad'
  ) THEN
    ALTER TABLE holidays ADD COLUMN comunidad text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'holidays' AND column_name = 'municipio'
  ) THEN
    ALTER TABLE holidays ADD COLUMN municipio text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_holidays_holiday_type ON holidays(holiday_type);
CREATE INDEX IF NOT EXISTS idx_holidays_comunidad ON holidays(comunidad);
CREATE INDEX IF NOT EXISTS idx_holidays_municipio ON holidays(municipio);
