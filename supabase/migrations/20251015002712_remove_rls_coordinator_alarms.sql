/*
  # Remove Authentication Requirements from Coordinator Alarms

  1. Changes
    - DROP existing restrictive policies
    - CREATE new policies that allow ANY user to access alarms
    - NO authentication required

  2. Security
    - Allow anonymous SELECT on coordinator_alarms
    - Allow anonymous UPDATE on coordinator_alarms
    - Allow anonymous INSERT on coordinator_alarms
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Supervisors can view their own alarms" ON coordinator_alarms;
DROP POLICY IF EXISTS "Supervisors can update their own alarms" ON coordinator_alarms;
DROP POLICY IF EXISTS "Authenticated users can insert alarms" ON coordinator_alarms;

-- Create permissive policies that allow ANY user to access
CREATE POLICY "Anyone can view all alarms"
  ON coordinator_alarms
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update alarms"
  ON coordinator_alarms
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can insert alarms"
  ON coordinator_alarms
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can delete alarms"
  ON coordinator_alarms
  FOR DELETE
  USING (true);
