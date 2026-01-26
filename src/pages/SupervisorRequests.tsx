import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Check, X, Search, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import CalendarSignatureAlert from '../components/CalendarSignatureAlert';

interface Request {
  request_id: string;
  request_type: 'time' | 'planner';
  request_status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  work_centers: string[];
  delegation: string;
  details: any;
}

function SupervisorRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [selectedWorkCenter, setSelectedWorkCenter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [pendingRequestsByWorkCenter, setPendingRequestsByWorkCenter] = useState<{ [key: string]: number }>({});
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const supervisorEmail = localStorage.getItem('supervisorEmail');

  useEffect(() => {
    fetchWorkCenters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * ✅ CLAVE: cargar contadores de pendientes para TODOS los centros
   * en cuanto tengamos workCenters (sin necesidad de selectedWorkCenter)
   */
  useEffect(() => {
    if (supervisorEmail && workCenters.length > 0) {
      fetchPendingCountsByCenter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supervisorEmail, workCenters]);

  /**
   * ✅ Listado SOLO cuando hay centro seleccionado
   */
  useEffect(() => {
    if (supervisorEmail && workCenters.length > 0 && selectedWorkCenter) {
      fetchRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supervisorEmail, selectedWorkCenter, filter, startDate, endDate, workCenters]);

  const fetchWorkCenters = async () => {
    try {
      if (!supervisorEmail) return;

      const { data: supervisorData, error } = await supabase
        .from('supervisor_profiles')
        .select('work_centers')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .single();

      if (error) throw error;

      if (supervisorData?.work_centers?.length > 0) {
        setWorkCenters(supervisorData.work_centers);

        // Si solo hay uno, seleccionarlo automáticamente (opcional, pero práctico)
        if (supervisorData.work_centers.length === 1) {
          setSelectedWorkCenter(supervisorData.work_centers[0]);
        }
      } else {
        setError('No tienes centros de trabajo asignados');
      }
    } catch (error) {
      console.error('Error fetching work centers:', error);
      setError('Error al cargar los centros de trabajo');
    }
  };

  /**
   * ✅ NUEVO: calcula pendientes por centro para TODOS los centros del supervisor
   * Esto es lo que hace que el badge rojo se vea en la pantalla de selección.
   */
  const fetchPendingCountsByCenter = async () => {
    try {
      if (!supervisorEmail) return;
      if (!workCenters || workCenters.length === 0) return;

      // 1) company_id del supervisor
      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('company_id')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .single();

      if (supervisorError) throw supervisorError;
      if (!supervisorData?.company_id) return;

      // 2) empleados de la empresa que estén en CUALQUIERA de los centros del supervisor
      //    (overlaps para arrays)
      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_profiles')
        .select('id, work_centers')
        .eq('company_id', supervisorData.company_id)
        .overlaps('work_centers', workCenters);

      if (employeesError) throw employeesError;

      if (!employeesData || employeesData.length === 0) {
        setPendingRequestsByWorkCenter({});
        return;
      }

      const employeeIds = employeesData.map((e: any) => e.id);

      // 3) traer SOLO pending de ambas tablas (más eficiente)
      let timePendingQuery = supabase
        .from('time_requests')
        .select('id, employee_id')
        .in('employee_id', employeeIds)
        .eq('status', 'pending');

      let plannerPendingQuery = supabase
        .from('planner_requests')
        .select('id, employee_id')
        .in('employee_id', employeeIds)
        .eq('status', 'pending');

      // (Opcional) si quieres que los contadores respeten filtros de fechas:
      if (startDate) {
        timePendingQuery = timePendingQuery.gte('created_at', new Date(startDate).toISOString());
        plannerPendingQuery = plannerPendingQuery.gte('created_at', new Date(startDate).toISOString());
      }
      if (endDate) {
        timePendingQuery = timePendingQuery.lte('created_at', new Date(endDate + 'T23:59:59').toISOString());
        plannerPendingQuery = plannerPendingQuery.lte('created_at', new Date(endDate + 'T23:59:59').toISOString());
      }

      const [timeRes, plannerRes] = await Promise.all([timePendingQuery, plannerPendingQuery]);

      if (timeRes.error) throw timeRes.error;
      if (plannerRes.error) throw plannerRes.error;

      // 4) mapa employee_id -> centros del empleado
      const employeeCentersMap = (employeesData as any[]).reduce((acc, emp) => {
        acc[emp.id] = Array.isArray(emp.work_centers) ? emp.work_centers : [];
        return acc;
      }, {} as Record<string, string[]>);

      // 5) acumular pendientes por centro
      const pendingByWorkCenter: { [key: string]: number } = {};

      const pendingEmployeeIds = [
        ...(timeRes.data || []).map((r: any) => r.employee_id),
        ...(plannerRes.data || []).map((r: any) => r.employee_id),
      ];

      pendingEmployeeIds.forEach((empId) => {
        const centers = employeeCentersMap[empId] || [];
        centers.forEach((c) => {
          pendingByWorkCenter[c] = (pendingByWorkCenter[c] || 0) + 1;
        });
      });

      setPendingRequestsByWorkCenter(pendingByWorkCenter);
    } catch (err) {
      console.error('Error fetching pending counts by center:', err);
      // no petamos UI por esto, pero podrías setError si quieres
    }
  };

  const fetchRequests = async () => {
    try {
      if (!selectedWorkCenter) return;

      setLoading(true);
      setError(null);

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

      // Get employees from supervisor's company that work in the selected work center
      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_profiles')
        .select('id, fiscal_name, email, work_centers')
        .eq('company_id', supervisorData.company_id)
        .contains('work_centers', [selectedWorkCenter]);

      if (employeesError) throw employeesError;

      if (!employeesData || employeesData.length === 0) {
        setRequests([]);
        setPendingRequestsCount(0);
        return;
      }

      const employeeIds = employeesData.map((emp: any) => emp.id);
      const employeeNamesMap = employeesData.reduce((acc: any, emp: any) => {
        acc[emp.id] = { name: emp.fiscal_name, email: emp.email, work_centers: emp.work_centers };
        return acc;
      }, {} as Record<string, { name: string; email: string; work_centers: string[] }>);

      // Get time requests for these employees
      let timeRequestsQuery = supabase
        .from('time_requests')
        .select('*')
        .in('employee_id', employeeIds);

      if (startDate) {
        timeRequestsQuery = timeRequestsQuery.gte('created_at', new Date(startDate).toISOString());
      }
      if (endDate) {
        timeRequestsQuery = timeRequestsQuery.lte('created_at', new Date(endDate + 'T23:59:59').toISOString());
      }

      // Get planner requests for these employees
      let plannerRequestsQuery = supabase
        .from('planner_requests')
        .select('*')
        .in('employee_id', employeeIds);

      if (startDate) {
        plannerRequestsQuery = plannerRequestsQuery.gte('created_at', new Date(startDate).toISOString());
      }
      if (endDate) {
        plannerRequestsQuery = plannerRequestsQuery.lte('created_at', new Date(endDate + 'T23:59:59').toISOString());
      }

      const [timeRequestsResponse, plannerRequestsResponse] = await Promise.all([timeRequestsQuery, plannerRequestsQuery]);

      if (timeRequestsResponse.error) throw timeRequestsResponse.error;
      if (plannerRequestsResponse.error) throw plannerRequestsResponse.error;

      // Format requests to match the expected structure
      const allRequests: Request[] = [
        ...(timeRequestsResponse.data || []).map((req: any) => ({
          request_id: req.id,
          request_type: 'time' as const,
          request_status: req.status,
          created_at: req.created_at,
          employee_id: req.employee_id,
          employee_name: employeeNamesMap[req.employee_id]?.name || 'Empleado',
          employee_email: employeeNamesMap[req.employee_id]?.email || '',
          work_centers: employeeNamesMap[req.employee_id]?.work_centers || [],
          delegation: '',
          details: {
            datetime: req.datetime,
            entry_type: req.entry_type,
            comment: req.comment,
          },
        })),
        ...(plannerRequestsResponse.data || []).map((req: any) => ({
          request_id: req.id,
          request_type: 'planner' as const,
          request_status: req.status,
          created_at: req.created_at,
          employee_id: req.employee_id,
          employee_name: employeeNamesMap[req.employee_id]?.name || 'Empleado',
          employee_email: employeeNamesMap[req.employee_id]?.email || '',
          work_centers: employeeNamesMap[req.employee_id]?.work_centers || [],
          delegation: '',
          details: {
            planner_type: req.planner_type,
            start_date: req.start_date,
            end_date: req.end_date,
            comment: req.comment,
          },
        })),
      ];

      const filtered = allRequests.filter((req) => filter === 'all' || req.request_status === filter);
      setRequests(filtered);

      // ✅ Contador de pendientes SOLO del centro seleccionado (correcto para la vista)
      const pendingCount = allRequests.filter((req) => req.request_status === 'pending').length;
      setPendingRequestsCount(pendingCount);

      // ✅ NO sobreescribimos pendingRequestsByWorkCenter aquí
      // porque ese mapa debe ser GLOBAL (todos los centros).
      // Eso lo gestiona fetchPendingCountsByCenter().

    } catch (error) {
      console.error('Error fetching requests:', error);
      setError('Error al cargar las solicitudes');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, type: string, newStatus: 'approved' | 'rejected') => {
    try {
      const table = type === 'time' ? 'time_requests' : 'planner_requests';

      const { error } = await supabase.from(table).update({ status: newStatus }).eq('id', requestId);

      if (error) throw error;

      setRequests((prev) =>
        prev.map((req) => (req.request_id === requestId ? { ...req, request_status: newStatus } : req))
      );

      if (newStatus !== 'pending') {
        setPendingRequestsCount((prev) => Math.max(0, prev - 1));
      }

      // refrescar lista + refrescar contadores globales para badges por centro
      await fetchRequests();
      await fetchPendingCountsByCenter();
    } catch (error) {
      console.error('Error updating request:', error);
      setError('Error al actualizar la solicitud');
    }
  };

  const handleExportExcel = () => {
    try {
      const dataToExport = requests.map((request) => ({
        Nombre: request.employee_name,
        Email: request.employee_email,
        'Centros de Trabajo': request.work_centers?.join(', ') || '',
        Delegación: request.delegation || '',
        'Tipo de Solicitud': getRequestTypeText(request.request_type),
        Estado: getStatusText(request.request_status),
        'Fecha de Solicitud': new Date(request.created_at).toLocaleString(),
        Detalles:
          request.request_type === 'time'
            ? `${new Date(request.details.datetime).toLocaleString()} - ${getEntryTypeText(request.details.entry_type)}`
            : `${request.details.planner_type} (${new Date(request.details.start_date).toLocaleDateString()} - ${new Date(
                request.details.end_date
              ).toLocaleDateString()})`,
        Comentario: request.details.comment || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Solicitudes');

      const fileName = `Solicitudes_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      setError('Error al exportar a Excel');
    }
  };

  const getRequestTypeText = (type: string) => {
    switch (type) {
      case 'time':
        return 'Fichaje';
      case 'planner':
        return 'Planificador';
      default:
        return type;
    }
  };

  const getStatusBadgeClasses = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Aprobada';
      case 'rejected':
        return 'Rechazada';
      case 'pending':
        return 'Pendiente';
      default:
        return status;
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

  const renderRequestDetails = (request: Request) => {
    switch (request.request_type) {
      case 'time':
        return (
          <>
            <p className="text-sm text-gray-600">
              <strong>Fecha y hora:</strong> {new Date(request.details.datetime).toLocaleString()}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Tipo:</strong> {getEntryTypeText(request.details.entry_type)}
            </p>
          </>
        );
      case 'planner':
        return (
          <>
            <p className="text-sm text-gray-600">
              <strong>Tipo:</strong> {request.details.planner_type}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Fecha inicio:</strong> {new Date(request.details.start_date).toLocaleDateString()}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Fecha fin:</strong> {new Date(request.details.end_date).toLocaleDateString()}
            </p>
          </>
        );
      default:
        return null;
    }
  };

  const filteredRequests = requests.filter(
    (request) =>
      request.employee_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      request.employee_email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!selectedWorkCenter && workCenters.length > 0) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Seleccionar Centro de Trabajo</h2>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workCenters.map((center) => (
                <button
                  key={center}
                  onClick={() => setSelectedWorkCenter(center)}
                  className="p-4 bg-white border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors relative"
                >
                  {center}
                  {(pendingRequestsByWorkCenter[center] || 0) > 0 && (
                    <span className="absolute top-0 right-0 bg-red-500 text-white rounded-full px-2 py-1 text-xs">
                      {pendingRequestsByWorkCenter[center]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <CalendarSignatureAlert />

        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
                Solicitudes
                {pendingRequestsCount > 0 && (
                  <span className="bg-red-500 text-white rounded-full px-2 py-1 text-xs">
                    {pendingRequestsCount}
                  </span>
                )}
              </h1>
              <p className="text-gray-600">Centro de Trabajo: {selectedWorkCenter}</p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => setSelectedWorkCenter('')}
                className="w-full px-4 py-2 text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cambiar Centro
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg ${
                filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Todas
            </button>

            <button
              onClick={() => setFilter('pending')}
              className={`px-4 py-2 rounded-lg ${
                filter === 'pending' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Pendientes
              {pendingRequestsCount > 0 && (
                <span className="ml-2 bg-red-500 text-white rounded-full px-2 py-1 text-xs">
                  {pendingRequestsCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setFilter('approved')}
              className={`px-4 py-2 rounded-lg ${
                filter === 'approved' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Aprobadas
            </button>

            <button
              onClick={() => setFilter('rejected')}
              className={`px-4 py-2 rounded-lg ${
                filter === 'rejected' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Rechazadas
            </button>
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="w-5 h-5" />
              Exportar a Excel
            </button>

            <div className="flex gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Inicio</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha Fin</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Buscar solicitudes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-64"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <p>Cargando solicitudes...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">No hay solicitudes que mostrar</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Empleado
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Detalles
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha Solicitud
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRequests.map((request) => (
                  <tr key={request.request_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{request.employee_name}</div>
                      <div className="text-sm text-gray-500">{request.employee_email}</div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">{getRequestTypeText(request.request_type)}</span>
                    </td>

                    <td className="px-6 py-4">
                      {renderRequestDetails(request)}
                      <p className="text-sm text-gray-500 mt-1">
                        <strong>Comentario:</strong> {request.details.comment || 'Ninguno'}
                      </p>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClasses(
                          request.request_status
                        )}`}
                      >
                        {getStatusText(request.request_status)}
                      </span>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(request.created_at).toLocaleString()}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      {request.request_status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleUpdateStatus(request.request_id, request.request_type, 'approved')}
                            className="p-1 text-green-600 hover:text-green-800"
                            title="Aprobar"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(request.request_id, request.request_type, 'rejected')}
                            className="p-1 text-red-600 hover:text-red-800"
                            title="Rechazar"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default SupervisorRequests;
