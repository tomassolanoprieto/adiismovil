/*
  # Fix time entries validation

  1. Changes
    - Add constraint to ensure time_type is always 'LABORAL'
    - Update entry_type constraint to use exact values
    - Add default value for time_type

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