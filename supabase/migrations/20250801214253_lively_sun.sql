/*
  # Create signed_reports table

  1. New Tables
    - `signed_reports`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, foreign key to employee_profiles)
      - `report_url` (text)
      - `start_date` (date)
      - `end_date` (date)
      - `status` (text)
      - `recipient_emails` (text array)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `signed_reports` table
    - Add policy for employees to insert their own reports
    - Add policy for employees to read their own reports
*/

CREATE TABLE IF NOT EXISTS signed_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  report_url text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  recipient_emails text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add foreign key constraint
ALTER TABLE signed_reports 
ADD CONSTRAINT signed_reports_employee_id_fkey 
FOREIGN KEY (employee_id) REFERENCES employee_profiles(id) ON DELETE CASCADE;

-- Add check constraint for status
ALTER TABLE signed_reports 
ADD CONSTRAINT signed_reports_status_check 
CHECK (status IN ('sent', 'pending', 'failed'));

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_signed_reports_employee_id 
ON signed_reports(employee_id);

CREATE INDEX IF NOT EXISTS idx_signed_reports_dates 
ON signed_reports(start_date, end_date);

-- Enable RLS
ALTER TABLE signed_reports ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Employees can insert their own reports"
  ON signed_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employee_profiles 
      WHERE employee_profiles.id = signed_reports.employee_id 
      AND employee_profiles.id = auth.uid()
    )
  );

CREATE POLICY "Employees can read their own reports"
  ON signed_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employee_profiles 
      WHERE employee_profiles.id = signed_reports.employee_id 
      AND employee_profiles.id = auth.uid()
    )
  );

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_signed_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signed_reports_updated_at_trigger
  BEFORE UPDATE ON signed_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_signed_reports_updated_at();