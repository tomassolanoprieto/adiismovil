/*
  # Remove Authentication Requirements from Supervisor and Employee Profiles

  1. Changes
    - DROP existing restrictive policies on supervisor_profiles
    - DROP existing restrictive policies on employee_profiles
    - CREATE new policies that allow ANY user to access
    - NO authentication required

  2. Security
    - Allow anonymous access to supervisor_profiles
    - Allow anonymous access to employee_profiles
*/

-- Drop all existing policies on supervisor_profiles
DROP POLICY IF EXISTS "supervisor_delegation_access" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_delegation_employee_access" ON employee_profiles;
DROP POLICY IF EXISTS "supervisor_profiles_access" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_profiles_access_v1" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_profiles_access_v2" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_profiles_access_v3" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_base_access" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_access_policy" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_access_policy_v2" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_access_policy_v3" ON supervisor_profiles;
DROP POLICY IF EXISTS "supervisor_profiles_policy" ON supervisor_profiles;

-- Create permissive policies for supervisor_profiles
CREATE POLICY "Anyone can view supervisor profiles"
  ON supervisor_profiles
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update supervisor profiles"
  ON supervisor_profiles
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can insert supervisor profiles"
  ON supervisor_profiles
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can delete supervisor profiles"
  ON supervisor_profiles
  FOR DELETE
  USING (true);

-- Drop any existing restrictive policies on employee_profiles
DROP POLICY IF EXISTS "Users can view own profile" ON employee_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON employee_profiles;
DROP POLICY IF EXISTS "Employees can view their own profile" ON employee_profiles;
DROP POLICY IF EXISTS "Employees can update their own profile" ON employee_profiles;
DROP POLICY IF EXISTS "Company can view their employees" ON employee_profiles;
DROP POLICY IF EXISTS "Company can update their employees" ON employee_profiles;

-- Create permissive policies for employee_profiles
CREATE POLICY "Anyone can view employee profiles"
  ON employee_profiles
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update employee profiles"
  ON employee_profiles
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can insert employee profiles"
  ON employee_profiles
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can delete employee profiles"
  ON employee_profiles
  FOR DELETE
  USING (true);
