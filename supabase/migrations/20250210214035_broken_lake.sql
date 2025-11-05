-- First clean up any existing data that would violate foreign keys
DELETE FROM planner_requests
WHERE employee_id NOT IN (SELECT id FROM employee_profiles);

DELETE FROM time_requests 
WHERE employee_id NOT IN (SELECT id FROM employee_profiles);

-- Add foreign key constraints if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'time_requests_employee_id_fkey'
    ) THEN
        ALTER TABLE time_requests
        ADD CONSTRAINT time_requests_employee_id_fkey 
        FOREIGN KEY (employee_id) 
        REFERENCES employee_profiles(id)
        ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'planner_requests_employee_id_fkey'
    ) THEN
        ALTER TABLE planner_requests
        ADD CONSTRAINT planner_requests_employee_id_fkey 
        FOREIGN KEY (employee_id) 
        REFERENCES employee_profiles(id)
        ON DELETE CASCADE;
    END IF;
END $$;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "time_requests_access" ON time_requests;
DROP POLICY IF EXISTS "planner_requests_access" ON planner_requests;

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