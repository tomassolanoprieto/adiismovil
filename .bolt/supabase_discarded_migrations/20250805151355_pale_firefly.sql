/*
  # Add total_hours column to employee_profiles table

  1. Changes
    - Add `total_hours` column to `employee_profiles` table
    - Set data type as numeric with default value of 0
    - This column will store the total annual working hours for each employee

  2. Notes
    - Default value of 0 ensures existing records are not affected
    - Numeric type allows for decimal hours if needed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_profiles' AND column_name = 'total_hours'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN total_hours numeric DEFAULT 0;
  END IF;
END $$;