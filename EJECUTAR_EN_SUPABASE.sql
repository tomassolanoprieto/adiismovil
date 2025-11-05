-- =====================================================
-- ⚠️ EJECUTAR ESTE SQL EN SUPABASE URGENTEMENTE ⚠️
-- =====================================================
--
-- SIN ESTO, LA APLICACIÓN NO FUNCIONARÁ CORRECTAMENTE
--
-- PASOS:
-- 1. Ir a: https://supabase.com/dashboard
-- 2. Seleccionar tu proyecto
-- 3. Ir a "SQL Editor" (icono </> en el menú izquierdo)
-- 4. Hacer click en "New query"
-- 5. Copiar y pegar TODO este archivo
-- 6. Hacer click en "Run" o presionar Ctrl+Enter
-- 7. Debe aparecer: "Migraciones aplicadas correctamente"
--
-- =====================================================

-- 1. Agregar columnas de firma del supervisor en calendar_approvals
-- (Para que el coordinador pueda firmar el calendario)
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS supervisor_signature text;
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS supervisor_signature_date timestamptz;
ALTER TABLE calendar_approvals ADD COLUMN IF NOT EXISTS calendars_sent_to_employees boolean DEFAULT false;

-- =====================================================
-- VERIFICACIÓN
-- =====================================================
-- Si ves este mensaje, todo está correcto:
SELECT '✅ Migraciones aplicadas correctamente' as status;
