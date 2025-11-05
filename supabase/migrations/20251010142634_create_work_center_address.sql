/*
  # Create work_center_address table

  1. New Tables
    - `work_center_address`
      - `id` (uuid, primary key)
      - `work_center_id` (uuid, foreign key to work_centers)
      - `address` (text)
      - `comunidad` (text) - Comunidad autónoma
      - `municipio` (text) - Municipio
      - `postal_code` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `work_center_address` table
    - Add policies for company access
*/

CREATE TABLE IF NOT EXISTS work_center_address (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_center_id UUID REFERENCES work_centers(id) ON DELETE CASCADE,
  address TEXT,
  comunidad TEXT,
  municipio TEXT,
  postal_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE work_center_address ENABLE ROW LEVEL SECURITY;

-- Companies can view addresses for their work centers
CREATE POLICY "Companies can view their work center addresses"
  ON work_center_address FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM work_centers wc
      WHERE wc.id = work_center_address.work_center_id
      AND wc.company_id = auth.uid()
    )
  );

-- Companies can insert addresses for their work centers
CREATE POLICY "Companies can insert work center addresses"
  ON work_center_address FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM work_centers wc
      WHERE wc.id = work_center_address.work_center_id
      AND wc.company_id = auth.uid()
    )
  );

-- Companies can update addresses for their work centers
CREATE POLICY "Companies can update work center addresses"
  ON work_center_address FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM work_centers wc
      WHERE wc.id = work_center_address.work_center_id
      AND wc.company_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM work_centers wc
      WHERE wc.id = work_center_address.work_center_id
      AND wc.company_id = auth.uid()
    )
  );

-- Companies can delete addresses for their work centers
CREATE POLICY "Companies can delete work center addresses"
  ON work_center_address FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM work_centers wc
      WHERE wc.id = work_center_address.work_center_id
      AND wc.company_id = auth.uid()
    )
  );