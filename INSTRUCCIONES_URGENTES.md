# ⚠️ INSTRUCCIONES URGENTES - EJECUTAR EN SUPABASE

## 🔴 ACCIÓN REQUERIDA

Para que las nuevas funcionalidades funcionen correctamente, **DEBES EJECUTAR** el siguiente SQL en tu base de datos de Supabase.

### 📋 Pasos a seguir:

1. **Ir a Supabase Dashboard**: https://supabase.com/dashboard
2. **Seleccionar tu proyecto**
3. **Ir a SQL Editor** (menú lateral izquierdo)
4. **Copiar y pegar** el contenido completo del archivo `EJECUTAR_EN_SUPABASE.sql`
5. **Ejecutar** el SQL (botón "Run" o Ctrl+Enter)

### ✅ Verificación

Después de ejecutar el SQL, deberías ver el mensaje:
```
Migraciones aplicadas correctamente
```

---

## 🆕 Funcionalidades Implementadas

### 1. ✅ Firma del Coordinador con Canvas
- Modal con canvas para firmar con el ratón/dedo
- Firma gráfica guardada como imagen
- Ambas firmas (coordinador + empleado) en el PDF final

### 2. ✅ Tipo de Festivo "Nacional"
- Nueva opción en el selector de tipo de festivo
- Se aplica automáticamente a TODOS los centros de trabajo
- Aparece en el calendario de todos los centros

### 3. ✅ Columna Ubicación Eliminada
- Tabla más limpia en Vista General del Coordinador

### 4. ✅ Aviso Legal Obligatorio
- Texto legal visible en el Portal Trabajador
- Informa sobre la obligación de fichaje según el Estatuto

---

## 🐛 Errores Corregidos

- ✅ Check constraint de holidays actualizado para incluir 'nacional'
- ✅ Columnas supervisor_signature añadidas a employee_profiles
- ✅ Firma convertida de texto a canvas (como en Portal Trabajador)

---

## ❓ Si tienes problemas

Si después de ejecutar el SQL siguen apareciendo errores:

1. Verifica que el SQL se ejecutó correctamente
2. Refresca el navegador (Ctrl+F5)
3. Revisa la consola del navegador para ver errores específicos

---

**¡IMPORTANTE!** No podrás usar las nuevas funcionalidades hasta que ejecutes el SQL en Supabase.
