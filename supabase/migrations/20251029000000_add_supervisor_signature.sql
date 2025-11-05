/*
  # Add supervisor signature to employee profiles

  1. Changes
    - Add supervisor_signature for coordinator's signature
    - Add supervisor_signature_date for when coordinator signed

  2. Notes
    - Stores coordinator's signature when sending calendar for employee signature
    - Both signatures will appear in the final PDF
*/

ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS supervisor_signature text;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS supervisor_signature_date timestamptz;
