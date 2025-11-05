/*
  # Create Coordinator Alarms Table

  1. New Tables
    - `coordinator_alarms`
      - `id` (uuid, primary key)
      - `supervisor_id` (uuid, references auth.users)
      - `employee_id` (uuid, references employee_profiles)
      - `alarm_type` (text) - Types: 'late_clock_in', 'missed_clock_in', 'overtime', 'work_shortfall', 'worked_vacation', 'weekly_45h_exceeded', 'annual_hours_exceeded'
      - `alarm_date` (date) - Date when the alarm occurred
      - `description` (text) - Description of the alarm
      - `hours_involved` (numeric) - Hours related to the alarm (for overtime, shortfall, etc.)
      - `is_read` (boolean) - Whether the alarm has been read
      - `email_sent` (boolean) - Whether email notification was sent
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `coordinator_alarms` table
    - Add policies for supervisors to read their own alarms
    - Add policies for supervisors to update their own alarms
    - Add policies for authenticated users to insert alarms

  3. Indexes
    - Index on supervisor_id for fast alarm retrieval
    - Index on alarm_date for date-based queries
    - Index on is_read for filtering unread alarms
*/

CREATE TABLE IF NOT EXISTS coordinator_alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employee_profiles(id) ON DELETE CASCADE NOT NULL,
  alarm_type text NOT NULL CHECK (alarm_type IN ('late_clock_in', 'missed_clock_in', 'overtime', 'work_shortfall', 'worked_vacation', 'weekly_45h_exceeded', 'annual_hours_exceeded')),
  alarm_date date NOT NULL,
  description text NOT NULL,
  hours_involved numeric(5,2) DEFAULT 0,
  is_read boolean DEFAULT false,
  email_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE coordinator_alarms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Supervisors can view their own alarms"
  ON coordinator_alarms
  FOR SELECT
  TO authenticated
  USING (auth.uid() = supervisor_id);

CREATE POLICY "Supervisors can update their own alarms"
  ON coordinator_alarms
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = supervisor_id)
  WITH CHECK (auth.uid() = supervisor_id);

CREATE POLICY "Authenticated users can insert alarms"
  ON coordinator_alarms
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_coordinator_alarms_supervisor_id ON coordinator_alarms(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_coordinator_alarms_date ON coordinator_alarms(alarm_date);
CREATE INDEX IF NOT EXISTS idx_coordinator_alarms_read ON coordinator_alarms(is_read);
CREATE INDEX IF NOT EXISTS idx_coordinator_alarms_employee_id ON coordinator_alarms(employee_id);