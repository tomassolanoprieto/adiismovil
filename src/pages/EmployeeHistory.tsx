import React, { useState, useEffect, useRef } from 'react'; 
import { supabase } from '../lib/supabase';
import { Calendar, Download, FileText, PenTool, X, Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import toast, { Toaster } from 'react-hot-toast';

interface DailyReport {
  date: string;
  clock_in: string;
  clock_out: string;
  break_duration: string;
  total_hours: number;
  night_hours: number;
}

interface SignatureData {
  x: number;
  y: number;
  time: number;
  pressure: number;
}

export default function EmployeeHistory() {
  const today = new Date().toISOString().split('T')[0];

  const [entries, setEntries] = useState([]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [totalTime, setTotalTime] = useState(0);
  const [totalNightTime, setTotalNightTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [employeeData, setEmployeeData] = useState<any>(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signature, setSignature] = useState<SignatureData[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [allowEmailClient, setAllowEmailClient] = useState(true);
  const [supervisorEmail, setSupervisorEmail] = useState<string | null>(null);
  const [hourTypeFilter, setHourTypeFilter] = useState<'all' | 'regular' | 'night'>('all');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 25;

  // New states for schedule metrics
  const [todayWorkedHours, setTodayWorkedHours] = useState(0);
  const [todayScheduledHours, setTodayScheduledHours] = useState(0);
  const [todayRemainingHours, setTodayRemainingHours] = useState(0);
  const [weekWorkedHours, setWeekWorkedHours] = useState(0);
  const [weekScheduledHours, setWeekScheduledHours] = useState(0);
  const [weekRemainingHours, setWeekRemainingHours] = useState(0);

  // Función para calcular horas nocturnas (22:00 - 06:00)
  const calculateNightHours = (start: string, end: string): number => {
    const startTime = new Date(start);
    const endTime = new Date(end);
    
    // Ajustar si el endTime es del día siguiente
    if (endTime < startTime) {
      endTime.setDate(endTime.getDate() + 1);
    }
    
    let nightHours = 0;
    const nightStart = new Date(startTime);
    nightStart.setHours(22, 0, 0, 0);
    const nightEnd = new Date(startTime);
    nightEnd.setDate(nightEnd.getDate() + 1);
    nightEnd.setHours(6, 0, 0, 0);
    
    // Calcular intersección con el periodo nocturno
    const overlapStart = new Date(Math.max(startTime.getTime(), nightStart.getTime()));
    const overlapEnd = new Date(Math.min(endTime.getTime(), nightEnd.getTime()));
    
    if (overlapStart < overlapEnd) {
      nightHours = (overlapEnd - overlapStart) / (1000 * 60 * 60);
    }
    
    return nightHours;
  };

  const handleSearch = async () => {
    await fetchTimeEntries();
    setCurrentPage(1);
  };

  const fetchEmployeeData = async () => {
  try {
    const employeeId = localStorage.getItem('employeeId');
    if (!employeeId) {
      throw new Error('No employee ID found');
    }

    const { data, error } = await supabase
      .from('employee_profiles')
      .select('*')
      .eq('id', employeeId)
      .single();

    if (error) throw error;
    setEmployeeData(data || null); // Asegúrate de establecer null si no hay datos
  } catch (err) {
    console.error('Error fetching employee data:', err);
    setEmployeeData(null);
    toast.error('Error al cargar los datos del empleado');
  }
};

  const fetchSupervisorEmail = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const { data: employeeData, error: employeeError } = await supabase
        .from('employee_profiles')
        .select('work_centers, delegation, company_id')
        .eq('id', employeeId)
        .single();

      if (employeeError) throw employeeError;
      if (!employeeData?.work_centers?.length || !employeeData?.company_id) return;

      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('email')
        .eq('is_active', true)
        .eq('company_id', employeeData.company_id)
        .overlaps('work_centers', employeeData.work_centers)
        .limit(1);

      if (supervisorError) throw supervisorError;

      if (supervisorData?.length) {
        setSupervisorEmail(supervisorData[0].email);
      }
    } catch (err) {
      console.error('Error fetching supervisor email:', err);
    }
  };

  const fetchTimeEntries = async () => {
  try {
    setLoading(true);
    setError(null);

    const employeeId = localStorage.getItem('employeeId');
    if (!employeeId) {
      throw new Error('No se encontró el ID del empleado');
    }

    let query = supabase
  .from('time_entries')
  .select('*')
  .eq('employee_id', employeeId)
  .or('changes.neq.eliminated,changes.is.null')  // <- Solo excluye "eliminated"
  .order('timestamp', { ascending: true });

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query = query.gte('timestamp', start.toISOString());
    }
    
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte('timestamp', end.toISOString());
    }

    const { data, error: entriesError } = await query;
    if (entriesError) throw entriesError;

    setEntries(data || []);
    calculateTotalTime(data);
  } catch (err) {
    console.error('Error fetching time entries:', err);
    setError(err instanceof Error ? err.message : 'Error al cargar los fichajes');
  } finally {
    setLoading(false);
  }
};

  const calculateTotalTime = (entries) => {
    if (!entries || entries.length === 0) {
      setTotalTime(0);
      setTotalNightTime(0);
      return;
    }

    const employeeId = localStorage.getItem('employeeId');
    if (!employeeId) {
      setTotalTime(0);
      setTotalNightTime(0);
      return;
    }

    const { dailyResults } = processTimeEntries(employeeId, entries);

    const totalMs = dailyResults.reduce((sum, day) => {
      if (day.hours) {
        return sum + (day.hours * 1000 * 60 * 60);
      }
      return sum;
    }, 0);

    const totalNightMs = dailyResults.reduce((sum, day) => {
      if (day.nightHours) {
        return sum + (day.nightHours * 1000 * 60 * 60);
      }
      return sum;
    }, 0);

    setTotalTime(totalMs);
    setTotalNightTime(totalNightMs);
  };

  const processTimeEntries = (employeeId: string, timeEntries: any[]) => {
  const employeeEntries = timeEntries
  .filter(entry => entry.employee_id === employeeId && entry.changes !== 'eliminated')  // <- Filtro local
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const dailyResults: any[] = [];
    let currentEntries: any[] = [];

    const getHoursWorked = (start: string, end: string, breakMs: number) => {
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      return ((endTime - startTime) / (1000 * 60 * 60)) - (breakMs / (1000 * 60 * 60));
    };

    for (const entry of employeeEntries) {
      const dateKey = entry.timestamp.split('T')[0];
      const entryTime = new Date(entry.timestamp);

      switch (entry.entry_type) {
        case 'clock_in':
          currentEntries.push({
            date: dateKey,
            dateObj: new Date(dateKey),
            clockIn: entry.timestamp,
            breakDuration: 0,
            clockOut: undefined,
            hours: 0,
            nightHours: 0
          });
          break;

        case 'break_start':
          if (currentEntries.length > 0) {
            const lastEntry = currentEntries[currentEntries.length - 1];
            if (lastEntry.clockIn && !lastEntry.clockOut) {
              lastEntry.breakStart = entry.timestamp;
            }
          }
          break;

        case 'break_end':
          if (currentEntries.length > 0) {
            const lastEntry = currentEntries[currentEntries.length - 1];
            if (lastEntry.breakStart) {
              const breakStart = new Date(lastEntry.breakStart).getTime();
              const breakEnd = entryTime.getTime();
              lastEntry.breakDuration += (breakEnd - breakStart);
              lastEntry.breakStart = undefined;
            }
          }
          break;

        case 'clock_out':
          if (currentEntries.length > 0) {
            const lastEntry = currentEntries[currentEntries.length - 1];
            if (lastEntry.clockIn && !lastEntry.clockOut) {
              lastEntry.clockOut = entry.timestamp;
              lastEntry.hours = getHoursWorked(
                lastEntry.clockIn,
                lastEntry.clockOut,
                lastEntry.breakDuration
              );
              lastEntry.nightHours = calculateNightHours(
                lastEntry.clockIn,
                lastEntry.clockOut
              );
              dailyResults.push(lastEntry);
              currentEntries.pop();
            }
          }
          break;
      }
    }

    // Procesar entradas pendientes al final del día
    currentEntries.forEach(entry => {
      if (entry.clockIn && !entry.clockOut) {
        const endOfDay = new Date(entry.date);
        endOfDay.setHours(23, 59, 59, 999);
        entry.clockOut = endOfDay.toISOString();
        entry.hours = getHoursWorked(
          entry.clockIn,
          entry.clockOut,
          entry.breakDuration
        );
        entry.nightHours = calculateNightHours(
          entry.clockIn,
          entry.clockOut
        );
        dailyResults.push(entry);
      }
    });

    const entriesByDate = employeeEntries.reduce((acc, entry) => {
      const date = entry.timestamp.split('T')[0];
      if (!acc[date]) acc[date] = [];
      acc[date].push(entry);
      return acc;
    }, {} as Record<string, any[]>);

    return {
      dailyResults,
      entriesByDate
    };
  };

  const filterToday = () => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    setStartDate(dateStr);
    setEndDate(dateStr);
    setCurrentPage(1);
  };

  const filterWeek = () => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
    
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    
    setStartDate(monday.toISOString().split('T')[0]);
    setEndDate(sunday.toISOString().split('T')[0]);
    setCurrentPage(1);
  };

  const filterMonth = () => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
    setCurrentPage(1);
  };

  const formatDuration = (ms) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const formatHours = (hours) => {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    return `${wholeHours}h ${minutes}m`;
  };

  const getEntryTypeText = (type) => {
    switch (type) {
      case 'clock_in': return 'Entrada';
      case 'break_start': return 'Inicio Pausa';
      case 'break_end': return 'Fin Pausa';
      case 'clock_out': return 'Salida';
      default: return type;
    }
  };

  const startSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!signatureCanvasRef.current) return;
    
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    setIsSigning(true);
    
    let x, y;
    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    
    setSignature([{ x, y, time: Date.now(), pressure: 0.5 }]);
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
    }
  };

  const drawSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isSigning || !signatureCanvasRef.current) return;
    
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    
    let x, y;
    if ('touches' in e) {
      e.preventDefault();
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    
    const newPoint = { x, y, time: Date.now(), pressure: 0.5 };
    setSignature(prev => [...prev, newPoint]);
    
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const endSignature = () => {
    setIsSigning(false);
    if (signatureCanvasRef.current) {
      setSignatureDataUrl(signatureCanvasRef.current.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    setSignature([]);
    setSignatureDataUrl(null);
    if (signatureCanvasRef.current) {
      const ctx = signatureCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, signatureCanvasRef.current.width, signatureCanvasRef.current.height);
      }
    }
  };

  const saveSignature = () => {
    if (signature.length === 0) {
      toast.error('Por favor, firma antes de continuar');
      return;
    }
    setShowSignatureModal(false);
    generateSignedReport();
  };

  useEffect(() => {
  const loadData = async () => {
    await fetchEmployeeData();
    await fetchSupervisorEmail();
    await fetchTimeEntries();
    await calculateScheduleMetrics();
  };
  loadData();
}, []);

  useEffect(() => {
    if (entries.length > 0) {
      calculateScheduleMetrics();
    }
  }, [entries]);

  const calculateScheduleMetrics = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      // Calcular inicio de semana (lunes)
      const startOfWeek = new Date(today);
      const dayOfWeek = today.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      startOfWeek.setDate(today.getDate() + diff);
      startOfWeek.setHours(0, 0, 0, 0);

      // Calcular fin de semana (domingo)
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      console.log('Fecha de hoy:', todayStr);
      console.log('Inicio de semana (lunes):', startOfWeek.toISOString().split('T')[0]);
      console.log('Fin de semana (domingo):', endOfWeek.toISOString().split('T')[0]);

      // Obtener horarios de la semana
      const { data: schedules, error: schedulesError } = await supabase
        .from('employee_schedules')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', startOfWeek.toISOString().split('T')[0])
        .lte('date', endOfWeek.toISOString().split('T')[0]);

      if (schedulesError) throw schedulesError;

      console.log('Horarios encontrados:', schedules?.length || 0);
      console.log('Horarios:', schedules);

      // Obtener fichajes de hoy
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      const { data: todayEntries, error: todayError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', today.toISOString())
        .lte('timestamp', todayEnd.toISOString())
        .order('timestamp', { ascending: true });

      if (todayError) throw todayError;

      console.log('Fichajes de hoy:', todayEntries?.length || 0);

      // Obtener fichajes de la semana
      const { data: weekEntries, error: weekError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', startOfWeek.toISOString())
        .lte('timestamp', endOfWeek.toISOString())
        .order('timestamp', { ascending: true });

      if (weekError) throw weekError;

      console.log('Fichajes de la semana:', weekEntries?.length || 0);

      // CALCULAR HORAS PROGRAMADAS DE HOY
      let todayScheduled = 0;
      const todaySchedule = schedules?.find(s => s.date === todayStr);
      if (todaySchedule) {
        console.log('Horario de hoy encontrado:', todaySchedule);

        // Mañana
        if (todaySchedule.morning_start && todaySchedule.morning_end) {
          const morning = calculateHoursBetween(todaySchedule.morning_start, todaySchedule.morning_end);
          todayScheduled += morning;
          console.log('Horas mañana:', morning);
        }

        // Tarde
        if (todaySchedule.afternoon_start && todaySchedule.afternoon_end) {
          const afternoon = calculateHoursBetween(todaySchedule.afternoon_start, todaySchedule.afternoon_end);
          todayScheduled += afternoon;
          console.log('Horas tarde:', afternoon);
        }
      } else {
        console.log('NO se encontró horario para hoy');
      }

      console.log('Total horas programadas hoy:', todayScheduled);

      // CALCULAR HORAS PROGRAMADAS DE LA SEMANA
      let weekScheduled = 0;
      schedules?.forEach(schedule => {
        let dayTotal = 0;

        // Mañana
        if (schedule.morning_start && schedule.morning_end) {
          const morning = calculateHoursBetween(schedule.morning_start, schedule.morning_end);
          dayTotal += morning;
        }

        // Tarde
        if (schedule.afternoon_start && schedule.afternoon_end) {
          const afternoon = calculateHoursBetween(schedule.afternoon_start, schedule.afternoon_end);
          dayTotal += afternoon;
        }

        weekScheduled += dayTotal;
        console.log(`Fecha ${schedule.date}: ${dayTotal} horas`);
      });

      console.log('Total horas programadas semana:', weekScheduled);

      // CALCULAR HORAS TRABAJADAS
      const todayWorked = calculateWorkedHours(todayEntries || []);
      const weekWorked = calculateWorkedHours(weekEntries || []);

      console.log('Horas trabajadas hoy:', todayWorked);
      console.log('Horas trabajadas semana:', weekWorked);

      // ACTUALIZAR ESTADOS
      setTodayScheduledHours(todayScheduled);
      setTodayWorkedHours(todayWorked);
      setTodayRemainingHours(Math.max(0, todayScheduled - todayWorked));
      setWeekScheduledHours(weekScheduled);
      setWeekWorkedHours(weekWorked);
      setWeekRemainingHours(Math.max(0, weekScheduled - weekWorked));

      console.log('=== RESUMEN ===');
      console.log('Hoy programadas:', todayScheduled, 'trabajadas:', todayWorked, 'restantes:', Math.max(0, todayScheduled - todayWorked));
      console.log('Semana programadas:', weekScheduled, 'trabajadas:', weekWorked, 'restantes:', Math.max(0, weekScheduled - weekWorked));
    } catch (err) {
      console.error('Error calculating schedule metrics:', err);
    }
  };

  const calculateHoursBetween = (start: string, end: string): number => {
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    return (endMinutes - startMinutes) / 60;
  };

  const calculateWorkedHours = (entries: any[]): number => {
    let totalHours = 0;
    let clockIn: Date | null = null;
    let breakStart: Date | null = null;
    let breakDuration = 0;

    for (const entry of entries) {
      const entryTime = new Date(entry.timestamp);

      switch (entry.entry_type) {
        case 'clock_in':
          clockIn = entryTime;
          breakDuration = 0;
          break;
        case 'break_start':
          breakStart = entryTime;
          break;
        case 'break_end':
          if (breakStart) {
            breakDuration += (entryTime.getTime() - breakStart.getTime()) / (1000 * 60 * 60);
            breakStart = null;
          }
          break;
        case 'clock_out':
          if (clockIn) {
            const worked = (entryTime.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
            totalHours += worked - breakDuration;
            clockIn = null;
            breakDuration = 0;
          }
          break;
      }
    }

    if (clockIn) {
      const now = new Date();
      const worked = (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
      totalHours += worked - breakDuration;
    }

    return totalHours;
  };

// En openEmailWithAttachment
const openEmailWithAttachment = (pdfBlob: Blob, recipients: string[], allowEmail: boolean) => {
  try {
    if (!employeeData) {
      throw new Error('Datos del empleado no disponibles');
    }

    const pdfUrl = URL.createObjectURL(pdfBlob);
    const fileName = `Informe_Jornadas_${employeeData.fiscal_name?.replace(/\s+/g, '_') || 'empleado'}_${reportStartDate}_${reportEndDate}.pdf`;
      
      // Descargar automáticamente el PDF
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = fileName;
      link.click();
      
      // Formatear fechas para el asunto/cuerpo del correo
      const formattedStartDate = new Date(reportStartDate).toLocaleDateString('es-ES');
      const formattedEndDate = new Date(reportEndDate).toLocaleDateString('es-ES');
      
      if (allowEmail) {
        const emailSubject = `Informe Jornadas ${employeeData.fiscal_name} del periodo ${formattedStartDate} a ${formattedEndDate}`;
        const emailBody = `Hola,\n\nSe ha generado un nuevo informe firmado para ${employeeData.fiscal_name}.\nEl informe va adjunto a este mensaje. \nSi desea, puede revisar el contenido, y enviarlo, o directamente enviar este mensaje.\n\nEste correo ha sido generado automáticamente, por favor no responda a este mensaje.`;
        
        // Crear lista de destinatarios (empleado + supervisor si existe)
        const emailRecipients = [employeeData.email];
        if (supervisorEmail) {
          emailRecipients.push(supervisorEmail);
        }
        
        const mailtoLink = `mailto:${emailRecipients.join(';')}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
        
        window.location.href = mailtoLink;
        
        toast.success('Se ha abierto tu cliente de correo. Por favor, adjunta manualmente el archivo PDF que se ha descargado.');
      } else {
        toast.success('Informe firmado descargado correctamente');
      }
      
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 100);
      
      return true;
    } catch (err) {
      console.error('Error opening email client:', err);
      toast.error('Error al abrir el cliente de correo');
      return false;
    }
  };

  const generateSignedReport = async () => {
    if (!reportStartDate || !reportEndDate) {
      toast.error('Por favor seleccione el rango de fechas para el informe');
      return;
    }

    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      if (!employeeData) {
        throw new Error('No se encontraron los datos del empleado');
      }

      const { data: timeEntries, error } = await supabase
  .from('time_entries')
  .select('*')
  .eq('employee_id', employeeId)
  .or('changes.neq.eliminated,changes.is.null')  // <- Excluye solo "eliminated"
  .gte('timestamp', new Date(reportStartDate).toISOString())
  .lte('timestamp', new Date(reportEndDate + 'T23:59:59.999Z').toISOString())
  .order('timestamp', { ascending: true });

      if (error) throw error;

      const { dailyResults } = processTimeEntries(employeeId, timeEntries || []);

      const startDateObj = new Date(reportStartDate);
      const endDateObj = new Date(reportEndDate);
      
      // Agrupar fichajes por fecha para manejar múltiples fichajes por día
      const resultsByDate = dailyResults.reduce((acc, day) => {
        const dateKey = day.date;
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(day);
        return acc;
      }, {} as Record<string, any[]>);

      const allDays: DailyReport[] = [];
      for (let date = new Date(startDateObj); date <= endDateObj; date.setDate(date.getDate() + 1)) {
        const dateKey = date.toISOString().split('T')[0];
        const dayEntries = resultsByDate[dateKey] || [];

        // Si no hay fichajes, mostrar una línea vacía
        if (dayEntries.length === 0) {
          allDays.push({
            date: date.toLocaleDateString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }),
            clock_in: '',
            clock_out: '',
            break_duration: '',
            total_hours: 0,
            night_hours: 0
          });
        } else {
          // Para cada fichaje del día, crear una línea
          dayEntries.forEach((entry, index) => {
            allDays.push({
              date: index === 0 ? date.toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              }) : '',
              clock_in: entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
              }) : '',
              clock_out: entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
              }) : '',
              break_duration: entry.breakDuration > 0 ? 
                `${Math.floor(entry.breakDuration / (1000 * 60 * 60))}:${Math.floor((entry.breakDuration % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0')}` : '',
              total_hours: entry.hours || 0,
              night_hours: entry.nightHours || 0
            });
          });
        }
      }

      const doc = new jsPDF();

      doc.setFontSize(14);
      doc.text('Listado mensual del registro de jornada', 105, 20, { align: 'center' });

      doc.setFontSize(10);
      const tableData = [
        [`Empresa: ${report.company?.fiscal_name || 'Empresa no disponible'}`, `Trabajador: ${report.employee.fiscal_name}`],
        [`C.I.F/N.I.F: ${report.company?.nif || 'NIF no disponible'}`, `N.I.F: ${report.employee.document_number}`],
        [`Centro de Trabajo: ${report.employee.work_centers.join(', ')}`, `Nº Afiliación: 281204329001`],
        ['C.C.C:', `Mes y Año: ${new Date(startDate).toLocaleDateString('es-ES', { month: '2-digit', year: 'numeric' })}`]
      ];

      doc.autoTable({
        startY: 30,
        head: [],
        body: tableData,
        theme: 'plain',
        styles: {
          cellPadding: 2,
          fontSize: 10
        },
        columnStyles: {
          0: { cellWidth: 95 },
          1: { cellWidth: 95 }
        }
      });

      const recordsData = allDays.map(day => [
        day.date,
        day.clock_in,
        day.clock_out,
        day.break_duration,
        day.total_hours ? 
          `${Math.floor(day.total_hours)}:${Math.round((day.total_hours % 1) * 60).toString().padStart(2, '0')}` : 
          '0:00',
        day.night_hours ? 
          `${Math.floor(day.night_hours)}:${Math.round((day.night_hours % 1) * 60).toString().padStart(2, '0')}` : 
          '0:00'
      ]);

      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['DIA', 'ENTRADA', 'SALIDA', 'PAUSAS', 'HORAS TOTALES', 'HORAS NOCTURNAS']],
        body: recordsData,
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 25 },
          2: { cellWidth: 25 },
          3: { cellWidth: 25 },
          4: { cellWidth: 30 },
          5: { cellWidth: 30 }
        }
      });

      const totalHours = allDays.reduce((acc, day) => acc + (day.total_hours || 0), 0);
      const totalNightHours = allDays.reduce((acc, day) => acc + (day.night_hours || 0), 0);
      
      const formatHours = (hours: number) => {
        const h = Math.floor(hours);
        const m = Math.round((hours % 1) * 60);
        return `${h}:${m.toString().padStart(2, '0')}`;
      };

      doc.autoTable({
        startY: doc.lastAutoTable.finalY,
        head: [],
        body: [
          ['TOTAL HORAS', '', '', '', formatHours(totalHours), formatHours(totalNightHours)]
        ],
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center',
          fontStyle: 'bold'
        },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 25 },
          2: { cellWidth: 25 },
          3: { cellWidth: 25 },
          4: { cellWidth: 30 },
          5: { cellWidth: 30 }
        }
      });

      if (signatureDataUrl) {
        doc.addImage(signatureDataUrl, 'PNG', 140, doc.lastAutoTable.finalY + 20, 50, 20);
      }

      doc.setFontSize(10);
      doc.text('Firma de la Empresa:', 40, doc.lastAutoTable.finalY + 30);
      doc.text('Firma del Trabajador:', 140, doc.lastAutoTable.finalY + 30);

      doc.setFontSize(8);
      doc.text(`En Madrid, a ${new Date().toLocaleDateString('es-ES', { 
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })}`, 14, doc.lastAutoTable.finalY + 60);

      doc.setFontSize(6);
      const legalText = 'Registro realizado en cumplimiento del Real Decreto-ley 8/2019, de 8 de marzo, de medidas urgentes de protección social y de lucha contra la precariedad laboral en la jornada de trabajo ("BOE" núm. 61 de 12 de marzo), la regulación de forma expresa en el artículo 34 del texto refundido de la Ley del Estatuto de los Trabajadores (ET), la obligación de las empresas de registrar diariamente la jornada laboral.';
      doc.text(legalText, 14, doc.lastAutoTable.finalY + 70, {
        maxWidth: 180,
        align: 'justify'
      });

      const pdfBlob = doc.output('blob');
      const recipients = [employeeData.email];
      
      if (supervisorEmail) {
        recipients.push(supervisorEmail);
      }
      
      const emailOpened = openEmailWithAttachment(pdfBlob, recipients, allowEmailClient);
      
      if (!emailOpened) {
        doc.save(`informe_firmado_${employeeData.fiscal_name || 'empleado'}_${reportStartDate}_${reportEndDate}.pdf`);
      }

      // Registro en base de datos
      try {
        const { data: reportData, error: reportError } = await supabase
          .from('signed_reports')
          .insert([{
            employee_id: employeeId,
            report_url: 'local_download',
            start_date: reportStartDate,
            end_date: reportEndDate,
            status: 'sent',
            recipient_emails: recipients
          }])
          .select();
        
        if (reportError) throw reportError;
        
      } catch (dbError) {
        console.error('Error registrando el informe:', dbError);
        toast.error('El informe se generó pero no se pudo registrar en el sistema');
      }

    } catch (err) {
      console.error('Error generating signed report:', err);
      toast.error(err instanceof Error ? err.message : 'Error al generar el informe firmado');
    }
  };

  const generateOfficialReport = async () => {
    if (!reportStartDate || !reportEndDate) {
      toast.error('Por favor seleccione el rango de fechas para el informe');
      return;
    }

    toast(
      (t) => (
        <div className="flex flex-col items-center p-4">
          <p className="mb-4 text-center">¿Cómo desea proceder con el informe?</p>
          
          <div className="w-full mb-4">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="allowEmailClient"
                checked={allowEmailClient}
                onChange={(e) => setAllowEmailClient(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="allowEmailClient" className="text-sm text-gray-700">
                Abrir automáticamente el cliente de correo para enviar
              </label>
            </div>
            <p className="text-xs text-gray-500">
              El informe se enviará a: {employeeData.email} 
              {supervisorEmail ? ` y ${supervisorEmail}` : ''}
            </p>
          </div>
          
          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={() => {
                setShowSignatureModal(true);
                toast.dismiss(t.id);
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Firmar y Enviar
            </button>
            <button
              onClick={() => {
                generateUnsignedReport();
                toast.dismiss(t.id);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Solo Descargar (sin firmar)
            </button>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
            >
              Cancelar
            </button>
          </div>
        </div>
      ),
      { 
        duration: 15000,
        style: {
          minWidth: '400px'
        }
      }
    );
  };

  const generateUnsignedReport = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      if (!employeeData) {
        throw new Error('No se encontraron los datos del empleado');
      }

      if (!reportStartDate || !reportEndDate) {
        throw new Error('Por favor seleccione el rango de fechas para el informe');
      }

      const { data: timeEntries, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', new Date(reportStartDate).toISOString())
        .lte('timestamp', new Date(reportEndDate + 'T23:59:59.999Z').toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;

      const { dailyResults } = processTimeEntries(employeeId, timeEntries || []);

      const startDateObj = new Date(reportStartDate);
      const endDateObj = new Date(reportEndDate);
      
      // Agrupar fichajes por fecha para manejar múltiples fichajes por día
      const resultsByDate = dailyResults.reduce((acc, day) => {
        const dateKey = day.date;
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(day);
        return acc;
      }, {} as Record<string, any[]>);

      const allDays: DailyReport[] = [];
      for (let date = new Date(startDateObj); date <= endDateObj; date.setDate(date.getDate() + 1)) {
        const dateKey = date.toISOString().split('T')[0];
        const dayEntries = resultsByDate[dateKey] || [];

        // Si no hay fichajes, mostrar una línea vacía
        if (dayEntries.length === 0) {
          allDays.push({
            date: date.toLocaleDateString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }),
            clock_in: '',
            clock_out: '',
            break_duration: '',
            total_hours: 0,
            night_hours: 0
          });
        } else {
          // Para cada fichaje del día, crear una línea
          dayEntries.forEach((entry, index) => {
            allDays.push({
              date: index === 0 ? date.toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              }) : '',
              clock_in: entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
              }) : '',
              clock_out: entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
              }) : '',
              break_duration: entry.breakDuration > 0 ? 
                `${Math.floor(entry.breakDuration / (1000 * 60 * 60))}:${Math.floor((entry.breakDuration % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0')}` : '',
              total_hours: entry.hours || 0,
              night_hours: entry.nightHours || 0
            });
          });
        }
      }

      const doc = new jsPDF();

      doc.setFontSize(14);
      doc.text('Listado mensual del registro de jornada', 105, 20, { align: 'center' });

      doc.setFontSize(10);
      const tableData = [
        [`Empresa: ${report.company?.fiscal_name || 'Empresa no disponible'}`, `Trabajador: ${report.employee.fiscal_name}`],
        [`C.I.F/N.I.F: ${report.company?.nif || 'NIF no disponible'}`, `N.I.F: ${report.employee.document_number}`],
        [`Centro de Trabajo: ${employeeData.work_centers?.join(', ') || ''}`],
        ['C.C.C:', `Mes y Año: ${new Date(reportStartDate).toLocaleDateString('es-ES', { month: '2-digit', year: 'numeric' })}`]
      ];

      doc.autoTable({
        startY: 30,
        head: [],
        body: tableData,
        theme: 'plain',
        styles: {
          cellPadding: 2,
          fontSize: 10
        },
        columnStyles: {
          0: { cellWidth: 95 },
          1: { cellWidth: 95 }
        }
      });

      const recordsData = allDays.map(day => [
        day.date,
        day.clock_in,
        day.clock_out,
        day.break_duration,
        day.total_hours ? 
          `${Math.floor(day.total_hours)}:${Math.round((day.total_hours % 1) * 60).toString().padStart(2, '0')}` : 
          '0:00',
        day.night_hours ? 
          `${Math.floor(day.night_hours)}:${Math.round((day.night_hours % 1) * 60).toString().padStart(2, '0')}` : 
          '0:00'
      ]);

      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 10,
        head: [['DIA', 'ENTRADA', 'SALIDA', 'PAUSAS', 'HORAS TOTALES', 'HORAS NOCTURNAS']],
        body: recordsData,
        theme: 'grid',
        styles: {
          cellPadding: 2,
          fontSize: 8,
          halign: 'center'
        },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 25 },
          2: { cellWidth: 25 },
          3: { cellWidth: 25 },
          4: { cellWidth: 30 },
