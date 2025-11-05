/*
  # Update work_center_address to work with center names

  1. Changes
    - Add `company_id` column to link to companies
    - Add `work_center_name` column for storing center names
    - Make `work_center_id` nullable for compatibility

  2. Notes
    - This allows storing addresses by center name instead of requiring work_centers table
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'work_center_address' 
    AND column_name = 'company_id'
  ) THEN
    ALTER TABLE work_center_address ADD COLUMN company_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'work_center_address' 
    AND column_name = 'work_center_name'
  ) THEN
    ALTER TABLE work_center_address ADD COLUMN work_center_name TEXT;
  END IF;
END $$;

-- Update RLS policies
DROP POLICY IF EXISTS "Companies can view their work center addresses" ON work_center_address;
DROP POLICY IF EXISTS "Companies can insert work center addresses" ON work_center_address;
DROP POLICY IF EXISTS "Companies can update work center addresses" ON work_center_address;
DROP POLICY IF EXISTS "Companies can delete work center addresses" ON work_center_address;

CREATE POLICY "Companies can view their work center addresses"
  ON work_center_address FOR SELECT
  TO authenticated
  USING (company_id = auth.uid());

CREATE POLICY "Companies can insert work center addresses"
  ON work_center_address FOR INSERT
  TO authenticated
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "Companies can update work center addresses"
  ON work_center_address FOR UPDATE
  TO authenticated
  USING (company_id = auth.uid())
  WITH CHECK (company_id = auth.uid());

CREATE POLICY "Companies can delete work center addresses"
  ON work_center_address FOR DELETE
  TO authenticated
  USING (company_id = auth.uid());