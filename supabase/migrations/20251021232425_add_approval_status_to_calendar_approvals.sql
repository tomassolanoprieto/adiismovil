/*
  # Add approval status to calendar_approvals

  1. Changes
    - Add status column to track approval state
    - Add company_approved_at timestamp
    - Add calendars_sent_to_employees boolean

  2. Notes
    - Status: pending_company_approval, company_approved, calendars_sent
    - Tracks when company approves holidays
    - Tracks when coordinator sends calendars to employees
*/

ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending_company_approval';
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS company_approved_at timestamptz;
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS calendars_sent_to_employees boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_calendar_approvals_status ON calendar_approvals(status);