5: { cellWidth: 30 }
}
});
      const totalHours = allDays.reduce((acc, day) => acc + (day.total_hours || 0), 0);
  const totalNightHours = allDays.reduce((acc, day) => acc + (day.night_hours || 0), 0);
  
  const formatHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours % 1) * 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  doc.autoTable({
    startY: doc.lastAutoTable.finalY,
    head: [],
    body: [
      ['TOTAL HORAS', '', '', '', formatHours(totalHours), formatHours(totalNightHours)]
    ],
    theme: 'grid',
    styles: {
      cellPadding: 2,
      fontSize: 8,
      halign: 'center',
      fontStyle: 'bold'
    },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 25 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 30 },
      5: { cellWidth: 30 }
    }
  });

  doc.setFontSize(10);
  doc.text('Firma de la Empresa:', 40, doc.lastAutoTable.finalY + 30);
  doc.text('Firma del Trabajador:', 140, doc.lastAutoTable.finalY + 30);

  doc.setFontSize(8);
  doc.text(`En Madrid, a ${new Date().toLocaleDateString('es-ES', { 
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })}`, 14, doc.lastAutoTable.finalY + 60);

  doc.setFontSize(6);
  const legalText = 'Registro realizado en cumplimiento del Real Decreto-ley 8/2019, de 8 de marzo, de medidas urgentes de protección social y de lucha contra la precariedad laboral en la jornada de trabajo ("BOE" núm. 61 de 12 de marzo), la regulación de forma expresa en el artículo 34 del texto refundido de la Ley del Estatuto de los Trabajadores (ET), la obligación de las empresas de registrar diariamente la jornada laboral.';
  doc.text(legalText, 14, doc.lastAutoTable.finalY + 70, {
    maxWidth: 180,
    align: 'justify'
  });

  doc.save(`informe_oficial_${employeeData.fiscal_name || 'empleado'}_${reportStartDate}_${reportEndDate}.pdf`);

} catch (err) {
  console.error('Error generating unsigned report:', err);
  toast.error('Error al generar el informe');
}
};

