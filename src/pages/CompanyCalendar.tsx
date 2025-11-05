import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Calendar, FileText, ChevronLeft, ChevronRight, Plus, X, Clock, LogIn, LogOut, BarChart, Download, RotateCcw, CheckCircle } from 'lucide-react';
import { useUser } from '../context/UserContext';

interface CalendarEvent {
  id?: string;
  title: string;
  start: string;
  end: string;
  color: string;
  type: 'planner' | 'holiday' | 'workschedule' | 'timeentry' | 'vacation';
  details?: {
    employeeName?: string;
    plannerType?: string;
    hours?: number;
    entryType?: string;
    workCenter?: string;
  };
}

interface NewHoliday {
  date: string;
  name: string;
  holiday_type: 'work_center' | 'comunidad' | 'municipio';
  work_center: string | null;
  comunidad: string | null;
  municipio: string | null;
}

export default function CompanyCalendar() {
  const { user } = useUser();
  const [searchParams] = useSearchParams();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showHolidays, setShowHolidays] = useState(true);
  const [showWorkSchedules, setShowWorkSchedules] = useState(true);
  const [showTimeEntries, setShowTimeEntries] = useState(true);
  const [showVacations, setShowVacations] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [newHoliday, setNewHoliday] = useState<NewHoliday>({
    date: '',
    name: '',
    holiday_type: 'work_center',
    work_center: null,
    comunidad: null,
    municipio: null,
  });
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [selectedHoliday, setSelectedHoliday] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [excludedHolidayIds, setExcludedHolidayIds] = useState<Set<string>>(new Set());
  const [showCalendarReports, setShowCalendarReports] = useState(false);
  const [selectedReportEmployee, setSelectedReportEmployee] = useState<string>('');
  const [showVacationForm, setShowVacationForm] = useState(false);
  const [showCoordinatorModal, setShowCoordinatorModal] = useState(false);
  const [selectedCentersForCoordinator, setSelectedCentersForCoordinator] = useState<string[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [calendarHistory, setCalendarHistory] = useState<any[]>([]);
  const [selectedHistoryEmployee, setSelectedHistoryEmployee] = useState<string>('');
  const [vacationStartDate, setVacationStartDate] = useState('');
  const [vacationEndDate, setVacationEndDate] = useState('');
  const [vacationNotes, setVacationNotes] = useState('');
  const [comunidades] = useState([
    'Andalucía', 'Aragón', 'Asturias', 'Islas Baleares', 'Canarias', 'Cantabria',
    'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Comunidad Valenciana',
    'Extremadura', 'Galicia', 'La Rioja', 'Madrid', 'Murcia', 'Navarra', 'País Vasco'
  ]);
  const [municipios] = useState([
    'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Málaga', 'Murcia',
    'Palma de Mallorca', 'Las Palmas', 'Bilbao', 'Alicante', 'Córdoba', 'Valladolid',
    'Vigo', 'Gijón', 'Hospitalet de Llobregat', 'A Coruña', 'Vitoria', 'Granada',
    'Elche', 'Oviedo', 'Badalona', 'Cartagena', 'Terrassa', 'Jerez de la Frontera',
    'Sabadell', 'Santa Cruz de Tenerife', 'Móstoles', 'Alcalá de Henares', 'Pamplona'
  ]);

  useEffect(() => {
    fetchWorkCenters();
    fetchEmployees();
  }, [selectedWorkCenter, user?.company_id]);

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
    if (selectedEmployee || selectedWorkCenter) {
      fetchCalendarEvents();
    } else {
      setCalendarEvents([]);
    }
  }, [
    selectedEmployee,
    selectedWorkCenter,
    currentDate,
    user?.company_id,
    showHolidays,
    showWorkSchedules,
    showTimeEntries,
    showVacations
  ]);

  const fetchWorkCenters = async () => {
    try {
      if (!user?.company_id) return;

      const { data: workCentersData, error } = await supabase
        .from('employee_profiles')
        .select('work_centers')
        .eq('company_id', user.company_id);

      if (error) {
        console.error('Error fetching work centers:', error);
        return;
      }

      if (workCentersData) {
        const centers = workCentersData
          .flatMap((emp) => emp.work_centers)
          .filter((center): center is string => !!center)
          .filter((center, index, self) => self.indexOf(center) === index);

        setWorkCenters(centers);
      }
    } catch (error) {
      console.error('Error fetching work centers:', error);
    }
  };

  const fetchEmployees = async () => {
    try {
      if (!user?.company_id) return;

      let query = supabase
        .from('employee_profiles')
        .select('*')
        .eq('is_active', true)
        .eq('company_id', user.company_id)
        .order('fiscal_name');

      if (selectedWorkCenter) {
        query = query.contains('work_centers', [selectedWorkCenter]);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching employees:', error);
        return;
      }

      if (data) {
        setEmployees(data);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchCalendarEvents = async () => {
    try {
      if (!user?.company_id) return;

      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      startOfMonth.setHours(0, 0, 0, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

      // Load excluded holidays if an employee is selected
      if (selectedEmployee) {
        const { data: exclusionsData, error: exclusionsError } = await supabase
          .from('employee_holiday_exclusions')
          .select('holiday_id')
          .eq('employee_id', selectedEmployee);

        if (!exclusionsError && exclusionsData) {
          setExcludedHolidayIds(new Set(exclusionsData.map(e => e.holiday_id)));
        }
      } else {
        setExcludedHolidayIds(new Set());
      }

      // === HOLIDAYS ===
      let holidaysQuery = supabase
        .from('holidays')
        .select('*')
        .eq('company_id', user.company_id)
        .gte('date', startOfMonthStr)
        .lte('date', endOfMonthStr);

      if (selectedWorkCenter) {
        holidaysQuery = holidaysQuery.or(`work_center.is.null,work_center.eq.${selectedWorkCenter}`);
      }

      // === WORK SCHEDULES (join con employee_profiles) ===
      let workSchedulesQuery = supabase
        .from('employee_schedules')
        .select(`
          *,
          employee_profiles!inner (
            id,
            company_id,
            fiscal_name,
            work_centers
          )
        `)
        .gte('date', startOfMonthStr)
        .lte('date', endOfMonthStr)
        .eq('employee_profiles.company_id', user.company_id);

      if (selectedEmployee) {
        workSchedulesQuery = workSchedulesQuery.eq('employee_id', selectedEmployee);
      }
      if (selectedWorkCenter) {
        workSchedulesQuery = workSchedulesQuery.contains('employee_profiles.work_centers', [selectedWorkCenter]);
      }

      // === TIME ENTRIES: primero IDs de empleados de la empresa (y centro) ===
      let employeeIdsQuery = supabase
        .from('employee_profiles')
        .select('id, fiscal_name')
        .eq('company_id', user.company_id);

      if (selectedEmployee) {
        employeeIdsQuery = employeeIdsQuery.eq('id', selectedEmployee);
      }
      if (selectedWorkCenter) {
        employeeIdsQuery = employeeIdsQuery.contains('work_centers', [selectedWorkCenter]);
      }

      const { data: employeeData, error: employeeError } = await employeeIdsQuery;
      if (employeeError) {
        console.error('Error fetching employees:', employeeError);
        return;
      }

      const employeeIds = employeeData?.map(emp => emp.id) || [];
      const employeeNamesMap = employeeData?.reduce((acc, emp) => {
        acc[emp.id] = emp.fiscal_name;
        return acc;
      }, {} as Record<string, string>) || {};

      let timeEntriesQuery = supabase
        .from('time_entries')
        .select('*')
        .in('employee_id', employeeIds)
        .eq('is_active', true)
        .gte('timestamp', startOfMonth.toISOString())
        .lte('timestamp', endOfMonth.toISOString());

      const [
        holidaysResponse,
        workSchedulesResponse
      ] = await Promise.all([
        showHolidays ? holidaysQuery : { data: [], error: null },
        showWorkSchedules ? workSchedulesQuery : { data: [], error: null }
      ]);

      let timeEntriesResponse: any = { data: [], error: null };
      if (showTimeEntries && employeeIds.length > 0) {
        timeEntriesResponse = await timeEntriesQuery;
      }

      const events: CalendarEvent[] = [];

      // Holidays
      if (showHolidays && holidaysResponse.data) {
        holidaysResponse.data.forEach((h: any) => {
          if (!excludedHolidayIds.has(h.id)) {
            events.push({
              id: h.id,
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
      if (showWorkSchedules && workSchedulesResponse.data) {
        workSchedulesResponse.data.forEach((schedule: any) => {
          const empName = schedule.employee_profiles?.fiscal_name;
          const empCenters = schedule.employee_profiles?.work_centers || [];

          if (schedule.morning_start && schedule.morning_end) {
            events.push({
              title: `${empName}: ${schedule.morning_start} - ${schedule.morning_end}`,
              start: `${schedule.date}T${schedule.morning_start}`,
              end: `${schedule.date}T${schedule.morning_end}`,
              color: '#3b82f6',
              type: 'workschedule',
              details: {
                employeeName: empName,
                workCenter: empCenters?.[0]
              }
            });
          }

          if (schedule.enabled && schedule.afternoon_start && schedule.afternoon_end) {
            events.push({
              title: `${empName}: ${schedule.afternoon_start} - ${schedule.afternoon_end}`,
              start: `${schedule.date}T${schedule.afternoon_start}`,
              end: `${schedule.date}T${schedule.afternoon_end}`,
              color: '#3b82f6',
              type: 'workschedule',
              details: {
                employeeName: empName,
                workCenter: empCenters?.[0]
              }
            });
          }
        });
      }

      // Time entries
      if (showTimeEntries && timeEntriesResponse.data) {
        timeEntriesResponse.data.forEach((entry: any) => {
          const employeeName = employeeNamesMap[entry.employee_id] || 'Empleado';
          const entryDate = new Date(entry.timestamp);
          const entryType =
            entry.entry_type === 'clock_in' ? 'Entrada' :
            entry.entry_type === 'clock_out' ? 'Salida' :
            entry.entry_type === 'break_start' ? 'Inicio pausa' : 'Fin pausa';

          const entryColor =
            entry.entry_type === 'clock_in' ? '#22c55e' :
            entry.entry_type === 'clock_out' ? '#ef4444' :
            entry.entry_type === 'break_start' ? '#f59e0b' : '#84cc16';

          events.push({
            title: `${employeeName}: ${entryType} (${entryDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`,
            start: entry.timestamp,
            end: entry.timestamp,
            color: entryColor,
            type: 'timeentry',
            details: {
              employeeName,
              workCenter: entry.work_center,
              entryType
            }
          });
        });
      }

      // Vacations
      if (showVacations && selectedEmployee) {
        const { data: vacationsData, error: vacationsError } = await supabase
          .from('employee_vacations')
          .select('*')
          .eq('employee_id', selectedEmployee)
          .eq('company_id', user.company_id)
          .or(`and(start_date.lte.${endOfMonthStr},end_date.gte.${startOfMonthStr})`);

        if (!vacationsError && vacationsData) {
          vacationsData.forEach((vacation: any) => {
            const startDate = new Date(vacation.start_date);
            const endDate = new Date(vacation.end_date);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
              events.push({
                id: vacation.id,
                title: `Vacaciones${vacation.notes ? ': ' + vacation.notes : ''}`,
                start: d.toISOString().split('T')[0],
                end: d.toISOString().split('T')[0],
                color: '#9333ea',
                type: 'vacation',
                details: {
                  employeeName: employeeNamesMap[selectedEmployee]
                }
              });
            }
          });
        }
      }

      setCalendarEvents(events);
    } catch (err) {
      console.error('Error fetching calendar events:', err);
    }
  };

  const handleDeleteHoliday = async () => {
    try {
      if (!selectedHoliday || !selectedHoliday.id) return;

      const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', selectedHoliday.id);

      if (error) throw error;

      setShowDeleteModal(false);
      setSelectedHoliday(null);
      fetchCalendarEvents();
    } catch (error) {
      console.error('Error deleting holiday:', error);
    }
  };

  const handleAddVacation = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (!user?.company_id || !selectedEmployee) return;

      const { error } = await supabase
        .from('employee_vacations')
        .insert({
          employee_id: selectedEmployee,
          company_id: user.company_id,
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

  const fetchCalendarHistory = async () => {
    try {
      if (!selectedEmployee) return;

      const currentYear = new Date().getFullYear();

      const { data, error } = await supabase
        .from('calendar_history')
        .select('*')
        .eq('employee_id', selectedEmployee)
        .eq('year', currentYear)
        .order('version', { ascending: false });

      if (error) throw error;

      setCalendarHistory(data || []);
      setShowHistoryModal(true);
    } catch (err) {
      console.error('Error fetching calendar history:', err);
      alert('Error al cargar el historial');
    }
  };

  const handleSendToCoordinator = async () => {
    try {
      if (!user?.company_id) return;

      if (selectedCentersForCoordinator.length === 0) {
        alert('Por favor selecciona al menos un centro de trabajo.');
        return;
      }

      const { error } = await supabase
        .from('calendar_approvals')
        .insert({
          company_id: user.company_id,
          work_centers: selectedCentersForCoordinator,
          status: 'pending_company_approval'
        });

      if (error) throw error;

      const supervisorQuery = await supabase
        .from('employee_profiles')
        .select('id')
        .eq('company_id', user.company_id)
        .eq('role', 'supervisor')
        .eq('is_active', true);

      if (supervisorQuery.data && supervisorQuery.data.length > 0) {
        const notifications = supervisorQuery.data.map(supervisor => ({
          supervisor_id: supervisor.id,
          type: 'calendar_pending',
          title: 'Calendarios enviados - Pendiente de aprobación',
          message: `La empresa ha enviado calendarios para los centros: ${selectedCentersForCoordinator.join(', ')}. Esperando confirmación de festivos por parte de la empresa.`,
          is_read: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }));

        await supabase
          .from('coordinator_notifications')
          .insert(notifications);
      }

      alert(`Calendarios enviados a coordinador para los centros: ${selectedCentersForCoordinator.join(', ')}. Ahora debes confirmar los festivos.`);
      setShowCoordinatorModal(false);
      setSelectedCentersForCoordinator([]);
    } catch (error) {
      console.error('Error sending to coordinator:', error);
      alert('Error al enviar a coordinador');
    }
  };

  const handleConfirmHolidays = async () => {
    try {
      if (!user?.company_id) return;

      const { data: pendingApprovals, error: fetchError } = await supabase
        .from('calendar_approvals')
        .select('id, work_centers')
        .eq('company_id', user.company_id)
        .eq('status', 'pending_company_approval');

      if (fetchError) throw fetchError;

      if (!pendingApprovals || pendingApprovals.length === 0) {
        alert('No hay calendarios pendientes de confirmar festivos.');
        return;
      }

      const approvalIds = pendingApprovals.map(a => a.id);
      const allWorkCenters = [...new Set(pendingApprovals.flatMap(a => a.work_centers))];

      const { error: updateError } = await supabase
        .from('calendar_approvals')
        .update({
          status: 'company_approved',
          company_approved_at: new Date().toISOString(),
          approved_by: user.email
        })
        .in('id', approvalIds);

      if (updateError) throw updateError;

      const supervisorQuery = await supabase
        .from('employee_profiles')
        .select('id')
        .eq('company_id', user.company_id)
        .eq('role', 'supervisor')
        .eq('is_active', true);

      if (supervisorQuery.data && supervisorQuery.data.length > 0) {
        const notifications = supervisorQuery.data.map(supervisor => ({
          supervisor_id: supervisor.id,
          type: 'calendar_approved',
          title: '¡Festivos confirmados! Envía calendarios a empleados',
          message: `La empresa ha confirmado los festivos para: ${allWorkCenters.join(', ')}. Ya puedes enviar los calendarios para firma a los empleados.`,
          is_read: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }));

        await supabase
          .from('coordinator_notifications')
          .insert(notifications);
      }

      alert(`Festivos confirmados. Los coordinadores ya pueden enviar calendarios para firma a los empleados.`);
    } catch (error) {
      console.error('Error confirming holidays:', error);
      alert('Error al confirmar festivos');
    }
  };

  const handleRequestCalendarSignature = async () => {
    try {
      if (!user?.company_id) return;

      if (!selectedWorkCenter) {
        alert('Por favor selecciona un centro de trabajo antes de enviar el calendario para firma.');
        return;
      }

      const currentYear = new Date().getFullYear();

      let query = supabase
        .from('employee_profiles')
        .update({
          calendar_signature_requested: true,
          calendar_signature_requested_at: new Date().toISOString(),
          calendar_report_year: currentYear,
          calendar_report_signed: false,
          calendar_report_pdf_url: null,
        })
        .eq('company_id', user.company_id)
        .eq('is_active', true);

      if (selectedEmployee) {
        query = query.eq('id', selectedEmployee);
        const employee = employees.find(e => e.id === selectedEmployee);
        const confirmed = confirm(
          `¿Estás seguro de que deseas enviar el calendario para firma al empleado ${employee?.fiscal_name}?`
        );
        if (!confirmed) return;
      } else {
        query = query.contains('work_centers', [selectedWorkCenter]);
        const filteredCount = employees.filter(e => e.work_centers?.includes(selectedWorkCenter)).length;
        const confirmed = confirm(
          `¿Estás seguro de que deseas enviar el calendario para firma a ${filteredCount} empleado(s) del centro "${selectedWorkCenter}"?`
        );
        if (!confirmed) return;
      }

      const { error } = await query;

      if (error) throw error;

      if (selectedEmployee) {
        alert('Se ha solicitado la firma del calendario al empleado seleccionado.');
      } else {
        const filteredCount = employees.filter(e => e.work_centers?.includes(selectedWorkCenter)).length;
        alert(`Se ha solicitado la firma del calendario a ${filteredCount} empleado(s) del centro "${selectedWorkCenter}".`);
      }

      await fetchEmployees();
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

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!user?.company_id) throw new Error('No se encontró el ID de la empresa');

      if (newHoliday.holiday_type === 'work_center') {
        const holidayData: any = {
          date: newHoliday.date,
          name: newHoliday.name,
          type: 'company',
          company_id: user.company_id,
          holiday_type: 'work_center',
          work_center: newHoliday.work_center === 'TODOS' ? null : newHoliday.work_center,
        };

        const { error: insertError } = await supabase
          .from('holidays')
          .insert([holidayData]);

        if (insertError) throw insertError;
      } else if (newHoliday.holiday_type === 'comunidad' || newHoliday.holiday_type === 'municipio') {
        const { data: addressData, error: addressError } = await supabase
          .from('work_center_address')
          .select('work_center_name, comunidad, municipio')
          .eq('company_id', user.company_id);

        if (addressError) throw addressError;

        let filteredCenters: string[] = [];

        if (newHoliday.holiday_type === 'comunidad' && newHoliday.comunidad) {
          filteredCenters = addressData
            ?.filter(addr => addr.work_center_name && addr.comunidad === newHoliday.comunidad)
            .map(addr => addr.work_center_name) || [];
        } else if (newHoliday.holiday_type === 'municipio' && newHoliday.municipio) {
          filteredCenters = addressData
            ?.filter(addr => addr.work_center_name && addr.municipio === newHoliday.municipio)
            .map(addr => addr.work_center_name) || [];
        }

        if (filteredCenters.length === 0) {
          alert('No se encontraron centros de trabajo con esa comunidad/municipio configurada');
          return;
        }

        const holidaysToInsert = filteredCenters.map(center => ({
          date: newHoliday.date,
          name: newHoliday.name,
          type: 'company',
          company_id: user.company_id,
          holiday_type: 'work_center',
          work_center: center,
        }));

        const { error: insertError } = await supabase
          .from('holidays')
          .insert(holidaysToInsert);

        if (insertError) throw insertError;
      }

      setShowHolidayForm(false);
      setNewHoliday({
        date: '',
        name: '',
        holiday_type: 'work_center',
        work_center: null,
        comunidad: null,
        municipio: null
      });
      fetchCalendarEvents();
    } catch (error) {
      console.error('Error adding holiday:', error);
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
    setCurrentDate((date) => {
      const newDate = new Date(date);
      if (direction === 'prev') newDate.setMonth(date.getMonth() - 1);
      else newDate.setMonth(date.getMonth() + 1);
      return newDate;
    });
    setExpandedDay(null);
  };

  const toggleDayExpansion = (date: Date) => {
    if (
      expandedDay &&
      expandedDay.getDate() === date.getDate() &&
      expandedDay.getMonth() === date.getMonth() &&
      expandedDay.getFullYear() === date.getFullYear()
    ) {
      setExpandedDay(null);
    } else {
      setExpandedDay(date);
    }
  };

  const getEventsForDay = (date: Date) => {
    return calendarEvents
      .filter((event) => {
        const eventDate = new Date(event.start);
        const matchesDate =
          eventDate.getDate() === date.getDate() &&
          eventDate.getMonth() === date.getMonth() &&
          eventDate.getFullYear() === date.getFullYear();

        if (!matchesDate) return false;
        if (event.type === 'holiday' && !showHolidays) return false;
        if (event.type === 'workschedule' && !showWorkSchedules) return false;
        if (event.type === 'timeentry' && !showTimeEntries) return false;

        return true;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Work Center Selection */}
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Centro de Trabajo</h2>
              <select
                value={selectedWorkCenter || ''}
                onChange={(e) => {
                  setSelectedWorkCenter(e.target.value || null);
                  setSelectedEmployee(null);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todos los centros</option>
                {workCenters.map((center) => (
                  <option key={center} value={center}>
                    {center}
                  </option>
                ))}
              </select>
            </div>

            {/* Employee Selection */}
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Empleado</h2>
              <select
                value={selectedEmployee || ''}
                onChange={(e) => setSelectedEmployee(e.target.value || null)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todos los empleados</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fiscal_name}
                  </option>
                ))}
              </select>

              {/* INFO + ACCIONES: SIEMPRE QUE HAYA EMPLEADO SELECCIONADO */}
              {selectedEmployee && (() => {
                const employee = employees.find((e: any) => e.id === selectedEmployee);
                if (!employee) return null;
                return (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-700">Informe de Calendario</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {employee.calendar_report_signed ? (
                          <>
                            <span className="text-green-600 font-medium">✓ Firmado</span>
                            {employee.calendar_report_signed_at && (
                              <span className="ml-2">
                                el {new Date(employee.calendar_report_signed_at).toLocaleDateString('es-ES')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-orange-600 font-medium">⏳ Pendiente de firma</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {employee.calendar_report_pdf_url && (
                        <button
                          onClick={() => handleDownloadReport(employee.calendar_report_pdf_url)}
                          className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Descargar Informe
                        </button>
                      )}
                      {/* ⬇⬇⬇ SIEMPRE VISIBLE */}
                      <button
                        onClick={() => handleResetEmployeeReport(employee.id)}
                        className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 transition-colors"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Restablecer Firma
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Event Filters */}
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Filtros</h2>
              <div className="space-y-4">
                <button
                  onClick={() => setShowHolidays(!showHolidays)}
                  className={`flex items-center gap-2 w-full px-4 py-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors ${
                    showHolidays ? 'bg-orange-50' : ''
                  }`}
                >
                  <Calendar className="w-5 h-5" />
                  Festivos
                </button>

                <button
                  onClick={() => setShowWorkSchedules(!showWorkSchedules)}
                  className={`flex items-center gap-2 w-full px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ${
                    showWorkSchedules ? 'bg-blue-50' : ''
                  }`}
                >
                  <Calendar className="w-5 h-5" />
                  Horarios Laborales
                </button>

                <button
                  onClick={() => setShowTimeEntries(!showTimeEntries)}
                  className={`flex items-center gap-2 w-full px-4 py-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors ${
                    showTimeEntries ? 'bg-green-50' : ''
                  }`}
                >
                  <Clock className="w-5 h-5" />
                  Fichajes
                </button>

                <button
                  onClick={() => setShowVacations(!showVacations)}
                  className={`flex items-center gap-2 w-full px-4 py-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors ${
                    showVacations ? 'bg-purple-50' : ''
                  }`}
                >
                  <Calendar className="w-5 h-5" />
                  Vacaciones
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Acciones</h2>
              <div className="space-y-3">
                {/* Botón Añadir Festivo movido a Configuración > Festivos */}
                <button
                  onClick={() => setShowVacationForm(true)}
                  disabled={!selectedEmployee}
                  className={`flex items-center gap-2 w-full px-4 py-2 rounded-lg transition-colors ${
                    selectedEmployee
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                  title={!selectedEmployee ? 'Selecciona un empleado primero' : ''}
                >
                  <Plus className="w-5 h-5" />
                  Añadir Vacaciones
                </button>
                <button
                  onClick={() => setShowCoordinatorModal(true)}
                  className="flex items-center gap-2 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <FileText className="w-5 h-5" />
                  Enviar a Coordinador para Planificar
                </button>
                <button
                  onClick={handleConfirmHolidays}
                  className="flex items-center gap-2 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <CheckCircle className="w-5 h-5" />
                  Confirmar Festivos
                </button>
                <button
                  onClick={() => setShowCalendarReports(!showCalendarReports)}
                  className="flex items-center gap-2 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <BarChart className="w-5 h-5" />
                  Ver Informes de Calendario
                </button>
                <button
                  onClick={fetchCalendarHistory}
                  disabled={!selectedEmployee}
                  className={`flex items-center gap-2 w-full px-4 py-2 rounded-lg transition-colors ${
                    selectedEmployee
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                  title={!selectedEmployee ? 'Selecciona un empleado primero' : ''}
                >
                  <Clock className="w-5 h-5" />
                  Ver Historial
                </button>
              </div>
            </div>
          </div>

          {/* Calendar */}
          <div className="lg:col-span-3">
            <div className="bg-white p-6 rounded-xl shadow-sm">
              {/* Month Navigation */}
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={() => navigateMonth('prev')}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="text-xl font-semibold">
                  {currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' })}
                </h2>
                <button
                  onClick={() => navigateMonth('next')}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-2">
                {/* Calendar Header */}
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
                  <div key={day} className="text-center font-semibold py-2">
                    {day}
                  </div>
                ))}
                {/* Calendar Days */}
                {getDaysInMonth(currentDate).map((date, index) => (
                  <div
                    key={index}
                    className={`min-h-[120px] p-2 border rounded-lg ${
                      date ? 'bg-white' : 'bg-gray-50'
                    } ${date && expandedDay && expandedDay.getDate() === date.getDate() && 
                       expandedDay.getMonth() === date.getMonth() && 
                       expandedDay.getFullYear() === date.getFullYear() ? 'border-2 border-blue-500' : ''}`}
                    onClick={() => date && toggleDayExpansion(date)}
                  >
                    {date && (
                      <>
                        <div className="font-medium mb-1">
                          {date.getDate()}
                        </div>
                        <div className="space-y-1 max-h-[100px] overflow-y-auto">
                          {getEventsForDay(date)
                            .slice(0, expandedDay && expandedDay.getDate() === date.getDate() && 
                                   expandedDay.getMonth() === date.getMonth() && 
                                   expandedDay.getFullYear() === date.getFullYear() ? undefined : 3)
                            .map((event, eventIndex) => (
                              <div
                                key={eventIndex}
                                className={`text-xs p-2 rounded flex items-center gap-1 truncate ${event.type === 'holiday' ? 'cursor-pointer hover:opacity-80' : ''}`}
                                style={{
                                  backgroundColor: `${event.color}15`,
                                  borderLeft: `3px solid ${event.color}`,
                                  color: event.color,
                                }}
                                title={event.title}
                                onClick={() => {
                                  if (event.type === 'holiday' && event.id) {
                                    setSelectedHoliday(event);
                                    setShowDeleteModal(true);
                                  }
                                }}
                              >
                                {event.type === 'holiday' ? (
                                  <Calendar className="w-3 h-3 flex-shrink-0" />
                                ) : event.type === 'workschedule' ? (
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
                          {expandedDay && expandedDay.getDate() === date.getDate() && 
                           expandedDay.getMonth() === date.getMonth() && 
                           expandedDay.getFullYear() === date.getFullYear() && 
                           getEventsForDay(date).length > 3 && (
                            <div className="text-xs text-center text-gray-500 mt-1">
                              {getEventsForDay(date).length - 3} más...
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Expanded Day View */}
              {expandedDay && (
                <div className="mt-6 bg-gray-50 p-4 rounded-lg">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">
                      Eventos para el {expandedDay.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </h3>
                    <button 
                      onClick={() => setExpandedDay(null)}
                      className="p-1 hover:bg-gray-200 rounded-full"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {getEventsForDay(expandedDay).length > 0 ? (
                      getEventsForDay(expandedDay).map((event, index) => (
                        <div
                          key={index}
                          className={`p-3 rounded-lg flex items-start gap-3 ${event.type === 'holiday' ? 'cursor-pointer hover:opacity-80' : ''}`}
                          style={{
                            backgroundColor: `${event.color}15`,
                            borderLeft: `4px solid ${event.color}`,
                          }}
                          onClick={() => {
                            if (event.type === 'holiday' && event.id) {
                              setSelectedHoliday(event);
                              setShowDeleteModal(true);
                            }
                          }}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {event.type === 'holiday' ? (
                              <Calendar className="w-4 h-4" style={{ color: event.color }} />
                            ) : event.type === 'workschedule' ? (
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
                            <div className="font-medium" style={{ color: event.color }}>
                              {event.title}
                            </div>
                            {event.details && (
                              <div className="text-xs text-gray-600 mt-1">
                                {event.details.employeeName && <div>Empleado: {event.details.employeeName}</div>}
                                {event.details.workCenter && <div>Centro: {event.details.workCenter}</div>}
                                {event.details.plannerType && <div>Tipo: {event.details.plannerType}</div>}
                                {event.details.entryType && <div>Tipo: {event.details.entryType}</div>}
                                {event.details.hours && <div>Horas: {event.details.hours}</div>}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-gray-500 py-4">
                        No hay eventos para este día
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Reports Section */}
      {showCalendarReports && (
        <div className="max-w-7xl mx-auto mt-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <h2 className="text-xl font-semibold mb-6">Informes de Calendario</h2>

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
                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fiscal_name} - {emp.calendar_report_signed ? '✓ Firmado' : '⏳ Pendiente'}
                  </option>
                ))}
              </select>
            </div>

            {selectedReportEmployee && (() => {
              const employee = employees.find((e: any) => e.id === selectedReportEmployee);
              return employee ? (
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="mb-4">
                    <h3 className="font-semibold text-lg">{employee.fiscal_name}</h3>
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
                        onClick={() => handleDownloadReport(employee.calendar_report_pdf_url)}
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
        </div>
      )}

      {/* Holiday Form */}
      {showHolidayForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Añadir Festivo</h2>
              <button
                onClick={() => setShowHolidayForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleAddHoliday} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha
                </label>
                <input
                  type="date"
                  value={newHoliday.date}
                  onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del Festivo
                </label>
                <input
                  type="text"
                  value={newHoliday.name}
                  onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Ej: Navidad"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Festivo
                </label>
                <select
                  value={newHoliday.holiday_type}
                  onChange={(e) => setNewHoliday({
                    ...newHoliday,
                    holiday_type: e.target.value as 'work_center' | 'comunidad' | 'municipio',
                    work_center: null,
                    comunidad: null,
                    municipio: null
                  })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="work_center">Centro de Trabajo</option>
                  <option value="comunidad">Comunidad</option>
                  <option value="municipio">Municipio</option>
                </select>
              </div>

              {newHoliday.holiday_type === 'work_center' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Centro de Trabajo
                  </label>
                  <select
                    value={newHoliday.work_center || 'TODOS'}
                    onChange={(e) => setNewHoliday({ ...newHoliday, work_center: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="TODOS">Todos los centros</option>
                    {workCenters.map((center) => (
                      <option key={center} value={center}>
                        {center}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newHoliday.holiday_type === 'comunidad' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Comunidad Autónoma
                  </label>
                  <select
                    value={newHoliday.comunidad || ''}
                    onChange={(e) => setNewHoliday({ ...newHoliday, comunidad: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="">Selecciona una comunidad</option>
                    {comunidades.map((com) => (
                      <option key={com} value={com}>
                        {com}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newHoliday.holiday_type === 'municipio' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Municipio
                  </label>
                  <select
                    value={newHoliday.municipio || ''}
                    onChange={(e) => setNewHoliday({ ...newHoliday, municipio: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="">Selecciona un municipio</option>
                    {municipios.map((mun) => (
                      <option key={mun} value={mun}>
                        {mun}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowHolidayForm(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Vacation Modal */}
      {showVacationForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Añadir Vacaciones</h2>
              <button
                onClick={() => setShowVacationForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleAddVacation} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Empleado
                </label>
                <input
                  type="text"
                  value={employees.find(e => e.id === selectedEmployee)?.fiscal_name || ''}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50"
                  disabled
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Inicio
                </label>
                <input
                  type="date"
                  value={vacationStartDate}
                  onChange={(e) => setVacationStartDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Fin
                </label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notas (opcional)
                </label>
                <textarea
                  value={vacationNotes}
                  onChange={(e) => setVacationNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  rows={3}
                  placeholder="Ej: Vacaciones de verano"
                />
              </div>

              <div className="flex justify-end gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowVacationForm(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Holiday Modal */}
      {showDeleteModal && selectedHoliday && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Eliminar Festivo</h2>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedHoliday(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <p className="text-gray-700 mb-6">
              ¿Estás seguro de que deseas eliminar el festivo "{selectedHoliday.title}"?
            </p>

            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedHoliday(null);
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteHoliday}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {showCoordinatorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full">
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Enviar a Coordinador para Planificar</h3>
              <p className="text-sm text-gray-600 mb-4">
                Selecciona los centros de trabajo cuyos calendarios deseas enviar al coordinador para que los planifique.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3 mb-4">
                {workCenters.map((center) => (
                  <label key={center} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={selectedCentersForCoordinator.includes(center)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCentersForCoordinator([...selectedCentersForCoordinator, center]);
                        } else {
                          setSelectedCentersForCoordinator(selectedCentersForCoordinator.filter(c => c !== center));
                        }
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm">{center}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCoordinatorModal(false);
                    setSelectedCentersForCoordinator([]);
                  }}
                  className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSendToCoordinator}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-semibold">Historial de Calendarios</h3>
              <button
                onClick={() => {
                  setShowHistoryModal(false);
                  setCalendarHistory([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
              {calendarHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No hay historial de calendarios para este empleado</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {calendarHistory.map((history, index) => (
                    <div key={history.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-semibold text-gray-900">
                            Versión {history.version}
                            {index === 0 && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Más reciente</span>}
                          </h4>
                          <p className="text-sm text-gray-600 mt-1">{history.reason}</p>
                        </div>
                        <div className="text-right text-sm text-gray-500">
                          <p>{new Date(history.created_at).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}</p>
                          {history.changed_by && <p className="mt-1">Por: {history.changed_by}</p>}
                        </div>
                      </div>
                      <div className="bg-gray-50 p-3 rounded text-xs">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="font-medium text-gray-700 mb-1">Horas anuales:</p>
                            <p className="text-gray-900">{history.calendar_data.total_annual_hours || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="font-medium text-gray-700 mb-1">Centros de trabajo:</p>
                            <p className="text-gray-900">
                              {Array.isArray(history.calendar_data.work_centers)
                                ? history.calendar_data.work_centers.join(', ')
                                : 'N/A'}
                            </p>
                          </div>
                        </div>
                        {history.calendar_data.work_schedule && (
                          <div className="mt-3">
                            <p className="font-medium text-gray-700 mb-2">Horario configurado:</p>
                            <pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto max-h-32">
                              {JSON.stringify(JSON.parse(history.calendar_data.work_schedule), null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">Historial de Calendarios</h3>
              <p className="text-sm text-gray-600 mt-1">
                {employees.find((e: any) => e.id === selectedHistoryEmployee)?.fiscal_name}
              </p>
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
                          <h4 className="font-medium text-gray-900">
                            Versión {calendarHistory.length - index}
                          </h4>
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
  );
}
