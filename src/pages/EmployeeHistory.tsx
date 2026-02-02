import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronLeft, ChevronRight, Search, Download } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import * as XLSX from 'xlsx';

export default function EmployeeHistory() {
  const today = new Date().toISOString().split('T')[0];

  const [entries, setEntries] = useState<any[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [totalTime, setTotalTime] = useState(0);
  const [totalNightTime, setTotalNightTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employeeData, setEmployeeData] = useState<any>(null);

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
      nightHours = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
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

      const { data, error } = await supabase.from('employee_profiles').select('*').eq('id', employeeId).single();

      if (error) throw error;
      setEmployeeData(data || null);
    } catch (err) {
      console.error('Error fetching employee data:', err);
      setEmployeeData(null);
      toast.error('Error al cargar los datos del empleado');
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
        .or('changes.neq.eliminated,changes.is.null') // <- Solo excluye "eliminated"
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
      calculateTotalTime(data || []);
    } catch (err) {
      console.error('Error fetching time entries:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los fichajes');
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalTime = (entriesList: any[]) => {
    if (!entriesList || entriesList.length === 0) {
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

    const { dailyResults } = processTimeEntries(employeeId, entriesList);

    const totalMs = dailyResults.reduce((sum, day) => {
      if (day.hours) return sum + day.hours * 1000 * 60 * 60;
      return sum;
    }, 0);

    const totalNightMs = dailyResults.reduce((sum, day) => {
      if (day.nightHours) return sum + day.nightHours * 1000 * 60 * 60;
      return sum;
    }, 0);

    setTotalTime(totalMs);
    setTotalNightTime(totalNightMs);
  };

  const processTimeEntries = (employeeId: string, timeEntries: any[]) => {
    const employeeEntries = (timeEntries || [])
      .filter((entry) => entry.employee_id === employeeId && entry.changes !== 'eliminated') // <- Filtro local
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const dailyResults: any[] = [];
    let currentEntries: any[] = [];

    const getHoursWorked = (start: string, end: string, breakMs: number) => {
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      return (endTime - startTime) / (1000 * 60 * 60) - breakMs / (1000 * 60 * 60);
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
            nightHours: 0,
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
              lastEntry.breakDuration += breakEnd - breakStart;
              lastEntry.breakStart = undefined;
            }
          }
          break;

        case 'clock_out':
          if (currentEntries.length > 0) {
            const lastEntry = currentEntries[currentEntries.length - 1];
            if (lastEntry.clockIn && !lastEntry.clockOut) {
              lastEntry.clockOut = entry.timestamp;
              lastEntry.hours = getHoursWorked(lastEntry.clockIn, lastEntry.clockOut, lastEntry.breakDuration);
              lastEntry.nightHours = calculateNightHours(lastEntry.clockIn, lastEntry.clockOut);
              dailyResults.push(lastEntry);
              currentEntries.pop();
            }
          }
          break;
      }
    }

    // ✅ Opción A: si el fichaje abierto es de HOY, usar "now" (no inventar fin de día).
    // Si es de un día pasado, se cierra a fin de ese día (como antes).
    currentEntries.forEach((entry) => {
      if (entry.clockIn && !entry.clockOut) {
        const now = new Date();
        const clockInDate = new Date(entry.clockIn);

        const isToday =
          clockInDate.getFullYear() === now.getFullYear() &&
          clockInDate.getMonth() === now.getMonth() &&
          clockInDate.getDate() === now.getDate();

        let assumedEnd: Date;

        if (isToday) {
          assumedEnd = now; // <- clave: evita nocturnas "futuras"
        } else {
          assumedEnd = new Date(entry.date);
          assumedEnd.setHours(23, 59, 59, 999);
        }

        entry.clockOut = assumedEnd.toISOString();
        entry.hours = getHoursWorked(entry.clockIn, entry.clockOut, entry.breakDuration);
        entry.nightHours = calculateNightHours(entry.clockIn, entry.clockOut);
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
      entriesByDate,
    };
  };

  const filterToday = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    setStartDate(dateStr);
    setEndDate(dateStr);
    setCurrentPage(1);
  };

  const filterWeek = () => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    setStartDate(monday.toISOString().split('T')[0]);
    setEndDate(sunday.toISOString().split('T')[0]);
    setCurrentPage(1);
  };

  const filterMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    setStartDate(firstDay.toISOString().split('T')[0]);
    setEndDate(lastDay.toISOString().split('T')[0]);
    setCurrentPage(1);
  };

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const formatHours = (hours: number) => {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    return `${wholeHours}h ${minutes}m`;
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

  // === EXPORTAR EXCEL (XLSX) con lo que muestra la tabla (PÁGINA ACTUAL) ===
  const exportTableToExcel = () => {
    try {
      if (!employeeData) {
        toast.error('Datos del empleado no disponibles');
        return;
      }

      const rows = paginatedEntries.map((entry) => ({
        Fecha: new Date(entry.timestamp).toLocaleDateString(),
        Hora: new Date(entry.timestamp).toLocaleTimeString(),
        Tipo: getEntryTypeText(entry.entry_type),
        'Centro de Trabajo': entry.work_center || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);

      // Ancho de columnas (aprox) para que se vea bien
      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 24 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Fichajes');

      const fileName = `fichajes_${(employeeData?.fiscal_name || 'empleado').replace(/\s+/g, '_')}_${startDate}_a_${endDate}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast.success('Excel descargado correctamente');
    } catch (err) {
      console.error('Error exporting Excel:', err);
      toast.error('Error al generar el Excel');
    }
  };

  useEffect(() => {
    const loadData = async () => {
      await fetchEmployeeData();
      await fetchTimeEntries();
      await calculateScheduleMetrics();
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (entries.length > 0) {
      calculateScheduleMetrics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const calculateScheduleMetrics = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const now = new Date();
      const todayDate = new Date(now);
      todayDate.setHours(0, 0, 0, 0);
      const todayStr = todayDate.toISOString().split('T')[0];

      // Calcular inicio de semana (lunes)
      const startOfWeek = new Date(todayDate);
      const dayOfWeek = todayDate.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      startOfWeek.setDate(todayDate.getDate() + diff);
      startOfWeek.setHours(0, 0, 0, 0);

      // Calcular fin de semana (domingo)
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Obtener horarios de la semana
      const { data: schedules, error: schedulesError } = await supabase
        .from('employee_schedules')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', startOfWeek.toISOString().split('T')[0])
        .lte('date', endOfWeek.toISOString().split('T')[0]);

      if (schedulesError) throw schedulesError;

      // Obtener fichajes de hoy
      const todayEnd = new Date(todayDate);
      todayEnd.setHours(23, 59, 59, 999);

      const { data: todayEntries, error: todayError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', todayDate.toISOString())
        .lte('timestamp', todayEnd.toISOString())
        .order('timestamp', { ascending: true });

      if (todayError) throw todayError;

      // Obtener fichajes de la semana
      const { data: weekEntries, error: weekError } = await supabase
        .from('time_entries')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', startOfWeek.toISOString())
        .lte('timestamp', endOfWeek.toISOString())
        .order('timestamp', { ascending: true });

      if (weekError) throw weekError;

      // CALCULAR HORAS PROGRAMADAS DE HOY
      let todayScheduled = 0;
      const todaySchedule = schedules?.find((s: any) => s.date === todayStr);
      if (todaySchedule) {
        // Mañana
        if (todaySchedule.morning_start && todaySchedule.morning_end) {
          todayScheduled += calculateHoursBetween(todaySchedule.morning_start, todaySchedule.morning_end);
        }
        // Tarde
        if (todaySchedule.afternoon_start && todaySchedule.afternoon_end) {
          todayScheduled += calculateHoursBetween(todaySchedule.afternoon_start, todaySchedule.afternoon_end);
        }
      }

      // CALCULAR HORAS PROGRAMADAS DE LA SEMANA
      let weekScheduled = 0;
      schedules?.forEach((schedule: any) => {
        let dayTotal = 0;

        // Mañana
        if (schedule.morning_start && schedule.morning_end) {
          dayTotal += calculateHoursBetween(schedule.morning_start, schedule.morning_end);
        }

        // Tarde
        if (schedule.afternoon_start && schedule.afternoon_end) {
          dayTotal += calculateHoursBetween(schedule.afternoon_start, schedule.afternoon_end);
        }

        weekScheduled += dayTotal;
      });

      // CALCULAR HORAS TRABAJADAS
      const todayWorked = calculateWorkedHours(todayEntries || []);
      const weekWorked = calculateWorkedHours(weekEntries || []);

      // ACTUALIZAR ESTADOS
      setTodayScheduledHours(todayScheduled);
      setTodayWorkedHours(todayWorked);
      setTodayRemainingHours(Math.max(0, todayScheduled - todayWorked));

      setWeekScheduledHours(weekScheduled);
      setWeekWorkedHours(weekWorked);
      setWeekRemainingHours(Math.max(0, weekScheduled - weekWorked));
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

  const calculateWorkedHours = (entriesList: any[]): number => {
    let totalHours = 0;
    let clockIn: Date | null = null;
    let breakStart: Date | null = null;
    let breakDuration = 0;

    for (const entry of entriesList) {
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

  // Get paginated entries
  const paginatedEntries = entries.slice((currentPage - 1) * entriesPerPage, currentPage * entriesPerPage);

  // Calculate total pages
  const totalPages = Math.ceil(entries.length / entriesPerPage);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-2xl font-bold">Historial de Fichajes</h2>

          <button
            onClick={exportTableToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-5 h-5" />
            Descargar Excel
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">{error}</div>}

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
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Inicio</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Fin</label>
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
                    <td className="px-6 py-4 whitespace-nowrap">{new Date(entry.timestamp).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{new Date(entry.timestamp).toLocaleTimeString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{getEntryTypeText(entry.entry_type)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{entry.work_center || ''}</td>
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
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
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
              onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <Toaster position="top-center" />
      </div>
    </div>
  );
}
