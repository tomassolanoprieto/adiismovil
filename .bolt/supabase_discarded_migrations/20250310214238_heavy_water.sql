/*
  # Fix Reports and Requests Functions

  1. Changes
    - Add get_daily_work_hours function for proper time calculations
    - Add get_filtered_requests function for request filtering
    - Fix temporary table handling in functions
    - Improve type safety and error handling

  2. Security
    - Maintain SECURITY DEFINER setting
    - Preserve existing RLS policies
*/

-- Function to get daily work hours with proper aggregation
CREATE OR REPLACE FUNCTION get_daily_work_hours(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  work_date date,
  clock_in time,
  clock_out time,
  break_duration interval,
  total_hours numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_date date;
  v_first_in time;
  v_last_out time;
  v_total_break interval;
  v_hours_worked numeric;
BEGIN
  -- Loop through each date in the range
  v_current_date := p_start_date;
  WHILE v_current_date <= p_end_date LOOP
    -- Calculate times for current date
    WITH daily_entries AS (
      SELECT 
        entry_type,
        timestamp::time as entry_time,
        timestamp
      FROM time_entries
      WHERE employee_id = p_employee_id
        AND date_trunc('day', timestamp) = v_current_date
        AND is_active = true
      ORDER BY timestamp
    ),
    breaks AS (
      SELECT 
        sum(
          CASE 
            WHEN lead(entry_type) OVER (ORDER BY timestamp) = 'break_end' 
            THEN lead(timestamp) OVER (ORDER BY timestamp) - timestamp
            ELSE '0'::interval
          END
        ) as total_break
      FROM daily_entries
      WHERE entry_type = 'break_start'
    ),
    work_time AS (
      SELECT
        min(CASE WHEN entry_type = 'clock_in' THEN entry_time END) as first_in,
        max(CASE WHEN entry_type = 'clock_out' THEN entry_time END) as last_out,
        COALESCE(
          EXTRACT(EPOCH FROM (
            max(CASE WHEN entry_type = 'clock_out' THEN timestamp END) - 
            min(CASE WHEN entry_type = 'clock_in' THEN timestamp END)
          )/3600.0 -
          EXTRACT(EPOCH FROM COALESCE((SELECT total_break FROM breaks), '0'::interval))/3600.0,
          0
        ) as hours_worked
      FROM daily_entries
    )
    SELECT 
      first_in,
      last_out,
      COALESCE((SELECT total_break FROM breaks), '0'::interval),
      hours_worked
    INTO 
      v_first_in,
      v_last_out,
      v_total_break,
      v_hours_worked
    FROM work_time;

    -- Return row for current date
    RETURN QUERY
    SELECT 
      v_current_date,
      v_first_in,
      v_last_out,
      v_total_break,
      v_hours_worked;

    -- Move to next date
    v_current_date := v_current_date + 1;
  END LOOP;
END;
$$;

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_filtered_requests(text[], timestamp with time zone, timestamp with time zone);

-- Function to get filtered requests with proper work center handling
CREATE OR REPLACE FUNCTION get_filtered_requests(
  p_work_centers text[],
  p_start_date timestamp with time zone DEFAULT NULL,
  p_end_date timestamp with time zone DEFAULT NULL
)
RETURNS TABLE (
  request_id uuid,
  request_type text,
  request_status text,
  created_at timestamp with time zone,
  employee_id uuid,
  employee_name text,
  employee_email text,
  work_centers text[],
  details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  -- Time requests
  SELECT 
    tr.id as request_id,
    'time'::text as request_type,
    tr.status as request_status,
    tr.created_at,
    tr.employee_id,
    ep.fiscal_name as employee_name,
    ep.email as employee_email,
    ep.work_centers,
    jsonb_build_object(
      'datetime', tr.datetime,
      'entry_type', tr.entry_type,
      'comment', tr.comment
    ) as details
  FROM time_requests tr
  JOIN employee_profiles ep ON tr.employee_id = ep.id
  WHERE (p_work_centers IS NULL OR ep.work_centers && p_work_centers)
    AND (p_start_date IS NULL OR tr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR tr.created_at <= p_end_date)

  UNION ALL

  -- Planner requests
  SELECT 
    pr.id as request_id,
    'planner'::text as request_type,
    pr.status as request_status,
    pr.created_at,
    pr.employee_id,
    ep.fiscal_name as employee_name,
    ep.email as employee_email,
    ep.work_centers,
    jsonb_build_object(
      'planner_type', pr.planner_type,
      'start_date', pr.start_date,
      'end_date', pr.end_date,
      'comment', pr.comment
    ) as details
  FROM planner_requests pr
  JOIN employee_profiles ep ON pr.employee_id = ep.id
  WHERE (p_work_centers IS NULL OR ep.work_centers && p_work_centers)
    AND (p_start_date IS NULL OR pr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pr.created_at <= p_end_date)
  ORDER BY created_at DESC;
END;
$$;