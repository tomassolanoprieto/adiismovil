/*
  # Fix time entries validation

  1. Changes
    - Add constraint to ensure time_type is always 'LABORAL'
    - Update entry_type constraint to use proper values
    - Add default value for time_type
    - Add validation trigger to ensure proper entry sequence

  2. Security
    - Maintain existing RLS policies
*/

-- Drop existing constraints if they exist
ALTER TABLE time_entries 
DROP CONSTRAINT IF EXISTS time_type_check;

ALTER TABLE time_entries 
DROP CONSTRAINT IF EXISTS time_entries_entry_type_check;

-- Add new constraints
ALTER TABLE time_entries 
ADD CONSTRAINT time_type_check 
CHECK (time_type = 'LABORAL');

ALTER TABLE time_entries 
ADD CONSTRAINT time_entries_entry_type_check 
CHECK (entry_type IN ('clock_in', 'break_start', 'break_end', 'clock_out'));

-- Set default value for time_type
ALTER TABLE time_entries 
ALTER COLUMN time_type SET DEFAULT 'LABORAL';

-- Create or replace the validation trigger function
CREATE OR REPLACE FUNCTION validate_time_entry()
RETURNS TRIGGER AS $$
BEGIN
  -- For non-clock_in entries, verify there is an active clock_in for the day
  IF NEW.entry_type != 'clock_in' THEN
    IF NOT EXISTS (
      SELECT 1 
      FROM time_entries 
      WHERE employee_id = NEW.employee_id 
        AND entry_type = 'clock_in'
        AND is_active = true
        AND DATE(timestamp) = DATE(NEW.timestamp)
    ) THEN
      RAISE EXCEPTION 'Debe existir una entrada activa antes de registrar una salida o pausa';
    END IF;
  END IF;

  -- Set time_type to LABORAL for all entries
  NEW.time_type := 'LABORAL';
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create or replace the trigger
DROP TRIGGER IF EXISTS validate_time_entry_trigger ON time_entries;

CREATE TRIGGER validate_time_entry_trigger
  BEFORE INSERT OR UPDATE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION validate_time_entry();