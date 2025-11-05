// CompanyDashboard.tsx (modificado)
// — Se eliminaron: horas festivas y desglose por time_type
// — Se añadió: cálculo robusto de horas (total y nocturnas) con cruces de medianoche y pausas

import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route } from 'react-router-dom';
import {
  LogOut,
  BarChart,
  FileText,
  Shield,
  User,
  Users,
  Clock,
  Search,
  X,
  Plus,
  Edit,
  Calendar,
  Settings,
  MapPin,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useCompany } from '../context/CompanyContext';
import CompanyEmployees from './CompanyEmployees';
import CompanySettings from './CompanySettings';
import CompanyRequests from './CompanyRequests';
import CompanyCalendar from './CompanyCalendar';
import CompanyReports from './CompanyReports';
import InspectorCredentials from './CompanyInspector';

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

// 22:00 → 06:00 del día siguiente, respecto a la fecha del INICIO del segmento
const calculateNightHours = (startISO: string, endISO: string): number => {
  const startTime = new Date(startISO);
  const endTime = new Date(endISO);

  // Cruce de medianoche (salida “antes” que entrada)
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

// Cálculo de horas de un segmento: total y nocturnas (sin festivos, sin desglose por tipo)
const computeSegmentHoursPure = (startISO: string, endISO: string, breakMs: number = 0) => {
  const startMs = new Date(startISO).getTime();
  let endMs = new Date(endISO).getTime();
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000; // cruza medianoche

  const grossMs = Math.max(0, endMs - startMs);
  const workedMs = Math.max(0, grossMs - (breakMs || 0));
  const totalHours = workedMs / (1000 * 60 * 60);

  const night = calculateNightHours(startISO, endISO);
  const nightHours = Math.max(0, Math.min(night, totalHours)); // cap

  return { totalHours, nightHours, workedMs };
};

// Convierte una secuencia de fichajes ordenados en segmentos trabajo+pausas
// Empareja clock_in → clock_out; acumula pausas entre medias; cierra con "now" si no hay salida.
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
        // Si había uno abierto, lo cerramos al final de ese día para no perder horas
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

  // Si quedó un turno abierto, cerramos con "ahora" o fin de día
  if (currentIn) {
    const endISO = nowISO || new Date().toISOString();
    closeCurrent(endISO);
  }

  return segments;
};

