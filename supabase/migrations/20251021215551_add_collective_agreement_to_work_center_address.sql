/*
  # Add Collective Agreement to Work Center Address

  1. Changes
    - Add `collective_agreement_id` column to `work_center_address` table
    - This links each work center address to a collective agreement

  2. Notes
    - Column is nullable (work centers may not have an agreement assigned yet)
    - Foreign key references collective_agreements table
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_center_address' AND column_name = 'collective_agreement_id'
  ) THEN
    ALTER TABLE work_center_address ADD COLUMN collective_agreement_id uuid REFERENCES collective_agreements(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_center_address_collective_agreement ON work_center_address(collective_agreement_id);
