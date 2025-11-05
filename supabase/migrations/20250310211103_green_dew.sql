/*
  # Get supervisor calendar data function v2

  1. New Functions
    - get_supervisor_calendar_data_v2: Returns work centers and employees for a supervisor without authentication
    - Filters by supervisor email and work centers only

  2. Security
    - Function accessible to all users (no auth required)
    - Proper type handling and validation
*/

CREATE OR REPLACE FUNCTION get_supervisor_calendar_data_v2(
  p_supervisor_email text
)
RETURNS TABLE (
  work_centers text[],
  employees jsonb
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH supervisor_data AS (
    SELECT 
      sp.work_centers as supervisor_work_centers
    FROM supervisor_profiles sp
    WHERE sp.email = p_supervisor_email
      AND sp.is_active = true
      AND sp.supervisor_type = 'center'
  ),
  employee_data AS (
    SELECT 
      ep.id,
      ep.fiscal_name,
      ep.email,
      ep.work_centers as employee_work_centers
    FROM employee_profiles ep
    CROSS JOIN supervisor_data sd
    WHERE ep.is_active = true
    AND ep.work_centers && sd.supervisor_work_centers
  )
  SELECT 
    sd.supervisor_work_centers as work_centers,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', ed.id,
        'fiscal_name', ed.fiscal_name,
        'email', ed.email,
        'work_centers', ed.employee_work_centers
      )
    ) FILTER (WHERE ed.id IS NOT NULL), '[]'::jsonb) as employees
  FROM supervisor_data sd
  LEFT JOIN employee_data ed ON true
  GROUP BY sd.supervisor_work_centers;
END;
$$;