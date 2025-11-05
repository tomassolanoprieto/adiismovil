import emailjs from '@emailjs/browser';

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || '';
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || '';
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || '';

const isEmailConfigured = () => {
  return SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY;
};

export interface AlarmEmailData {
  supervisor_email: string;
  supervisor_name: string;
  employee_name: string;
  employee_email: string;
  alarm_type: string;
  alarm_date: string;
  description: string;
  hours_involved: number;
}

const getAlarmTypeText = (alarmType: string): string => {
  switch (alarmType) {
    case 'late_clock_in':
      return 'Fichaje de entrada con retraso';
    case 'missed_clock_in':
      return 'Fichaje de entrada no realizado';
    case 'missed_clock_out':
      return 'Fichaje de salida no realizado';
    case 'overtime':
      return 'Horas extras';
    case 'work_shortfall':
      return 'Merma de trabajo';
    case 'worked_vacation':
      return 'Trabajó durante vacaciones';
    case 'weekly_45h_exceeded':
      return 'Superó 45 horas semanales';
    case 'annual_hours_exceeded':
      return 'Superó límite anual de horas';
    default:
      return 'Alerta de tiempo';
  }
};

export const sendAlarmEmail = async (alarmData: AlarmEmailData): Promise<boolean> => {
  if (!isEmailConfigured()) {
    console.warn('EmailJS not configured. Skipping email notification.');
    return false;
  }

  try {
    const templateParams = {
      email: alarmData.supervisor_email,
      to_name: alarmData.supervisor_name,
      from_name: alarmData.employee_name,
      from_email: alarmData.employee_email,
      employee_name: alarmData.employee_name,
      alert_type: getAlarmTypeText(alarmData.alarm_type),
      alarm_type: getAlarmTypeText(alarmData.alarm_type),
      alarm_date: new Date(alarmData.alarm_date).toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      description: alarmData.description,
      hours_involved: alarmData.hours_involved > 0 ? `${alarmData.hours_involved.toFixed(2)} horas` : 'N/A',
    };

    const response = await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      templateParams,
      PUBLIC_KEY
    );

    if (response.status === 200) {
      console.log('Email sent successfully:', response);
      return true;
    } else {
      console.error('Email send failed:', response);
      return false;
    }
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

export const sendBatchAlarmEmails = async (alarms: AlarmEmailData[]): Promise<number> => {
  let successCount = 0;

  for (const alarm of alarms) {
    const success = await sendAlarmEmail(alarm);
    if (success) {
      successCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return successCount;
};
