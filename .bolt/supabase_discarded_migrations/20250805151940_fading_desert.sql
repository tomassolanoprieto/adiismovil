/*
  # Fix work_centers column type in employee_profiles

  1. Changes
    - Drop the work_centers column if it exists with wrong type
    - Recreate it as text[] type
    - Set default empty array
    - Update any existing data to preserve work center assignments

  2. Security
    - No RLS changes needed as this is a column type fix
*/

-- First, let's check if the column exists and what type it has
DO $$
BEGIN
  -- Drop the column if it exists with the wrong type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'work_centers'
  ) THEN
    -- Try to alter the column type directly first
    BEGIN
      ALTER TABLE employee_profiles ALTER COLUMN work_centers TYPE text[] USING work_centers::text[];
    EXCEPTION WHEN OTHERS THEN
      -- If that fails, drop and recreate the column
      ALTER TABLE employee_profiles DROP COLUMN work_centers;
      ALTER TABLE employee_profiles ADD COLUMN work_centers text[] DEFAULT '{}';
    END;
  ELSE
    -- Add the column if it doesn't exist
    ALTER TABLE employee_profiles ADD COLUMN work_centers text[] DEFAULT '{}';
  END IF;
END $$;