/*
  # Add supervisor signature to calendar_approvals

  1. Changes
    - Add `supervisor_signature` column to store supervisor's signature as base64 image
    - Add `supervisor_signature_date` column to track when signature was added
    - Add `calendars_sent_to_employees` column if not exists
    
  2. Security
    - No RLS changes needed (already configured)
*/

-- Add supervisor signature columns
ALTER TABLE calendar_approvals 
ADD COLUMN IF NOT EXISTS supervisor_signature text;

ALTER TABLE calendar_approvals 
ADD COLUMN IF NOT EXISTS supervisor_signature_date timestamptz;

ALTER TABLE calendar_approvals 
ADD COLUMN IF NOT EXISTS calendars_sent_to_employees boolean DEFAULT false;
