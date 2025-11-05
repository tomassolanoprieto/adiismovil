import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Calendar, ChevronLeft, ChevronRight, Search, Clock, Calendar as CalendarIcon, LogIn, LogOut, FileText, BarChart, Download, RotateCcw } from 'lucide-react';

interface Employee {
  id: string;
  fiscal_name: string;
  email: string;
  work_centers: string[];
  delegation: string;
  calendar_signature_requested?: boolean;
  calendar_report_signed?: boolean;
  calendar_report_pdf_url?: string;
  calendar_report_signed_at?: string;
}

interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  color: string;
  type: 'holiday' | 'workschedule' | 'timeentry' | 'planner' | 'vacation';
  details?: {
    employeeName?: string;
    workCenter?: string;
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

export default function SupervisorCalendar() {
  const [searchParams] = useSearchParams();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showHolidays, setShowHolidays] = useState(true);
  const [showWorkSchedules, setShowWorkSchedules] = useState(true);
  const [showTimeEntries, setShowTimeEntries] = useState(true);
  const [showVacations, setShowVacations] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isCalendarApproved, setIsCalendarApproved] = useState(false);
  const [pendingApprovalMessage, setPendingApprovalMessage] = useState('');

  // ALERTA: ahora solo depende de calendars_sent_to_employees === false
  const [showSendCalendarAlert, setShowSendCalendarAlert] = useState(false);
  const [employeesWithoutCalendar, setEmployeesWithoutCalendar] = useState<Employee[]>([]);

  const [showSupervisorSignatureModal, setShowSupervisorSignatureModal] = useState(false);
  const [supervisorSignature, setSupervisorSignature] = useState<{x: number; y: number}[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const supervisorSignatureCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const [supervisorSignatureDataUrl, setSupervisorSignatureDataUrl] = useState<string | null>(null);
  const [pendingSignatureEmployees, setPendingSignatureEmployees] = useState<string[]>([]);
  const [pendingSignatureDescription, setPendingSignatureDescription] = useState('');

  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWorkCenter, setSelectedWorkCenter] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [supervisorWorkCenters, setSupervisorWorkCenters] = useState<string[]>([]);

  const [showCalendarReports, setShowCalendarReports] = useState(false);
  const [selectedReportEmployee, setSelectedReportEmployee] = useState<string>('');
  const [showVacationForm, setShowVacationForm] = useState(false);
  const [vacationStartDate, setVacationStartDate] = useState('');
  const [vacationEndDate, setVacationEndDate] = useState('');
  const [vacationNotes, setVacationNotes] = useState('');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [calendarHistory, setCalendarHistory] = useState<any[]>([]);
  const [selectedHistoryEmployee, setSelectedHistoryEmployee] = useState<string>('');

  const supervisorEmail = localStorage.getItem('supervisorEmail');

  useEffect(() => {
    fetchSupervisorWorkCenters();
    checkCalendarApprovalStatus();
  }, []);

  // Obtiene el último approval por company_id y decide alertas sin depender de columnas que no existen
  const checkCalendarApprovalStatus = async () => {
    try {
      const supervisorEmail = localStorage.getItem('supervisorEmail');
      if (!supervisorEmail) return;

      const { data: supervisorData } = await supabase
        .from('supervisor_profiles')
        .select('id, company_id')
        .eq('email', supervisorEmail)
        .maybeSingle();

      if (!supervisorData?.company_id) return;

      // Traigo el último calendar_approval
      const { data: latestApproval } = await supabase
        .from('calendar_approvals')
        .select('id, status, work_centers, calendars_sent_to_employees')
        .eq('company_id', supervisorData.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Si no hay registros, no mostramos la alerta ni bloqueamos
      if (!latestApproval) {
        setIsCalendarApproved(false);
        setPendingApprovalMessage('No hay aprobaciones de calendario registradas.');
        setShowSendCalendarAlert(false);
        setEmployeesWithoutCalendar([]);
        return;
      }

      // Aprobación: si hay columna status y es "pending_company_approval", bloqueamos; si no existe status, consideramos aprobado.
      const pending = latestApproval?.status === 'pending_company_approval';
      setIsCalendarApproved(!pending);
      setPendingApprovalMessage(
        pending
          ? `Esperando confirmación de festivos por parte de la empresa${latestApproval.work_centers?.length ? ` para: ${latestApproval.work_centers.join(', ')}` : ''}`
          : ''
      );

      // ALERTA SOLO si NO se han enviado aún
      if (!pending && latestApproval.calendars_sent_to_employees === false) {
        // Cargamos empleados solo para mostrar cuántos recibirán (informativo)
        const { data: emps } = await supabase
          .from('employee_profiles')
          .select('id, fiscal_name, email, work_centers, delegation')
          .eq('company_id', supervisorData.company_id)
          .eq('is_active', true);

        const visible = (emps || []).filter(emp =>
          supervisorWorkCenters.length
            ? emp.work_centers?.some((c: string) => supervisorWorkCenters.includes(c))
            : true
        );

        setEmployeesWithoutCalendar(visible as Employee[]);
        setShowSendCalendarAlert(true);
      } else {
        setShowSendCalendarAlert(false);
        setEmployeesWithoutCalendar([]);
      }
    } catch (error) {
      console.error('Error checking approval status:', error);
    }
  };

  useEffect(() => {
    if (supervisorWorkCenters.length > 0) {
      fetchEmployees();
      checkCalendarApprovalStatus();
    }
  }, [supervisorWorkCenters, searchTerm, selectedWorkCenter]);

  useEffect(() => {
    const employeeId = searchParams.get('employee');
    if (employeeId && employees.length > 0) {
      const employee = employees.find(emp => emp.id === employeeId);
      if (employee) {
        setSelectedEmployee(employeeId);
      }
    }
  }, [searchParams, employees]);

  useEffect(() => {
    if (supervisorWorkCenters.length > 0) {
      fetchCalendarEvents();
    }
  }, [currentDate, showHolidays, showWorkSchedules, showTimeEntries, showVacations, selectedWorkCenter, selectedEmployee, supervisorWorkCenters]);

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
        setSelectedWorkCenter(supervisor.work_centers[0]);
      }
    } catch (error) {
      console.error('Error fetching supervisor work centers:', error);
    }
  };

  const fetchEmployees = async () => {
    try {
      if (!supervisorWorkCenters.length) return;

      // Get supervisor's company_id first
      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('company_id')
        .eq('email', supervisorEmail)
        .single();

      if (supervisorError) throw supervisorError;

      let query = supabase
        .from('employee_profiles')
        .select('id, fiscal_name, email, work_centers, delegation, calendar_signature_requested, calendar_report_signed, calendar_report_pdf_url, calendar_report_signed_at')
        .eq('company_id', supervisorData.company_id)
        .eq('is_active', true)
        .order('fiscal_name', { ascending: true });

      if (selectedWorkCenter) {
        query = query.contains('work_centers', [selectedWorkCenter]);
      } else {
        query = query.overlaps('work_centers', supervisorWorkCenters);
      }

      if (searchTerm) {
        query = query.or(`fiscal_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      console.error('Error fetching employees:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar empleados');
    }
  };

  const fetchCalendarEvents = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!supervisorWorkCenters.length) {
        throw new Error('No se encontraron centros de trabajo asignados');
      }

      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      startOfMonth.setHours(0, 0, 0, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

      // Determine which employees to fetch data for
      let employeesToFetch: Employee[] = [];
      if (selectedEmployee) {
        const employee = employees.find(emp => emp.id === selectedEmployee);
        if (employee) {
          employeesToFetch = [employee];
        }
      } else if (selectedWorkCenter) {
        employeesToFetch = employees.filter(emp => emp.work_centers?.includes(selectedWorkCenter));
      } else {
        employeesToFetch = employees;
      }

      // Get supervisor's company_id first
      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('company_id')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .single();

      if (supervisorError) throw supervisorError;
      if (!supervisorData?.company_id) {
        throw new Error('No se encontró la empresa del supervisor');
      }

      // Fetch holidays
      let holidaysQuery = supabase
        .from('holidays')
        .select('id, date, name, work_center')
        .eq('company_id', supervisorData.company_id)
        .lte('date', endOfMonth.toISOString().split('T')[0]);

      if (selectedWorkCenter) {
        holidaysQuery = holidaysQuery.or(`work_center.is.null,work_center.eq."${selectedWorkCenter}"`);
      } else if (supervisorWorkCenters.length > 0) {
        const workCentersFilter = supervisorWorkCenters.map(wc => `work_center.eq."${wc}"`).join(',');
        holidaysQuery = holidaysQuery.or(`work_center.is.null,${workCentersFilter}`);
      }

      // Fetch employee schedules
      let employeeSchedulesResponse: { data: EmployeeSchedule[] | null; error: any } = { data: null, error: null };
      if (employeesToFetch.length > 0) {
        const r = await supabase
          .from('employee_schedules')
          .select('*')
          .in('employee_id', employeesToFetch.map(emp => emp.id))
          .gte('date', startOfMonthStr)
          .lte('date', endOfMonthStr);
        employeeSchedulesResponse = r as any;
      }

      // Fetch time entries
      let timeEntriesResponse: { data: any[] | null; error: any } = { data: null, error: null };
      if (employeesToFetch.length > 0) {
        const r = await supabase
          .from('time_entries')
          .select('*')
          .in('employee_id', employeesToFetch.map(emp => emp.id))
          .gte('timestamp', startOfMonth.toISOString())
          .lte('timestamp', endOfMonth.toISOString())
          .order('timestamp', { ascending: true });
        timeEntriesResponse = r as any;
      }

      const holidaysResponse = await holidaysQuery;

      if (holidaysResponse.error) throw holidaysResponse.error;
      if (employeeSchedulesResponse && employeeSchedulesResponse.error) throw employeeSchedulesResponse.error;
      if (timeEntriesResponse && timeEntriesResponse.error) throw timeEntriesResponse.error;

      // Process events
      const events: CalendarEvent[] = [];
      const processedEntries = new Set<string>();

      // Holidays
      if (showHolidays) {
        (holidaysResponse.data || []).forEach((h: any) => {
          const eventKey = `holiday-${h.id}`;
          if (!processedEntries.has(eventKey)) {
            processedEntries.add(eventKey);
            events.push({
              title: h.name + (h.work_center ? ` (${h.work_center})` : ' (Todos los centros)'),
              start: h.date,
              end: h.date,
              color: '#f97316',
              type: 'holiday'
            });
          }
        });
      }

      // Work schedules
      if (showWorkSchedules && employeeSchedulesResponse && employeeSchedulesResponse.data) {
        const schedules = employeeSchedulesResponse.data as EmployeeSchedule[];

        schedules.forEach(schedule => {
          const employee = employees.find(emp => emp.id === schedule.employee_id);
          if (!employee) return;

          if (schedule.morning_start && schedule.morning_end) {
            const morningKey = `${schedule.employee_id}-${schedule.date}-morning`;
            if (!processedEntries.has(morningKey)) {
              processedEntries.add(morningKey);
              events.push({
                title: `${employee.fiscal_name}: ${schedule.morning_start} - ${schedule.morning_end}`,
                start: `${schedule.date}T${schedule.morning_start}`,
                end: `${schedule.date}T${schedule.morning_end}`,
                color: '#3b82f6',
                type: 'workschedule',
                details: {
                  employeeName: employee.fiscal_name,
                  workCenter: employee.work_centers?.[0]
                }
              });
            }
          }

          if (schedule.enabled && schedule.afternoon_start && schedule.afternoon_end) {
            const afternoonKey = `${schedule.employee_id}-${schedule.date}-afternoon`;
            if (!processedEntries.has(afternoonKey)) {
              processedEntries.add(afternoonKey);
              events.push({
                title: `${employee.fiscal_name}: ${schedule.afternoon_start} - ${schedule.afternoon_end}`,
                start: `${schedule.date}T${schedule.afternoon_start}`,
                end: `${schedule.date}T${schedule.afternoon_end}`,
                color: '#3b82f6',
                type: 'workschedule',
                details: {
                  employeeName: employee.fiscal_name,
                  workCenter: employee.work_centers?.[0]
                }
              });
            }
          }
        });
      }

      // Time entries
      if (showTimeEntries && timeEntriesResponse && timeEntriesResponse.data) {
        const processedTime = new Set<string>();

        (timeEntriesResponse.data || []).forEach((entry: any) => {
          const employee = employees.find(emp => emp.id === entry.employee_id);
          const employeeName = employee?.fiscal_name || 'Empleado';
          const entryDate = new Date(entry.timestamp);
          const entryType =
            entry.entry_type === 'clock_in' ? 'Entrada' :
            entry.entry_type === 'clock_out' ? 'Salida' :
            entry.entry_type === 'break_start' ? 'Inicio pausa' : 'Fin pausa';

          const entryColor =
            entry.entry_type === 'clock_in' ? '#22c55e' :
            entry.entry_type === 'clock_out' ? '#ef4444' :
            entry.entry_type === 'break_start' ? '#f59e0b' : '#84cc16';

          const entryKey = `timeentry-${entry.id}-${entry.timestamp}`;
          if (!processedTime.has(entryKey)) {
            processedTime.add(entryKey);
            events.push({
              title: `${employeeName}: ${entryType} (${entryDate.toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'})})`,
              start: entry.timestamp,
              end: entry.timestamp,
              color: entryColor,
              type: 'timeentry',
              details: {
                employeeName,
                workCenter: (entry as any).work_center,
                entryType
              }
            });
          }
        });
      }

      // Vacations (solo si hay empleado seleccionado)
      if (showVacations && selectedEmployee) {
        const employeeProfile = employees.find(e => e.id === selectedEmployee);
        if (employeeProfile) {
          const { data: vacationsData, error: vacationsError } = await supabase
            .from('employee_vacations')
            .select('*')
            .eq('employee_id', selectedEmployee)
            .or(`and(start_date.lte.${endOfMonthStr},end_date.gte.${startOfMonthStr})`);

          if (!vacationsError && vacationsData) {
            vacationsData.forEach((vacation: any) => {
              const s = new Date(vacation.start_date);
              const e = new Date(vacation.end_date);
              for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
                events.push({
                  title: `${employeeProfile.fiscal_name}: Vacaciones${vacation.notes ? ' - ' + vacation.notes : ''}`,
                  start: d.toISOString().split('T')[0],
                  end: d.toISOString().split('T')[0],
                  color: '#9333ea',
                  type: 'vacation',
                  details: { employeeName: employeeProfile.fiscal_name }
                });
              }
            });
          }
        }
      }

      setCalendarEvents(events);
    } catch (err) {
      console.error('Error fetching calendar events:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los eventos');
    } finally {
      setLoading(false);
    }
  };

  const handleAddVacation = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const employeeProfile = employees.find(e => e.id === selectedEmployee);
      if (!employeeProfile) return;

      const { data: companyData } = await supabase
        .from('employee_profiles')
        .select('company_id')
        .eq('id', selectedEmployee)
        .single();

      if (!companyData?.company_id) return;

      const { error } = await supabase
        .from('employee_vacations')
        .insert({
          employee_id: selectedEmployee,
          company_id: companyData.company_id,
          start_date: vacationStartDate,
          end_date: vacationEndDate,
          status: 'approved',
          notes: vacationNotes || null
        });

      if (error) throw error;

      setShowVacationForm(false);
      setVacationStartDate('');
      setVacationEndDate('');
      setVacationNotes('');
      fetchCalendarEvents();
    } catch (error) {
      console.error('Error adding vacation:', error);
      alert('Error al añadir las vacaciones');
    }
  };

  const handleRequestCalendarSignature = async () => {
    try {
      if (!supervisorEmail) return;

      let filteredEmployees = employees;
      let targetDescription = '';

      if (selectedEmployee) {
        filteredEmployees = employees.filter(emp => emp.id === selectedEmployee);
        const empName = filteredEmployees[0]?.fiscal_name || 'empleado seleccionado';
        targetDescription = `al empleado ${empName}`;
      } else if (selectedWorkCenter) {
        filteredEmployees = employees.filter(emp => emp.work_centers?.includes(selectedWorkCenter));
        targetDescription = `a ${filteredEmployees.length} empleado(s) del centro de trabajo "${selectedWorkCenter}"`;
      } else {
        targetDescription = `a ${filteredEmployees.length} empleado(s) de todos tus centros de trabajo`;
      }

      const employeeIds = filteredEmployees.map(emp => emp.id);

      if (employeeIds.length === 0) {
        alert('No hay empleados seleccionados');
        return;
      }

      setPendingSignatureEmployees(employeeIds);
      setPendingSignatureDescription(targetDescription);
      setShowSupervisorSignatureModal(true);
    } catch (error) {
      console.error('Error preparing calendar signature:', error);
      alert('Error al preparar la firma del calendario');
    }
  };

  const startSupervisorSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!supervisorSignatureCanvasRef.current) return;

    const canvas = supervisorSignatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();

    setIsSigning(true);

    let x, y;
    if ('touches' in e) {
      // @ts-expect-error - touches en React TouchEvent
      x = e.touches[0].clientX - rect.left;
      // @ts-expect-error
      y = e.touches[0].clientY - rect.top;
    } else {
      // @ts-expect-error
      x = (e as React.MouseEvent).clientX - rect.left;
      // @ts-expect-error
      y = (e as React.MouseEvent).clientY - rect.top;
    }

    setSupervisorSignature([{ x, y }]);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
    }
  };

  const drawSupervisorSignature = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isSigning || !supervisorSignatureCanvasRef.current) return;

    const canvas = supervisorSignatureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');

    let x, y;
    if ('touches' in e) {
      e.preventDefault();
      // @ts-expect-error
      x = e.touches[0].clientX - rect.left;
      // @ts-expect-error
      y = e.touches[0].clientY - rect.top;
    } else {
      // @ts-expect-error
      x = (e as React.MouseEvent).clientX - rect.left;
      // @ts-expect-error
      y = (e as React.MouseEvent).clientY - rect.top;
    }

    setSupervisorSignature(prev => [...prev, { x, y }]);

    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const endSupervisorSignature = () => {
    setIsSigning(false);
    if (supervisorSignatureCanvasRef.current) {
      setSupervisorSignatureDataUrl(supervisorSignatureCanvasRef.current.toDataURL('image/png'));
    }
  };

  const clearSupervisorSignature = () => {
    setSupervisorSignature([]);
    setSupervisorSignatureDataUrl(null);
    if (supervisorSignatureCanvasRef.current) {
      const ctx = supervisorSignatureCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, supervisorSignatureCanvasRef.current.width, supervisorSignatureCanvasRef.current.height);
      }
    }
  };

  const handleConfirmSupervisorSignature = async () => {
    try {
      if (supervisorSignature.length === 0 || !supervisorSignatureDataUrl) {
        alert('Por favor firma antes de continuar');
        return;
      }
      if (!supervisorEmail) return;

      // 1) Marcar a los empleados como "firma solicitada"
      const currentYear = new Date().getFullYear();
      const { error: updEmpErr } = await supabase
        .from('employee_profiles')
        .update({
          calendar_signature_requested: true,
          calendar_signature_requested_at: new Date().toISOString(),
          calendar_report_year: currentYear,
          calendar_report_signed: false,
          calendar_report_pdf_url: null
        })
        .in('id', pendingSignatureEmployees);
      if (updEmpErr) throw updEmpErr;

      // 2) Obtener supervisor (id, company)
      const { data: supervisorData } = await supabase
        .from('supervisor_profiles')
        .select('id, company_id')
        .eq('email', supervisorEmail)
        .maybeSingle();

      if (!supervisorData?.company_id) throw new Error('No company_id para el supervisor');

      // 3) Guardar firma en el perfil del supervisor (fuente oficial para los PDFs)
      await supabase
        .from('supervisor_profiles')
        .update({ signature_image: supervisorSignatureDataUrl })
        .eq('id', supervisorData.id);

      // 4) Marcar en calendar_approvals que los calendarios se enviaron a empleados (NO guardamos columnas inexistentes)
      const { data: latestApproval } = await supabase
        .from('calendar_approvals')
        .select('id, calendars_sent_to_employees')
        .eq('company_id', supervisorData.company_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestApproval?.id) {
        const { error: updAppErr } = await supabase
          .from('calendar_approvals')
          .update({
            // ¡Sólo tocamos columnas que existan en tu esquema!
            calendars_sent_to_employees: true
          })
          .eq('id', latestApproval.id);
        if (updAppErr) throw updAppErr;
      }

      // 5) (Opcional) limpiar notificaciones antiguas
      const { data: supIdRow } = await supabase
        .from('supervisor_profiles')
        .select('id')
        .eq('email', supervisorEmail)
        .maybeSingle();

      if (supIdRow?.id) {
        await supabase
          .from('coordinator_notifications')
          .delete()
          .eq('supervisor_id', supIdRow.id)
          .eq('type', 'calendar_approved');
      }

      // Reset modal y UI
      setShowSupervisorSignatureModal(false);
      setSupervisorSignature([]);
      setSupervisorSignatureDataUrl(null);
      setPendingSignatureEmployees([]);
      setShowSendCalendarAlert(false);
      setEmployeesWithoutCalendar([]);

      alert(`✅ Se ha enviado la solicitud de firma del calendario ${pendingSignatureDescription}.`);

      // Refrescar listados/estado
      await fetchEmployees();
      await checkCalendarApprovalStatus();
    } catch (error) {
      console.error('Error requesting calendar signature:', error);
      alert('Error al solicitar firmas de calendario');
    }
  };

  const handleResetEmployeeReport = async (employeeId: string) => {
    try {
      const { error } = await supabase
        .from('employee_profiles')
        .update({
          calendar_signature_requested: true,
          calendar_report_signed: false,
          calendar_report_pdf_url: null,
          calendar_report_signed_at: null,
        })
        .eq('id', employeeId);

      if (error) throw error;

      alert('El estado del informe ha sido restablecido. El empleado deberá firmar nuevamente.');
      fetchEmployees();
    } catch (error) {
      console.error('Error resetting report:', error);
      alert('Error al restablecer el informe');
    }
  };

  const handleDownloadReport = (pdfUrl: string) => {
    if (!pdfUrl) {
      alert('No hay informe disponible para descargar');
      return;
    }
    window.open(pdfUrl, '_blank');
  };

  const handleViewHistory = async (employeeId: string) => {
    try {
      const { data, error } = await supabase
        .from('calendar_history')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });

    if (error) throw error;

      setCalendarHistory(data || []);
      setSelectedHistoryEmployee(employeeId);
      setShowHistoryModal(true);
    } catch (error) {
      console.error('Error fetching history:', error);
      alert('Error al obtener el historial');
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];

    const firstDayOfWeek = firstDay.getDay();
    for (let i = 0; i < (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1); i++) {
      days.push(null);
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(date => {
      const newDate = new Date(date);
      if (direction === 'prev') {
        newDate.setMonth(date.getMonth() - 1);
      } else {
        newDate.setMonth(date.getMonth() + 1);
      }
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

  const getEventsForDay = (date: Date) => {
    return calendarEvents
      .filter(event => {
        const eventDate = new Date(event.start);
        return (
          eventDate.getDate() === date.getDate() &&
          eventDate.getMonth() === date.getMonth() &&
          eventDate.getFullYear() === date.getFullYear()
        );
      })
      .sort((a, b) => {
        const dateA = new Date(a.start);
        const dateB = new Date(b.start);
        return dateA.getTime() - dateB.getTime();
      });
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Calendario del Centro</h1>
          <p className="text-gray-600">Vista general de horarios y fichajes</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}

        {/* ALERTA: solo si calendars_sent_to_employees === false */}
        {showSendCalendarAlert && employeesWithoutCalendar.length > 0 && (
          <div className="mb-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <FileText className="h-6 w-6 text-blue-500" />
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-blue-800">Envío de Calendarios Pendiente</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>
                    Tienes <strong>{employeesWithoutCalendar.length} empleado(s)</strong> que recibirán el calendario para firma.
                  </p>
                  <div className="mt-2">
                    <button
                      onClick={handleRequestCalendarSignature}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Enviar Ahora
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="flex items-center mb-1">
              <Search className="text-gray-400 w-5 h-5 mr-2" />
              <span className="text-sm font-medium text-gray-700">Buscar empleado</span>
            </div>
            <input
              type="text"
              placeholder="Nombre o email..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setSelectedEmployee('');
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center mb-1">
              <svg className="text-gray-400 w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Centro de trabajo</span>
            </div>
            <select
              value={selectedWorkCenter}
              onChange={(e) => {
                setSelectedWorkCenter(e.target.value);
                setSelectedEmployee('');
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Todos mis centros</option>
              {supervisorWorkCenters.map(center => (
                <option key={center} value={center}>{center}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center mb-1">
              <svg className="text-gray-400 w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Empleado específico</span>
            </div>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Todos los empleados</option>
              {employees
                .filter(emp => !selectedWorkCenter || emp.work_centers?.includes(selectedWorkCenter))
                .map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.fiscal_name}</option>
                ))
              }
            </select>
          </div>
        </div>

        {!isCalendarApproved && pendingApprovalMessage && (
          <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <Clock className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">Esperando confirmación de festivos</h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>{pendingApprovalMessage}</p>
                  <p className="mt-1">El calendario estará bloqueado hasta que la empresa confirme los festivos.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Informes de calendario */}
        {showCalendarReports && (
          <div className="mb-6 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-xl font-semibold mb-6">Informes de Calendario</h3>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Seleccionar Empleado
              </label>
              <select
                value={selectedReportEmployee}
                onChange={(e) => setSelectedReportEmployee(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Selecciona un empleado...</option>
                {employees.map((emp: Employee) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fiscal_name} - {emp.calendar_report_signed ? '✓ Firmado' : '⏳ Pendiente'}
                  </option>
                ))}
              </select>
            </div>

            {selectedReportEmployee && (() => {
              const employee = employees.find((e: Employee) => e.id === selectedReportEmployee);
              return employee ? (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="mb-4">
                    <h4 className="font-semibold text-lg">{employee.fiscal_name}</h4>
                    <p className="text-sm text-gray-600">
                      Estado: {employee.calendar_report_signed ? (
                        <span className="text-green-600 font-medium">✓ Firmado</span>
                      ) : (
                        <span className="text-orange-600 font-medium">⏳ Pendiente de firma</span>
                      )}
                    </p>
                    {employee.calendar_report_signed_at && (
                      <p className="text-sm text-gray-600">
                        Firmado el: {new Date(employee.calendar_report_signed_at).toLocaleDateString('es-ES')}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-3 flex-wrap">
                    {employee.calendar_report_pdf_url && (
                      <button
                        onClick={() => handleDownloadReport(employee.calendar_report_pdf_url!)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Descargar Informe
                      </button>
                    )}
                    <button
                      onClick={() => handleViewHistory(employee.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      Ver Historial
                    </button>
                    {employee.calendar_report_signed && (
                      <button
                        onClick={() => handleResetEmployeeReport(employee.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Restablecer Calendario
                      </button>
                    )}
                  </div>
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* Controles principales */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <button
            onClick={() => setShowHolidays(!showHolidays)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${showHolidays ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-600'}`}
          >
            <Calendar className="w-5 h-5" />
            <span className="text-sm">Festivos</span>
          </button>

          <button
            onClick={() => setShowWorkSchedules(!showWorkSchedules)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${showWorkSchedules ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-600'}`}
          >
            <Clock className="w-5 h-5" />
            <span className="text-sm">Horarios</span>
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
            <CalendarIcon className="w-5 h-5" />
            <span className="text-sm">Vacaciones</span>
          </button>

          <button
            onClick={() => selectedEmployee ? setShowVacationForm(true) : null}
            disabled={!selectedEmployee}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              selectedEmployee ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            title={!selectedEmployee ? 'Selecciona un empleado primero' : 'Añadir vacaciones'}
          >
            <CalendarIcon className="w-5 h-5" />
            <span className="text-sm">Añadir Vacaciones</span>
          </button>

          <button
            onClick={() => setShowCalendarReports(!showCalendarReports)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <BarChart className="w-5 h-5" />
            Ver Informes de Calendario
          </button>

          <button
            onClick={handleRequestCalendarSignature}
            disabled={!isCalendarApproved}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              isCalendarApproved ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            title={!isCalendarApproved ? 'Esperando confirmación de festivos por la empresa' : 'Enviar calendario para firma'}
          >
            <FileText className="w-5 h-5" />
            Enviar para Firma
          </button>
        </div>

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
        <div className={`bg-white rounded-xl shadow-lg p-6 relative ${!isCalendarApproved ? 'opacity-60 pointer-events-none blur-sm' : ''}`}>
          {!isCalendarApproved && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10 rounded-xl">
              <div className="text-center p-6">
                <Clock className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                <p className="text-lg font-semibold text-gray-800">Calendario bloqueado</p>
                <p className="text-sm text-gray-600 mt-2">Esperando confirmación de festivos</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-7 gap-2">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
              <div key={day} className="text-center font-semibold py-2">
                {day}
              </div>
            ))}
            {loading ? (
              <div className="col-span-7 py-20 text-center text-gray-500">
                Cargando eventos...
              </div>
            ) : (
              getDaysInMonth(currentDate).map((date, index) => (
                <div
                  key={index}
                  className={`min-h-[100px] p-2 border rounded-lg ${
                    date ? 'bg-white' : 'bg-gray-50'
                  } ${date && expandedDay && expandedDay.getDate() === date.getDate() &&
                     expandedDay.getMonth() === date.getMonth() &&
                     expandedDay.getFullYear() === date.getFullYear() ? 'border-2 border-blue-500' : ''}`}
                  onClick={() => date && toggleDayExpansion(date)}
                >
                  {date && (
                    <>
                      <div className="font-medium mb-1">{date.getDate()}</div>
                      <div className="space-y-1">
                        {getEventsForDay(date)
                          .slice(0, expandedDay && expandedDay.getDate() === date.getDate() &&
                                 expandedDay.getMonth() === date.getMonth() &&
                                 expandedDay.getFullYear() === date.getFullYear() ? undefined : 3)
                          .map((event, eventIndex) => (
                            <div
                              key={eventIndex}
                              className="text-xs p-2 rounded flex items-center gap-1"
                              style={{
                                backgroundColor: `${event.color}15`,
                                borderLeft: `3px solid ${event.color}`,
                                color: event.color
                              }}
                              title={event.title}
                            >
                              {event.type === 'holiday' ? (
                                <Calendar className="w-3 h-3 flex-shrink-0" />
                              ) : event.type === 'workschedule' ? (
                                <Clock className="w-3 h-3 flex-shrink-0" />
                              ) : event.type === 'planner' ? (
                                <FileText className="w-3 h-3 flex-shrink-0" />
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
        </div>

        {/* Vista expandida */}
        {expandedDay && (
          <div className="mt-6 bg-white rounded-xl shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                Eventos para el {expandedDay.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
              <button
                onClick={() => setExpandedDay(null)}
                className="p-1 hover:bg-gray-200 rounded-full"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
                      ) : event.type === 'planner' ? (
                        <FileText className="w-4 h-4" style={{ color: event.color }} />
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
                      <div className="font-medium" style={{ color: event.color }}>
                        {event.title}
                      </div>
                      {event.details && (
                        <div className="text-xs text-gray-600 mt-1">
                          {event.details.employeeName && <div>Empleado: {event.details.employeeName}</div>}
                          {event.details.workCenter && <div>Centro: {event.details.workCenter}</div>}
                          {event.details.entryType && <div>Tipo: {event.details.entryType}</div>}
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

        {/* Modal vacaciones */}
        {showVacationForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Añadir Vacaciones</h2>
                <button onClick={() => setShowVacationForm(false)} className="text-gray-400 hover:text-gray-600">
                  <span className="text-2xl">&times;</span>
                </button>
              </div>

              <form onSubmit={handleAddVacation} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Empleado</label>
                  <input
                    type="text"
                    value={employees.find(e => e.id === selectedEmployee)?.fiscal_name || ''}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50"
                    disabled
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Inicio</label>
                  <input
                    type="date"
                    value={vacationStartDate}
                    onChange={(e) => setVacationStartDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Fin</label>
                  <input
                    type="date"
                    value={vacationEndDate}
                    onChange={(e) => setVacationEndDate(e.target.value)}
                    min={vacationStartDate}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
                  <textarea
                    value={vacationNotes}
                    onChange={(e) => setVacationNotes(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    rows={3}
                    placeholder="Ej: Vacaciones de verano"
                  />
                </div>

                <div className="flex justify-end gap-4 mt-6">
                  <button type="button" onClick={() => setShowVacationForm(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                    Guardar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal firma coordinador */}
        {showSupervisorSignatureModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold mb-4">Firma del Coordinador</h3>
              <p className="text-gray-600 mb-4">
                Antes de enviar el calendario {pendingSignatureDescription}, debes firmar como coordinador/a.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Tu Firma</label>
                <div className="border-2 border-gray-300 rounded-lg overflow-hidden">
                  <canvas
                    ref={supervisorSignatureCanvasRef}
                    width={400}
                    height={200}
                    className="w-full bg-white cursor-crosshair touch-none"
                    onMouseDown={startSupervisorSignature}
                    onMouseMove={drawSupervisorSignature}
                    onMouseUp={endSupervisorSignature}
                    onMouseLeave={endSupervisorSignature}
                    onTouchStart={startSupervisorSignature}
                    onTouchMove={drawSupervisorSignature}
                    onTouchEnd={endSupervisorSignature}
                  />
                </div>
                <button type="button" onClick={clearSupervisorSignature} className="mt-2 text-sm text-blue-600 hover:text-blue-800">
                  Limpiar firma
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4">Tu firma aparecerá en el calendario junto con la firma del empleado.</p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowSupervisorSignatureModal(false);
                    setSupervisorSignature([]);
                    setSupervisorSignatureDataUrl(null);
                    clearSupervisorSignature();
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button onClick={handleConfirmSupervisorSignature} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                  Firmar y Enviar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Historial */}
        {showHistoryModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden">
<div className="p-6 border-b border-gray-200 flex items-start justify-between">
  <div>
    <h3 className="text-xl font-semibold text-gray-900">Historial de Calendarios</h3>
    <p className="text-sm text-gray-600 mt-1">
      {employees.find(e => e.id === selectedHistoryEmployee)?.fiscal_name}
    </p>
  </div>

  {/* Botón de cierre (cabecera) */}
  <button
    onClick={() => {
      setShowHistoryModal(false);
      setCalendarHistory([]);
      setSelectedHistoryEmployee('');
    }}
    className="p-2 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
    aria-label="Cerrar historial"
    title="Cerrar"
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
</div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {calendarHistory.length === 0 ? (
                  <p className="text-gray-600 text-center py-8">No hay historial disponible</p>
                ) : (
                  <div className="space-y-4">
                    {calendarHistory.map((history, index) => (
                      <div key={history.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-medium text-gray-900">Versión {calendarHistory.length - index}</h4>
                            <p className="text-sm text-gray-600">
                              {new Date(history.created_at).toLocaleString('es-ES', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                            {history.created_by && (
                              <p className="text-sm text-gray-500">Por: {history.created_by}</p>
                            )}
                          </div>
                          <button
                            onClick={() => window.open(history.calendar_data?.pdf_url, '_blank')}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            Descargar
                          </button>
                        </div>
                        {index === 0 && (
                          <span className="inline-block px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                            Versión Actual
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-gray-200 flex justify-end">
                <button
                  onClick={() => {
                    setShowHistoryModal(false);
                    setCalendarHistory([]);
                    setSelectedHistoryEmployee('');
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
