/*
  # Add work_centers array to holidays table

  1. Changes
    - Add `work_centers` column as text array to support multiple work centers per holiday
    - Keep existing `work_center` column for backward compatibility

  2. Notes
    - The new column supports holidays that affect multiple work centers
    - This is needed for comunidad and municipio type holidays
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'holidays' AND column_name = 'work_centers'
  ) THEN
    ALTER TABLE holidays ADD COLUMN work_centers text[] DEFAULT '{}';
  END IF;
END $$;

-- Update existing records to populate work_centers array from work_center
UPDATE holidays 
SET work_centers = ARRAY[work_center]
WHERE work_center IS NOT NULL AND (work_centers IS NULL OR work_centers = '{}');

CREATE INDEX IF NOT EXISTS idx_holidays_work_centers ON holidays USING GIN(work_centers);
