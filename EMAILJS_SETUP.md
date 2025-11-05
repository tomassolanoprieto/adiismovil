# Configuración de EmailJS para Notificaciones de Alarmas

El sistema de alarmas puede enviar notificaciones por email automáticamente cuando se detectan problemas (fichajes perdidos, horas extras, etc.). Esta funcionalidad es **opcional** y requiere una cuenta de EmailJS.

## Estado Actual

- ✅ El sistema de alarmas funciona completamente **sin** EmailJS
- ✅ Las alarmas se generan y almacenan en la base de datos
- ✅ Los coordinadores pueden ver todas las alarmas en el portal
- ⚠️ Las notificaciones por email están desactivadas hasta que configures EmailJS

## Cómo Configurar EmailJS (Opcional)

### Paso 1: Crear una cuenta en EmailJS

1. Ve a [https://www.emailjs.com/](https://www.emailjs.com/)
2. Crea una cuenta gratuita (permite hasta 200 emails/mes)

### Paso 2: Configurar un servicio de email

1. En el dashboard de EmailJS, ve a **Email Services**
2. Haz clic en **Add New Service**
3. Selecciona tu proveedor de email (Gmail, Outlook, etc.)
4. Sigue las instrucciones para conectar tu cuenta
5. Copia el **Service ID** que se genera

### Paso 3: Crear una plantilla de email

1. Ve a **Email Templates**
2. Haz clic en **Create New Template**
3. Usa esta plantilla como base:

```
Asunto: [ALERTA] {{alarm_type}} - {{employee_name}}

Hola {{to_name}},

Se ha detectado una nueva alerta en el sistema de control de tiempo:

Empleado: {{employee_name}}
Tipo de Alerta: {{alarm_type}}
Fecha: {{alarm_date}}
Descripción: {{description}}
Horas Involucradas: {{hours_involved}}

Por favor, revisa esta alerta en el Portal Coordinador.

---
Sistema de Control de Tiempo
```

4. Guarda la plantilla y copia el **Template ID**

### Paso 4: Obtener la Public Key

1. Ve a **Account** > **General**
2. Copia tu **Public Key**

### Paso 5: Configurar las variables de entorno

Edita el archivo `.env` en la raíz del proyecto y descomenta/agrega:

```env
VITE_EMAILJS_SERVICE_ID=tu_service_id
VITE_EMAILJS_TEMPLATE_ID=tu_template_id
VITE_EMAILJS_PUBLIC_KEY=tu_public_key
```

### Paso 6: Reiniciar el servidor

```bash
npm run dev
```

## Verificación

Una vez configurado, las alarmas nuevas intentarán enviar notificaciones por email. Puedes verificar en la consola del navegador:

- ✅ `Email sent successfully:` - Email enviado correctamente
- ⚠️ `EmailJS not configured. Skipping email notification.` - EmailJS no configurado (normal si no agregaste las credenciales)
- ❌ `Error sending email:` - Error al enviar (verifica tus credenciales)

## Tipos de Alarmas que Generan Emails

Cuando EmailJS está configurado, se envían emails para:

- 🟡 Fichajes de entrada con retraso
- 🔴 Fichajes de entrada no realizados
- 🔴 Fichajes de salida no realizados
- 🟠 Horas extras
- 🔴 Merma de trabajo
- 🟣 Trabajó durante vacaciones
- 🔴 Superó 45 horas semanales
- 🔴 Superó límite anual de horas

## Notas Importantes

- El sistema funciona perfectamente sin EmailJS
- Las alarmas siempre se guardan en la base de datos
- Los coordinadores pueden ver todas las alarmas en su portal
- EmailJS solo añade la funcionalidad de notificaciones por email
- La cuenta gratuita de EmailJS tiene un límite de 200 emails/mes
