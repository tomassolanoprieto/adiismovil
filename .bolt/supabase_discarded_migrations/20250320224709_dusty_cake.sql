-- Drop existing function if exists
DROP FUNCTION IF EXISTS get_filtered_requests(uuid, text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text[], timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text, text, timestamp with time zone, timestamp with time zone);

-- Create new function with proper parameter types and column references
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
  v_supervisor_work_centers work_center_enum[];
BEGIN
  -- Get supervisor's company_id and work_centers
  SELECT 
    company_id,
    work_centers
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
    array_agg(DISTINCT wc::text) as work_centers,
    ep.delegation::text,
    jsonb_build_object(
      'datetime', tr.datetime,
      'entry_type', tr.entry_type,
      'comment', tr.comment,
      'work_center', tr.work_center
    ) as details
  FROM time_requests tr
  JOIN employee_profiles ep ON tr.employee_id = ep.id,
  UNNEST(ep.work_centers) wc
  WHERE ep.company_id = v_supervisor_company_id
    AND ep.work_centers && v_supervisor_work_centers
    AND (p_work_center IS NULL OR p_work_center = ANY(ep.work_centers::text[]))
    AND (p_start_date IS NULL OR tr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR tr.created_at <= p_end_date)
  GROUP BY tr.id, tr.status, tr.created_at, tr.employee_id, ep.fiscal_name, ep.email, ep.delegation

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
    array_agg(DISTINCT wc::text) as work_centers,
    ep.delegation::text,
    jsonb_build_object(
      'planner_type', pr.planner_type,
      'start_date', pr.start_date,
      'end_date', pr.end_date,
      'comment', pr.comment
    ) as details
  FROM planner_requests pr
  JOIN employee_profiles ep ON pr.employee_id = ep.id,
  UNNEST(ep.work_centers) wc
  WHERE ep.company_id = v_supervisor_company_id
    AND ep.work_centers && v_supervisor_work_centers
    AND (p_work_center IS NULL OR p_work_center = ANY(ep.work_centers::text[]))
    AND (p_start_date IS NULL OR pr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pr.created_at <= p_end_date)
  GROUP BY pr.id, pr.status, pr.created_at, pr.employee_id, ep.fiscal_name, ep.email, ep.delegation
  ORDER BY created_at DESC;
END;
$$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employee_profiles_work_centers_gin 
ON employee_profiles USING gin(work_centers);

CREATE INDEX IF NOT EXISTS idx_supervisor_profiles_work_centers_gin 
ON supervisor_profiles USING gin(work_centers);

CREATE INDEX IF NOT EXISTS idx_time_requests_created_at 
ON time_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_planner_requests_created_at 
ON planner_requests(created_at);

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_filtered_requests TO authenticated;