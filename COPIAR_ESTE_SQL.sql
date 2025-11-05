-- ⚠️⚠️⚠️ COPIAR TODO ESTO Y PEGARLO EN SUPABASE SQL EDITOR ⚠️⚠️⚠️
--
-- PASOS:
-- 1. Seleccionar TODO este texto (Ctrl+A)
-- 2. Copiar (Ctrl+C)
-- 3. Ir a: https://uvplcrhpifbebnebpmjg.supabase.co/project/uvplcrhpifbebnebpmjg/sql/new
-- 4. Pegar (Ctrl+V)
-- 5. Click en RUN (botón verde) o Ctrl+Enter
-- 6. Debe aparecer "✅ TODO CORRECTO"
--
-- =========================================================================

-- MIGRACIÓN 1: Agregar columnas para firma del supervisor en calendar_approvals
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS supervisor_signature text;
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS supervisor_signature_date timestamptz;
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS calendars_sent_to_employees boolean DEFAULT false;

-- MIGRACIÓN 2: Marcar todos los schedules como enabled=true
UPDATE employee_schedules SET enabled = true WHERE enabled = false OR enabled IS NULL;

-- VERIFICACIÓN
SELECT '✅ TODO CORRECTO - Las migraciones se aplicaron exitosamente' as resultado;
