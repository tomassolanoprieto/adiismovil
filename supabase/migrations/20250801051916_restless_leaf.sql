/*
  # Fix work schedules foreign key relationship

  1. Tables
    - Add missing foreign key constraint between employee_schedules and employee_profiles
    - Ensure proper relationship for PostgREST queries

  2. Security
    - Maintain existing RLS policies
    - Add index for better performance

  3. Changes
    - Add foreign key constraint if it doesn't exist
    - Add performance index
*/

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'employee_schedules_employee_id_fkey'
    AND table_name = 'employee_schedules'
  ) THEN
    ALTER TABLE employee_schedules 
    ADD CONSTRAINT employee_schedules_employee_id_fkey 
    FOREIGN KEY (employee_id) REFERENCES employee_profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add index for better performance if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_employee_schedules_employee_id 
ON employee_schedules(employee_id);

-- Add index for date queries if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_employee_schedules_date 
ON employee_schedules(date);