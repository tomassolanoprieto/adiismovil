// InspectorDashboard.tsx (modificado)
// — Cálculo robusto por segmentos (sin festivos, sin desglose por time_type)
// — Considera pausas, cruces de medianoche y horas nocturnas (22:00–06:00, acotadas a las horas reales del segmento)

import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route } from 'react-router-dom';
import { LogOut, BarChart, FileText, Shield, Users, Clock, Search, X, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import InspectorReports from './InspectorReports';

interface Employee {
  id: string;
  fiscal_name: string;
  email: string;
  work_centers: string[];
  document_number: string;
  is_active: boolean;
}

interface TimeEntry {
  id: string;
  employee_id: string;
  entry_type: 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
  timestamp: string;
  work_center?: string;
  // time_type?: string; // ⛔️ ya no se usa para cálculos ni desglose
  changes?: string;
  is_active: boolean;
  latitude?: number;
  longitude?: number;
}

/* =========================================================
   Utilidad de geolocalización (igual que en otras pantallas)
   ========================================================= */
const getApproximateLocation = async (latitude: number, longitude: number) => {
  try {
    const response = await fetch(
      `https://us1.locationiq.com/v1/reverse.php?key=pk.e07ef17ed17dc6d6359dbbdcaa8d4124&lat=${latitude}&lon=${longitude}&format=json`
    );
    const data = await response.json();
    return data.display_name || 'Ubicación no disponible';
  } catch (error) {
    console.error('Error con LocationIQ:', error);
    return 'Error al obtener ubicación';
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
type RawEntry = Pick<TimeEntry, 'entry_type' | 'timestamp'>;
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [entriesCurrentPage, setEntriesCurrentPage] = useState(0);
  const [entriesPerPage] = useState(10);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('');
  const [workCenters, setWorkCenters] = useState<string[]>([]);

  // Obtener el company_id del inspector al cargar el componente
  useEffect(() => {
    const fetchInspectorData = async () => {
      const inspectorUsername = localStorage.getItem('inspectorUsername');
      if (!inspectorUsername) {
        console.error('No inspector username found in localStorage');
        return;
      }

      const { data: inspectorData, error } = await supabase
        .from('inspector_credentials')
        .select('company_id')
        .eq('username', inspectorUsername)
        .single();

      if (error) {
        console.error('Error fetching inspector data:', error);
        return;
      }

      if (inspectorData) {
        setCompanyId(inspectorData.company_id);
      }
    };

    fetchInspectorData();
  }, []);

  // Cargar empleados y fichajes cuando companyId cambie
  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        
        // 1. Obtener empleados activos de esta empresa
        const { data: employeesData, error: employeesError } = await supabase
          .from('employee_profiles')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true);

        if (employeesError) throw employeesError;

        // Extraer centros de trabajo únicos
        const centers = new Set<string>();
        employeesData?.forEach(emp => {
          if (emp.work_centers && Array.isArray(emp.work_centers)) {
            emp.work_centers.forEach((center: string) => centers.add(center));
          }
        });
        setWorkCenters(Array.from(centers).sort());

        // Filtrar empleados por centro de trabajo si está seleccionado
        let filteredEmployees = employeesData || [];
        if (selectedWorkCenter) {
          filteredEmployees = filteredEmployees.filter(emp =>
            emp.work_centers && emp.work_centers.includes(selectedWorkCenter)
          );
        }

        // 2. Obtener fichajes de estos empleados
        if (filteredEmployees && filteredEmployees.length > 0) {
          const employeeIds = filteredEmployees.map(emp => emp.id);
          const { data: timeEntriesData, error: timeEntriesError } = await supabase
            .from('time_entries')
            .select('*')
            .in('employee_id', employeeIds)
            .eq('is_active', true)
            .order('timestamp', { ascending: false });

          if (timeEntriesError) throw timeEntriesError;

          setEmployees(filteredEmployees);
          setTimeEntries(timeEntriesData || []);
        } else {
          setEmployees(filteredEmployees);
          setTimeEntries([]);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId, selectedWorkCenter]);

  const loadLocations = async (entries: TimeEntry[]) => {
    const locs: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.latitude && entry.longitude) {
        try {
          const location = await getApproximateLocation(entry.latitude, entry.longitude);
          locs[entry.id] = location;
        } catch (error) {
          console.error('Error getting location:', error);
          locs[entry.id] = 'Ubicación no disponible';
        }
      } else {
        locs[entry.id] = 'Ubicación no registrada';
      }
    }
    setLocations(locs);
  };

  useEffect(() => {
    if (selectedEmployee) {
      loadLocations(selectedEmployee.entries);
    }
  }, [selectedEmployee]);

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  // ===== Reemplazado: cálculo diario robusto (sin festivos / sin time_type)
  const calculateDailyWorkTime = (entries: TimeEntry[]) => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const { totalMs } = sumWorkedMsInRange(entries, start, end);
    return totalMs;
  };

  const filterEntriesByMonth = (entries: TimeEntry[]) => {
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

    const { totalMs } = sumWorkedMsInRange(employeeEntries); // total global (todas las fechas)

    return {
      employee,
      totalTime: totalMs,
      entries: employeeEntries,
    };
  });

  const getEntryTypeText = (type: TimeEntry['entry_type']) => {
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

  const filteredEmployees = employeeWorkTimes.filter(({ employee }) =>
    employee.fiscal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (employee.work_centers &&
      employee.work_centers.some(
        (wc) => typeof wc === 'string' && wc.toLowerCase().includes(searchTerm.toLowerCase())
      ))
  );

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Vista General</h1>
          <p className="text-gray-600">Visualiza los horarios de trabajo de forma precisa y eficiente</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
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
                <p className="text-sm text-gray-600">Centros de Trabajo</p>
                <p className="text-2xl font-bold">
                  {new Set(employees.flatMap((emp) => emp.work_centers || [])).size}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Buscar Empleado
            </label>
            <Search className="absolute left-3 bottom-3 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Buscar empleados..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Centro de Trabajo
            </label>
            <select
              value={selectedWorkCenter}
              onChange={(e) => setSelectedWorkCenter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Todos los centros</option>
              {workCenters.map((center) => (
                <option key={center} value={center}>
                  {center}
                </option>
              ))}
            </select>
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
                  Tiempo Trabajado
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center">
                    Cargando...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center">
                    No hay empleados para mostrar
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(({ employee, totalTime, entries }) => (
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
                        {formatDuration(totalTime)}
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
                              Cambios
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {getPaginatedEntries().map((entry: TimeEntry) => (
                            <tr key={entry.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {new Date(entry.timestamp).toLocaleDateString()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {getEntryTypeText(entry.entry_type)}
                                {/* ⛔️ Sin sub-etiqueta de time_type */}
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
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {entry.changes || 'N/A'}
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
      </div>
    </div>
  );
}

export default function InspectorDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login/inspector');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-8">
            <Shield className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-bold">Portal Inspector/a</span>
          </div>
          <nav className="space-y-2">
            <button
              onClick={() => {
                setActiveTab('overview');
                navigate('/inspector');
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
                setActiveTab('reports');
                navigate('/inspector/informes');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'reports' ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-5 h-5" />
              Informes
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

      {/* Main Content */}
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/informes" element={<InspectorReports />} />
        </Routes>
      </div>
    </div>
  );
}
