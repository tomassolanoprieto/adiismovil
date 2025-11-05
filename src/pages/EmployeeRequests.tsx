import React, { useState, useEffect } from 'react';
import { FileText, Clock, Activity, User, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';

type TimeEntryType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

interface TimeRequest {
  id: string;
  employee_id: string;
  datetime: string;
  entry_type: TimeEntryType;
  work_center: string;
  comment: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export default function EmployeeRequests() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time request state
  const [datetime, setDatetime] = useState('');
  const [comment, setComment] = useState('');
  const [entryType, setEntryType] = useState<TimeEntryType>('clock_in');
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('');
  const [timeRequests, setTimeRequests] = useState<TimeRequest[]>([]);

  useEffect(() => {
    fetchRequests();
    fetchWorkCenters();
  }, []);

  const fetchWorkCenters = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      const { data, error } = await supabase
        .from('employee_profiles')
        .select('work_centers')
        .eq('id', employeeId)
        .single();

      if (error) throw error;

      if (data?.work_centers) {
        setWorkCenters(data.work_centers);
        setSelectedWorkCenter(data.work_centers[0] || '');
      } else {
        console.warn('No se encontraron centros de trabajo para el empleado.');
        setWorkCenters([]);
        setSelectedWorkCenter('');
      }
    } catch (err) {
      console.error('Error fetching work centers:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los centros de trabajo');
    }
  };

  const fetchRequests = async () => {
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      // Fetch time requests
      const { data: timeData, error: timeError } = await supabase
        .from('time_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });

      if (timeError) throw timeError;
      setTimeRequests(timeData || []);

    } catch (err) {
      console.error('Error fetching requests:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar las solicitudes');
    } finally {
      setLoading(false);
    }
  };

  const handleTimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      let locationData: {
        location_latitude?: number;
        location_longitude?: number;
        location_accuracy?: number;
      } = {};

      if ('geolocation' in navigator) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            });
          });

          locationData = {
            location_latitude: position.coords.latitude,
            location_longitude: position.coords.longitude,
            location_accuracy: position.coords.accuracy
          };
        } catch (geoError) {
          console.warn('No se pudo obtener la ubicación GPS:', geoError);
        }
      }

      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        vendor: navigator.vendor,
        language: navigator.language,
        languages: navigator.languages,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        screenColorDepth: window.screen.colorDepth,
        devicePixelRatio: window.devicePixelRatio,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        maxTouchPoints: navigator.maxTouchPoints,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as any).deviceMemory,
        connection: (navigator as any).connection ? {
          effectiveType: (navigator as any).connection.effectiveType,
          downlink: (navigator as any).connection.downlink,
          rtt: (navigator as any).connection.rtt
        } : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: new Date().toISOString()
      };

      const { error: insertError } = await supabase
        .from('time_requests')
        .insert([{
          employee_id: employeeId,
          datetime: new Date(datetime).toISOString(),
          entry_type: entryType,
          work_center: selectedWorkCenter,
          comment,
          status: 'pending',
          ...locationData,
          device_info: deviceInfo
        }]);

      if (insertError) throw insertError;

      setDatetime('');
      setComment('');
      setEntryType('clock_in');
      await fetchRequests();

    } catch (err) {
      console.error('Error submitting time request:', err);
      setError(err instanceof Error ? err.message : 'Error al enviar la solicitud');
    } finally {
      setLoading(false);
    }
  };

  const getEntryTypeText = (type: TimeEntryType) => {
    switch (type) {
      case 'clock_in': return 'Entrada';
      case 'break_start': return 'Pausa';
      case 'break_end': return 'Volver';
      case 'clock_out': return 'Salida';
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
      default:
        return 'Pendiente';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-6">Solicitudes</h2>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}
        
        <div className="mb-8">
          <h3 className="text-xl font-semibold mb-6">Incidencia de Fichaje</h3>
            <form onSubmit={handleTimeSubmit} className="space-y-6 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha y hora inicio
                </label>
                <input
                  type="datetime-local"
                  value={datetime}
                  onChange={(e) => setDatetime(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Centro de trabajo
                </label>
                <select
                  value={selectedWorkCenter}
                  onChange={(e) => setSelectedWorkCenter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  {workCenters.map((center) => (
                    <option key={center} value={center}>
                      {center}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de fichaje
                </label>
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as TimeEntryType)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="clock_in">Entrada</option>
                  <option value="break_start">Pausa</option>
                  <option value="break_end">Volver</option>
                  <option value="clock_out">Salida</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comentario
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={4}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar Solicitud'}
              </button>
            </form>
        </div>

        <div>
          <h3 className="text-xl font-semibold mb-6">Historial de Incidencias</h3>

          <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha y Hora
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tipo
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Centro de trabajo
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Comentario
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center">
                        Cargando solicitudes...
                      </td>
                    </tr>
                  ) : timeRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center">
                        No hay solicitudes para mostrar
                      </td>
                    </tr>
                  ) : (
                    timeRequests.map((request) => (
                      <tr key={request.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {new Date(request.datetime).toLocaleString('es-ES', {
                            timeZone: 'Europe/Madrid',
                            hour12: false,
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getEntryTypeText(request.entry_type)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {request.work_center || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeClasses(request.status)}`}>
                            {getStatusText(request.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {request.comment}
                        </td>
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