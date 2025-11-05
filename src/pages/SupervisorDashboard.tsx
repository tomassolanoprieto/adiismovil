// SupervisorDashboard.tsx (modificado)
// — Sin horas festivas ni desglose por time_type
// — Cálculo robusto: segmentos clock_in→clock_out, pausas, cruces de medianoche, horas nocturnas (22:00–06:00)

import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route } from 'react-router-dom';
import { LogOut, BarChart, Shield, User, Users, Clock, Search, X, Plus, CreditCard as Edit, Calendar, Settings, MapPin, ChevronLeft, ChevronRight, AlertTriangle, Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MobileNav from '../components/MobileNav';
import SupervisorEmployees from './SupervisorEmployees';
import SupervisorRequests from './SupervisorRequests';
import SupervisorCalendar from './SupervisorCalendar';
import SupervisorReports from './SupervisorReports';
import SupervisorAlerts from './SupervisorAlerts';
import CalendarSignatureAlert from '../components/CalendarSignatureAlert';
import { generateAllAlarms } from '../lib/alarmCalculations';
import { sendAlarmEmail } from '../lib/emailService';

type TimeEntryType = 'turno' | 'coordinacion' | 'formacion' | 'sustitucion' | 'otros';

const getApproximateLocation = async (latitude, longitude) => {
  try {
    const response = await fetch(
      `https://us1.locationiq.com/v1/reverse.php?key=pk.e07ef17ed17dc6d6359dbbdcaa8d4124&lat=${latitude}&lon=${longitude}&format=json`
    );
    const data = await response.json();
    return data.display_name || "Ubicación no disponible";
  } catch (error) {
    console.error("Error con LocationIQ:", error);
    return "Error al obtener ubicación";
  }
};

/* ===========================
   BLOQUE NUEVO: CÁLCULOS PUROS
   =========================== */

// Ventana nocturna fija 22:00 → 06:00 (respecto al día del inicio del segmento)
const calculateNightHours = (startISO: string, endISO: string): number => {
  const startTime = new Date(startISO);
  const endTime = new Date(endISO);

  // Si cruza medianoche (end < start), mover salida +1 día
  if (endTime < startTime) {
    endTime.setDate(endTime.getDate() + 1);
  }

  const nightStart = new Date(startTime);
  nightStart.setHours(22, 0, 0, 0);

  const nightEnd = new Date(startTime);
  nightEnd.setDate(nightEnd.getDate() + 1);
  nightEnd.setHours(6, 0, 0, 0);

  const overlapStart = new Date(Math.max(startTime.getTime(), nightStart.getTime()));
  const overlapEnd = new Date(Math.min(endTime.getTime(), nightEnd.getTime()));

  if (overlapStart < overlapEnd) {
    return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
  }
  return 0;
};

// Horas de un segmento (sin festivos ni desglose por tipo)
const computeSegmentHoursPure = (startISO: string, endISO: string, breakMs: number = 0) => {
  const startMs = new Date(startISO).getTime();
  let endMs = new Date(endISO).getTime();
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000; // cruza medianoche

  const grossMs = Math.max(0, endMs - startMs);
  const workedMs = Math.max(0, grossMs - (breakMs || 0));
  const totalHours = workedMs / (1000 * 60 * 60);

  const night = calculateNightHours(startISO, endISO);
  const nightHours = Math.max(0, Math.min(night, totalHours)); // no exceder horas reales

  return { totalHours, nightHours, workedMs };
};

// Construcción de segmentos a partir de fichajes ordenados
type RawEntry = { entry_type: string; timestamp: string; id?: string };
type BuiltSegment = { clockIn: string; clockOut: string; breakMs: number };

const buildSegmentsFromEntries = (entries: RawEntry[], nowISO?: string): BuiltSegment[] => {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const segments: BuiltSegment[] = [];
  let currentIn: string | null = null;
  let breakStart: string | null = null;
  let breakAccumMs = 0;

  const closeCurrent = (endISO: string) => {
    if (currentIn) {
      segments.push({ clockIn: currentIn, clockOut: endISO, breakMs: breakAccumMs });
      currentIn = null;
      breakStart = null;
      breakAccumMs = 0;
    }
  };

  for (const e of sorted) {
    const ts = e.timestamp;

    switch (e.entry_type) {
      case 'clock_in':
        // Si había un turno abierto, ciérralo al fin de ese día
        if (currentIn) {
          const endOfDay = new Date(currentIn);
          endOfDay.setHours(23, 59, 59, 999);
          closeCurrent(endOfDay.toISOString());
        }
        currentIn = ts;
        breakStart = null;
        breakAccumMs = 0;
        break;

      case 'break_start':
        if (currentIn && !breakStart) {
          breakStart = ts;
        }
        break;

      case 'break_end':
        if (currentIn && breakStart) {
          const ms = new Date(ts).getTime() - new Date(breakStart).getTime();
          if (ms > 0) breakAccumMs += ms;
          breakStart = null;
        }
        break;

      case 'clock_out':
        if (currentIn) {
          closeCurrent(ts);
        }
        break;
    }
  }

  // Si quedó un turno abierto, cerrarlo con "ahora"
  if (currentIn) {
    const endISO = nowISO || new Date().toISOString();
    closeCurrent(endISO);
  }

  return segments;
};

// Suma de tiempo (y horas nocturnas) con recorte opcional por rango
const sumWorkedMsInRange = (
  entries: RawEntry[],
  rangeStart?: Date,
  rangeEnd?: Date
) => {
  const nowISO = new Date().toISOString();
  const segments = buildSegmentsFromEntries(entries, nowISO);

  let totalMs = 0;
  let totalNightHours = 0;

  for (const seg of segments) {
    let s = new Date(seg.clockIn);
    let e = new Date(seg.clockOut);

    // Descarta fuera de rango
    if (rangeStart && e < rangeStart) continue;
    if (rangeEnd && s > rangeEnd) continue;

    // Recorta a los límites del rango
    if (rangeStart && s < rangeStart) s = new Date(rangeStart);
    if (rangeEnd && e > rangeEnd) e = new Date(rangeEnd);

    const { workedMs, nightHours } = computeSegmentHoursPure(
      s.toISOString(),
      e.toISOString(),
      seg.breakMs
    );
    totalMs += workedMs;
    totalNightHours += nightHours;
  }

  return { totalMs, totalNightHours };
};
/* ===== FIN BLOQUE NUEVO ===== */

function Overview() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [timeEntries, setTimeEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editReason, setEditReason] = useState('');
  const [newEntry, setNewEntry] = useState({
    timestamp: '',
    entry_type: 'clock_in',
    work_center: '',
  });
  const [supervisorWorkCenters, setSupervisorWorkCenters] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [entriesCurrentPage, setEntriesCurrentPage] = useState(0);
  const [entriesPerPage] = useState(10);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [pendingAlertsCount, setPendingAlertsCount] = useState(0);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string | null>(null);
  const [employeeSchedules, setEmployeeSchedules] = useState<Record<string, any>>({});

  const supervisorEmail = localStorage.getItem('supervisorEmail');

  // Función para cargar las ubicaciones
  const loadLocations = async (entries: any[]) => {
    const locs: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.latitude && entry.longitude) {
        const location = await getApproximateLocation(entry.latitude, entry.longitude);
        locs[entry.id] = location;
      } else {
        locs[entry.id] = 'No disponible';
      }
    }
    setLocations(locs);
  };

  useEffect(() => {
    if (selectedEmployee) {
      loadLocations(selectedEmployee.entries);
    }
  }, [selectedEmployee]);

  const formatHours = (hours: number) => {
    return `${hours.toFixed(2)}h`;
  };

  const getTodayScheduledHours = (employeeId: string) => {
    const schedule = employeeSchedules[employeeId];
    if (!schedule || !schedule.schedule) return 0;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    try {
      const scheduleData = typeof schedule.schedule === 'string'
        ? JSON.parse(schedule.schedule)
        : schedule.schedule;

      const daySchedule = scheduleData[dayName];
      if (!daySchedule || !daySchedule.enabled) return 0;

      const start = daySchedule.start.split(':');
      const end = daySchedule.end.split(':');
      const breakMinutes = daySchedule.break || 0;

      const startMinutes = parseInt(start[0]) * 60 + parseInt(start[1]);
      const endMinutes = parseInt(end[0]) * 60 + parseInt(end[1]);
      const totalMinutes = endMinutes - startMinutes - breakMinutes;

      return totalMinutes / 60;
    } catch (e) {
      console.error('Error parsing schedule:', e);
      return 0;
    }
  };

  const calculateDailyWorkTime = (entries: any[]) => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const { totalMs } = sumWorkedMsInRange(entries, start, end);
    return totalMs;
  };

  useEffect(() => {
    const getSupervisorInfo = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!supervisorEmail) {
          throw new Error('No se encontró el correo electrónico del supervisor');
        }

        // Obtener los centros de trabajo del supervisor
        const { data: workCenters, error: workCentersError } = await supabase
          .rpc('get_supervisor_work_centers', {
            p_email: supervisorEmail,
          });
        // Obtener información del supervisor incluyendo company_id
        const { data: supervisorData, error: supervisorError } = await supabase
          .from('supervisor_profiles')
          .select('work_centers, company_id')
          .eq('email', supervisorEmail)
          .eq('is_active', true)
          .single();

        if (supervisorError) throw supervisorError;
        if (!supervisorData?.work_centers?.length) {
          throw new Error('No se encontraron centros de trabajo asignados');
        }

        setSupervisorWorkCenters(supervisorData.work_centers);

        // Selección inicial de centro
        if (supervisorData.work_centers.length > 1 && !selectedWorkCenter) {
          setSelectedWorkCenter('TODOS');
        } else if (supervisorData.work_centers.length === 1 && !selectedWorkCenter) {
          setSelectedWorkCenter(supervisorData.work_centers[0]);
        }

        // Filtrar empleados por el centro de trabajo seleccionado
        const workCentersToFilter = (selectedWorkCenter === 'TODOS' || !selectedWorkCenter)
          ? supervisorData.work_centers
          : [selectedWorkCenter];

        // Empleados de la empresa del supervisor que trabajen en el/los centro(s)
        const { data: employeesData, error: employeesError } = await supabase
          .from('employee_profiles')
          .select('*')
          .eq('company_id', supervisorData.company_id)
          .overlaps('work_centers', workCentersToFilter)
          .eq('is_active', true);

        if (employeesError) throw employeesError;

        setEmployees(employeesData || []);
      } catch (err) {
        console.error('Error getting supervisor info:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar los datos');
      } finally {
        setLoading(false);
      }
    };

    getSupervisorInfo();
  }, [selectedWorkCenter]);

  useEffect(() => {
    fetchPendingAlertsCount();
  }, []);

  useEffect(() => {
    if (employees.length > 0) {
      fetchTimeEntries();
      fetchPendingAlertsCount();
      fetchEmployeeSchedules();
    }
  }, [employees]);

  const fetchPendingAlertsCount = async () => {
    console.log('=== FETCHING ALERTS COUNT IN DASHBOARD ===');
    try {
      if (!supervisorEmail) {
        console.error('No supervisor email found');
        return;
      }

      console.log('Fetching supervisor profile for:', supervisorEmail);

      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('id')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .maybeSingle();

      if (supervisorError) {
        console.error('Error fetching supervisor profile:', supervisorError);
        return;
      }

      if (!supervisorData) {
        console.error('No supervisor profile found');
        return;
      }

      const supervisorId = supervisorData.id;
      console.log('Supervisor ID:', supervisorId);

      const { count, error } = await supabase
        .from('coordinator_alarms')
        .select('*', { count: 'exact', head: true })
        .eq('supervisor_id', supervisorId);

      console.log('Alerts count result:', { count, error });

      if (error) throw error;

      console.log(`✓ Found ${count || 0} total alarms`);
      setPendingAlertsCount(count || 0);
    } catch (err) {
      console.error('Error fetching alerts count:', err);
    }
  };

  const fetchEmployeeSchedules = async () => {
    try {
      const employeeIds = employees.map((emp) => emp.id);
      const { data: schedulesData, error } = await supabase
        .from('employee_schedules')
        .select('*')
        .in('employee_id', employeeIds);

      if (error) throw error;

      const schedulesMap: Record<string, any> = {};
      (schedulesData || []).forEach((schedule: any) => {
        schedulesMap[schedule.employee_id] = schedule;
      });
      setEmployeeSchedules(schedulesMap);
    } catch (err) {
      console.error('Error fetching employee schedules:', err);
    }
  };

  const fetchTimeEntries = async () => {
    try {
      setError(null);
      const employeeIds = employees.map((emp) => emp.id);

      const { data: timeEntriesData, error } = await supabase
        .from('time_entries')
        .select('*')
        .in('employee_id', employeeIds)
        .eq('is_active', true)
        .order('timestamp', { ascending: false });

      if (error) throw error;
      setTimeEntries(timeEntriesData || []);
    } catch (err) {
      console.error('Error fetching time entries:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los fichajes');
    }
  };

  const handleAddEntry = async () => {
    try {
      const employeeId = selectedEmployee.employee.id;
      const entryDate = new Date(newEntry.timestamp).toISOString().split('T')[0];

      if (newEntry.entry_type !== 'clock_in') {
        const { data: activeEntries, error: fetchError } = await supabase
          .from('time_entries')
          .select('*')
          .eq('employee_id', employeeId)
          .eq('entry_type', 'clock_in')
          .eq('is_active', true)
          .gte('timestamp', `${entryDate}T00:00:00`)
          .lte('timestamp', `${entryDate}T23:59:59`)
          .order('timestamp', { ascending: false })
          .limit(1);

        if (fetchError) throw fetchError;

        if (!activeEntries || activeEntries.length === 0) {
          throw new Error('Debe existir una entrada activa antes de registrar una salida o pausa.');
        }
      }

      // Insertar el nuevo fichaje
      const { error } = await supabase.from('time_entries').insert([
        {
          employee_id: employeeId,
          entry_type: newEntry.entry_type,
          timestamp: new Date(newEntry.timestamp).toISOString(),
          changes: null,
          original_timestamp: null,
          is_active: true,
          work_center: newEntry.work_center,
        },
      ]);

      if (error) throw error;

      await fetchTimeEntries();
      setShowEditModal(false);
      setNewEntry({
        timestamp: '',
        entry_type: 'clock_in',
        work_center: '',
      });
    } catch (err) {
      console.error('Error adding entry:', err);
      setError(err instanceof Error ? err.message : 'Error al añadir el fichaje');
    }
  };

  const handleUpdateEntry = async () => {
    try {
      const employeeId = selectedEmployee.employee.id;
      const entryDate = new Date(editingEntry.timestamp).toISOString().split('T')[0];

      if (editingEntry.entry_type !== 'clock_in') {
        const { data: activeEntries, error: fetchError } = await supabase
          .from('time_entries')
          .select('*')
          .eq('employee_id', employeeId)
          .eq('entry_type', 'clock_in')
          .eq('is_active', true)
          .gte('timestamp', `${entryDate}T00:00:00`)
          .lte('timestamp', `${entryDate}T23:59:59`)
          .order('timestamp', { ascending: false })
          .limit(1);

        if (fetchError) throw fetchError;

        if (!activeEntries || activeEntries.length === 0) {
          throw new Error('Debe existir una entrada activa antes de registrar una salida o pausa.');
        }
      }

      // Actualizar el fichaje
      const { error } = await supabase
        .from('time_entries')
        .update({
          entry_type: editingEntry.entry_type,
          timestamp: new Date(editingEntry.timestamp).toISOString(),
          changes: 'edited',
          original_timestamp: editingEntry.original_timestamp || editingEntry.timestamp,
          work_center: editingEntry.work_center,
          reason: editReason || null,
        })
        .eq('id', editingEntry.id);

      if (error) throw error;

      await fetchTimeEntries();
      setShowEditModal(false);
      setEditingEntry(null);
      setEditReason('');
    } catch (err) {
      console.error('Error updating entry:', err);
      setError(err instanceof Error ? err.message : 'Error al actualizar el fichaje');
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    const reason = prompt('¿Por qué quieres eliminar este fichaje? (motivo)');
    if (!reason) return;

    try {
      const { error } = await supabase
        .from('time_entries')
        .update({
          changes: 'eliminated',
          is_active: false,
          reason: reason,
        })
        .eq('id', entryId);

      if (error) throw error;

      await fetchTimeEntries();
    } catch (err) {
      console.error('Error deleting entry:', err);
      setError('Error al eliminar el fichaje');
    }
  };

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };
  const getEntryTypeText = (type: string) => {
    switch (type) {
      case 'clock_in':
        return 'Entrada';
      case 'break_start':
        return 'Inicio Pausa';
      case 'break_end':
        return 'Fin Pausa';
      case 'clock_out':
        return 'Salida';
      default:
        return type;
    }
  };

  const filterEntriesByMonth = (entries: any[]) => {
    if (!selectedMonth || selectedMonth === '') return entries;

    const [year, month] = selectedMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    return entries.filter(entry => {
      try {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= startDate && entryDate <= endDate;
      } catch (e) {
        console.error('Error parsing date:', entry.timestamp, e);
        return false;
      }
    });
  };

  const getPaginatedEntries = () => {
    if (!selectedEmployee) return [];

    const filteredEntries = filterEntriesByMonth(selectedEmployee.entries);
    const startIndex = entriesCurrentPage * entriesPerPage;
    const endIndex = startIndex + entriesPerPage;

    return filteredEntries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(startIndex, endIndex);
  };

  const getTotalEntriesPages = () => {
    if (!selectedEmployee) return 0;
    const filteredEntries = filterEntriesByMonth(selectedEmployee.entries);
    return Math.ceil(filteredEntries.length / entriesPerPage);
  };

  // ===== Reemplazado: total por empleado usando segmentos + pausas + cruces de medianoche =====
  const employeeWorkTimes = employees.map((employee) => {
    const employeeEntries = timeEntries
      .filter((entry) => entry.employee_id === employee.id && entry.is_active);

    const { totalMs } = sumWorkedMsInRange(employeeEntries);

    const todayWorkedMs = calculateDailyWorkTime(employeeEntries);
    const todayScheduledHours = getTodayScheduledHours(employee.id);
    const annualScheduledHours = employee.total_hours || 0;

    return {
      employee,
      totalTime: totalMs,
      todayWorkedMs,
      todayScheduledHours,
      annualScheduledHours,
      entries: employeeEntries,
    };
  });

  const filteredEmployees = employeeWorkTimes.filter(({ employee }) =>
    employee.fiscal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (employee.work_centers &&
      employee.work_centers.some(
        (wc: any) => typeof wc === 'string' && wc.toLowerCase().includes(searchTerm.toLowerCase())
      ))
  );

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Vista General</h1>
          {supervisorWorkCenters.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-600">Centro de Trabajo:</span>
              <select
                value={selectedWorkCenter || ''}
                onChange={(e) => setSelectedWorkCenter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="TODOS">TODOS</option>
                {supervisorWorkCenters.map((center) => (
                  <option key={center} value={center}>
                    {center}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-gray-600">Centro de Trabajo: {supervisorWorkCenters.join(', ')}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}

        <CalendarSignatureAlert />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Users className="w-8 h-8 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600">Total Empleados</p>
                <p className="text-2xl font-bold">{employees.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Shield className="w-8 h-8 text-purple-600" />
              <div>
                <p className="text-sm text-gray-600">
                  {selectedWorkCenter === 'TODOS' ? 'Centros de Trabajo' : 'Centro de Trabajo'}
                </p>
                <p className="text-2xl font-bold">
                  {selectedWorkCenter === 'TODOS'
                    ? supervisorWorkCenters.length
                    : (selectedWorkCenter || supervisorWorkCenters[0])
                  }
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
              <div>
                <p className="text-sm text-gray-600">Alertas</p>
                <p className="text-2xl font-bold">{pendingAlertsCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Buscar empleados..."
            />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nombre
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Centros de Trabajo
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tiempo Trabajado Hoy
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tiempo a Trabajar Hoy
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tiempo Trabajado Anual
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tiempo a Trabajar Anual
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">
                    Cargando...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center">
                    No hay empleados para mostrar
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(({ employee, totalTime, todayWorkedMs, todayScheduledHours, annualScheduledHours, entries }) => (
                  <tr
                    key={employee.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setSelectedEmployee({ employee, totalTime, entries });
                      setShowDetailsModal(true);
                      setEntriesCurrentPage(0);
                    }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {employee.fiscal_name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {employee.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {Array.isArray(employee.work_centers) ? employee.work_centers.join(', ') : ''}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        {formatDuration(todayWorkedMs)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        {formatHours(todayScheduledHours)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        {formatDuration(totalTime)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        {formatHours(annualScheduledHours)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {showDetailsModal && selectedEmployee && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-lg max-w-6xl w-full max-h-[80vh] overflow-hidden flex flex-col">
              {/* Encabezado del modal */}
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">
                    Detalles de Fichajes - {selectedEmployee.employee.fiscal_name}
                  </h2>
                  <button
                    onClick={() => setShowDetailsModal(false)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Sección de horas trabajadas hoy */}
              <div className="p-6 bg-blue-50 border-b border-blue-200">
                <div className="flex items-center gap-4">
                  <Clock className="w-6 h-6 text-blue-600" />
                  <div>
                    <p className="text-sm text-gray-600">Horas trabajadas hoy</p>
                    <p className="text-xl font-bold">
                      {formatDuration(calculateDailyWorkTime(selectedEmployee.entries))}
                    </p>
                  </div>
                </div>
              </div>

              {/* Contenido principal con scroll vertical */}
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-4">
                  {/* Información básica del empleado */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium">{selectedEmployee.employee.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Centros de Trabajo</p>
                      <p className="font-medium">
                        {Array.isArray(selectedEmployee.employee.work_centers)
                          ? selectedEmployee.employee.work_centers.join(', ')
                          : ''}
                      </p>
                    </div>
                  </div>

                  {/* Tabla de fichajes con scroll horizontal */}
                  <div className="mt-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-medium">Registro de Fichajes</h3>
                      <button
                        onClick={() => setShowEditModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Añadir Fichaje
                      </button>
                    </div>

                    {/* Filtro por mes */}
                    <div className="mb-4 flex items-center gap-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Filtrar por mes
                      </label>
                      <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => {
                          setSelectedMonth(e.target.value);
                          setEntriesCurrentPage(0);
                        }}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        onClick={() => {
                          setSelectedMonth('');
                          setEntriesCurrentPage(0);
                        }}
                        className="px-3 py-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        Mostrar todos
                      </button>
                    </div>
                    
                    <div className="overflow-x-auto shadow-sm border border-gray-200 rounded-lg">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Fecha
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Hora
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Tipo
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Centro
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Cambios
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Motivo
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Acciones
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {getPaginatedEntries().length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-6 py-4 text-center">
                                No hay fichajes para mostrar
                              </td>
                            </tr>
                          ) : (
                            getPaginatedEntries().map((entry: any) => (
                              <tr key={entry.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {new Date(entry.timestamp).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {new Date(entry.timestamp).toLocaleTimeString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {getEntryTypeText(entry.entry_type)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {entry.work_center || '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {entry.changes || 'N/A'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-900">
                                  {entry.reason ? (
                                    <button
                                      onClick={() => alert(`Motivo:\n\n${entry.reason}`)}
                                      className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer max-w-xs truncate block"
                                      title={entry.reason}
                                    >
                                      {entry.reason.length > 30 ? `${entry.reason.substring(0, 30)}...` : entry.reason}
                                    </button>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingEntry({
                                          id: entry.id,
                                          timestamp: new Date(entry.timestamp).toISOString().slice(0, 16),
                                          entry_type: entry.entry_type,
                                          work_center: entry.work_center,
                                          original_timestamp: entry.original_timestamp,
                                        });
                                        setShowEditModal(true);
                                      }}
                                      className="p-1 text-blue-600 hover:text-blue-800"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteEntry(entry.id);
                                      }}
                                      className="p-1 text-red-600 hover:text-red-800"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Paginación */}
                    <div className="flex justify-between items-center mt-4">
                      <button
                        onClick={() => setEntriesCurrentPage(prev => Math.max(prev - 1, 0))}
                        disabled={entriesCurrentPage === 0}
                        className={`flex items-center gap-1 px-3 py-1 rounded-md ${
                          entriesCurrentPage === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <ChevronLeft className="w-5 h-5" />
                        Anterior
                      </button>
                      
                      <span className="text-sm text-gray-600">
                        Página {entriesCurrentPage + 1} de {getTotalEntriesPages()}
                      </span>
                      
                      <button
                        onClick={() => setEntriesCurrentPage(prev => prev + 1)}
                        disabled={(entriesCurrentPage + 1) >= getTotalEntriesPages()}
                        className={`flex items-center gap-1 px-3 py-1 rounded-md ${
                          (entriesCurrentPage + 1) >= getTotalEntriesPages() 
                            ? 'text-gray-400 cursor-not-allowed' 
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        Siguiente
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer del modal */}
              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowDetailsModal(false)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showEditModal && selectedEmployee && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full">
              <div className="p-6 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">
                    {editingEntry ? 'Editar Fichaje' : 'Añadir Fichaje'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingEntry(null);
                      setEditReason('');
                      setNewEntry({
                        timestamp: '',
                        entry_type: 'clock_in',
                        work_center: '',
                      });
                    }}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
              <div className="p-6">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editingEntry) {
                      handleUpdateEntry();
                    } else {
                      handleAddEntry();
                    }
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha y Hora
                    </label>
                    <input
                      type="datetime-local"
                      value={editingEntry ? editingEntry.timestamp : newEntry.timestamp}
                      onChange={(e) => {
                        if (editingEntry) {
                          setEditingEntry({ ...editingEntry, timestamp: e.target.value });
                        } else {
                          setNewEntry({ ...newEntry, timestamp: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tipo de Fichaje
                    </label>
                    <select
                      value={editingEntry ? editingEntry.entry_type : newEntry.entry_type}
                      onChange={(e) => {
                        if (editingEntry) {
                          setEditingEntry({ ...editingEntry, entry_type: e.target.value });
                        } else {
                          setNewEntry({ ...newEntry, entry_type: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="clock_in">Entrada</option>
                      <option value="break_start">Inicio Pausa</option>
                      <option value="break_end">Fin Pausa</option>
                      <option value="clock_out">Salida</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Centro de Trabajo
                    </label>
                    <select
                      value={editingEntry ? editingEntry.work_center : newEntry.work_center}
                      onChange={(e) => {
                        if (editingEntry) {
                          setEditingEntry({ ...editingEntry, work_center: e.target.value });
                        } else {
                          setNewEntry({ ...newEntry, work_center: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Selecciona un centro de trabajo</option>
                      {supervisorWorkCenters.map((center) => (
                        <option key={center} value={center}>
                          {center}
                        </option>
                      ))}
                    </select>
                  </div>

                  {editingEntry && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Motivo del cambio <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        rows={3}
                        placeholder="Explica por qué estás modificando este fichaje..."
                        required
                      />
                    </div>
                  )}

                  <div className="flex justify-end gap-4 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditModal(false);
                        setEditingEntry(null);
                        setEditReason('');
                        setNewEntry({
                          timestamp: '',
                          entry_type: 'clock_in',
                          work_center: '',
                        });
                      }}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {editingEntry ? 'Guardar Cambios' : 'Añadir Fichaje'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SupervisorDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [pendingAlertsCount, setPendingAlertsCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const navigate = useNavigate();

  const supervisorEmail = localStorage.getItem('supervisorEmail');

  useEffect(() => {
    const initializeAlarms = async () => {
      await generateAlarmsForAllEmployees();
      await fetchPendingAlertsCount();
      await fetchNotifications();
    };

    initializeAlarms();

    const interval = setInterval(() => {
      fetchPendingAlertsCount();
      fetchNotifications();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async () => {
    try {
      if (!supervisorEmail) return;

      const { data: supervisorData } = await supabase
        .from('supervisor_profiles')
        .select('id')
        .eq('email', supervisorEmail)
        .maybeSingle();

      if (!supervisorData) return;

      const { data, error } = await supabase
        .from('coordinator_notifications')
        .select('*')
        .eq('supervisor_id', supervisorData.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      setNotifications(data || []);
      setUnreadNotificationsCount(data?.filter(n => !n.is_read).length || 0);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  const markNotificationAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('coordinator_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      await fetchNotifications();
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('coordinator_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;

      await fetchNotifications();
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  const generateAlarmsForAllEmployees = async () => {
    console.log('=== GENERATING ALARMS FOR ALL EMPLOYEES ===');
    try {
      if (!supervisorEmail) {
        console.error('No supervisor email found');
        return;
      }

      console.log('Fetching supervisor data for:', supervisorEmail);

      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('id, work_centers, company_id')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .maybeSingle();

      if (supervisorError || !supervisorData) {
        console.error('Error fetching supervisor:', supervisorError);
        return;
      }

      const supervisorId = supervisorData.id;
      console.log('Supervisor ID:', supervisorId);

      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_profiles')
        .select('id')
        .eq('company_id', supervisorData.company_id)
        .overlaps('work_centers', supervisorData.work_centers)
        .eq('is_active', true);

      if (employeesError || !employeesData) return;

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      for (const employee of employeesData) {
        const alarms = await generateAllAlarms(employee.id, supervisorId, startDate, endDate);

        if (alarms.length > 0) {
          const { data: employeeProfile } = await supabase
            .from('employee_profiles')
            .select('fiscal_name, email')
            .eq('id', employee.id)
            .single();

          const { data: supervisorProfile } = await supabase
            .from('supervisor_profiles')
            .select('fiscal_name')
            .eq('email', supervisorEmail)
            .single();

          for (const alarm of alarms) {
            const { data: existing } = await supabase
              .from('coordinator_alarms')
              .select('id, email_sent')
              .eq('supervisor_id', supervisorId)
              .eq('employee_id', alarm.employee_id)
              .eq('alarm_type', alarm.alarm_type)
              .eq('alarm_date', alarm.alarm_date)
              .maybeSingle();

            if (!existing) {
              const { data: insertedAlarm } = await supabase
                .from('coordinator_alarms')
                .insert([alarm])
                .select()
                .single();

              if (insertedAlarm && !insertedAlarm.email_sent) {
                const emailSent = await sendAlarmEmail({
                  supervisor_email: supervisorEmail || '',
                  supervisor_name: supervisorProfile?.fiscal_name || 'Coordinador',
                  employee_name: employeeProfile?.fiscal_name || 'Empleado',
                  employee_email: employeeProfile?.email || '',
                  alarm_type: alarm.alarm_type,
                  alarm_date: alarm.alarm_date,
                  description: alarm.description,
                  hours_involved: alarm.hours_involved,
                });

                if (emailSent) {
                  await supabase
                    .from('coordinator_alarms')
                    .update({ email_sent: true })
                    .eq('id', insertedAlarm.id);
                }
              }
            } else if (existing && !existing.email_sent) {
              const emailSent = await sendAlarmEmail({
                supervisor_email: supervisorEmail || '',
                supervisor_name: supervisorProfile?.fiscal_name || 'Coordinador',
                employee_name: employeeProfile?.fiscal_name || 'Empleado',
                employee_email: employeeProfile?.email || '',
                alarm_type: alarm.alarm_type,
                alarm_date: alarm.alarm_date,
                description: alarm.description,
                hours_involved: alarm.hours_involved,
              });

              if (emailSent) {
                await supabase
                  .from('coordinator_alarms')
                  .update({ email_sent: true })
                  .eq('id', existing.id);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error generating alarms:', err);
    }
  };

  const fetchPendingAlertsCount = async () => {
    console.log('=== FETCHING ALERTS COUNT (Modal Component) ===');
    try {
      if (!supervisorEmail) {
        console.error('No supervisor email found');
        return;
      }

      console.log('Fetching supervisor profile for:', supervisorEmail);

      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('id')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .maybeSingle();

      if (supervisorError) {
        console.error('Error fetching supervisor profile:', supervisorError);
        return;
      }

      if (!supervisorData) {
        console.error('No supervisor profile found');
        return;
      }

      const supervisorId = supervisorData.id;
      console.log('Supervisor ID:', supervisorId);

      const { count, error } = await supabase
        .from('coordinator_alarms')
        .select('*', { count: 'exact', head: true })
        .eq('supervisor_id', supervisorId);

      console.log('Alerts count result:', { count, error });

      if (error) throw error;

      console.log(`✓ Found ${count || 0} total alarms in modal`);
      setPendingAlertsCount(count || 0);
    } catch (err) {
      console.error('Error fetching alerts count:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <nav className="bg-white shadow-sm sticky top-0 z-40">
        <div className="px-4">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center">
              <Shield className="h-6 w-6 text-purple-600 mr-2" />
              <span className="text-lg font-bold text-gray-900">Coordinador/a</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative flex items-center text-gray-700 hover:text-gray-900 p-2 rounded-lg transition-colors duration-200"
                >
                  <Bell className="h-5 w-5" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center text-[10px]">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-y-auto">
                    <div className="p-3 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-900 text-sm">Notificaciones</h3>
                    </div>
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-gray-500 text-sm">
                        No hay notificaciones
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`p-3 hover:bg-gray-50 ${!notification.is_read ? 'bg-blue-50' : ''}`}
                          >
                            <div className="flex justify-between items-start mb-1">
                              <h4 className="font-medium text-gray-900 text-xs">{notification.title}</h4>
                              <button
                                onClick={() => deleteNotification(notification.id)}
                                className="text-gray-400 hover:text-red-600"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                            <p className="text-xs text-gray-600 mb-1">{notification.message}</p>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-gray-400">
                                {new Date(notification.created_at).toLocaleDateString('es-ES', {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                              {!notification.is_read && (
                                <button
                                  onClick={() => markNotificationAsRead(notification.id)}
                                  className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  Marcar como leída
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  localStorage.removeItem('supervisorEmail');
                  navigate('/');
                }}
                className="flex items-center text-gray-700 hover:text-gray-900 p-2"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/empleados" element={<SupervisorEmployees />} />
        <Route path="/solicitudes" element={<SupervisorRequests />} />
        <Route path="/informes" element={<SupervisorReports />} />
        <Route path="/alertas" element={<SupervisorAlerts />} />
        <Route path="/calendario" element={<SupervisorCalendar />} />
      </Routes>

      <MobileNav role="coordinator" />
    </div>
  );
}
