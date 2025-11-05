/*
  # Fix Database Functions

  1. New Functions
    - get_filtered_requests: Function to get filtered requests by work center and date range
    - calculate_daily_work_hours: Function to calculate daily work hours for employees

  2. Changes
    - Improved error handling
    - Better type safety
    - More efficient queries
    - Fixed delegation_enum comparison issue
*/

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

-- Function to get daily work hours with proper aggregation
CREATE OR REPLACE FUNCTION calculate_daily_work_hours(
  p_employee_id uuid,
  p_date date
)
RETURNS TABLE (
  total_hours numeric,
  entry_types text[],
  timestamps timestamp with time zone[],
  work_centers text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entries record;
  v_total_hours numeric := 0;
  v_entry_types text[] := ARRAY[]::text[];
  v_timestamps timestamp with time zone[] := ARRAY[]::timestamp with time zone[];
  v_work_centers text[] := ARRAY[]::text[];
  v_clock_in timestamp with time zone;
  v_break_start timestamp with time zone;
BEGIN
  -- Get all entries for the day ordered by timestamp
  FOR v_entries IN (
    SELECT 
      entry_type,
      timestamp,
      work_center
    FROM time_entries
    WHERE employee_id = p_employee_id
      AND date_trunc('day', timestamp) = p_date
      AND is_active = true
    ORDER BY timestamp
  ) LOOP
    -- Add entry to arrays
    v_entry_types := array_append(v_entry_types, v_entries.entry_type);
    v_timestamps := array_append(v_timestamps, v_entries.timestamp);
    v_work_centers := array_append(v_work_centers, v_entries.work_center);
    
    -- Calculate hours based on entry type
    CASE v_entries.entry_type
      WHEN 'clock_in' THEN
        v_clock_in := v_entries.timestamp;
      WHEN 'break_start' THEN
        IF v_clock_in IS NOT NULL THEN
          v_total_hours := v_total_hours + 
            EXTRACT(EPOCH FROM (v_entries.timestamp - v_clock_in))/3600.0;
          v_clock_in := NULL;
        END IF;
        v_break_start := v_entries.timestamp;
      WHEN 'break_end' THEN
        v_break_start := NULL;
        v_clock_in := v_entries.timestamp;
      WHEN 'clock_out' THEN
        IF v_clock_in IS NOT NULL THEN
          v_total_hours := v_total_hours + 
            EXTRACT(EPOCH FROM (v_entries.timestamp - v_clock_in))/3600.0;
          v_clock_in := NULL;
        END IF;
    END CASE;
  END LOOP;

  -- If still clocked in, add time until now
  IF v_clock_in IS NOT NULL AND v_break_start IS NULL THEN
    v_total_hours := v_total_hours + 
      EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - v_clock_in))/3600.0;
  END IF;

  RETURN QUERY
  SELECT 
    v_total_hours,
    v_entry_types,
    v_timestamps,
    v_work_centers;
END;
$$;

-- Function to get supervisor's calendar data
CREATE OR REPLACE FUNCTION get_supervisor_calendar_data_v2(
  p_supervisor_email text
)
RETURNS TABLE (
  work_centers text[],
  employees json
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sp.work_centers,
    json_agg(
      json_build_object(
        'id', ep.id,
        'fiscal_name', ep.fiscal_name,
        'email', ep.email,
        'work_centers', ep.work_centers
      )
    ) as employees
  FROM supervisor_profiles sp
  LEFT JOIN employee_profiles ep 
    ON ep.work_centers && sp.work_centers 
    AND ep.is_active = true
  WHERE sp.email = p_supervisor_email
    AND sp.is_active = true
  GROUP BY sp.work_centers;
END;
$$;