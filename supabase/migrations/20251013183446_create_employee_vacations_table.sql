/*
  # Create Employee Vacations Table

  1. New Tables
    - `employee_vacations`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, foreign key to employee_profiles)
      - `company_id` (uuid, foreign key to company_profiles)
      - `start_date` (date, vacation start)
      - `end_date` (date, vacation end)
      - `status` (text, pending/approved/rejected)
      - `notes` (text, optional notes)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `employee_vacations` table
    - Add policy for authenticated users to read vacations in their company
    - Add policy for company users to create/update/delete vacations
*/

CREATE TABLE IF NOT EXISTS employee_vacations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text DEFAULT 'approved',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE employee_vacations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view vacations in their company"
  ON employee_vacations
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM employee_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Company users can insert vacations"
  ON employee_vacations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM employee_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Company users can update vacations"
  ON employee_vacations
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM employee_profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM employee_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Company users can delete vacations"
  ON employee_vacations
  FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM employee_profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_employee_vacations_employee ON employee_vacations(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_vacations_company ON employee_vacations(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_vacations_dates ON employee_vacations(start_date, end_date);