/*
  # Update get_filtered_requests to include location and device info

  1. Changes
    - Drop all existing variations of the function
    - Add location_latitude, location_longitude, location_accuracy to return
    - Add device_info to return
    - Update time_requests query to include new fields

  2. Notes
    - Maintains backward compatibility
    - Only affects time_requests (planner doesn't have location)
*/

DROP FUNCTION IF EXISTS get_filtered_requests(text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text, text, timestamp with time zone, timestamp with time zone);
DROP FUNCTION IF EXISTS get_filtered_requests(text, timestamp with time zone, timestamp with time zone, uuid);

CREATE OR REPLACE FUNCTION get_filtered_requests(
  p_work_center text,
  p_start_date timestamp with time zone DEFAULT NULL,
  p_end_date timestamp with time zone DEFAULT NULL,
  p_company_id uuid DEFAULT NULL
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
  details jsonb,
  location_latitude double precision,
  location_longitude double precision,
  location_accuracy double precision,
  device_info jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
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
    ) as details,
    tr.location_latitude,
    tr.location_longitude,
    tr.location_accuracy,
    tr.device_info
  FROM time_requests tr
  JOIN employee_profiles ep ON tr.employee_id = ep.id,
  UNNEST(ep.work_centers) wc
  WHERE (p_work_center IS NULL OR p_work_center = ANY(ep.work_centers::text[]))
    AND (p_start_date IS NULL OR tr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR tr.created_at <= p_end_date)
    AND (p_company_id IS NULL OR ep.company_id = p_company_id)
  GROUP BY tr.id, tr.status, tr.created_at, tr.employee_id, ep.fiscal_name, ep.email, ep.delegation,
           tr.location_latitude, tr.location_longitude, tr.location_accuracy, tr.device_info

  UNION ALL

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
    ) as details,
    NULL::double precision as location_latitude,
    NULL::double precision as location_longitude,
    NULL::double precision as location_accuracy,
    NULL::jsonb as device_info
  FROM planner_requests pr
  JOIN employee_profiles ep ON pr.employee_id = ep.id,
  UNNEST(ep.work_centers) wc
  WHERE (p_work_center IS NULL OR p_work_center = ANY(ep.work_centers::text[]))
    AND (p_start_date IS NULL OR pr.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pr.created_at <= p_end_date)
    AND (p_company_id IS NULL OR ep.company_id = p_company_id)
  GROUP BY pr.id, pr.status, pr.created_at, pr.employee_id, ep.fiscal_name, ep.email, ep.delegation
  ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_filtered_requests TO authenticated;