// Get paginated entries
const paginatedEntries = entries.slice(
(currentPage - 1) * entriesPerPage,
currentPage * entriesPerPage
);

// Calculate total pages
const totalPages = Math.ceil(entries.length / entriesPerPage);

return (
<div className="max-w-7xl mx-auto px-4 py-8">
<div className="bg-white rounded-xl shadow-lg p-6">
<h2 className="text-2xl font-bold mb-6">Historial de Fichajes</h2>
      {error && (
      <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
        {error}
      </div>
    )}
    
    <div className="flex flex-wrap gap-4 mb-6">
      <div className="flex gap-2">
        <button
          onClick={filterToday}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Hoy
        </button>
        <button
          onClick={filterWeek}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Semana
        </button>
        <button
          onClick={filterMonth}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Mes
        </button>
      </div>
      <div className="flex gap-4 ml-auto">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha Inicio
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha Fin
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded-lg px-3 py-2"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleSearch}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Search className="w-5 h-5" />
            Buscar
          </button>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div className="bg-blue-50 p-6 rounded-lg">
        <h3 className="text-xl font-semibold mb-2">Tiempo Total Trabajado</h3>
        <p className="text-3xl font-bold text-blue-600">{formatDuration(totalTime)}</p>
      </div>
      <div className="bg-indigo-50 p-6 rounded-lg">
        <h3 className="text-xl font-semibold mb-2">Horas Nocturnas</h3>
        <p className="text-3xl font-bold text-indigo-600">{formatDuration(totalNightTime)}</p>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
        <h4 className="text-sm font-medium text-gray-600 mb-1">Horas Diarias Programadas</h4>
        <p className="text-2xl font-bold text-green-600">{formatHours(todayScheduledHours)}</p>
      </div>
      <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
        <h4 className="text-sm font-medium text-gray-600 mb-1">Horas Restantes Hoy</h4>
        <p className="text-2xl font-bold text-orange-600">{formatHours(todayRemainingHours)}</p>
      </div>
      <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
        <h4 className="text-sm font-medium text-gray-600 mb-1">Horas Semanales Trabajadas</h4>
        <p className="text-2xl font-bold text-purple-600">{formatHours(weekWorkedHours)}</p>
      </div>
      <div className="bg-pink-50 p-4 rounded-lg border border-pink-200">
        <h4 className="text-sm font-medium text-gray-600 mb-1">Horas Restantes Semana</h4>
        <p className="text-2xl font-bold text-pink-600">{formatHours(weekRemainingHours)}</p>
      </div>
    </div>

    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Fecha
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Hora
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Tipo
            </th>
            <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Centro de Trabajo
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {loading ? (
            <tr>
              <td colSpan={4} className="px-6 py-4 text-center">
                Cargando fichajes...
              </td>
            </tr>
          ) : paginatedEntries.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-6 py-4 text-center">
                No hay fichajes para mostrar
              </td>
            </tr>
          ) : (
            paginatedEntries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getEntryTypeText(entry.entry_type)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {entry.work_center || ''}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {/* Pagination controls */}
    {totalPages > 1 && (
      <div className="flex justify-between items-center mt-4 px-2">
        <button
          onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
          disabled={currentPage === 1}
          className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Anterior
        </button>
        
        <span className="text-sm text-gray-600">
          Página {currentPage} de {totalPages}
        </span>
        
        <button
          onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
          disabled={currentPage === totalPages}
          className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Siguiente
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    )}

    {/* Sección de Informes */}
    <div className="mt-12 pt-8 border-t border-gray-200">
      <h2 className="text-2xl font-bold mb-6">Informes</h2>
      
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="text-blue-600" />
          <h3 className="text-lg font-semibold">Informe Oficial</h3>
        </div>
        
        <p className="text-gray-600 mb-6">
          Genera un informe oficial de tu jornada laboral para el período seleccionado.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha Inicio
            </label>
            <input
              type="date"
              value={reportStartDate}
              onChange={(e) => setReportStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha Fin
            </label>
            <input
              type="date"
              value={reportEndDate}
              onChange={(e) => setReportEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
        
        <button
          onClick={generateOfficialReport}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <Download className="w-5 h-5" />
          Generar PDF
        </button>
      </div>
    </div>
    <Toaster position="top-center" />
  </div>

  {/* Modal de Firma */}
  {showSignatureModal && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Firmar Informe</h3>
          <button 
            onClick={() => setShowSignatureModal(false)}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <p className="mb-4 text-gray-600">
          Por favor, firma en el área de abajo con tu dedo o ratón.
        </p>
        
        <div className="border-2 border-dashed border-gray-300 rounded-lg mb-4">
          <canvas
            ref={signatureCanvasRef}
            width={500}
            height={200}
            className="w-full h-48 bg-gray-50 touch-none"
            onMouseDown={startSignature}
            onMouseMove={drawSignature}
            onMouseUp={endSignature}
            onMouseLeave={endSignature}
            onTouchStart={startSignature}
            onTouchMove={drawSignature}
            onTouchEnd={endSignature}
          />
        </div>
        
        <div className="flex justify-between">
          <button
            onClick={clearSignature}
            className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
          >
            <X className="w-5 h-5" />
            Limpiar
          </button>
          
          <button
            onClick={saveSignature}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Check className="w-5 h-5" />
            Confirmar Firma
          </button>
        </div>
      </div>
    </div>
  )}
</div>
);
}