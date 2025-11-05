/*
  # Update holidays table for location-based holidays

  1. Changes
    - Add `holiday_type` column: 'work_center', 'comunidad', 'municipio'
    - Add `work_center_id` column for specific work center holidays
    - Add `comunidad` column for regional holidays
    - Add `municipio` column for municipal holidays

  2. Notes
    - If holiday_type is 'work_center' and work_center_id is NULL, applies to all work centers
    - If holiday_type is 'comunidad', applies to all work centers in that comunidad
    - If holiday_type is 'municipio', applies to all work centers in that municipio
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'holidays' 
    AND column_name = 'holiday_type'
  ) THEN
    ALTER TABLE holidays ADD COLUMN holiday_type TEXT DEFAULT 'work_center' CHECK (holiday_type IN ('work_center', 'comunidad', 'municipio'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'holidays' 
    AND column_name = 'work_center_id'
  ) THEN
    ALTER TABLE holidays ADD COLUMN work_center_id UUID REFERENCES work_centers(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'holidays' 
    AND column_name = 'comunidad'
  ) THEN
    ALTER TABLE holidays ADD COLUMN comunidad TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'holidays' 
    AND column_name = 'municipio'
  ) THEN
    ALTER TABLE holidays ADD COLUMN municipio TEXT;
  END IF;
END $$;