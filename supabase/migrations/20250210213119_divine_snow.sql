-- Modify planner_requests table to support time in dates
ALTER TABLE planner_requests
  ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date::TIMESTAMPTZ,
  ALTER COLUMN end_date TYPE TIMESTAMPTZ USING end_date::TIMESTAMPTZ;

-- Update constraint for date range validation
ALTER TABLE planner_requests 
  DROP CONSTRAINT IF EXISTS valid_date_range,
  ADD CONSTRAINT valid_date_range CHECK (end_date >= start_date);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_planner_requests_date_range 
ON planner_requests(start_date, end_date);