/*
  # Update time entries constraints

  1. Changes
    - Update time_type to always be 'LABORAL'
    - Update entry_type constraint to match exact values
    - Add default value for time_type

  2. Security
    - Maintain existing RLS policies
*/

-- Update the time_type constraint
ALTER TABLE time_entries 
DROP CONSTRAINT IF EXISTS time_entries_time_type_check;

ALTER TABLE time_entries 
ALTER COLUMN time_type SET DEFAULT 'LABORAL';

-- Update the entry_type constraint to match exact values
ALTER TABLE time_entries 
DROP CONSTRAINT IF EXISTS time_entries_entry_type_check;

ALTER TABLE time_entries 
ADD CONSTRAINT time_entries_entry_type_check 
CHECK (entry_type IN ('clock_in', 'break_start', 'break_end', 'clock_out'));