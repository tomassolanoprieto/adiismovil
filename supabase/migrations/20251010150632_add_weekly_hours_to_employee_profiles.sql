/*
  # Add weekly hours field to employee profiles

  1. Changes
    - Add `weekly_hours` column to employee_profiles table
    - This field stores the weekly working hours for each employee (jornada semanal)
    - Default value is 40 hours (standard full-time)

  2. Notes
    - Field is numeric (decimal) to support partial hours
    - Can be null for flexibility
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'weekly_hours'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN weekly_hours NUMERIC(5,2) DEFAULT 40;
  END IF;
END $$;