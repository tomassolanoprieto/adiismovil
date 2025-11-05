import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Download, Search, FileText, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

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
  entry_type: string;
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
    nightHours = (overlapEnd - overlapStart) / (1000 * 60 * 60);
  }
  
  return nightHours;
};

export default function CompanyReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reportType, setReportType] = useState<'daily' | 'annual' | 'official' | 'alarms'>('daily');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWorkCenter, setSelectedWorkCenter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [hoursLimit, setHoursLimit] = useState<number>(40);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [companyInfo, setCompanyInfo] = useState<{fiscal_name: string, nif: string} | null>(null);
  const [hourTypeFilter, setHourTypeFilter] = useState<'all' | 'regular' | 'night'>('all');
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const [timeRequests, setTimeRequests] = useState<any[]>([]);
  const [plannerRequests, setPlannerRequests] = useState<any[]>([]);

  useEffect(() => {
    const loadRequests = async () => {
      const timeReqs = await fetchCompanyTimeRequests();
      const plannerReqs = await fetchCompanyPlannerRequests();
      
      setTimeRequests(timeReqs);
      setPlannerRequests(plannerReqs);
    };

    loadRequests();
  }, []);

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
  }, []);

  const handleSearch = async () => {
    if (!initialLoadComplete) return;
    await generateReport();
  };

  // En la función fetchWorkCenters:
const fetchWorkCenters = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Asegurarse de que solo obtenemos los centros de trabajo de la empresa del usuario
    const { data } = await supabase
      .from('employee_profiles')
      .select('work_centers')
      .eq('company_id', user.id);  // Filtrar por la empresa del usuario

    if (data) {
      const uniqueWorkCenters = [...new Set(data.flatMap(emp => emp.work_centers || []))];
      setWorkCenters(uniqueWorkCenters);
    }
  } catch (error) {
    console.error('Error fetching work centers:', error);
  }
};

// En la función fetchEmployees:
const fetchEmployees = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let query = supabase
      .from('employee_profiles')
      .select('*')
      .eq('company_id', user.id)  // Filtrar por la empresa del usuario
      .eq('is_active', true);

    if (selectedWorkCenter) {
      query = query.contains('work_centers', [selectedWorkCenter]);
    }

    if (searchTerm) {
      query = query.ilike('fiscal_name', `%${searchTerm}%`);
    }

    const { data } = await query;
    if (data) {
      setEmployees(data);
      
      if (reportType === 'official' && selectedEmployee && 
          !data.some((e: any) => e.id === selectedEmployee)) {
        setSelectedEmployee('');
      }
    }
  } catch (error) {
    console.error('Error fetching employees:', error);
  }
};

// En la función fetchCompanyInfo:
const fetchCompanyInfo = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: companyData, error } = await supabase
      .from('company_profiles')
      .select('fiscal_name, nif')
      .eq('id', user.id)  // Filtrar por la empresa del usuario
      .single();

    if (error) throw error;

    if (companyData) {
      setCompanyInfo({
        fiscal_name: companyData.fiscal_name,
        nif: companyData.nif
      });
    }
  } catch (error) {
    console.error('Error fetching company info:', error);
  }
};

