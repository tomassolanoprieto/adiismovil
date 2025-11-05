/*
  # Create Collective Agreements Table

  1. New Tables
    - `collective_agreements`
      - `id` (uuid, primary key)
      - `company_id` (uuid, references auth.users) - Company that owns this agreement
      - `name` (text) - Name of the collective agreement
      - `total_annual_hours` (numeric) - Total annual working hours (Jornada Cómputo Total)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `collective_agreements` table
    - Allow anyone to view, insert, update, and delete (no authentication required)

  3. Indexes
    - Index on company_id for fast retrieval
    - Index on name for searching
*/

CREATE TABLE IF NOT EXISTS collective_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  total_annual_hours numeric(6,2) NOT NULL DEFAULT 1826,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE collective_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view collective agreements"
  ON collective_agreements
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert collective agreements"
  ON collective_agreements
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update collective agreements"
  ON collective_agreements
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete collective agreements"
  ON collective_agreements
  FOR DELETE
  USING (true);

CREATE INDEX IF NOT EXISTS idx_collective_agreements_company_id ON collective_agreements(company_id);
CREATE INDEX IF NOT EXISTS idx_collective_agreements_name ON collective_agreements(name);
