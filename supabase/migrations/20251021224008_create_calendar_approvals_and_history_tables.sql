/*
  # Create tables for calendar approvals and history

  1. New Tables
    - `calendar_approvals` - Tracks company approval to send calendars to coordinators
    - `calendar_history` - Stores historical versions of employee calendars
    - `compensatory_days` - Stores compensatory days for holidays worked
    - `coordinator_notifications` - Notifications/alerts for coordinators

  2. Security
    - Enable RLS on all tables
    - Anyone can view, insert, update (no authentication required per system design)
*/

-- Calendar Approvals (Company sends to Coordinator)
CREATE TABLE IF NOT EXISTS calendar_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  work_centers text[] NOT NULL,
  approved_at timestamptz DEFAULT now(),
  approved_by text,
  status text DEFAULT 'approved',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE calendar_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view calendar approvals"
  ON calendar_approvals FOR SELECT USING (true);

CREATE POLICY "Anyone can insert calendar approvals"
  ON calendar_approvals FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update calendar approvals"
  ON calendar_approvals FOR UPDATE USING (true) WITH CHECK (true);

-- Calendar History (Version control for calendars)
CREATE TABLE IF NOT EXISTS calendar_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  year integer NOT NULL,
  calendar_data jsonb NOT NULL,
  total_annual_hours numeric(6,2),
  work_centers text[],
  collective_agreement_id uuid,
  version integer DEFAULT 1,
  reason text,
  created_at timestamptz DEFAULT now(),
  created_by text
);

ALTER TABLE calendar_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view calendar history"
  ON calendar_history FOR SELECT USING (true);

CREATE POLICY "Anyone can insert calendar history"
  ON calendar_history FOR INSERT WITH CHECK (true);

-- Compensatory Days (Days off for holidays worked)
CREATE TABLE IF NOT EXISTS compensatory_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  holiday_date date NOT NULL,
  holiday_name text NOT NULL,
  compensatory_date date NOT NULL,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid
);

ALTER TABLE compensatory_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view compensatory days"
  ON compensatory_days FOR SELECT USING (true);

CREATE POLICY "Anyone can insert compensatory days"
  ON compensatory_days FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update compensatory days"
  ON compensatory_days FOR UPDATE USING (true) WITH CHECK (true);

-- Coordinator Notifications
CREATE TABLE IF NOT EXISTS coordinator_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

ALTER TABLE coordinator_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view coordinator notifications"
  ON coordinator_notifications FOR SELECT USING (true);

CREATE POLICY "Anyone can insert coordinator notifications"
  ON coordinator_notifications FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update coordinator notifications"
  ON coordinator_notifications FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete coordinator notifications"
  ON coordinator_notifications FOR DELETE USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_approvals_company ON calendar_approvals(company_id);
CREATE INDEX IF NOT EXISTS idx_calendar_approvals_work_centers ON calendar_approvals USING GIN(work_centers);
CREATE INDEX IF NOT EXISTS idx_calendar_history_employee ON calendar_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_calendar_history_year ON calendar_history(year);
CREATE INDEX IF NOT EXISTS idx_compensatory_days_employee ON compensatory_days(employee_id);
CREATE INDEX IF NOT EXISTS idx_compensatory_days_dates ON compensatory_days(holiday_date, compensatory_date);
CREATE INDEX IF NOT EXISTS idx_coordinator_notifications_supervisor ON coordinator_notifications(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_coordinator_notifications_is_read ON coordinator_notifications(is_read);
