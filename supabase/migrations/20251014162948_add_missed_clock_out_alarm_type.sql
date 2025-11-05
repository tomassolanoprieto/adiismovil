/*
  # Add missed_clock_out alarm type

  1. Changes
    - Update the CHECK constraint on coordinator_alarms.alarm_type to include 'missed_clock_out'
    - This allows tracking of missed clock-out entries in addition to missed clock-ins

  2. Notes
    - The new alarm type helps identify when employees clock in but forget to clock out
    - Maintains data integrity with proper constraints
*/

-- Drop the existing constraint
ALTER TABLE coordinator_alarms
DROP CONSTRAINT IF EXISTS coordinator_alarms_alarm_type_check;

-- Add the updated constraint with the new alarm type
ALTER TABLE coordinator_alarms
ADD CONSTRAINT coordinator_alarms_alarm_type_check
CHECK (alarm_type IN (
  'late_clock_in',
  'missed_clock_in',
  'missed_clock_out',
  'overtime',
  'work_shortfall',
  'worked_vacation',
  'weekly_45h_exceeded',
  'annual_hours_exceeded'
));