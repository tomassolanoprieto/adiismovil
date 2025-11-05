import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Calendar, Clock, AlertTriangle, Download, Search, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';

interface Employee {
  id: string;
  fiscal_name: string;
  email: string;
  work_centers: string[];
  delegation: string;
  document_number: string;
  total_hours: number;
  company_id: string;
}

interface Alert {
  id: string;
  employee_id: string;
  employee_name: string;
  alert_type: 'missed_clock_in' | 'overtime' | 'shortage' | 'vacation';
  date: string;
  hours: number;
  percentage: number;
  work_center: string;
  details: string;
  status: 'pending' | 'resolved' | 'dismissed';
  created_at: string;
  notified: boolean;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  work_center: string;
}

interface TimeEntry {
  id: string;
  employee_id: string;
  entry_type: 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
  timestamp: string;
  work_center: string;
  is_active: boolean;
  time_type?: string;
}

interface EmployeeSchedule {
  id: string;
  employee_id: string;
  date: string;
  morning_start: string | null;
  morning_end: string | null;
  afternoon_start: string | null;
  afternoon_end: string | null;
  enabled: boolean;
}

export default function SupervisorAlerts() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [alertType, setAlertType] = useState<'missed_clock_in' | 'overtime' | 'shortage' | 'vacation'>('missed_clock_in');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('');
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [supervisorWorkCenters, setSupervisorWorkCenters] = useState<string[]>([]);
  const [pendingCounts, setPendingCounts] = useState({
    missed_clock_in: 0,
    overtime: 0,
    shortage: 0,
    vacation: 0
  });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  // Fixed grace period of 10 minutes
  const GRACE_PERIOD_MINUTES = 10;

  const supervisorEmail = localStorage.getItem('supervisorEmail');

  useEffect(() => {
    // Clear any existing interval when component unmounts
    return () => {
      if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    };
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        toast.loading('Cargando datos iniciales...', { id: 'loading-data' });
        setIsLoading(true);
        await fetchSupervisorWorkCenters();
        await fetchEmployees();
        await fetchAlerts();
        setLastRefresh(new Date());
        startRealTimeMonitoring();
        await checkAllEmployeesForAlerts();
        toast.dismiss('loading-data');
        toast.success('Datos cargados correctamente');
      } catch (error) {
        console.error('Error loading initial data:', error);
        toast.dismiss('loading-data');
        toast.error('Error al cargar los datos iniciales');
      } finally {
        setIsLoading(false);
      }
    };

    // Setup auto-refresh every hour
    const setupAutoRefresh = () => {
      if (autoRefreshInterval) clearInterval(autoRefreshInterval);
      
      const interval = setInterval(async () => {
        console.log('Auto-refreshing alerts data...');
        await refreshData();
      }, 60 * 60 * 1000); // Every hour
      
      setAutoRefreshInterval(interval);
    };

    loadInitialData();
    setupAutoRefresh();

    return () => {
      if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    };
  }, []);

  useEffect(() => {
    const counts = {
      missed_clock_in: alerts.filter(a => a.alert_type === 'missed_clock_in' && a.status === 'pending').length,
      overtime: alerts.filter(a => a.alert_type === 'overtime' && a.status === 'pending').length,
      shortage: alerts.filter(a => a.alert_type === 'shortage' && a.status === 'pending').length,
      vacation: alerts.filter(a => a.alert_type === 'vacation' && a.status === 'pending').length
    };
    setPendingCounts(counts);
  }, [alerts]);

  useEffect(() => {
    if (supervisorWorkCenters.length > 0) {
      fetchEmployees();
      fetchAlerts();
      setLastRefresh(new Date());
    }
  }, [selectedWorkCenter, searchTerm]);

  const checkAllEmployeesForAlerts = async () => {
    if (!employees.length) return;
    
    // Check for the last 7 days to catch any missed alerts
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    toast.loading('Verificando alertas para todos los empleados...', { id: 'checking-alerts' });
    
    let processedCount = 0;
    const totalToProcess = employees.length;
    
    for (const employee of employees) {
      try {
        // Check each day in the range
        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
          await checkEmployeeAlertsForDate(employee, new Date(date));
        }
        
        processedCount++;
        if (processedCount % 5 === 0 || processedCount === totalToProcess) {
          toast.loading(`Procesando empleados: ${processedCount}/${totalToProcess}...`, { id: 'checking-alerts' });
        }
      } catch (error) {
        console.error(`Error checking alerts for employee ${employee.fiscal_name}:`, error);
      }
    }
    
    toast.dismiss('checking-alerts');
    toast.success(`Verificación completada para ${totalToProcess} empleados`);
  };

  const checkEmployeeAlertsForDate = async (employee: Employee, date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    
    // 1. Fetch employee schedule for this date
    const { data: scheduleData, error: scheduleError } = await supabase
      .from('employee_schedules')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('date', dateStr);
      
    if (scheduleError) {
      console.error('Error fetching employee schedule:', scheduleError);
      return;
    }
    
    if (!scheduleData || scheduleData.length === 0) return;
    
    const daySchedule: EmployeeSchedule = scheduleData[0];

    // 2. Check for holidays
    const isHoliday = await checkHoliday(dateStr, employee.work_centers);
    if (isHoliday) {
      // If it's a holiday, check if the employee worked
      const timeEntries: TimeEntry[] = await fetchTimeEntries(employee.id, dateStr, dateStr);
      if (timeEntries.length > 0) {
        // Create an alert for working on a holiday
        await createAlert({
          employee,
          alert_type: 'vacation',
          date: dateStr,
          hours: calculateActualHours(timeEntries),
          percentage: 100,
          work_center: timeEntries[0]?.work_center || employee.work_centers[0] || '',
          details: `Trabajó durante un día festivo (${dateStr})`,
        });
      }
      return;
    }

    // 3. Check for missed clock-ins/outs
    await checkMissedClockInsAndOuts(employee, dateStr, daySchedule);

    // 4. Check for overtime/shortage
    // Only check for completed days (not today or future dates)
    if (new Date(dateStr) < new Date(new Date().toISOString().split('T')[0])) {
      await checkOvertimeAndShortage(employee, dateStr, daySchedule);
    }
  };

  const checkMissedClockInsAndOuts = async (employee: Employee, dateStr: string, daySchedule: EmployeeSchedule) => {
    const timeEntries: TimeEntry[] = await fetchTimeEntries(employee.id, dateStr, dateStr);
    
    // Sort time entries by timestamp
    const sortedEntries = timeEntries.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Separate clock-ins and clock-outs
    const clockIns = sortedEntries.filter(entry => entry.entry_type === 'clock_in');
    const clockOuts = sortedEntries.filter(entry => entry.entry_type === 'clock_out');
    
    // Check morning shift
    if (daySchedule.morning_start) {
      // Check morning clock-in (first clock-in of the day)
      if (clockIns.length === 0) {
        await createAlert({
          employee,
          alert_type: 'missed_clock_in',
          date: dateStr,
          hours: 0,
          percentage: 0,
          work_center: employee.work_centers[0] || '',
          details: `No fichó entrada mañana a la hora programada: ${daySchedule.morning_start}`,
        });
      } else {
        const firstClockIn = clockIns[0];
        const hasValidClockIn = checkTimeEntryExists(
          [firstClockIn], 
          'clock_in', 
          daySchedule.morning_start, 
          dateStr
        );
        
        if (!hasValidClockIn) {
          await createAlert({
            employee,
            alert_type: 'missed_clock_in',
            date: dateStr,
            hours: 0,
            percentage: 0,
            work_center: firstClockIn.work_center || employee.work_centers[0] || '',
            details: `Fichó entrada mañana fuera del horario programado: ${daySchedule.morning_start} (fichó a las ${new Date(firstClockIn.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`,
          });
        }
      }
    }
    
    if (daySchedule.morning_end) {
      // Check morning clock-out (first clock-out of the day)
      if (clockOuts.length === 0 && clockIns.length > 0) {
        // Has clock-in but no clock-out
        await createAlert({
          employee,
          alert_type: 'missed_clock_in',
          date: dateStr,
          hours: 0,
          percentage: 0,
          work_center: clockIns[0].work_center || employee.work_centers[0] || '',
          details: `No fichó salida mañana a la hora programada: ${daySchedule.morning_end}`,
        });
      } else if (clockOuts.length > 0) {
        const firstClockOut = clockOuts[0];
        const hasValidClockOut = checkTimeEntryExists(
          [firstClockOut], 
          'clock_out', 
          daySchedule.morning_end, 
          dateStr
        );
        
        if (!hasValidClockOut) {
          await createAlert({
            employee,
            alert_type: 'missed_clock_in',
            date: dateStr,
            hours: 0,
            percentage: 0,
            work_center: firstClockOut.work_center || employee.work_centers[0] || '',
            details: `Fichó salida mañana fuera del horario programado: ${daySchedule.morning_end} (fichó a las ${new Date(firstClockOut.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`,
          });
        }
      }
    }
    
    // Check afternoon shift (only if enabled)
    if (daySchedule.enabled) {
      if (daySchedule.afternoon_start) {
        // Check afternoon clock-in (second clock-in of the day)
        if (clockIns.length < 2) {
          await createAlert({
            employee,
            alert_type: 'missed_clock_in',
            date: dateStr,
            hours: 0,
            percentage: 0,
            work_center: employee.work_centers[0] || '',
            details: `No fichó entrada tarde a la hora programada: ${daySchedule.afternoon_start}`,
          });
        } else {
          const secondClockIn = clockIns[1];
          const hasValidClockIn = checkTimeEntryExists(
            [secondClockIn], 
            'clock_in', 
            daySchedule.afternoon_start, 
            dateStr
          );
          
          if (!hasValidClockIn) {
            await createAlert({
              employee,
              alert_type: 'missed_clock_in',
              date: dateStr,
              hours: 0,
              percentage: 0,
              work_center: secondClockIn.work_center || employee.work_centers[0] || '',
              details: `Fichó entrada tarde fuera del horario programado: ${daySchedule.afternoon_start} (fichó a las ${new Date(secondClockIn.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`,
            });
          }
        }
      }
      
      if (daySchedule.afternoon_end) {
        // Check afternoon clock-out (second clock-out of the day)
        if (clockOuts.length < 2) {
          // Check if there's a second clock-in but no second clock-out
          if (clockIns.length >= 2) {
            await createAlert({
              employee,
              alert_type: 'missed_clock_in',
              date: dateStr,
              hours: 0,
              percentage: 0,
              work_center: clockIns[1].work_center || employee.work_centers[0] || '',
              details: `No fichó salida tarde a la hora programada: ${daySchedule.afternoon_end}`,
            });
          }
        } else {
          const secondClockOut = clockOuts[1];
          const hasValidClockOut = checkTimeEntryExists(
            [secondClockOut], 
            'clock_out', 
            daySchedule.afternoon_end, 
            dateStr
          );
          
          if (!hasValidClockOut) {
            await createAlert({
              employee,
              alert_type: 'missed_clock_in',
              date: dateStr,
              hours: 0,
              percentage: 0,
              work_center: secondClockOut.work_center || employee.work_centers[0] || '',
              details: `Fichó salida tarde fuera del horario programado: ${daySchedule.afternoon_end} (fichó a las ${new Date(secondClockOut.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`,
            });
          }
        }
      }
    }
  };

  // Check if a time entry exists within the grace period
  const checkTimeEntryExists = (
    entries: TimeEntry[], 
    entryType: 'clock_in' | 'clock_out', 
    scheduledTime: string, 
    dateStr: string
  ): boolean => {
    // Validate scheduledTime format
    if (!scheduledTime || !scheduledTime.includes(':')) {
      return false;
    }

    const [scheduledHours, scheduledMinutes] = scheduledTime.split(':').map(Number);
    if (isNaN(scheduledHours) || isNaN(scheduledMinutes)) {
      return false;
    }
    
    const scheduledDate = new Date(dateStr);
    scheduledDate.setHours(scheduledHours, scheduledMinutes, 0, 0);
    
    const graceStart = new Date(scheduledDate);
    graceStart.setMinutes(graceStart.getMinutes() - GRACE_PERIOD_MINUTES);
    
    const graceEnd = new Date(scheduledDate);
    graceEnd.setMinutes(graceEnd.getMinutes() + GRACE_PERIOD_MINUTES);
    
    return entries.some(entry => {
      if (entry.entry_type !== entryType) return false;
      const entryTime = new Date(entry.timestamp);
      return entryTime >= graceStart && entryTime <= graceEnd;
    });
  };

  // Check for overtime or shortage
  const checkOvertimeAndShortage = async (employee: Employee, dateStr: string, daySchedule: EmployeeSchedule) => {
    const timeEntries: TimeEntry[] = await fetchTimeEntries(employee.id, dateStr, dateStr);
    
    // Calculate expected hours
    const expectedHours = calculateExpectedHours(daySchedule);
    
    // If no expected hours (no schedule), skip
    if (expectedHours === 0) return;
    
    console.log(`Employee: ${employee.fiscal_name}, Date: ${dateStr}`);
    console.log(`Expected hours: ${expectedHours}`);
    console.log(`Time entries:`, timeEntries);
    
    // Calculate actual hours
    const actualHours = calculateActualHours(timeEntries);
    
    // If no time entries at all, create a shortage alert for the entire day
    if (timeEntries.length === 0) {
      await createAlert({
        employee,
        alert_type: 'shortage',
        date: dateStr,
        hours: expectedHours,
        percentage: 100,
        work_center: employee.work_centers[0] || '',
        details: `No trabajó en un día programado (${expectedHours.toFixed(2)}h esperadas)`,
      });
      return;
    }
    
    console.log(`Actual hours: ${actualHours}`);
    console.log(`Difference: ${actualHours - expectedHours}`);
    
    // Check for overtime (only if worked more than expected)
    if (actualHours > expectedHours) {
      const overtimeHours = actualHours - expectedHours;
      // Only create alert if overtime is at least 15 minutes and 5% of expected hours
      if (overtimeHours >= 0.25 && overtimeHours >= (expectedHours * 0.05)) {
        await createAlert({
          employee,
          alert_type: 'overtime',
          date: dateStr,
          hours: overtimeHours,
          percentage: (overtimeHours / expectedHours) * 100,
          work_center: timeEntries[0]?.work_center || employee.work_centers[0] || '',
          details: `Trabajó ${actualHours.toFixed(2)}h (esperadas: ${expectedHours.toFixed(2)}h) - ${overtimeHours.toFixed(2)}h extras`,
        });
      }
    } 
    // Check for shortage (only if worked less than expected)
    else if (actualHours < expectedHours) {
      const shortageHours = expectedHours - actualHours;
      // Only create alert if shortage is at least 15 minutes and 5% of expected hours
      if (shortageHours >= 0.25 && shortageHours >= (expectedHours * 0.05)) {
        await createAlert({
          employee,
          alert_type: 'shortage',
          date: dateStr,
          hours: shortageHours,
          percentage: (shortageHours / expectedHours) * 100,
          work_center: timeEntries[0]?.work_center || employee.work_centers[0] || '',
          details: `Trabajó ${actualHours.toFixed(2)}h (esperadas: ${expectedHours.toFixed(2)}h) - ${shortageHours.toFixed(2)}h faltantes`,
        });
      }
    }
  };

  // Calculate expected hours from schedule
  const calculateExpectedHours = (daySchedule: EmployeeSchedule): number => {
    let totalExpectedHours = 0;

    // Calculate morning hours (morning_start to morning_end)
    if (daySchedule.morning_start && daySchedule.morning_end) {
      try {
        const [startHour, startMin] = daySchedule.morning_start.split(':').map(Number);
        const [endHour, endMin] = daySchedule.morning_end.split(':').map(Number);
        
        if (!isNaN(startHour) && !isNaN(startMin) && !isNaN(endHour) && !isNaN(endMin)) {
          const startTime = startHour + (startMin / 60);
          const endTime = endHour + (endMin / 60);
          
          if (endTime > startTime) {
            totalExpectedHours += endTime - startTime;
          }
        }
      } catch (error) {
        console.error('Error calculating morning hours:', error);
      }
    }

    // Calculate afternoon hours if enabled (afternoon_start to afternoon_end)
    if (daySchedule.enabled && daySchedule.afternoon_start && daySchedule.afternoon_end) {
      try {
        const [startHour, startMin] = daySchedule.afternoon_start.split(':').map(Number);
        const [endHour, endMin] = daySchedule.afternoon_end.split(':').map(Number);
        
        if (!isNaN(startHour) && !isNaN(startMin) && !isNaN(endHour) && !isNaN(endMin)) {
          const startTime = startHour + (startMin / 60);
          const endTime = endHour + (endMin / 60);
          
          if (endTime > startTime) {
            totalExpectedHours += endTime - startTime;
          }
        }
      } catch (error) {
        console.error('Error calculating afternoon hours:', error);
      }
    }

    return totalExpectedHours;
  };

  // Calculate actual hours worked from time entries
  const calculateActualHours = (entries: TimeEntry[]): number => {
    if (entries.length === 0) return 0;
    
    // Separate clock-ins and clock-outs
    const clockIns = entries.filter(e => e.entry_type === 'clock_in').sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const clockOuts = entries.filter(e => e.entry_type === 'clock_out').sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    let totalActualHours = 0;
    
    // Calculate time for each clock-in/clock-out pair
    for (let i = 0; i < clockIns.length; i++) {
      if (clockOuts[i]) {
        const clockInTime = new Date(clockIns[i].timestamp);
        const clockOutTime = new Date(clockOuts[i].timestamp);
        
        // Calculate hours between clock-in and clock-out
        const hoursWorked = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
        totalActualHours += hoursWorked;
      }
    }
    
    return totalActualHours;
  };

  // Create an alert in the database
  const createAlert = async ({
    employee, 
    alert_type,
    date,
    hours,
    percentage,
    work_center,
    details
  }: {
    employee: Employee;
    alert_type: 'missed_clock_in' | 'overtime' | 'shortage' | 'vacation';
    date: string;
    hours: number;
    percentage: number;
    work_center: string;
    details: string;
  }) => {
    try {
      const alertId = `${employee.id}-${date}-${alert_type}-${Date.now()}`;
      
      // Check if there's already an alert of this type for this employee on this date (including dismissed ones)
      const { data: existingAlerts, error: existingError } = await supabase
        .from('employee_alerts')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('alert_type', alert_type)
        .eq('date', date);

      if (existingError) throw existingError;
      
      // Skip if there's already an alert of this type for this employee on this date (regardless of status)
      if (existingAlerts && existingAlerts.length > 0) return;

      const newAlert = {
        id: alertId,
        employee_id: employee.id,
        employee_name: employee.fiscal_name,
        alert_type,
        date,
        hours,
        percentage,
        work_center,
        details,
        status: 'pending',
        created_at: new Date().toISOString(),
        notified: false
      };

      const { data: insertedAlert, error: insertError } = await supabase
        .from('employee_alerts')
        .insert([newAlert])
        .select();

      if (insertError) throw insertError;

      setAlerts(prev => [insertedAlert[0], ...prev]);

      await sendEmailNotification(insertedAlert[0], employee);

      toast.success(`Nueva alerta generada para ${employee.fiscal_name}`, {
        position: 'top-right',
        duration: 5000,
      });

    } catch (error) {
      console.error('Error creating alert:', error);
      toast.error(`Error al crear la alerta para ${employee.fiscal_name}`, {
        position: 'top-right',
        duration: 5000,
      });
    }
  };

  // Check if a date is a holiday for the employee
  const checkHoliday = async (date: string, employeeWorkCenters: string[]): Promise<boolean> => { 
    try {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .eq('date', date);

      if (error) throw error;

      if (!data || data.length === 0) return false; 

      // Check if holiday applies to any of the employee's work centers
      return data.some(holiday => {
        // If holiday has no specific work center, it applies to all
        if (!holiday.work_center) return true;
        
        // Check if employee's work centers include the holiday's work center
        return employeeWorkCenters.includes(holiday.work_center);
      });
    } catch (error) {
      console.error('Error checking holiday:', error);
      return false;
    }
  };

  // Send email notification for an alert
  const sendEmailNotification = async (alert: Alert, employee: Employee) => {
    try {
      const alertTypeText = alert.alert_type === 'missed_clock_in' ? 'Fichaje no realizado' :
                          alert.alert_type === 'overtime' ? 'Horas extras' :
                          alert.alert_type === 'shortage' ? 'Merma de horas' : 'Trabajo en vacaciones';

      const { error: emailError } = await supabase
        .from('email_notifications')
        .insert({
          to_email: supervisorEmail,
          subject: `[ALERTA] ${alertTypeText} - ${employee.fiscal_name} - ${alert.date}`,
          message: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #3b82f6;">Alerta de Control de Tiempo</h1>
              <p>Se ha detectado una nueva alerta para ${employee.fiscal_name}:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Tipo</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${alertTypeText}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Fecha</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${new Date(alert.date).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Centro</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${alert.work_center}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Detalles</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${alert.details}</td>
                </tr>
              </table>
              
              <p style="margin-top: 20px;">Por favor, revise esta alerta en el Portal Coordinador.</p>
            </div>
          `,
          employee_id: employee.id,
          alert_id: alert.id
        });

      if (emailError) throw emailError;

      await supabase
        .from('employee_alerts') 
        .update({ notified: true })
        .eq('id', alert.id);

    } catch (error) {
      console.error('Error sending email notification:', error);
    }
  };

  const fetchTimeEntries = async (employeeId: string, startDate: string, endDate: string): Promise<TimeEntry[]> => { 
    try {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      const { data, error } = await supabase 
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .gte('timestamp', start.toISOString())
        .lte('timestamp', end.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching time entries:', err);
      return [];
    }
  };

  const fetchSupervisorWorkCenters = async () => {
    try { 
      if (!supervisorEmail) return;
      
      const { data: supervisor, error } = await supabase
        .from('supervisor_profiles')
        .select('work_centers')
        .eq('email', supervisorEmail)
        .single();

      if (error) throw error;
      
      if (supervisor?.work_centers?.length) {
        setSupervisorWorkCenters(supervisor.work_centers);
        if (supervisor.work_centers.length === 1) {
          setSelectedWorkCenter(supervisor.work_centers[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching supervisor work centers:', error);
    }
  };

  const fetchEmployees = async () => {
    try { 
      if (!supervisorEmail || supervisorWorkCenters.length === 0) return;
      
      let workCentersToQuery = selectedWorkCenter ? [selectedWorkCenter] : supervisorWorkCenters;

      const { data: employeesData, error } = await supabase
        .from('employee_profiles')
        .select('*')
        .overlaps('work_centers', workCentersToQuery) 
        .eq('is_active', true)
        .order('fiscal_name', { ascending: true });

      if (error) throw error;

      if (employeesData) {
        let filteredEmployees = employeesData || [];
         
        if (searchTerm) {
          filteredEmployees = filteredEmployees.filter(emp => 
            emp.fiscal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            emp.email.toLowerCase().includes(searchTerm.toLowerCase())
          );
        }

        setEmployees(filteredEmployees); 
        setWorkCenters([...new Set(filteredEmployees.flatMap(emp => emp.work_centers || []))]);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchAlerts = async () => {
    setIsLoading(true); 
    try {
      if (!employees.length) {
        setAlerts([]);
        return;
      }
      
      let query = supabase
        .from('employee_alerts') 
        .select('*')
        .in('employee_id', employees.map(emp => emp.id));
      
      if (alertType) {
        query = query.eq('alert_type', alertType);
      }

      if (selectedWorkCenter) {
        query = query.eq('work_center', selectedWorkCenter);
      }

      const { data: alertsData, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      
      setAlerts(alertsData || []);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startRealTimeMonitoring = () => {
    const timeEntriesSubscription = supabase 
      .channel('time-entry-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_entries' }, handleTimeEntryChange)
      .subscribe();

    const scheduleSubscription = supabase
      .channel('schedule-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'employee_schedules' }, handleScheduleChange)
      .subscribe();

    return () => {
      supabase.removeChannel(timeEntriesSubscription);
      supabase.removeChannel(scheduleSubscription);
    };
  };

  const handleTimeEntryChange = async (payload: any) => { 
    try {
      const employee = employees.find(e => e.id === payload.new.employee_id);
      if (!employee) return;

      const entryDate = new Date(payload.new.timestamp);
      await checkEmployeeAlertsForDate(employee, entryDate);
    } catch (error) {
      console.error('Error handling time entry change:', error);
    }
  };

  const handleScheduleChange = async (payload: any) => { 
    try {
      const employee = employees.find(e => e.id === payload.new.employee_id);
      if (!employee) return;

      const scheduleDate = new Date(payload.new.date);
      await checkEmployeeAlertsForDate(employee, scheduleDate);
    } catch (error) {
      console.error('Error handling schedule change:', error);
    }
  };

  const handleExport = () => { 
    const alertTypeText = alertType === 'missed_clock_in' ? 'Fichajes Perdidos' :
                         alertType === 'overtime' ? 'Horas Extras' :
                         alertType === 'shortage' ? 'Mermas de Trabajo' : 'Vacaciones Trabajadas';
    
    const exportData = alerts.map(alert => ({
      'Nombre': alert.employee_name,
      'Fecha': new Date(alert.date).toLocaleDateString(),
      'Centro de Trabajo': alert.work_center,
      'Horas': alert.hours.toFixed(2),
      'Porcentaje': `${alert.percentage.toFixed(2)}%`,
      'Detalles': alert.details,
      'Fecha de creación': new Date(alert.created_at).toLocaleString()
    }));

    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Avisos');

    const fileName = `avisos_${alertTypeText.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const refreshData = async () => { 
    toast.loading('Actualizando datos...', { id: 'refreshing-data' });
    setIsLoading(true);
    try {
      await fetchEmployees();
      await fetchAlerts();
      setLastRefresh(new Date());
      await checkAllEmployeesForAlerts();
      toast.dismiss('refreshing-data');
      toast.success('Datos actualizados correctamente');
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast.dismiss('refreshing-data');
      toast.error('Error al actualizar los datos');
    } finally {
      setIsLoading(false);
    }
  };

  const markAsSeen = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from('employee_alerts')
        .update({ status: 'dismissed' })
        .eq('id', alertId);

      if (error) throw error;

      setAlerts(prev => 
        prev.map(alert => 
          alert.id === alertId ? { ...alert, status: 'dismissed' } : alert
        )
      );

      toast.success('Aviso marcado como visto');
    } catch (error) {
      console.error('Error marking alert as seen:', error);
      toast.error('Error al marcar como visto');
    }
  };

  return (
    <div className="p-8">
      <Toaster /> 
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Avisos Automáticos</h1>
          <p className="text-gray-600">Alertas de control de tiempo generadas automáticamente</p>
          <div className="mt-2 text-sm text-gray-500">
            Última actualización: {lastRefresh.toLocaleString('es-ES')}
            <br />
            <span className="text-xs">
              Los datos se actualizan automáticamente cada hora
            </span>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-4">
          <button 
            onClick={() => setAlertType('missed_clock_in')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg relative ${
              alertType === 'missed_clock_in'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Clock className="h-5 w-5" /> 
            Fichajes Perdidos
            {pendingCounts.missed_clock_in > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                {pendingCounts.missed_clock_in}
              </span>
            )}
          </button>
          <button 
            onClick={() => setAlertType('overtime')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg relative ${
              alertType === 'overtime'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Clock className="h-5 w-5" /> 
            Horas Extras
            {pendingCounts.overtime > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                {pendingCounts.overtime}
              </span>
            )}
          </button>
          <button 
            onClick={() => setAlertType('shortage')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg relative ${
              alertType === 'shortage'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <AlertTriangle className="h-5 w-5" /> 
            Mermas de trabajo
            {pendingCounts.shortage > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                {pendingCounts.shortage}
              </span>
            )}
          </button>
          <button 
            onClick={() => setAlertType('vacation')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg relative ${
              alertType === 'vacation'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Calendar className="h-5 w-5" /> 
            Vacaciones trabajadas
            {pendingCounts.vacation > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                {pendingCounts.vacation}
              </span>
            )}
          </button>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm space-y-4 mb-6"> 
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Filtros</h2>
            <button 
              onClick={refreshData}
              className="flex items-center gap-2 px-3 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> 
              {isLoading ? 'Actualizando...' : 'Refrescar datos'}
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {supervisorWorkCenters.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Centro de Trabajo
                </label>
                <select
                  value={selectedWorkCenter}
                  onChange={(e) => setSelectedWorkCenter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Todos mis centros</option>
                  {supervisorWorkCenters.map((center) => (
                    <option key={center} value={center}>
                      {center}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1"> 
                Buscar empleado
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Nombre del empleado..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            disabled={alerts.length === 0}
          >
            <Download className="w-5 h-5" />
            Exportar a Excel
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden"> 
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Empleado
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Centro de Trabajo
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {alertType === 'missed_clock_in' ? 'Hora Programada' : 
                     alertType === 'overtime' ? 'Horas Extra' : 
                     alertType === 'shortage' ? 'Horas Faltantes' : 'Horas Trabajadas'}
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Detalles
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado 
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center">
                      Cargando... 
                    </td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center">
                      No hay alertas para mostrar
                    </td>
                  </tr>
                ) : (
                  alerts.filter(alert => alert.alert_type === alertType).map((alert) => (
                    <tr key={alert.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {alert.employee_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {new Date(alert.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {alert.work_center}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap"> 
                        {alertType === 'missed_clock_in' ? (
                          <span className="font-medium text-purple-600">
                            {alert.details.includes(': ') ? alert.details.split(': ')[1] : 'Fichaje no realizado'}
                          </span>
                        ) : (
                          <span className={`font-medium ${
                            alertType === 'overtime' ? 'text-orange-600' : 
                            alertType === 'shortage' ? 'text-red-600' : 'text-blue-600'
                          }`}>
                            {alert.hours.toFixed(2)}h
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {alert.details}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap"> 
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          alert.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          alert.status === 'resolved' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {alert.status === 'pending' ? 'Pendiente' : 
                           alert.status === 'resolved' ? 'Resuelto' : 
                           'Descartado'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {alert.status === 'pending' && (
                          <button
                            onClick={() => markAsSeen(alert.id)}
                            className="flex items-center gap-1 px-2 py-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                            title="Marcar como visto"
                          >
                            <Eye className="w-4 h-4" />
                            <span className="text-xs">Visto</span>
                          </button>
                        )}
                        {alert.status === 'dismissed' && (
                          <span className="flex items-center gap-1 text-gray-600 text-xs">
                            <EyeOff className="w-4 h-4" />
                            Descartado
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}