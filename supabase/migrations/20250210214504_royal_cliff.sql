-- Drop existing policies if they exist
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "time_requests_access" ON time_requests;
    DROP POLICY IF EXISTS "planner_requests_access" ON planner_requests;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;

-- Create comprehensive policies for requests
CREATE POLICY "time_requests_access"
  ON time_requests
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "planner_requests_access"
  ON planner_requests
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_time_requests_employee_id 
ON time_requests(employee_id);

CREATE INDEX IF NOT EXISTS idx_planner_requests_employee_id 
ON planner_requests(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_company_id 
ON employee_profiles(company_id);

CREATE INDEX IF NOT EXISTS idx_supervisor_profiles_company_id 
ON supervisor_profiles(company_id);