-- 1. Eliminar la política RLS que depende de la columna work_centers
DROP POLICY IF EXISTS supervisor_center_access ON employee_profiles;

-- 2. Realizar la migración
ALTER TABLE employee_profiles 
  DROP COLUMN delegation,
  ALTER COLUMN work_centers TYPE text[] USING work_centers::text[],
  ALTER COLUMN job_positions TYPE text[] USING job_positions::text[];

-- 3. Eliminar los tipos enum si existen
DROP TYPE IF EXISTS work_center_enum CASCADE;
DROP TYPE IF EXISTS work_center_enum_new CASCADE;
DROP TYPE IF EXISTS job_position_enum CASCADE;
DROP TYPE IF EXISTS delegation_enum CASCADE;

-- 4. Recrear la política RLS (ajusta la política según tus necesidades)
CREATE POLICY supervisor_center_access ON employee_profiles
FOR SELECT
USING (work_centers && ARRAY(SELECT current_setting('app.current_user_work_centers', true)::text[]));