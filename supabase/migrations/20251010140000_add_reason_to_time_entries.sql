/*
  # Add reason field to time_entries

  1. Changes
    - Add `reason` column to time_entries table to store the reason for editing/eliminating entries
    - This field will be populated when a supervisor modifies a time entry

  2. Details
    - Column: reason (text, nullable)
    - Only filled when changes field is 'edited' or 'eliminated'
*/

-- Add reason column to time_entries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'time_entries' 
    AND column_name = 'reason'
  ) THEN
    ALTER TABLE time_entries ADD COLUMN reason TEXT;
  END IF;
END $$;
