/*
  # Add calendar signature fields to employee_profiles

  1. Changes
    - Add `calendar_signature_requested` (boolean) - indicates if signature has been requested
    - Add `calendar_signature_requested_at` (timestamptz) - when signature was requested
    - Add `calendar_report_signed` (boolean) - indicates if employee has signed the report
    - Add `calendar_report_signed_at` (timestamptz) - when the report was signed
    - Add `calendar_report_pdf_url` (text) - URL/path to the stored PDF report
    - Add `calendar_report_year` (integer) - year of the calendar report

  2. Purpose
    - Track calendar signature workflow for employees
    - Store signed calendar reports
    - Enable company to request and track signatures

  3. Notes
    - All fields default to null/false
    - Companies can request signature by setting calendar_signature_requested to true
    - Employees sign and upload PDF which gets stored in calendar_report_pdf_url
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'calendar_signature_requested'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN calendar_signature_requested BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'calendar_signature_requested_at'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN calendar_signature_requested_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'calendar_report_signed'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN calendar_report_signed BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'calendar_report_signed_at'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN calendar_report_signed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'calendar_report_pdf_url'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN calendar_report_pdf_url TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employee_profiles' 
    AND column_name = 'calendar_report_year'
  ) THEN
    ALTER TABLE employee_profiles ADD COLUMN calendar_report_year INTEGER;
  END IF;
END $$;