// Modificar la función fetchTimeEntriesInBatches para incluir el filtro por company_id
const fetchTimeEntriesInBatches = async (employeeIds: string[], startDate?: string, endDate?: string) => {
  if (!employeeIds.length) return [];
  
  const BATCH_SIZE = 10;
  const batches = chunkArray(employeeIds, BATCH_SIZE);
  let allEntries: any[] = [];

  for (const batch of batches) {
    try {
      // Primero obtenemos los employee_id que pertenecen a la compañía del usuario
      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_profiles')
        .select('id')
        .in('id', batch)
        .eq('company_id', (await supabase.auth.getUser()).data.user?.id);

      if (employeesError) throw employeesError;
      if (!employeesData || employeesData.length === 0) continue;

      const validEmployeeIds = employeesData.map(emp => emp.id);

      // Luego obtenemos las entradas de tiempo solo para esos empleados
      let query = supabase
        .from('time_entries')
        .select('*')
        .in('employee_id', validEmployeeIds)
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

// Función para obtener las solicitudes de tiempo de la empresa del usuario
// Función para obtener TODAS las solicitudes de tiempo de la empresa actual
const fetchCompanyTimeRequests = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Primero obtenemos los empleados de la empresa
    const { data: employees, error: employeesError } = await supabase
      .from('employee_profiles')
      .select('id, fiscal_name')
      .eq('company_id', user.id);

    if (employeesError) throw employeesError;
    if (!employees || employees.length === 0) return [];

    const employeeIds = employees.map(emp => emp.id);

    // Luego obtenemos las solicitudes de tiempo de esos empleados
    const { data, error } = await supabase
      .from('time_requests')
      .select('*')
      .in('employee_id', employeeIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Agregar información del empleado a cada solicitud
    const requestsWithEmployeeInfo = (data || []).map(request => ({
      ...request,
      employee_profiles: employees.find(emp => emp.id === request.employee_id)
    }));
    
    return requestsWithEmployeeInfo;
  } catch (error) {
    console.error('Error fetching company time requests:', error);
    return [];
  }
};

// Función para obtener TODAS las solicitudes del planner de la empresa actual
const fetchCompanyPlannerRequests = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Primero obtenemos los empleados de la empresa
    const { data: employees, error: employeesError } = await supabase
      .from('employee_profiles')
      .select('id, fiscal_name')
      .eq('company_id', user.id);

    if (employeesError) throw employeesError;
    if (!employees || employees.length === 0) return [];

    const employeeIds = employees.map(emp => emp.id);

    // Luego obtenemos las solicitudes del planner de esos empleados
    const { data, error } = await supabase
      .from('planner_requests')
      .select('*')
      .in('employee_id', employeeIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Agregar información del empleado a cada solicitud
    const requestsWithEmployeeInfo = (data || []).map(request => ({
      ...request,
      employee_profiles: employees.find(emp => emp.id === request.employee_id)
    }));
    
    return requestsWithEmployeeInfo;
  } catch (error) {
    console.error('Error fetching company planner requests:', error);
    return [];
  }
};

  const generateReport = async () => {
    setIsLoading(true);

    try {
      if (reportType === 'annual' && !selectedYear) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      if ((reportType === 'daily' || reportType === 'official' || reportType === 'alarms') && (!startDate || !endDate)) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      if (reportType === 'official' && employees.length > 0 && !selectedEmployee) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      if (employees.length === 0) {
        setReports([]);
        setIsLoading(false);
        return;
      }

      let timeStart, timeEnd;
      if (reportType === 'annual' && selectedYear) {
        timeStart = new Date(selectedYear, 0, 1).toISOString();
        timeEnd = new Date(selectedYear, 11, 31).toISOString();
      } else if ((reportType === 'daily' || reportType === 'official' || reportType === 'alarms') && startDate && endDate) {
        timeStart = startDate;
        timeEnd = endDate + 'T23:59:59.999Z';
      }

      const timeEntries = await fetchTimeEntriesInBatches(
        employees.map(emp => emp.id),
        timeStart,
        timeEnd
      );

      const processTimeEntries = (employeeId: string) => {
        const employeeEntries = timeEntries
          .filter(entry => entry.employee_id === employeeId)
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

        return {
          dailyResults,
          entriesByDate: employeeEntries.reduce((acc, entry) => {
            const date = entry.timestamp.split('T')[0];
            if (!acc[date]) acc[date] = [];
            acc[date].push(entry);
            return acc;
          }, {} as Record<string, any[]>)
        };
      };

      let reportData: Report[] = [];

      switch (reportType) {
        case 'official': {
          if (!selectedEmployee) break;

          const employee = employees.find(emp => emp.id === selectedEmployee);
          if (!employee) break;

          const start = new Date(startDate);
          const end = new Date(endDate);
          
          // Generar todos los días del rango
          const daysInRange = [];
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            daysInRange.push(new Date(d));
          }

          const { dailyResults } = processTimeEntries(selectedEmployee);

          // Agrupar fichajes por fecha
          const entriesByDate = dailyResults.reduce((acc, entry) => {
            const dateKey = entry.date;
            if (!acc[dateKey]) acc[dateKey] = [];
            acc[dateKey].push(entry);
            return acc;
          }, {} as Record<string, any[]>);

          const dailyReports: DailyReport[] = daysInRange.flatMap(date => {
            const dateKey = date.toISOString().split('T')[0];
            const dayEntries = entriesByDate[dateKey] || [];

            // Si no hay fichajes, mostrar una línea vacía
            if (dayEntries.length === 0) {
              return [{
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
              }];
            }

            // Para cada fichaje del día, crear una línea
            return dayEntries.map((entry, index) => ({
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
              break_duration: entry.breakDuration ? 
                `${Math.floor(entry.breakDuration / (1000 * 60 * 60))}:${Math.floor((entry.breakDuration % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0')}` : '',
              total_hours: entry.hours || 0,
              night_hours: entry.nightHours || 0
            }));
          });

          reportData = [{
            employee: {
              fiscal_name: employee.fiscal_name,
              email: employee.email,
              work_centers: employee.work_centers || [],
              document_number: employee.document_number
            },
            date: startDate,
            entry_type: '',
            timestamp: '',
            daily_reports: dailyReports,
            company: companyInfo || undefined
          }];
          break;
        }

        case 'daily': {
          reportData = employees.map(employee => {
            const { dailyResults } = processTimeEntries(employee.id);
            const totalHours = dailyResults.reduce((sum, day) => sum + day.hours, 0);
            const totalNightHours = dailyResults.reduce((sum, day) => sum + day.nightHours, 0);
            
            return {
              employee: {
                fiscal_name: employee.fiscal_name,
                email: employee.email,
                work_centers: employee.work_centers || [],
                document_number: employee.document_number
              },
              date: `${new Date(startDate).toLocaleDateString('es-ES')} - ${new Date(endDate).toLocaleDateString('es-ES')}`,
              entry_type: '',
              timestamp: '',
              work_center: employee.work_centers?.[0] || '',
              total_hours: parseFloat(totalHours.toFixed(2)),
              night_hours: parseFloat(totalNightHours.toFixed(2))
            };
          });
          break;
        }

        case 'annual': {
          reportData = employees.map(employee => {
            const { dailyResults } = processTimeEntries(employee.id);
            const totalHoursByMonth = Array(12).fill(0);
            const totalNightHoursByMonth = Array(12).fill(0);
            
            dailyResults.forEach(day => {
              const month = day.dateObj.getMonth();
              totalHoursByMonth[month] += day.hours;
              totalNightHoursByMonth[month] += day.nightHours;
            });

            return {
              employee: {
                fiscal_name: employee.fiscal_name,
                email: employee.email,
                work_centers: employee.work_centers || [],
                document_number: employee.document_number
              },
              date: `Año ${selectedYear}`,
              entry_type: '',
              timestamp: '',
              total_hours: totalHoursByMonth.reduce((acc, hours) => acc + hours, 0),
              night_hours: totalNightHoursByMonth.reduce((acc, hours) => acc + hours, 0),
              monthly_hours: totalHoursByMonth,
              monthly_night_hours: totalNightHoursByMonth
            };
          });
          break;
        }

        case 'alarms': {
          reportData = employees.map(employee => {
            const { dailyResults } = processTimeEntries(employee.id);
            const totalHours = dailyResults.reduce((sum, day) => sum + day.hours, 0);
            const totalNightHours = dailyResults.reduce((sum, day) => sum + day.nightHours, 0);
            
            return {
              employee: {
                fiscal_name: employee.fiscal_name,
                email: employee.email,
                work_centers: employee.work_centers || [],
                document_number: employee.document_number
              },
              date: '-',
              entry_type: '-',
              timestamp: '-',
              total_hours: totalHours,
              night_hours: totalNightHours
            };
          }).filter(({ total_hours }) => total_hours > hoursLimit)
            .map(({ employee, total_hours, night_hours }) => ({
              employee,
              date: '-',
              entry_type: '-',
              timestamp: '-',
              total_hours,
              night_hours
            }));
          break;
        }
      }

      // Aplicar filtro de tipo de horas si es necesario
      if (hourTypeFilter !== 'all') {
        reportData = reportData.map(report => {
          if (hourTypeFilter === 'regular') {
            return {
              ...report,
              night_hours: 0,
              monthly_night_hours: report.monthly_night_hours?.map(() => 0)
            };
          } else if (hourTypeFilter === 'night') {
            return {
              ...report,
              total_hours: report.night_hours || 0,
              monthly_hours: report.monthly_night_hours
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
    if (reportType === 'official') {
      if (!selectedEmployee || !startDate || !endDate) {
        alert('Por favor seleccione un empleado y el rango de fechas');
        return;
      }

      const report = reports[0];
      if (!report || !report.daily_reports) return;

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

      const recordsData = report.daily_reports.map(day => [
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

      const totalHours = report.daily_reports.reduce((acc, day) => acc + (day.total_hours || 0), 0);
      const totalNightHours = report.daily_reports.reduce((acc, day) => acc + (day.night_hours || 0), 0);
      
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

      doc.save(`informe_oficial_${report.employee.fiscal_name}_${startDate}.pdf`);
    } else {
      const exportData = reports.map(report => ({
        'Nombre': report.employee.fiscal_name,
        'Email': report.employee.email,
        'Centros de Trabajo': report.employee.work_centers.join(', '),
        'Fecha': report.date,
        'Tipo': report.entry_type,
        'Hora': report.timestamp,
        'Centro de Trabajo': report.work_center || '',
        ...(report.total_hours ? { 'Horas Totales': report.total_hours } : {}),
        ...(report.night_hours ? { 'Horas Nocturnas': report.night_hours } : {}),
        ...(report.monthly_hours ? {
          'Enero': report.monthly_hours[0],
          'Febrero': report.monthly_hours[1],
          'Marzo': report.monthly_hours[2],
          'Abril': report.monthly_hours[3],
          'Mayo': report.monthly_hours[4],
          'Junio': report.monthly_hours[5],
          'Julio': report.monthly_hours[6],
          'Agosto': report.monthly_hours[7],
          'Septiembre': report.monthly_hours[8],
          'Octubre': report.monthly_hours[9],
          'Noviembre': report.monthly_hours[10],
          'Diciembre': report.monthly_hours[11],
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
          'Diciembre (Nocturnas)': report.monthly_night_hours?.[11] || 0
        } : {})
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Informe');
      
      const reportName = `informe_${reportType}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, reportName);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
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
              reportType === 'daily'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
              reportType === 'annual'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <FileText className="w-5 h-5" />
            Resumen Anual
          </button>
          <button
            onClick={() => {
              setReportType('official');
              setHourTypeFilter('all');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              reportType === 'official'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <FileText className="w-5 h-5" />
            Informe
          </button>
          <button
            onClick={() => {
              setReportType('alarms');
              setHourTypeFilter('all');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              reportType === 'alarms'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
            {reportType === 'official' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Empleado
                </label>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Seleccionar empleado</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fiscal_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
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

                {reportType === 'alarms' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Límite de Horas
                    </label>
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
            )}

            {(reportType === 'daily' || reportType === 'official' || reportType === 'alarms') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha Inicio
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </>
            )}

            {reportType === 'annual' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Año
                </label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Horas
                </label>
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

        <div className="mb-6">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-5 h-5" />
            {reportType === 'official' ? 'Generar PDF' : 'Exportar a Excel'}
          </button>
        </div>

        {reportType !== 'official' && (
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
                          <th key={i} className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                      <td colSpan={reportType === 'annual' ? 16 : (reportType === 'daily' ? 6 : 6)} className="px-6 py-4 text-center">
                        Cargando...
                      </td>
                    </tr>
                  ) : reports.length === 0 ? (
                    <tr>
                      <td colSpan={reportType === 'annual' ? 16 : (reportType === 'daily' ? 6 : 6)} className="px-6 py-4 text-center">
                        No hay datos para mostrar
                      </td>
                    </tr>
                  ) : (
                    reports.map((report, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {report.employee.fiscal_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {report.employee.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {report.employee.work_centers.join(', ')}
                        </td>
                        {reportType === 'daily' ? (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.date}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.total_hours?.toFixed(2)} h
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.night_hours?.toFixed(2)} h
                            </td>
                          </>
                        ) : reportType === 'annual' ? (
                          <>
                            {report.monthly_hours?.map((hours, i) => (
                              <td key={i} className="px-6 py-4 whitespace-nowrap">
                                {hours.toFixed(2)} h
                              </td>
                            ))}
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.total_hours?.toFixed(2)} h
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.night_hours?.toFixed(2)} h
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.total_hours?.toFixed(2)} h
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {report.night_hours?.toFixed(2)} h
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}