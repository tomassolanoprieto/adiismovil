import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Calendar, ChevronLeft, ChevronRight, Clock, FileText, LogIn, LogOut, X, Download, Check } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import toast, { Toaster } from 'react-hot-toast';

interface CalendarEvent {
  id?: string;
  title: string;
  start: string | Date;
  end: string | Date;
  color: string;
  type: 'holiday' | 'workschedule' | 'timeentry' | 'planner' | 'vacation';
  details?: {
    entryType?: string;
    plannerType?: string;
  };
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

interface SignatureData {
  x: number;
  y: number;
  time: number;
  pressure: number;
}

export default function EmployeeCalendar() {
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [employeeSchedules, setEmployeeSchedules] = useState<EmployeeSchedule[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showHolidays, setShowHolidays] = useState(true);
  const [showWorkSchedule, setShowWorkSchedule] = useState(true);
  const [showTimeEntries, setShowTimeEntries] = useState(true);
  const [showVacations, setShowVacations] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [employeeData, setEmployeeData] = useState<any>(null);

  // Firma del trabajador
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signature, setSignature] = useState<SignatureData[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const signatureDataUrlRef = useRef<string | null>(null); // asegura disponibilidad inmediata tras confirmar

  // Acción pendiente que debe ejecutarse tras firmar
  const pendingActionRef = useRef<null | (() => void)>(null);

  const [supervisorEmail, setSupervisorEmail] = useState<string | null>(null);
  const [showCalendarReport, setShowCalendarReport] = useState(false);
  const [calendarSignatureRequested, setCalendarSignatureRequested] = useState(false);
  const [calendarReportSigned, setCalendarReportSigned] = useState(false);
  const [calendarReportPdfUrl, setCalendarReportPdfUrl] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const getEntryTypeText = (type: string) => {
    switch (type) {
      case 'clock_in': return 'Entrada';
      case 'clock_out': return 'Salida';
      case 'break_start': return 'Inicio Pausa';
      case 'break_end': return 'Fin Pausa';
      default: return type;
    }
  };

  useEffect(() => {
    fetchCalendarEvents();
    fetchEmployeeData();
    fetchSupervisorEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, showHolidays, showWorkSchedule, showTimeEntries, showVacations]);

  // ===== Helper: asegurar firma antes de continuar =====
  const ensureSignatureThen = (action: () => void) => {
    const hasSignature = !!(signatureDataUrlRef.current || signatureDataUrl);
    if (hasSignature) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setShowSignatureModal(true);
  };

  // === FIRMA DEL COORDINADOR: intenta encontrar una firma válida sin romper si faltan columnas ===
  const fetchSupervisorSignature = async (companyId: string, workCenters: string[] = []) => {
    try {
      const { data: appr } = await supabase
        .from('calendar_approvals')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const sig =
        (appr as any)?.supervisor_signature ??
        (appr as any)?.coordinator_signature ??
        (appr as any)?.signature ??
        null;
      if (sig) return sig;
    } catch { /* noop */ }

    try {
      let q = supabase
        .from('supervisor_profiles')
        .select('signature, signature_image, work_centers')
        .eq('company_id', companyId)
        .eq('is_active', true);

      if (workCenters?.length) q = q.overlaps('work_centers', workCenters);

      const { data: sup } = await q.limit(1);
      const sig = sup?.[0]?.signature || sup?.[0]?.signature_image || null;
      if (sig) return sig;
    } catch { /* noop */ }

    return null;
  };

  const addImageSmart = (doc: any, dataUrl: string, x: number, y: number, w: number, h: number) => {
    const fmt = dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
    doc.addImage(dataUrl, fmt as any, x, y, w, h);
  };

  const fetchEmployeeData = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const { data, error } = await supabase
        .from('employee_profiles')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (error) throw error;

      if (data) {
        const { data: companyData } = await supabase
          .from('company_profiles')
          .select('fiscal_name, nif')
          .eq('id', data.company_id)
          .single();

        const flatData = {
          ...data,
          company_name: companyData?.fiscal_name || 'Empresa no disponible',
          company_nif: companyData?.nif || 'NIF no disponible'
        };
        setEmployeeData(flatData);
        setCalendarSignatureRequested(Boolean(data.calendar_signature_requested));
        setCalendarReportSigned(Boolean(data.calendar_report_signed));
        setCalendarReportPdfUrl(data.calendar_report_pdf_url || null);
      }
    } catch (err) {
      console.error('Error fetching employee data:', err);
    }
  };

  const fetchSupervisorEmail = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const { data: employeeProfile, error: employeeError } = await supabase
        .from('employee_profiles')
        .select('work_centers, company_id')
        .eq('id', employeeId)
        .single();

      if (employeeError) throw employeeError;
      if (!employeeProfile?.work_centers?.length || !employeeProfile?.company_id) return;

      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('email')
        .eq('is_active', true)
        .eq('company_id', employeeProfile.company_id)
        .overlaps('work_centers', employeeProfile.work_centers)
        .limit(1);

      if (supervisorError) throw supervisorError;

      if (supervisorData?.length) setSupervisorEmail(supervisorData[0].email);
    } catch (err) {
      console.error('Error fetching supervisor email:', err);
    }
  };

  const fetchCalendarEvents = async () => {
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId') || '';
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      startOfMonth.setHours(0, 0, 0, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

      const { data: employeeProfile, error: employeeError } = await supabase
        .from('employee_profiles')
        .select('company_id, work_centers')
        .eq('id', employeeId)
        .single();
      if (employeeError) throw employeeError;

      // Schedules (mes actual)
      const { data: schedulesData, error: schedulesError } = await supabase
        .from('employee_schedules')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', startOfMonthStr)
        .lte('date', endOfMonthStr);
      if (schedulesError) throw schedulesError;
      setEmployeeSchedules(schedulesData || []);

      // Festivos
      let holidaysData: any[] = [];
      if (employeeProfile?.company_id && employeeProfile?.work_centers?.length) {
        let holidaysQuery = supabase
          .from('holidays')
          .select('id, date, name, work_center, company_id')
          .eq('company_id', employeeProfile.company_id)
          .gte('date', startOfMonthStr)
          .lte('date', endOfMonthStr);
        holidaysQuery = holidaysQuery.in('work_center', employeeProfile.work_centers);
        const { data: holData, error: holidaysError } = await holidaysQuery;
        if (holidaysError) throw holidaysError;
        holidaysData = holData || [];
      }

      // Fichajes
      const timeEntriesResponse = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', startOfMonth.toISOString())
        .lte('timestamp', endOfMonth.toISOString())
        .order('timestamp', { ascending: true });
      if (timeEntriesResponse.error) throw timeEntriesResponse.error;

      // Planner aprobadas (opcional)
      const { data: plannerRequestsData, error: plannerRequestsError } = await supabase
        .from('planner_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('status', 'approved')
        .or(`start_date.gte.${startOfMonth.toISOString()},end_date.lte.${endOfMonth.toISOString()}`);
      if (plannerRequestsError) throw plannerRequestsError;
      void plannerRequestsData;

      // Vacaciones
      const { data: vacationsData, error: vacationsError } = await supabase
        .from('employee_vacations')
        .select('*')
        .eq('employee_id', employeeId)
        .or(`and(start_date.lte.${endOfMonthStr},end_date.gte.${startOfMonthStr})`);
      if (vacationsError) throw vacationsError;

      // Construcción de eventos
      const events: CalendarEvent[] = [];
      const dayKey = (d: Date | string) => {
        const dt = typeof d === 'string' ? new Date(d) : d;
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };

      if (showHolidays) {
        (holidaysData || []).forEach((h: any) => {
          events.push({
            id: `holiday-${h.id}`,
            title: h.name + (h.work_center ? ` (${h.work_center})` : ''),
            start: h.date,
            end: h.date,
            color: '#f97316',
            type: 'holiday'
          });
        });
      }

      if (showVacations && vacationsData) {
        vacationsData.forEach((vac: any) => {
          const s = new Date(vac.start_date);
          const e = new Date(vac.end_date);
          for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            const k = dayKey(d);
            events.push({
              id: `vacation-${vac.id}-${k}`,
              title: `Vacaciones${vac.notes ? ': ' + vac.notes : ''}`,
              start: k,
              end: k,
              color: '#8b5cf6',
              type: 'vacation'
            });
          }
        });
      }

      if (showWorkSchedule && schedulesData) {
        const seen = new Set<string>();
        schedulesData.forEach((sch) => {
          if (sch.morning_start && sch.morning_end) {
            const key = `${sch.date}-morning`;
            if (!seen.has(key)) {
              seen.add(key);
              events.push({
                id: key,
                title: `Horario: ${sch.morning_start} - ${sch.morning_end}`,
                start: `${sch.date}T${sch.morning_start}`,
                end: `${sch.date}T${sch.morning_end}`,
                color: '#3b82f6',
                type: 'workschedule'
              });
            }
          }
          if (sch.enabled && sch.afternoon_start && sch.afternoon_end) {
            const key = `${sch.date}-afternoon`;
            if (!seen.has(key)) {
              seen.add(key);
              events.push({
                id: key,
                title: `Horario: ${sch.afternoon_start} - ${sch.afternoon_end}`,
                start: `${sch.date}T${sch.afternoon_start}`,
                end: `${sch.date}T${sch.afternoon_end}`,
                color: '#3b82f6',
                type: 'workschedule'
              });
            }
          }
        });
      }

      if (showTimeEntries) {
        (timeEntriesResponse.data || []).forEach((entry: any) => {
          const entryType =
            entry.entry_type === 'clock_in' ? 'Entrada' :
            entry.entry_type === 'clock_out' ? 'Salida' :
            entry.entry_type === 'break_start' ? 'Inicio pausa' : 'Fin pausa';

          const entryColor =
            entry.entry_type === 'clock_in' ? '#22c55e' :
            entry.entry_type === 'clock_out' ? '#ef4444' :
            entry.entry_type === 'break_start' ? '#f59e0b' : '#84cc16';

          events.push({
            id: `te-${entry.id}`,
            title: `${entryType} (${new Date(entry.timestamp).toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'})})`,
            start: entry.timestamp,
            end: entry.timestamp,
            color: entryColor,
            type: 'timeentry',
            details: { entryType }
          });
        });
      }

      setCalendarEvents(events);
    } catch (err) {
      console.error('Error fetching calendar events:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los eventos');
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: (Date | null)[] = [];

    const firstDayOfWeek = firstDay.getDay();
    for (let i = 0; i < (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1); i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
    return days;
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(date => {
      const newDate = new Date(date);
      newDate.setMonth(direction === 'prev' ? date.getMonth() - 1 : date.getMonth() + 1);
      return newDate;
    });
    setExpandedDay(null);
  };

  const toggleDayExpansion = (date: Date) => {
    if (expandedDay &&
        expandedDay.getDate() === date.getDate() &&
        expandedDay.getMonth() === date.getMonth() &&
        expandedDay.getFullYear() === date.getFullYear()) {
      setExpandedDay(null);
    } else {
      setExpandedDay(date);
    }
  };

  const dateKeyLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const getEventsForDay = (date: Date) => {
    const key = dateKeyLocal(date);
    return calendarEvents
      .filter(event => dateKeyLocal(new Date(event.start)) === key)
      .filter(event => {
        if (event.type === 'holiday' && !showHolidays) return false;
        if (event.type === 'workschedule' && !showWorkSchedule) return false;
        if (event.type === 'timeentry' && !showTimeEntries) return false;
        if (event.type === 'vacation' && !showVacations) return false;
        return true;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  };

  // ====== Firma del trabajador en canvas ======
  const startSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!signatureCanvasRef.current) return;
    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    setIsSigning(true);

    let x: number, y: number;
    if ('touches' in e) {
      // @ts-ignore
      x = e.touches[0].clientX - rect.left;
      // @ts-ignore
      y = e.touches[0].clientY - rect.top;
    } else {
      x = (e as React.MouseEvent).clientX - rect.left;
      y = (e as React.MouseEvent).clientY - rect.top;
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

    let x: number, y: number;
    if ('touches' in e) {
      e.preventDefault();
      // @ts-ignore
      x = e.touches[0].clientX - rect.left;
      // @ts-ignore
      y = e.touches[0].clientY - rect.top;
    } else {
      x = (e as React.MouseEvent).clientX - rect.left;
      y = (e as React.MouseEvent).clientY - rect.top;
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
      const dataUrl = signatureCanvasRef.current.toDataURL('image/png');
      setSignatureDataUrl(dataUrl);
      signatureDataUrlRef.current = dataUrl;
    }
  };

  const clearSignature = () => {
    setSignature([]);
    setSignatureDataUrl(null);
    signatureDataUrlRef.current = null;
    if (signatureCanvasRef.current) {
      const ctx = signatureCanvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, signatureCanvasRef.current.width, signatureCanvasRef.current.height);
    }
  };

  // === Canvas nítido (retina) + reset limpio al abrir modal ===
  useEffect(() => {
    if (!showSignatureModal || !signatureCanvasRef.current) return;

    // Reset datos firma
    setSignature([]);
    setSignatureDataUrl(null);
    signatureDataUrlRef.current = null;

    const canvas = signatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Ajusta el tamaño del canvas a su tamaño CSS * DPR
    canvas.width = Math.max(500, Math.floor(rect.width * dpr));
    canvas.height = Math.max(200, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
  }, [showSignatureModal]);

  // === Evitar scroll/zoom accidental mientras firmas en móviles ===
  useEffect(() => {
    const prevent = (e: TouchEvent) => e.preventDefault();
    if (showSignatureModal) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('touchmove', prevent, { passive: false });
    }
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('touchmove', prevent as any);
    };
  }, [showSignatureModal]);

  const openEmailWithAttachment = (pdfBlob: Blob, recipients: string[]) => {
    try {
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = pdfUrl;
      const fileName = `calendario_firmado_${employeeData.fiscal_name || 'empleado'}_${reportStartDate}_${reportEndDate}.pdf`;
      link.download = fileName;
      link.click();

      const emailSubject = `Calendario firmado del ${new Date(reportStartDate).toLocaleDateString('es-ES')} al ${new Date(reportEndDate).toLocaleDateString('es-ES')}`;
      const emailBody = `Se ha generado un nuevo calendario firmado para ${employeeData.fiscal_name}.\n\nAdjunte manualmente el PDF descargado (${fileName}).`;
      const allRecipients = [...new Set([...recipients, supervisorEmail].filter(Boolean))] as string[];

      if (allRecipients.length > 0) {
        const mailtoLink = `mailto:${allRecipients.join(';')}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
        window.location.href = mailtoLink;
        toast.success(`Correo preparado para: ${allRecipients.join(' y ')}`);
      } else {
        toast.success('PDF descargado correctamente (sin destinatarios)');
      }

      setTimeout(() => URL.revokeObjectURL(pdfUrl), 100);
      return true;
    } catch (err) {
      console.error('Error al manejar el correo:', err);
      toast.error('Error al preparar el correo electrónico');
      return false;
    }
  };

  // === Construir eventos para el PDF desde BD en un rango dado (incluye HORARIO) ===
  const fetchEventsForReportRange = async (startDate: Date, endDate: Date): Promise<CalendarEvent[]> => {
    const employeeId = localStorage.getItem('employeeId');
    if (!employeeId) throw new Error('No se encontró el ID del empleado');

    const { data: employeeProfile, error: employeeError } = await supabase
      .from('employee_profiles')
      .select('company_id, work_centers')
      .eq('id', employeeId)
      .single();
    if (employeeError) throw employeeError;

    const startStr = startDate.toISOString().split('T')[0];
    const endStr   = endDate.toISOString().split('T')[0];

    // HORARIOS
    const { data: schedules, error: schedulesError } = await supabase
      .from('employee_schedules')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('enabled', true)
      .gte('date', startStr)
      .lte('date', endStr);
    if (schedulesError) throw schedulesError;

    // FICHAJES
    const { data: timeEntries, error: timeError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: true });
    if (timeError) throw timeError;

    // FESTIVOS
    let holidays: any[] = [];
    if (employeeProfile?.company_id) {
      let holidaysQuery = supabase
        .from('holidays')
        .select('id, date, name, work_center')
        .eq('company_id', employeeProfile.company_id)
        .gte('date', startStr)
        .lte('date', endStr);

      if (employeeProfile?.work_centers?.length) {
        holidaysQuery = holidaysQuery.in('work_center', employeeProfile.work_centers);
      }
      const { data: holidaysData, error: holErr } = await holidaysQuery;
      if (holErr) throw holErr;
      holidays = holidaysData || [];
    }

    // VACACIONES
    const { data: vacations, error: vacError } = await supabase
      .from('employee_vacations')
      .select('*')
      .eq('employee_id', employeeId)
      .or(`and(start_date.lte.${endStr},end_date.gte.${startStr})`);
    if (vacError) throw vacError;

    const events: CalendarEvent[] = [];

    (schedules || []).forEach((sch: EmployeeSchedule) => {
      if (sch.morning_start && sch.morning_end) {
        events.push({
          title: `Horario: ${sch.morning_start} - ${sch.morning_end}`,
          start: `${sch.date}T${sch.morning_start}`,
          end:   `${sch.date}T${sch.morning_end}`,
          color: '#3b82f6',
          type: 'workschedule'
        });
      }
      if (sch.afternoon_start && sch.afternoon_end) {
        events.push({
          title: `Horario: ${sch.afternoon_start} - ${sch.afternoon_end}`,
          start: `${sch.date}T${sch.afternoon_start}`,
          end:   `${sch.date}T${sch.afternoon_end}`,
          color: '#3b82f6',
          type: 'workschedule'
        });
      }
    });

    (timeEntries || []).forEach((entry: any) => {
      const entryType =
        entry.entry_type === 'clock_in'     ? 'Entrada' :
        entry.entry_type === 'clock_out'    ? 'Salida' :
        entry.entry_type === 'break_start'  ? 'Inicio Pausa' : 'Fin Pausa';

      const entryColor =
        entry.entry_type === 'clock_in'     ? '#22c55e' :
        entry.entry_type === 'clock_out'    ? '#ef4444' :
        entry.entry_type === 'break_start'  ? '#f59e0b' : '#84cc16';

      events.push({
        title: `${entryType} (${new Date(entry.timestamp).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})})`,
        start: entry.timestamp,
        end: entry.timestamp,
        color: entryColor,
        type: 'timeentry',
        details: { entryType }
      });
    });

    (holidays || []).forEach((h: any) => {
      events.push({
        title: h.name + (h.work_center ? ` (${h.work_center})` : ''),
        start: h.date,
        end: h.date,
        color: '#f97316',
        type: 'holiday'
      });
    });

    (vacations || []).forEach((vac: any) => {
      const s = new Date(vac.start_date);
      const e = new Date(vac.end_date);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const dateKey = d.toISOString().split('T')[0];
        events.push({
          title: `Vacaciones${vac.notes ? ': ' + vac.notes : ''}`,
          start: dateKey,
          end: dateKey,
          color: '#8b5cf6',
          type: 'vacation'
        });
      }
    });

    return events;
  };

  // ====== PDF (RANGO) con firma del trabajador (requerida) ======

  // ====== PDF (ANUAL) — ahora también exige firma previa ======
  const generateAnnualCalendarReport = async () => {
    if (!employeeData) {
      toast.error('No se pudo cargar los datos del empleado');
      return;
    }

    setGeneratingReport(true);
    try {
      const currentYear = new Date().getFullYear();
      const startDate = new Date(currentYear, 0, 1);
      const endDate = new Date(currentYear, 11, 31, 23, 59, 59, 999);
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      const { data: timeEntries } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString());

      const { data: schedules } = await supabase
        .from('employee_schedules')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('enabled', true)
        .gte('date', startDate.toISOString().split('T')[0])
        .lte('date', endDate.toISOString().split('T')[0]);

      const { data: holidays } = await supabase
        .from('holidays')
        .select('*')
        .eq('company_id', employeeData.company_id)
        .gte('date', startDate.toISOString().split('T')[0])
        .lte('date', endDate.toISOString().split('T')[0]);

      const { data: vacations } = await supabase
        .from('employee_vacations')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('start_date', startDate.toISOString().split('T')[0])
        .lte('end_date', endDate.toISOString().split('T')[0]);

      const allEvents: CalendarEvent[] = [];

      (schedules || []).forEach((schedule: any) => {
        if (schedule.morning_start && schedule.morning_end) {
          allEvents.push({
            id: `${schedule.id}-morning`,
            title: `Mañana: ${schedule.morning_start} - ${schedule.morning_end}`,
            start: new Date(`${schedule.date}T${schedule.morning_start}`),
            end: new Date(`${schedule.date}T${schedule.morning_end}`),
            color: '#3b82f6',
            type: 'workschedule'
          });
        }
        if (schedule.afternoon_start && schedule.afternoon_end) {
          allEvents.push({
            id: `${schedule.id}-afternoon`,
            title: `Tarde: ${schedule.afternoon_start} - ${schedule.afternoon_end}`,
            start: new Date(`${schedule.date}T${schedule.afternoon_start}`),
            end: new Date(`${schedule.date}T${schedule.afternoon_end}`),
            color: '#3b82f6',
            type: 'workschedule'
          });
        }
      });

      (timeEntries || []).forEach((entry: any) => {
        allEvents.push({
          id: entry.id,
          title: entry.entry_type || 'Fichaje',
          start: new Date(entry.timestamp),
          end: new Date(entry.timestamp),
          color:
            entry.entry_type === 'clock_in' ? '#22c55e' :
            entry.entry_type === 'clock_out' ? '#ef4444' :
            entry.entry_type === 'break_start' ? '#f59e0b' : '#84cc16',
          type: 'timeentry',
          details: { entryType: entry.entry_type }
        });
      });

      (holidays || []).forEach((holiday: any) => {
        allEvents.push({
          id: holiday.id,
          title: holiday.name,
          start: new Date(holiday.date),
          end: new Date(holiday.date),
          color: '#f97316',
          type: 'holiday'
        });
      });

      (vacations || []).forEach((vacation: any) => {
        const s = new Date(vacation.start_date);
        const e = new Date(vacation.end_date);
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          allEvents.push({
            id: `vacation-${vacation.id}-${d.toISOString()}`,
            title: 'Vacaciones',
            start: new Date(d),
            end: new Date(d),
            color: '#8b5cf6',
            type: 'vacation'
          });
        }
      });

      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Calendario Laboral', 105, 20, { align: 'center' });

      doc.setFontSize(10);
      const headerTable = [
        [`Empresa: ${employeeData?.company_name || 'Empresa no disponible'}`, `Trabajador: ${employeeData?.fiscal_name || ''}`],
        [`C.I.F/N.I.F: ${employeeData?.company_nif || 'NIF no disponible'}`, `N.I.F: ${employeeData?.document_number || ''}`],
        [`Centro de Trabajo: ${employeeData?.work_centers?.join(', ') || ''}`, `Nº Afiliación: ${employeeData?.social_security_number || ''}`],
        ['C.C.C:', `Año: ${new Date().getFullYear()}`]
      ];
      (doc as any).autoTable({
        startY: 30,
        head: [],
        body: headerTable,
        theme: 'plain',
        styles: { cellPadding: 3, fontSize: 10, lineWidth: 0.1 },
        columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 95 } }
      });

      const eventsByDay: Record<string, CalendarEvent[]> = {};
      allEvents.forEach(event => {
        const eventDate = new Date(event.start as any);
        if (isNaN(eventDate.getTime())) return;
        const key = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
        (eventsByDay[key] ||= []).push(event);
      });

      const allDays: { date: Date; events: CalendarEvent[] }[] = [];
      for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        allDays.push({ date: new Date(date), events: eventsByDay[key] || [] });
      }

      const tableBody = allDays.map(day => {
        const formattedDate = day.date.toLocaleDateString('es-ES', {
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
        });

        const sched: string[] = [];
        const times: string[] = [];
        const others: string[] = [];

        day.events
          .filter(e => e.type === 'workschedule')
          .sort((a, b) => new Date(a.start as any).getTime() - new Date(b.start as any).getTime())
          .forEach(e => {
            const s = new Date(e.start as any).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', hour12:false });
            const t = new Date(e.end as any).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', hour12:false });
            sched.push(`${s} - ${t}`);
          });

        day.events.forEach(e => {
          if (e.type === 'timeentry') {
            const time = new Date(e.start as any).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
            const entryTypeText = e.details?.entryType ? getEntryTypeText(e.details.entryType) : 'Fichaje';
            times.push(`${entryTypeText} (${time})`);
          } else if (e.type === 'holiday') {
            others.push(`Festivo: ${e.title}`);
          } else if (e.type === 'vacation') {
            others.push(e.title);
          }
        });

        const scheduleText = sched.length ? `Horario: ${sched.join(' | ')}` : '';
        let eventsText = '';
        if (scheduleText) eventsText += scheduleText + '\n';
        if (times.length) eventsText += times.join('\n') + '\n';
        if (others.length) eventsText += others.join('\n');

        return [formattedDate, eventsText.trim() || 'Sin eventos'];
      });

      (doc as any).autoTable({
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [['Fecha', 'Eventos']],
        body: tableBody,
        theme: 'grid',
        styles: {
          cellPadding: 4, fontSize: 9, lineWidth: 0.1,
          lineColor: [80, 80, 80], textColor: [0, 0, 0], font: 'helvetica'
        },
        columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' }, 1: { cellWidth: 130 } },
        willDrawCell: (data: any) => {
          if (data.cell.text && data.cell.text.length > 0) {
            const numLines = data.cell.text.length;
            const minHeight = numLines * 7 + 8;
            if (data.row.height < minHeight) data.row.height = minHeight;
          }
        }
      });

      const supervisorSig = await fetchSupervisorSignature(employeeData.company_id, employeeData?.work_centers || []);
      const workerSig = signatureDataUrlRef.current || signatureDataUrl;

      console.log('=== FIRMAS EN PDF ANUAL (generateAnnualCalendarReport) ===');
      console.log('supervisorSig:', supervisorSig ? 'EXISTS' : 'NULL');
      console.log('workerSig:', workerSig ? 'EXISTS' : 'NULL');
      console.log('signatureDataUrlRef.current:', signatureDataUrlRef.current ? 'EXISTS' : 'NULL');
      console.log('signatureDataUrl:', signatureDataUrl ? 'EXISTS' : 'NULL');

      doc.setFontSize(10);
      doc.text('Firma del Coordinador/a:', 40, (doc as any).lastAutoTable.finalY + 30);
      doc.text('Firma del Trabajador/a:', 140, (doc as any).lastAutoTable.finalY + 30);

      if (supervisorSig) {
        try {
          console.log('✓ Agregando firma coordinador al PDF anual...');
          addImageSmart(doc, supervisorSig, 40, (doc as any).lastAutoTable.finalY + 35, 50, 20);
          console.log('✓ Firma coordinador agregada correctamente');
        }
        catch (e) { console.error('ERROR al agregar firma coordinador:', e); }
      } else {
        console.warn('⚠ NO HAY FIRMA DEL COORDINADOR');
      }

      if (workerSig) {
        console.log('✓ Agregando firma trabajador al PDF anual...');
        addImageSmart(doc, workerSig, 140, (doc as any).lastAutoTable.finalY + 35, 50, 20);
        console.log('✓ Firma trabajador agregada correctamente');
      } else {
        console.warn('⚠ NO HAY FIRMA DEL TRABAJADOR - Esto NO debería pasar');
      }

      doc.setFontSize(8);
      doc.text(`En Madrid, a ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, 14, (doc as any).lastAutoTable.finalY + 60);

      const signedPdfBlob = doc.output('blob');
      const fileName = `${employeeId}/calendario_anual_${currentYear}_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('calendar-reports')
        .upload(fileName, signedPdfBlob, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('calendar-reports').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      await supabase.from('calendar_history').insert({
        employee_id: employeeId,
        year: currentYear,
        calendar_data: { pdf_url: publicUrl, signed_at: new Date().toISOString() },
        work_centers: employeeData?.work_centers || [],
        created_by: employeeData?.fiscal_name || 'Empleado'
      });

      const { error: updateError } = await supabase
        .from('employee_profiles')
        .update({
          calendar_signature_requested: false,
          calendar_report_signed: true,
          calendar_report_signed_at: new Date().toISOString(),
          calendar_report_pdf_url: publicUrl,
        })
        .eq('id', employeeId);
      if (updateError) throw updateError;

      setCalendarReportSigned(true);
      setCalendarReportPdfUrl(publicUrl);
      setCalendarSignatureRequested(false);
      setShowSignatureModal(false);
      setShowCalendarReport(false);
      await fetchEmployeeData();

      const link = document.createElement('a');
      link.href = publicUrl;
      link.download = `calendario_anual_${currentYear}_firmado.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      try {
        const { data: companyData } = await supabase
          .from('company_profiles')
          .select('coordinator_email')
          .eq('id', employeeData.company_id)
          .maybeSingle();

        const coordinatorEmail = companyData?.coordinator_email || supervisorEmail;
        const recipients = [coordinatorEmail, employeeData.email].filter(Boolean) as string[];

        if (recipients.length > 0) {
          const emailSubject = `Calendario Anual ${currentYear} Firmado - ${employeeData.fiscal_name}`;
          const emailBody =
            `Se ha firmado el calendario laboral anual ${currentYear}.\n\n` +
            `Trabajador/a: ${employeeData.fiscal_name}\n` +
            `Fecha de firma: ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}\n\n` +
            `Enlace de descarga: ${publicUrl}\n\n` +
            `Adjunte el PDF si lo necesita.`;

          const mailtoLink = `mailto:${recipients.join(';')}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
          window.location.href = mailtoLink;

          toast.success(`Calendario firmado. Correo preparado para: ${recipients.join(' y ')}`);
        } else {
          toast.success('Calendario firmado y descargado correctamente');
        }
      } catch (emailError) {
        console.error('Error preparing email:', emailError);
        toast.success('Calendario firmado y descargado correctamente');
      }
    } catch (error) {
      console.error('Error submitting signed report:', error);
      toast.error('Error al enviar el informe firmado: ' + (error as any).message);
    } finally {
      setGeneratingReport(false);
    }
  };

  // === Al confirmar firma en el modal ===
  const saveSignature = () => {
    if (signature.length === 0) {
      toast.error('Por favor, firma antes de continuar');
      return;
    }
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setSignatureDataUrl(dataUrl);
      signatureDataUrlRef.current = dataUrl;
    }
    setShowSignatureModal(false);

    // Ejecutar la acción pendiente (rango firmado / solo descargar / anual)
    if (pendingActionRef.current) {
      const cb = pendingActionRef.current;
      pendingActionRef.current = null;
      // pequeña cola para asegurar que el estado se asentó
      setTimeout(() => cb(), 0);
    }
  };

  // === UI ===


  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-6">Mi Calendario</h2>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}

        {/* Filtros */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <button
            onClick={() => setShowHolidays(!showHolidays)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${showHolidays ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-600'}`}
          >
            <Calendar className="w-5 h-5" />
            <span className="text-sm">Festivos</span>
          </button>

          <button
            onClick={() => setShowWorkSchedule(!showWorkSchedule)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${showWorkSchedule ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-600'}`}
          >
            <Clock className="w-5 h-5" />
            <span className="text-sm">Horario Laboral</span>
          </button>

          <button
            onClick={() => setShowTimeEntries(!showTimeEntries)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${showTimeEntries ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-600'}`}
          >
            <LogIn className="w-5 h-5" />
            <span className="text-sm">Fichajes</span>
          </button>

          <button
            onClick={() => setShowVacations(!showVacations)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${showVacations ? 'bg-purple-50 text-purple-600' : 'bg-gray-50 text-gray-600'}`}
          >
            <Calendar className="w-5 h-5" />
            <span className="text-sm">Vacaciones</span>
          </button>
        </div>

        {/* Aviso firma anual */}
        {calendarSignatureRequested && !calendarReportSigned && (
          <div className="mb-6 p-4 bg-orange-50 border-l-4 border-orange-500 rounded-lg">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-orange-600" />
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900">Firma de Calendario Anual Pendiente</h3>
                <p className="text-sm text-orange-700 mt-1">
                  Tu empresa ha solicitado que firmes el calendario anual. Por favor, genera y firma el informe.
                </p>
              </div>
              <button
                onClick={() => setShowCalendarReport(true)}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors whitespace-nowrap"
              >
                Ir a Firmar
              </button>
            </div>
          </div>
        )}

        {/* Sección informe anual */}
        {showCalendarReport && calendarSignatureRequested && (
          <div className="mb-6 bg-white p-6 rounded-lg border-2 border-blue-500 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-6 h-6 text-blue-600" />
                <h3 className="text-xl font-semibold">Informe de Calendario Anual</h3>
              </div>
              <button onClick={() => setShowCalendarReport(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            {calendarReportSigned && calendarReportPdfUrl ? (
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <div className="flex items-center gap-3 mb-3">
                  <Check className="w-6 h-6 text-green-600" />
                  <div>
                    <h4 className="font-semibold text-green-900">Calendario Firmado</h4>
                    <p className="text-sm text-green-700">Tu informe ha sido firmado y enviado correctamente.</p>
                  </div>
                </div>
                <button
                  onClick={() => window.open(calendarReportPdfUrl, '_blank')}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download className="w-5 h-5" />
                  Descargar Informe Firmado
                </button>
              </div>
            ) : (
              <div>
                <p className="text-gray-700 mb-4">
                  Este informe incluye todo el calendario del año {new Date().getFullYear()}.
                  Se te pedirá la firma y se incluirá como <strong>Firma del Trabajador/a</strong> en el PDF.
                </p>
                <div className="bg-blue-50 p-4 rounded-lg mb-4">
                  <p className="text-sm text-blue-900 font-medium mb-2">Importante:</p>
                  <ul className="text-sm text-blue-800 list-disc list-inside space-y-1">
                    <li>El informe incluirá todos los meses del año actual</li>
                    <li>Tu firma se incrustará en el documento</li>
                  </ul>
                </div>
                <button
                  onClick={() => ensureSignatureThen(() => generateAnnualCalendarReport())}
                  disabled={generatingReport}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingReport ? (
                    <>
                      <Clock className="w-5 h-5 animate-spin" />
                      Generando...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5" />
                      Generar y Firmar Informe Anual
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Navegación mes */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigateMonth('prev')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-semibold">
            {currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={() => navigateMonth('next')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Calendario */}
        <div className="grid grid-cols-7 gap-2">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
            <div key={day} className="text-center font-semibold py-2">
              {day}
            </div>
          ))}

          {loading ? (
            <div className="col-span-7 py-20 text-center text-gray-500">Cargando eventos...</div>
          ) : (
            getDaysInMonth(currentDate).map((date, index) => (
              <div
                key={index}
                className={`min-h-[100px] p-2 border rounded-lg ${date ? 'bg-white' : 'bg-gray-50'} ${date && expandedDay && expandedDay.getDate() === date.getDate() && expandedDay.getMonth() === date.getMonth() && expandedDay.getFullYear() === date.getFullYear() ? 'border-2 border-blue-500' : ''}`}
                onClick={() => date && toggleDayExpansion(date)}
              >
                {date && (
                  <>
                    <div className="font-medium mb-1">{date.getDate()}</div>
                    <div className="space-y-1">
                      {getEventsForDay(date)
                        .slice(0, expandedDay && expandedDay.getDate() === date.getDate() && expandedDay.getMonth() === date.getMonth() && expandedDay.getFullYear() === date.getFullYear() ? undefined : 3)
                        .map((event, idx) => (
                          <div
                            key={idx}
                            className="text-xs p-2 rounded flex items-center gap-1"
                            style={{ backgroundColor: `${event.color}15`, borderLeft: `3px solid ${event.color}`, color: event.color }}
                            title={event.title}
                          >
                            {event.type === 'holiday' ? (
                              <Calendar className="w-3 h-3 flex-shrink-0" />
                            ) : event.type === 'workschedule' ? (
                              <Clock className="w-3 h-3 flex-shrink-0" />
                            ) : event.type === 'vacation' ? (
                              <Calendar className="w-3 h-3 flex-shrink-0" />
                            ) : (
                              event.details?.entryType === 'Entrada' ? (
                                <LogIn className="w-3 h-3 flex-shrink-0" />
                              ) : event.details?.entryType === 'Salida' ? (
                                <LogOut className="w-3 h-3 flex-shrink-0" />
                              ) : (
                                <Clock className="w-3 h-3 flex-shrink-0" />
                              )
                            )}
                            <span className="truncate">{event.title}</span>
                          </div>
                        ))}
                      {getEventsForDay(date).length > 3 &&
                        (!expandedDay ||
                          expandedDay.getDate() !== date.getDate() ||
                          expandedDay.getMonth() !== date.getMonth() ||
                          expandedDay.getFullYear() !== date.getFullYear()) && (
                          <div className="text-xs text-center text-gray-500 mt-1">
                            {getEventsForDay(date).length - 3} más...
                          </div>
                        )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Día expandido */}
        {expandedDay && (
          <div className="mt-6 bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                Eventos para el {expandedDay.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
              <button onClick={() => setExpandedDay(null)} className="p-1 hover:bg-gray-200 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {getEventsForDay(expandedDay).length > 0 ? (
                getEventsForDay(expandedDay).map((event, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg flex items-start gap-3"
                    style={{ backgroundColor: `${event.color}15`, borderLeft: `4px solid ${event.color}` }}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {event.type === 'holiday' ? (
                        <Calendar className="w-4 h-4" style={{ color: event.color }} />
                      ) : event.type === 'workschedule' ? (
                        <Clock className="w-4 h-4" style={{ color: event.color }} />
                      ) : event.type === 'vacation' ? (
                        <Calendar className="w-4 h-4" style={{ color: event.color }} />
                      ) : (
                        event.details?.entryType === 'Entrada' ? (
                          <LogIn className="w-4 h-4" style={{ color: event.color }} />
                        ) : event.details?.entryType === 'Salida' ? (
                          <LogOut className="w-4 h-4" style={{ color: event.color }} />
                        ) : (
                          <Clock className="w-4 h-4" style={{ color: event.color }} />
                        )
                      )}
                    </div>
                    <div>
                      <div className="font-medium" style={{ color: event.color }}>{event.title}</div>
                      {event.details && (
                        <div className="text-xs text-gray-600 mt-1">
                          {event.details.entryType && <div>Tipo: {getEntryTypeText(event.details.entryType)}</div>}
                          {event.details.plannerType && <div>Tipo: {event.details.plannerType}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-4">No hay eventos para este día</div>
              )}
            </div>
          </div>
        )}

        {/* Estado informe anual firmado */}
        {calendarReportSigned && calendarReportPdfUrl && (
          <div className="mt-8 bg-green-50 border border-green-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <FileText className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-green-900">Calendario Anual Firmado</h3>
                <p className="text-sm text-green-700">Tu calendario anual ha sido firmado y enviado correctamente</p>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              <a
                href={calendarReportPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Download className="w-5 h-5" />
                Descargar Informe Firmado
              </a>
              <button
                onClick={() => window.open(calendarReportPdfUrl, '_blank')}
                className="flex items-center gap-2 px-4 py-2 bg-white text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition-colors"
              >
                <FileText className="w-5 h-5" />
                Ver Informe
              </button>
            </div>
          </div>
        )}
      </div>

      <Toaster position="top-center" />

      {/* Modal de Firma */}
      {showSignatureModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Firmar Calendario</h3>
              <button onClick={() => { setShowSignatureModal(false); pendingActionRef.current = null; }} className="text-gray-500 hover:text-gray-700">
                <X className="w-6 h-6" />
              </button>
            </div>

            <p className="mb-4 text-gray-600">Por favor, firma en el área de abajo con tu dedo o ratón.</p>

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
              <button onClick={clearSignature} className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">
                <X className="w-5 h-5" />
                Limpiar
              </button>
              <button onClick={saveSignature} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
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
