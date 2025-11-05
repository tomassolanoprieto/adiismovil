import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  LogOut, 
  Play, 
  Pause, 
  RotateCcw, 
  LogIn, 
  Clock, 
  FileText, 
  User 
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import EmployeeHistory from './EmployeeHistory';
import EmployeeRequests from './EmployeeRequests';
import EmployeeCalendar from './EmployeeCalendar';
import EmployeeProfile from './EmployeeProfile';

function TimeControl() {
  const [currentState, setCurrentState] = useState('initial');
  const [loading, setLoading] = useState(false);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string | null>(null);
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [showWorkCenterSelector, setShowWorkCenterSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geolocation, setGeolocation] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const employeeId = localStorage.getItem('employeeId');
        if (!employeeId) {
          throw new Error('No se encontró el ID del empleado');
        }

        const { data: employeeData, error: employeeError } = await supabase
          .from('employee_profiles')
          .select('work_centers')
          .eq('id', employeeId)
          .single();

        if (employeeError) throw employeeError;
        if (employeeData?.work_centers) {
          setWorkCenters(employeeData.work_centers);
          if (employeeData.work_centers.length === 1) {
            setSelectedWorkCenter(employeeData.work_centers[0]);
          }
        }

        const { data: lastEntry, error: lastEntryError } = await supabase
          .from('time_entries')
          .select('*')
          .eq('employee_id', employeeId)
          .eq('is_active', true)
          .order('timestamp', { ascending: false })
          .limit(1);

        if (lastEntryError) throw lastEntryError;

        if (lastEntry && lastEntry.length > 0) {
          const lastEntryType = lastEntry[0].entry_type;
          setSelectedWorkCenter(lastEntry[0].work_center);

          switch (lastEntryType) {
            case 'clock_in':
              setCurrentState('working');
              break;
            case 'break_start':
              setCurrentState('paused');
              break;
            case 'break_end':
              setCurrentState('working');
              break;
            case 'clock_out':
              setCurrentState('initial');
              setSelectedWorkCenter(null);
              break;
            default:
              setCurrentState('initial');
              break;
          }
        } else {
          setCurrentState('initial');
        }
      } catch (err) {
        console.error('Error checking session:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar los datos');
      }
    };

    checkActiveSession();
  }, []);

  const getGeolocation = async () => {
    if (!navigator.geolocation) {
      throw new Error('Tu navegador no soporta geolocalización. Necesitas permitir el acceso a la ubicación para poder fichar.');
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { timeout: 10000, enableHighAccuracy: true }
        );
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (error: any) {
      if (error.code === 1) {
        throw new Error('Debes permitir el acceso a tu ubicación GPS para poder fichar. Por favor, acepta los permisos de ubicación en tu navegador.');
      } else if (error.code === 2) {
        throw new Error('No se pudo obtener tu ubicación. Verifica que el GPS esté activado en tu dispositivo.');
      } else if (error.code === 3) {
        throw new Error('Se agotó el tiempo de espera al obtener tu ubicación. Inténtalo nuevamente.');
      } else {
        throw new Error('Error al obtener la ubicación GPS. Por favor, inténtalo de nuevo.');
      }
    }
  };

  const handleTimeEntry = async (entryType: 'clock_in' | 'break_start' | 'break_end' | 'clock_out') => {
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      if (entryType === 'clock_in') {
        if (workCenters.length === 0) {
          throw new Error('No tienes centros de trabajo asignados');
        }
        if (workCenters.length > 1 && !selectedWorkCenter) {
          setShowWorkCenterSelector(true);
          return;
        }
      }

      let locationData: {
        latitude?: number;
        longitude?: number;
        location_latitude?: number;
        location_longitude?: number;
        location_accuracy?: number;
      } = {};

      try {
        const { latitude, longitude } = await getGeolocation();
        setGeolocation({ latitude, longitude });

        if ('geolocation' in navigator) {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0
            });
          });

          locationData = {
            latitude,
            longitude,
            location_latitude: position.coords.latitude,
            location_longitude: position.coords.longitude,
            location_accuracy: position.coords.accuracy
          };
        } else {
          locationData = { latitude, longitude };
        }
      } catch (geoError) {
        console.warn('No se pudo obtener la ubicación GPS:', geoError);
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

      const entryData = {
        employee_id: employeeId,
        entry_type: entryType,
        timestamp: new Date().toISOString(),
        ...locationData,
        is_active: true,
        work_center: entryType === 'clock_in' ? selectedWorkCenter || workCenters[0] : null,
        device_info: deviceInfo
      };

      const { error: insertError } = await supabase
        .from('time_entries')
        .insert([entryData]);

      if (insertError) throw insertError;

      switch (entryType) {
        case 'clock_in': setCurrentState('working'); break;
        case 'break_start': setCurrentState('paused'); break;
        case 'break_end': setCurrentState('working'); break;
        case 'clock_out': setCurrentState('initial'); break;
      }

    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'Error al registrar');
    } finally {
      setLoading(false);
    }
  };

  const handleClockInClick = () => {
    if (workCenters.length === 0) {
      setError('No tienes centros de trabajo asignados');
      return;
    }

    if (workCenters.length === 1) {
      setSelectedWorkCenter(workCenters[0]);
      handleTimeEntry('clock_in');
    } else {
      setShowWorkCenterSelector(true);
    }
  };

  const handleSelectWorkCenter = (center: string) => {
    setSelectedWorkCenter(center);
    setShowWorkCenterSelector(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="space-y-6 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Control de Tiempo</h2>

          <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
            <p className="text-sm text-blue-900 leading-relaxed">
              <strong className="font-semibold">Obligación Legal de Registro Horario:</strong> Conforme al artículo 34.9 del Estatuto de los Trabajadores, es obligatorio registrar la jornada laboral diaria de cada trabajador, incluyendo el horario concreto de inicio y finalización. Este registro debe realizarse de forma exacta y veraz.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
              {error}
            </div>
          )}

          {showWorkCenterSelector && currentState === 'initial' && (
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-700 mb-4">Selecciona el centro de trabajo:</h3>
              <div className="space-y-3">
                {workCenters.map(center => (
                  <button
                    key={center}
                    onClick={() => handleSelectWorkCenter(center)}
                    className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium py-3 px-4 rounded-lg transition-colors"
                  >
                    {center}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleClockInClick}
              disabled={currentState !== 'initial' || loading || (workCenters.length > 1 && !selectedWorkCenter)}
              className={`w-full ${
                currentState === 'initial'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <LogIn className="h-6 w-6" />
              <span className="text-xl">Entrada</span>
            </button>

            <button
              onClick={() => handleTimeEntry('break_start')}
              disabled={currentState !== 'working' || loading}
              className={`w-full ${
                currentState === 'working'
                  ? 'bg-orange-500 hover:bg-orange-600'
                  : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <Pause className="h-6 w-6" />
              <span className="text-xl">Pausa</span>
            </button>

            <button
              onClick={() => handleTimeEntry('break_end')}
              disabled={currentState !== 'paused' || loading}
              className={`w-full ${
                currentState === 'paused'
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <RotateCcw className="h-6 w-6" />
              <span className="text-xl">Volver</span>
            </button>

            <button
              onClick={() => handleTimeEntry('clock_out')}
              disabled={currentState === 'initial' || loading}
              className={`w-full ${
                currentState !== 'initial'
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <LogOut className="h-6 w-6" />
              <span className="text-xl">Salida</span>
            </button>
          </div>

          {selectedWorkCenter && currentState !== 'initial' && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <p className="text-green-700 font-medium">
                Centro de trabajo actual: {selectedWorkCenter}
              </p>
            </div>
          )}

          {geolocation.latitude && geolocation.longitude && (
            <div className="mt-4 p-4 bg-purple-50 rounded-lg">
              <p className="text-purple-700 font-medium">
                Ubicación registrada: Latitud {geolocation.latitude}, Longitud {geolocation.longitude}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeeDashboard() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [calendarSignaturePending, setCalendarSignaturePending] = useState<boolean>(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Carga inicial: email, id, nombre y estado de firma (solo calendar_report_signed)
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email || null;
      setUserEmail(email);

      try {
        // 1) Id guardado en localStorage
        const storedId = localStorage.getItem('employeeId');
        if (storedId) {
          setEmployeeId(storedId);
          const { data, error } = await supabase
            .from('employee_profiles')
            .select('fiscal_name, calendar_signature_requested, calendar_report_signed')
            .eq('id', storedId)
            .single();
          if (!error && data) {
            setEmployeeName(data.fiscal_name);
            // Mostrar aviso SOLO si se solicitó firma Y NO está firmado
            const shouldShowPending = data.calendar_signature_requested === true && data.calendar_report_signed !== true;
            setCalendarSignaturePending(shouldShowPending);
            return;
          }
        }

        // 2) Fallback por email (y guardamos id para la suscripción)
        if (email) {
          const { data, error } = await supabase
            .from('employee_profiles')
            .select('id, fiscal_name, calendar_signature_requested, calendar_report_signed')
            .eq('email', email)
            .single();
          if (!error && data) {
            setEmployeeId(data.id);
            setEmployeeName(data.fiscal_name);
            // Mostrar aviso SOLO si se solicitó firma Y NO está firmado
            const shouldShowPending = data.calendar_signature_requested === true && data.calendar_report_signed !== true;
            setCalendarSignaturePending(shouldShowPending);
          }
        }
      } catch (e) {
        console.error('No se pudo obtener el perfil del empleado:', e);
      }
    };
    getUser();
  }, []);

  // Suscripción en tiempo real SOLO al campo calendar_report_signed
  useEffect(() => {
    if (!employeeId) return;

    const channel = supabase
      .channel('employee_calendar_signed_' + employeeId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'employee_profiles',
          filter: `id=eq.${employeeId}`,
        },
        (payload) => {
          const row: any = payload.new || {};
          if (row.fiscal_name) setEmployeeName(row.fiscal_name as string);
          // Mostrar aviso SOLO si se solicitó firma Y NO está firmado
          const shouldShowPending = row.calendar_signature_requested === true && row.calendar_report_signed !== true;
          setCalendarSignaturePending(shouldShowPending);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('employeeId');
    navigate('/login/empleado');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <div className="flex items-center">
                <Clock className="h-8 w-8 text-blue-600 mr-2" />
                <span className="text-xl font-bold text-gray-900">Portal Trabajador/a</span>
              </div>
              <Link
                to="/empleado/fichar"
                className={`px-3 py-2 font-medium ${
                  location.pathname === '/empleado' || location.pathname === '/empleado/fichar'
                    ? 'text-blue-600'
                    : 'text-gray-900 hover:text-gray-700'
                }`}
              >
                Fichar
              </Link>
              <Link
                to="/empleado/historial"
                className={`px-3 py-2 font-medium ${
                  location.pathname === '/empleado/historial'
                    ? 'text-blue-600'
                    : 'text-gray-900 hover:text-gray-700'
                }`}
              >
                Historial
              </Link>
              <Link
                to="/empleado/solicitudes"
                className={`px-3 py-2 font-medium ${
                  location.pathname === '/empleado/solicitudes'
                    ? 'text-blue-600'
                    : 'text-gray-900 hover:text-gray-700'
                }`}
              >
                Solicitudes Modificación de Fichaje
              </Link>
              <Link
                to="/empleado/calendario"
                className={`px-3 py-2 font-medium ${
                  location.pathname === '/empleado/calendario'
                    ? 'text-blue-600'
                    : 'text-gray-900 hover:text-gray-700'
                }`}
              >
                Calendario
              </Link>
              <Link
                to="/empleado/perfil"
                className={`px-3 py-2 font-medium ${
                  location.pathname === '/empleado/perfil'
                    ? 'text-blue-600'
                    : 'text-gray-900 hover:text-gray-700'
                }`}
              >
                Perfil
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <User className="h-5 w-5 text-gray-500" />
                <div className="leading-tight text-right">
                  <div className="text-sm font-medium text-gray-900">
                    {employeeName ?? 'Empleado/a'}
                  </div>
                  <div className="text-xs text-gray-600">
                    {userEmail ?? ''}
                  </div>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors duration-200"
              >
                <LogOut className="h-5 w-5 mr-2" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Aviso: SOLO cuando calendar_report_signed NO es TRUE */}
      {calendarSignaturePending && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="bg-orange-500 text-white p-4 rounded-lg shadow-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6" />
              <div>
                <h3 className="font-semibold">Firma de Calendario Pendiente</h3>
                <p className="text-sm">Tu empresa ha solicitado que firmes el calendario anual. Por favor completa este proceso.</p>
              </div>
            </div>
            <Link
              to="/empleado/calendario"
              className="px-4 py-2 bg-white text-orange-600 rounded-lg hover:bg-orange-50 transition-colors font-medium whitespace-nowrap"
            >
              Firmar Ahora
            </Link>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/" element={<TimeControl />} />
        <Route path="/fichar" element={<TimeControl />} />
        <Route path="/historial" element={<EmployeeHistory />} />
        <Route path="/solicitudes" element={<EmployeeRequests />} />
        <Route path="/calendario" element={<EmployeeCalendar />} />
        <Route path="/perfil" element={<EmployeeProfile />} />
      </Routes>
    </div>
  );
}

export default EmployeeDashboard;
