import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Download, Search, FileText, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import CalendarSignatureAlert from '../components/CalendarSignatureAlert';

interface DailyReport {
  date: string;
  clock_in: string;
  clock_out: string;
  break_duration: string;
  total_hours: number;
  night_hours: number;
}

interface Report {
  employee: {
    fiscal_name: string;
    email: string;
    work_centers: string[];
    document_number: string;
  };
  date: string;
  timestamp: string;
  work_center?: string;
  total_hours?: number;
  night_hours?: number;
  daily_reports?: DailyReport[];
  monthly_hours?: number[];
  monthly_night_hours?: number[];
  company?: {
    fiscal_name: string;
    nif: string;
  };
}

const chunkArray = <T,>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

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

export default function SupervisorReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // ✅ Quitado "official" (Informe) del apartado de Informes
  const [reportType, setReportType] = useState<'daily' | 'annual' | 'alarms'>('daily');

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWorkCenter, setSelectedWorkCenter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [hoursLimit, setHoursLimit] = useState<number>(40);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [companyInfo, setCompanyInfo] = useState<{ fiscal_name: string; nif: string } | null>(null);
  const [hourTypeFilter, setHourTypeFilter] = useState<'all' | 'regular' | 'night'>('all');
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Recuperar el correo electrónico del supervisor del localStorage
  const supervisorEmail = localStorage.getItem('supervisorEmail');

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setIsLoading(true);
        await fetchWorkCenters();
        await fetchEmployees();
        await fetchCompanyInfo();
        setInitialLoadComplete(true);
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async () => {
    if (!initialLoadComplete) return;
    await generateReport();
  };

  const fetchWorkCenters = async () => {
    try {
      if (!supervisorEmail) return;

      // Obtener los centros de trabajo del supervisor
      const { data: workCenters, error } = await supabase.rpc('get_supervisor_work_centers', {
        p_email: supervisorEmail,
      });

      if (error) throw error;

      if (workCenters) {
        setWorkCenters(workCenters);
        setSelectedWorkCenter(workCenters[0]); // Establecer el primer centro de trabajo como predeterminado
      }
    } catch (error) {
      console.error('Error fetching work centers:', error);
    }
  };

  const ensureArray = (value: any): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
  };

  const fetchEmployees = async () => {
    try {
      if (!supervisorEmail) return;

      // Get supervisor's company_id and work_centers first
      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('company_id, work_centers')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .single();

      if (supervisorError) throw supervisorError;
      if (!supervisorData?.work_centers?.length) return;

      // Get employees from supervisor's company that work in supervisor's centers
      const { data: employeesData, error } = await supabase
        .from('employee_profiles')
        .select('*')
        .eq('company_id', supervisorData.company_id)
        .eq('is_active', true)
        .overlaps('work_centers', supervisorData.work_centers);

      if (error) throw error;

      if (employeesData) {
        const processedEmployees = employeesData.map((emp) => ({
          ...emp,
          work_centers: ensureArray(emp.work_centers),
        }));

        setEmployees(processedEmployees);

        // (Antes había lógica específica para "official"; ya no aplica)
        if (selectedEmployee && !processedEmployees.some((e) => e.id === selectedEmployee)) {
          setSelectedEmployee('');
        }
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const fetchCompanyInfo = async () => {
    try {
      if (!supervisorEmail) return;

      // Obtener el company_id del supervisor
      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('company_id')
        .eq('email', supervisorEmail)
        .single();

      if (supervisorError) throw supervisorError;
      if (!supervisorData?.company_id) return;

      // Obtener la información de la empresa
      const { data: companyData, error: companyError } = await supabase
        .from('company_profiles')
        .select('fiscal_name, nif')
        .eq('id', supervisorData.company_id)
        .single();

      if (companyError) throw companyError;

      if (companyData) {
        setCompanyInfo({
          fiscal_name: companyData.fiscal_name,
          nif: companyData.nif,
        });
      }
    } catch (error) {
      console.error('Error fetching company info:', error);
    }
  };

  const fetchTimeEntriesInBatches = async (employeeIds: string[], startDate?: string, endDate?: string) => {
    if (!employeeIds.length) return [];

    const BATCH_SIZE = 10;
    const batches = chunkArray(employeeIds, BATCH_SIZE);
    let allEntries: any[] = [];

    for (const batch of batches) {
      try {
        let query = supabase
          .from('time_entries')
          .select(
            `
            id,
            employee_id,
            timestamp,
            entry_type,
            work_center,
            is_active
          `
          )
          .in('employee_id', batch)
          .eq('is_active', true)
          .order('timestamp', { ascending: true });

        if (startDate) {
          query = query.gte('timestamp', startDate);
        }
        if (endDate) {
          query = query.lte('timestamp', endDate);
        }

        const { data, error } = await query;

        if (error) throw error;
        if (data) allEntries = [...allEntries, ...data];
      } catch (error) {
        console.error(`Error en lote de empleados:`, error);
        continue;
      }
    }

    return allEntries;
  };

  const generateReport = async () => {
    setIsLoading(true);

    try {
      if (reportType === 'annual' && !selectedYear) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      // ✅ Quitado "official" de la validación de fechas
      if ((reportType === 'daily' || reportType === 'alarms') && (!startDate || !endDate)) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      if (employees.length === 0) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      let timeStart: string | undefined, timeEnd: string | undefined;
      if (reportType === 'annual' && selectedYear) {
        timeStart = new Date(selectedYear, 0, 1).toISOString();
        timeEnd = new Date(selectedYear, 11, 31).toISOString();
      } else if ((reportType === 'daily' || reportType === 'alarms') && startDate && endDate) {
        timeStart = startDate;
        timeEnd = endDate + 'T23:59:59.999Z';
      }

      const timeEntries = await fetchTimeEntriesInBatches(
        employees.map((emp) => emp.id),
        timeStart,
        timeEnd
      );

      const processTimeEntries = (employeeId: string) => {
        const employeeEntries = timeEntries
          .filter((entry) => entry.employee_id === employeeId)
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
          }
        }

        // Procesar entradas pendientes al final del día
        currentEntries.forEach((entry) => {
          if (entry.clockIn && !entry.clockOut) {
            const endOfDay = new Date(entry.date);
            endOfDay.setHours(23, 59, 59, 999);
            entry.clockOut = endOfDay.toISOString();
            entry.hours = getHoursWorked(entry.clockIn, entry.clockOut, entry.breakDuration);
            entry.nightHours = calculateNightHours(entry.clockIn, entry.clockOut);
            dailyResults.push(entry);
          }
        });

        return {
          dailyResults,
          entriesByDate: employeeEntries.reduce((acc, entry) => {
            const date = entry.timestamp.split('T')[0];
            if (!acc[date]) acc[date] = [];
            acc[date].push(entry);
            return acc;
          }, {} as Record<string, any[]>),
        };
      };

      let reportData: Report[] = [];

      switch (reportType) {
        case 'daily': {
          reportData = employees.map((employee) => {
            const { dailyResults } = processTimeEntries(employee.id);
            const totalHours = dailyResults.reduce((sum, day) => sum + day.hours, 0);
            const totalNightHours = dailyResults.reduce((sum, day) => sum + day.nightHours, 0);

            return {
              employee: {
                fiscal_name: employee.fiscal_name,
                email: employee.email,
                work_centers: employee.work_centers || [],
                document_number: employee.document_number,
              },
              date: `${new Date(startDate).toLocaleDateString('es-ES')} - ${new Date(endDate).toLocaleDateString(
                'es-ES'
              )}`,
              timestamp: '',
              work_center: employee.work_centers?.[0] || '',
              total_hours: parseFloat(totalHours.toFixed(2)),
              night_hours: parseFloat(totalNightHours.toFixed(2)),
            };
          });
          break;
        }

        case 'annual': {
          reportData = employees.map((employee) => {
            const { dailyResults } = processTimeEntries(employee.id);
            const totalHoursByMonth = Array(12).fill(0);
            const totalNightHoursByMonth = Array(12).fill(0);

            dailyResults.forEach((day) => {
              const month = day.dateObj.getMonth();
              totalHoursByMonth[month] += day.hours;
              totalNightHoursByMonth[month] += day.nightHours;
            });

            return {
              employee: {
                fiscal_name: employee.fiscal_name,
                email: employee.email,
                work_centers: employee.work_centers || [],
                document_number: employee.document_number,
              },
              date: `Año ${selectedYear}`,
              timestamp: '',
              total_hours: totalHoursByMonth.reduce((acc, hours) => acc + hours, 0),
              night_hours: totalNightHoursByMonth.reduce((acc, hours) => acc + hours, 0),
              monthly_hours: totalHoursByMonth,
              monthly_night_hours: totalNightHoursByMonth,
            };
          });
          break;
        }

        case 'alarms': {
          reportData = employees
            .map((employee) => {
              const { dailyResults } = processTimeEntries(employee.id);
              const totalHours = dailyResults.reduce((sum, day) => sum + day.hours, 0);
              const totalNightHours = dailyResults.reduce((sum, day) => sum + day.nightHours, 0);

              return {
                employee: {
                  fiscal_name: employee.fiscal_name,
                  email: employee.email,
                  work_centers: employee.work_centers || [],
                  document_number: employee.document_number,
                },
                date: '-',
                timestamp: '-',
                total_hours: totalHours,
                night_hours: totalNightHours,
              };
            })
            .filter(({ total_hours }) => (total_hours ?? 0) > hoursLimit)
            .map(({ employee, total_hours, night_hours }) => ({
              employee,
              date: '-',
              timestamp: '-',
              total_hours,
              night_hours,
            }));
          break;
        }
      }

      // Aplicar filtro de tipo de horas si es necesario (solo aplica a daily/annual en UI, pero lo dejamos seguro)
      if (hourTypeFilter !== 'all') {
        reportData = reportData.map((report) => {
          if (hourTypeFilter === 'regular') {
            return {
              ...report,
              night_hours: 0,
              monthly_night_hours: report.monthly_night_hours?.map(() => 0),
            };
          } else if (hourTypeFilter === 'night') {
            return {
              ...report,
              total_hours: report.night_hours || 0,
              monthly_hours: report.monthly_night_hours,
            };
          }
          return report;
        });
      }

      setReports(reportData);
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    // ✅ Ya no hay PDF oficial; siempre exporta Excel
    const exportData = reports.map((report) => ({
      Nombre: report.employee.fiscal_name,
      Email: report.employee.email,
      'Centros de Trabajo': report.employee.work_centers?.join(', ') || '',
      Fecha: report.date,
      Hora: report.timestamp,
      'Centro de Trabajo': report.work_center || '',
      ...(typeof report.total_hours === 'number' ? { 'Horas Totales': report.total_hours } : {}),
      ...(typeof report.night_hours === 'number' ? { 'Horas Nocturnas': report.night_hours } : {}),
      ...(report.monthly_hours
        ? {
            Enero: report.monthly_hours[0],
            Febrero: report.monthly_hours[1],
            Marzo: report.monthly_hours[2],
            Abril: report.monthly_hours[3],
            Mayo: report.monthly_hours[4],
            Junio: report.monthly_hours[5],
            Julio: report.monthly_hours[6],
            Agosto: report.monthly_hours[7],
            Septiembre: report.monthly_hours[8],
            Octubre: report.monthly_hours[9],
            Noviembre: report.monthly_hours[10],
            Diciembre: report.monthly_hours[11],
            'Enero (Nocturnas)': report.monthly_night_hours?.[0] || 0,
            'Febrero (Nocturnas)': report.monthly_night_hours?.[1] || 0,
            'Marzo (Nocturnas)': report.monthly_night_hours?.[2] || 0,
            'Abril (Nocturnas)': report.monthly_night_hours?.[3] || 0,
            'Mayo (Nocturnas)': report.monthly_night_hours?.[4] || 0,
            'Junio (Nocturnas)': report.monthly_night_hours?.[5] || 0,
            'Julio (Nocturnas)': report.monthly_night_hours?.[6] || 0,
            'Agosto (Nocturnas)': report.monthly_night_hours?.[7] || 0,
            'Septiembre (Nocturnas)': report.monthly_night_hours?.[8] || 0,
            'Octubre (Nocturnas)': report.monthly_night_hours?.[9] || 0,
            'Noviembre (Nocturnas)': report.monthly_night_hours?.[10] || 0,
            'Diciembre (Nocturnas)': report.monthly_night_hours?.[11] || 0,
          }
        : {}),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Informe');

    const reportName = `informe_${reportType}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, reportName);
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <CalendarSignatureAlert />

        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Informes</h1>
          <p className="text-gray-600">Genera y exporta informes detallados</p>
        </div>

        <div className="mb-6 flex gap-4">
          <button
            onClick={() => {
              setReportType('daily');
              setHourTypeFilter('all');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              reportType === 'daily' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <FileText className="w-5 h-5" />
            Resumen Diario
          </button>

          <button
            onClick={() => {
              setReportType('annual');
              setHourTypeFilter('all');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              reportType === 'annual' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <FileText className="w-5 h-5" />
            Resumen Anual
          </button>

          {/* ✅ Botón "Informe" eliminado */}

          <button
            onClick={() => {
              setReportType('alarms');
              setHourTypeFilter('all');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              reportType === 'alarms' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
            Alarmas
          </button>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm space-y-4 mb-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Filtros</h2>
            <button
              onClick={handleSearch}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Search className="w-5 h-5" />
              Buscar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* ✅ Quitado bloque de selección de empleado (solo existía para "official") */}
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Centro de Trabajo</label>
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

              {reportType === 'alarms' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Límite de Horas</label>
                  <input
                    type="number"
                    value={hoursLimit.toString()}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value > 0) {
                        setHoursLimit(value);
                      }
                    }}
                    min="1"
                    step="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}
            </>

            {(reportType === 'daily' || reportType === 'alarms') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Inicio</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Fin</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </>
            )}

            {reportType === 'annual' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Año</label>
                <select
                  value={selectedYear || ''}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Seleccionar año</option>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={new Date().getFullYear() - i}>
                      {new Date().getFullYear() - i}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(reportType === 'daily' || reportType === 'annual') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Horas</label>
                <select
                  value={hourTypeFilter}
                  onChange={(e) => setHourTypeFilter(e.target.value as 'all' | 'regular' | 'night')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">Todas las horas</option>
                  <option value="regular">Solo horas regulares</option>
                  <option value="night">Solo horas nocturnas</option>
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="mb-6 flex gap-4">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
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
                    Nombre
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Centros de Trabajo
                  </th>

                  {reportType === 'daily' ? (
                    <>
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Fechas
                      </th>
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Horas Totales
                      </th>
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Horas Nocturnas
                      </th>
                    </>
                  ) : reportType === 'annual' ? (
                    <>
                      {Array.from({ length: 12 }, (_, i) => (
                        <th
                          key={i}
                          className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {new Date(0, i).toLocaleString('es-ES', { month: 'short' })}
                        </th>
                      ))}
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Horas
                      </th>
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Nocturnas
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Horas Totales
                      </th>
                      <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Horas Nocturnas
                      </th>
                    </>
                  )}
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={reportType === 'annual' ? 16 : 6} className="px-6 py-4 text-center">
                      Cargando...
                    </td>
                  </tr>
                ) : reports.length === 0 ? (
                  <tr>
                    <td colSpan={reportType === 'annual' ? 16 : 6} className="px-6 py-4 text-center">
                      No hay datos para mostrar
                    </td>
                  </tr>
                ) : (
                  reports.map((report, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">{report.employee.fiscal_name}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{report.employee.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{report.employee.work_centers?.join(', ') || ''}</td>

                      {reportType === 'daily' ? (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap">{report.date}</td>
                          <td className="px-6 py-4 whitespace-nowrap">{report.total_hours?.toFixed(2)} h</td>
                          <td className="px-6 py-4 whitespace-nowrap">{report.night_hours?.toFixed(2)} h</td>
                        </>
                      ) : reportType === 'annual' ? (
                        <>
                          {report.monthly_hours?.map((hours, i) => (
                            <td key={i} className="px-6 py-4 whitespace-nowrap">
                              {hours.toFixed(2)} h
                            </td>
                          ))}
                          <td className="px-6 py-4 whitespace-nowrap">{report.total_hours?.toFixed(2)} h</td>
                          <td className="px-6 py-4 whitespace-nowrap">{report.night_hours?.toFixed(2)} h</td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap">{report.total_hours?.toFixed(2)} h</td>
                          <td className="px-6 py-4 whitespace-nowrap">{report.night_hours?.toFixed(2)} h</td>
                        </>
                      )}
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