// Suma horas (y horas nocturnas) de una lista de entradas, con opción de acotar por rango
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
    // recorte por rango si se pasó (hoy, mes, etc.)
    let s = new Date(seg.clockIn);
    let e = new Date(seg.clockOut);
    if (rangeStart && e < rangeStart) continue;
    if (rangeEnd && s > rangeEnd) continue;

    if (rangeStart && s < rangeStart) s = new Date(rangeStart);
    if (rangeEnd && e > rangeEnd) e = new Date(rangeEnd);

    const { workedMs, totalHours, nightHours } = computeSegmentHoursPure(
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
  const { employees, timeEntries, loading } = useCompany();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [newEntry, setNewEntry] = useState({
    timestamp: '',
    entry_type: 'clock_in',
    time_type: 'turno' as TimeEntryType,
    work_center: '',
  });
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [entriesCurrentPage, setEntriesCurrentPage] = useState(0);
  const [entriesPerPage] = useState(10);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('TODOS');
  const [allWorkCenters, setAllWorkCenters] = useState<string[]>([]);
  const [employeeSchedules, setEmployeeSchedules] = useState<Record<string, any>>({});

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

  useEffect(() => {
    const centers = new Set(employees.flatMap((emp) => emp.work_centers || []));
    setAllWorkCenters(Array.from(centers));
  }, [employees]);

  useEffect(() => {
    const loadEmployeeSchedules = async () => {
      if (employees.length === 0) return;

      const employeeIds = employees.map(emp => emp.id);
      const { data, error } = await supabase
        .from('employee_schedules')
        .select('*')
        .in('employee_id', employeeIds);

      if (!error && data) {
        const schedulesMap = {};
        data.forEach(schedule => {
          schedulesMap[schedule.employee_id] = schedule;
        });
        setEmployeeSchedules(schedulesMap);
      }
    };

    loadEmployeeSchedules();
  }, [employees]);

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const formatHours = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
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

  // ===== Reemplazado: cálculo diario ahora usa la lógica robusta (sin festivos / sin time_type) =====
  const calculateDailyWorkTime = (entries: any[]) => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const { totalMs } = sumWorkedMsInRange(entries, start, end);
    return totalMs;
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

  // ===== Reemplazado: total por empleado usa segmentos + pausas + cruces de medianoche =====
  const employeeWorkTimes = employees.map((employee) => {
    const employeeEntries = timeEntries
      .filter((entry) => entry.employee_id === employee.id && entry.is_active);

    // Total anual (todas las fechas)
    const { totalMs } = sumWorkedMsInRange(employeeEntries);

    // Tiempo trabajado hoy
    const todayWorkedMs = calculateDailyWorkTime(employeeEntries);

    // Horas programadas hoy
    const todayScheduledHours = getTodayScheduledHours(employee.id);

    // Horas anuales a trabajar
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

      const { error } = await supabase.from('time_entries').insert([
        {
          employee_id: employeeId,
          entry_type: newEntry.entry_type,
          time_type: newEntry.entry_type === 'clock_in' ? newEntry.time_type : null,
          timestamp: new Date(newEntry.timestamp).toISOString(),
          changes: null,
          original_timestamp: null,
          is_active: true,
          work_center: newEntry.work_center,
        },
      ]);

      if (error) throw error;

      window.location.reload();
    } catch (err: any) {
      console.error('Error adding entry:', err);
      alert(err.message || 'Error al añadir el fichaje');
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

      const { error } = await supabase
        .from('time_entries')
        .update({
          entry_type: editingEntry.entry_type,
          time_type: editingEntry.entry_type === 'clock_in' ? editingEntry.time_type : null,
          timestamp: new Date(editingEntry.timestamp).toISOString(),
          changes: 'edited',
          original_timestamp: editingEntry.original_timestamp || editingEntry.timestamp,
          work_center: editingEntry.work_center,
          reason: editingEntry.reason || null,
        })
        .eq('id', editingEntry.id);

      if (error) throw error;

      window.location.reload();
    } catch (err: any) {
      console.error('Error updating entry:', err);
      alert(err.message || 'Error al actualizar el fichaje');
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este fichaje?')) return;

    try {
      const { error } = await supabase
        .from('time_entries')
        .update({
          changes: 'eliminated',
          is_active: false,
        })
        .eq('id', entryId);

      if (error) throw error;

      window.location.reload();
    } catch (err) {
      console.error('Error deleting entry:', err);
      alert('Error al eliminar el fichaje');
    }
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

  const filteredEmployees = employeeWorkTimes.filter(({ employee }) => {
    const matchesSearch = employee.fiscal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (employee.work_centers &&
        employee.work_centers.some(
          (wc: any) => typeof wc === 'string' && wc.toLowerCase().includes(searchTerm.toLowerCase())
        ));

    const matchesWorkCenter = selectedWorkCenter === 'TODOS' ||
      (employee.work_centers && employee.work_centers.includes(selectedWorkCenter));

    return matchesSearch && matchesWorkCenter;
  });

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Vista General</h1>
          {allWorkCenters.length > 1 ? (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-gray-600">Centro de Trabajo:</span>
              <select
                value={selectedWorkCenter}
                onChange={(e) => setSelectedWorkCenter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="TODOS">TODOS</option>
                {allWorkCenters.map((center) => (
                  <option key={center} value={center}>
                    {center}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-gray-600">Gestiona los horarios de trabajo de forma precisa y eficiente</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-4">
              <Users className="w-8 h-8 text-blue-600" />
              <div>
                <p className="text-sm text-gray-600">Total Empleados</p>
                <p className="text-2xl font-bold">{filteredEmployees.length}</p>
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
                    ? new Set(employees.flatMap((emp) => emp.work_centers || [])).size
                    : selectedWorkCenter
                  }
                </p>
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

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
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

              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium">{selectedEmployee.employee.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Centros de Trabajo</p>
                      <p className="font-medium">
                        {Array.isArray(selectedEmployee.employee.work_centers)
                          ? selectedEmployee.employee.work_centers.join(', ')
                          : '-'}
                      </p>
                    </div>
                  </div>

                  <div>
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
                              Ubicación
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              Dispositivo
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
                          {getPaginatedEntries().map((entry: any) => (
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
                                <div className="flex items-center gap-1">
                                  <MapPin className="w-4 h-4 text-gray-500" />
                                  {locations[entry.id] || 'Cargando...'}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {entry.device_info ? (
                                  <details className="cursor-pointer">
                                    <summary className="text-blue-600 hover:text-blue-800 font-medium">
                                      Ver detalles
                                    </summary>
                                    <div className="mt-2 p-2 bg-gray-50 rounded space-y-1 text-xs">
                                      <div><strong>Plataforma:</strong> {entry.device_info.platform}</div>
                                      <div><strong>Navegador:</strong> {entry.device_info.vendor}</div>
                                      <div><strong>Resolución:</strong> {entry.device_info.screenResolution}</div>
                                      <div><strong>Zona horaria:</strong> {entry.device_info.timezone}</div>
                                      {entry.device_info.connection && (
                                        <div>
                                          <strong>Conexión:</strong> {entry.device_info.connection.effectiveType}
                                        </div>
                                      )}
                                      {entry.device_info.maxTouchPoints > 0 && (
                                        <div><strong>Pantalla táctil:</strong> Sí</div>
                                      )}
                                    </div>
                                  </details>
                                ) : (
                                  <span className="text-gray-400">No disponible</span>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {entry.changes || 'N/A'}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                                <div className="truncate" title={entry.reason || ''}>
                                  {entry.reason || '-'}
                                </div>
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
                                        reason: entry.reason || '',
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
                          ))}
                        </tbody>
                      </table>
                    </div>

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
                      setNewEntry({
                        timestamp: '',
                        entry_type: 'clock_in',
                        time_type: 'turno',
                        work_center: selectedEmployee.employee.work_centers[0],
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
                      {selectedEmployee.employee.work_centers.map((center: string) => (
                        <option key={center} value={center}>
                          {center}
                        </option>
                      ))}
                    </select>
                  </div>

                  {editingEntry && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Motivo (Opcional)
                      </label>
                      <textarea
                        value={editingEntry.reason || ''}
                        onChange={(e) => {
                          setEditingEntry({ ...editingEntry, reason: e.target.value });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        rows={3}
                        placeholder="Describe el motivo de la edición..."
                      />
                    </div>
                  )}

                  <div className="flex justify-end gap-4 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditModal(false);
                        setEditingEntry(null);
                        setNewEntry({
                          timestamp: '',
                          entry_type: 'clock_in',
                          time_type: 'turno',
                          work_center: selectedEmployee.employee.work_centers[0],
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

export default function CompanyDashboard() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email || null);
    };
    getUser();
  }, []);

  useEffect(() => {
    const fetchPendingRequests = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: requests, error } = await supabase
        .from('time_requests')
        .select('*')
        .eq('status', 'pending')
        .eq('employee_id', user.id);

      if (error) {
        console.error('Error fetching pending requests:', error);
        return;
      }

      setPendingRequestsCount(requests.length);
    };

    fetchPendingRequests();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login/empresa');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div className="w-64 bg-white shadow-lg">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-8">
            <Shield className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-bold">Portal Empresa</span>
          </div>
          <nav className="space-y-2">
            <button
              onClick={() => {
                setActiveTab('overview');
                navigate('/empresa');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'overview' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <BarChart className="w-5 h-5" />
              Vista General
            </button>
            <button
              onClick={() => {
                setActiveTab('employees');
                navigate('/empresa/empleados');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'employees' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Users className="w-5 h-5" />
              Empleados
            </button>
            <button
              onClick={() => {
                setActiveTab('requests');
                navigate('/empresa/solicitudes');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'requests' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-5 h-5" />
              Solicitudes Modificación de Fichaje
              {pendingRequestsCount > 0 && (
                <span className="bg-red-500 text-white rounded-full px-2 py-1 text-xs">
                  {pendingRequestsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab('calendar');
                navigate('/empresa/calendario');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'calendar' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Calendar className="w-5 h-5" />
              Calendario
            </button>
            <button
              onClick={() => {
                setActiveTab('reports');
                navigate('/empresa/informes');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'reports' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-5 h-5" />
              Informes
            </button>
            <button
              onClick={() => {
                setActiveTab('inspector');
                navigate('/empresa/inspector');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'inspector' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Shield className="w-5 h-5" />
              Inspector
            </button>
            <button
              onClick={() => {
                setActiveTab('settings');
                navigate('/empresa/ajustes');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'settings' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Settings className="w-5 h-5" />
              Configuración
            </button>
          </nav>
        </div>
        <div className="absolute bottom-0 w-64 p-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg"
          >
            <LogOut className="w-5 h-5" />
            Cerrar Sesión
          </button>
        </div>
      </div>

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/empleados" element={<CompanyEmployees />} />
          <Route path="/solicitudes" element={<CompanyRequests />} />
          <Route path="/calendario" element={<CompanyCalendar />} />
          <Route path="/informes" element={<CompanyReports />} />
          <Route path="/inspector" element={<InspectorCredentials />} />
          <Route path="/ajustes" element={<CompanySettings />} />
        </Routes>
      </div>
    </div>
  );
}
