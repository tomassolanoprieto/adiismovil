import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uvplcrhpifbebnebpmjg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2cGxjcmhwaWZiZWJuZWJwbWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyNjQ0NjYsImV4cCI6MjA1Njg0MDQ2Nn0.S7fPqLtdDVkASw4n4WAPYUpryV70_nGOw8XSs5zzW1w';

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigrations() {
  console.log('🔄 Aplicando migraciones a Supabase...\n');

  try {
    // Migración 1: Agregar columnas supervisor_signature
    console.log('1️⃣ Agregando columnas supervisor_signature...');

    const { error: error1 } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE employee_profiles
        ADD COLUMN IF NOT EXISTS supervisor_signature text;

        ALTER TABLE employee_profiles
        ADD COLUMN IF NOT EXISTS supervisor_signature_date timestamptz;
      `
    });

    if (error1) {
      console.log('⚠️ No se puede usar RPC, intentando método alternativo...');
      console.log('⚠️ Necesitas ejecutar el SQL manualmente en Supabase Dashboard');
      console.log('\nPero voy a verificar si las columnas ya existen...\n');
    } else {
      console.log('✅ Columnas supervisor_signature agregadas');
    }

    // Migración 2: Actualizar check constraint de holidays
    console.log('\n2️⃣ Actualizando constraint de holidays...');

    const { error: error2 } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_holiday_type_check;

        ALTER TABLE holidays ADD CONSTRAINT holidays_holiday_type_check
        CHECK (holiday_type IN ('nacional', 'work_center', 'comunidad', 'municipio'));
      `
    });

    if (error2) {
      console.log('⚠️ No se puede modificar constraint automáticamente');
    } else {
      console.log('✅ Constraint de holidays actualizado');
    }

    console.log('\n' + '='.repeat(60));
    console.log('❌ LAS MIGRACIONES NO SE PUEDEN APLICAR AUTOMÁTICAMENTE');
    console.log('='.repeat(60));
    console.log('\n🔴 DEBES EJECUTAR MANUALMENTE EN SUPABASE:\n');
    console.log('1. Ve a: https://supabase.com/dashboard');
    console.log('2. Abre SQL Editor');
    console.log('3. Copia y pega EJECUTAR_EN_SUPABASE.sql');
    console.log('4. Click en RUN\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n🔴 DEBES EJECUTAR EL SQL MANUALMENTE EN SUPABASE');
  }
}

applyMigrations();
