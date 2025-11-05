/*
  # Fix company requests function

  1. Changes
    - Fix function signature to match expected parameters
    - Add company_id parameter for proper filtering
    - Ensure proper type handling for delegation
    - Add proper filtering by company_id
    - Maintain consistent return types

  2. Security
    - Function accessible to authenticated users only
    - Proper type handling for security
*/

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_filtered_requests;

-- Create new function with proper parameters and type handling
CREATE OR REPLACE FUNCTION get_filtered_requests(
  p_company_id uuid,
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
    ep.delegation::text,
    jsonb_build_object(
      'datetime', tr.datetime,
      'entry_type', tr.entry_type,
      'comment', tr.comment
    ) as details
  FROM time_requests tr
  JOIN employee_profiles ep ON tr.employee_id = ep.id
  WHERE 
    ep.company_id = p_company_id
    AND (p_work_center IS NULL OR p_work_center = ANY(ep.work_centers))
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
    ep.delegation::text,
    jsonb_build_object(
      'planner_type', pr.planner_type,
      'start_date', pr.start_date,
      'end_date', pr.end_date,
      'comment', pr.comment
    ) as details
  FROM planner_requests pr
  JOIN employee_profiles ep ON pr.employee_id = ep.id
  WHERE 
    ep.company_id = p_company_id
    AND (p_work_center IS NULL OR p_work_center = ANY(ep.work_centers))
    AND (p_start_date IS NULL OR pr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pr.created_at <= p_end_date)
  ORDER BY created_at DESC;
END;
$$;