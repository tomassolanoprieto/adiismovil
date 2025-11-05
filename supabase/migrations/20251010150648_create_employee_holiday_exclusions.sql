/*
  # Create employee holiday exclusions table

  1. New Table: employee_holiday_exclusions
    - `id` (uuid, primary key)
    - `employee_id` (uuid, references employee_profiles)
    - `holiday_id` (uuid, references holidays)
    - `created_at` (timestamp)

  2. Purpose
    - Stores which holidays should NOT apply to specific employees
    - Used when forcing an employee to work on a holiday

  3. Security
    - Enable RLS
    - Companies can only manage exclusions for their employees
*/

CREATE TABLE IF NOT EXISTS employee_holiday_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  holiday_id UUID NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, holiday_id)
);

ALTER TABLE employee_holiday_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Companies can view their employee holiday exclusions"
  ON employee_holiday_exclusions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employee_profiles
      WHERE employee_profiles.id = employee_holiday_exclusions.employee_id
      AND employee_profiles.company_id = auth.uid()
    )
  );

CREATE POLICY "Companies can insert employee holiday exclusions"
  ON employee_holiday_exclusions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employee_profiles
      WHERE employee_profiles.id = employee_holiday_exclusions.employee_id
      AND employee_profiles.company_id = auth.uid()
    )
  );

CREATE POLICY "Companies can delete employee holiday exclusions"
  ON employee_holiday_exclusions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employee_profiles
      WHERE employee_profiles.id = employee_holiday_exclusions.employee_id
      AND employee_profiles.company_id = auth.uid()
    )
  );