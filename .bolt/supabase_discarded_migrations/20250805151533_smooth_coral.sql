/*
  # Fix work_centers column type in employee_profiles table

  1. Changes
    - Change work_centers column from work_center_enum[] to text[]
    - This allows storing any work center names as text arrays instead of requiring a predefined enum

  2. Security
    - No RLS changes needed as this is just a column type change
*/

-- Change the work_centers column type from work_center_enum[] to text[]
DO $$
BEGIN
  -- Check if the column exists and change its type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_profiles' AND column_name = 'work_centers'
  ) THEN
    ALTER TABLE employee_profiles ALTER COLUMN work_centers TYPE text[];
  END IF;
END $$;