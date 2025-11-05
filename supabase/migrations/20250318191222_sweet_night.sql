-- Drop existing function if exists
DROP FUNCTION IF EXISTS get_filtered_requests(uuid, text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text[], timestamp with time zone, timestamp with time zone);

-- Create new function with proper filtering by supervisor's company and work centers
CREATE OR REPLACE FUNCTION get_filtered_requests(
  p_supervisor_email text,
  p_work_center text DEFAULT NULL,
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
  delegation text,
  details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supervisor_company_id uuid;
  v_supervisor_work_centers text[];
BEGIN
  -- Get supervisor's company_id and work_centers
  SELECT 
    company_id,
    work_centers::text[]
  INTO 
    v_supervisor_company_id,
    v_supervisor_work_centers
  FROM supervisor_profiles
  WHERE email = p_supervisor_email
    AND is_active = true
    AND supervisor_type = 'center';

  IF v_supervisor_company_id IS NULL THEN
    RETURN;
  END IF;

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
    ep.work_centers::text[],
    ep.delegation::text,
    jsonb_build_object(
      'datetime', tr.datetime,
      'entry_type', tr.entry_type,
      'comment', tr.comment
    ) as details
  FROM time_requests tr
  JOIN employee_profiles ep ON tr.employee_id = ep.id
  WHERE ep.company_id = v_supervisor_company_id
    AND ep.work_centers && v_supervisor_work_centers
    AND (p_work_center IS NULL OR ep.work_centers @> ARRAY[p_work_center])
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
    ep.work_centers::text[],
    ep.delegation::text,
    jsonb_build_object(
      'planner_type', pr.planner_type,
      'start_date', pr.start_date,
      'end_date', pr.end_date,
      'comment', pr.comment
    ) as details
  FROM planner_requests pr
  JOIN employee_profiles ep ON pr.employee_id = ep.id
  WHERE ep.company_id = v_supervisor_company_id
    AND ep.work_centers && v_supervisor_work_centers
    AND (p_work_center IS NULL OR ep.work_centers @> ARRAY[p_work_center])
    AND (p_start_date IS NULL OR pr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pr.created_at <= p_end_date)
  ORDER BY created_at DESC;
END;
$$;

-- Create function to get supervisor's work centers and employees
CREATE OR REPLACE FUNCTION get_supervisor_center_data_v2(
  p_supervisor_email text
)
RETURNS TABLE (
  work_centers text[],
  employees jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supervisor_company_id uuid;
  v_supervisor_work_centers text[];
BEGIN
  -- Get supervisor's company_id and work_centers
  SELECT 
    company_id,
    work_centers::text[]
  INTO 
    v_supervisor_company_id,
    v_supervisor_work_centers
  FROM supervisor_profiles
  WHERE email = p_supervisor_email
    AND is_active = true
    AND supervisor_type = 'center';

  IF v_supervisor_company_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH employee_data AS (
    SELECT 
      ep.id,
      ep.fiscal_name,
      ep.email,
      ep.work_centers::text[] as employee_work_centers
    FROM employee_profiles ep
    WHERE ep.company_id = v_supervisor_company_id
      AND ep.is_active = true
      AND ep.work_centers && v_supervisor_work_centers
  )
  SELECT 
    v_supervisor_work_centers as work_centers,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', ed.id,
        'fiscal_name', ed.fiscal_name,
        'email', ed.email,
        'work_centers', ed.employee_work_centers
      )
    ) FILTER (WHERE ed.id IS NOT NULL), '[]'::jsonb) as employees
  FROM employee_data ed
  GROUP BY v_supervisor_work_centers;
END;
$$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_supervisor_profiles_email_type 
ON supervisor_profiles(email, supervisor_type);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_company_work_centers 
ON employee_profiles(company_id) 
INCLUDE (work_centers);