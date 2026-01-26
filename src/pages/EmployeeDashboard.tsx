import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, useLocation } from 'react-router-dom';
import {
  LogIn,
  Pause,
  RotateCcw,
  LogOut,
  Clock,
  FileText,
  History,
  Calendar as CalendarIcon,
  User
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import EmployeeHistory from './EmployeeHistory';
import EmployeeRequests from './EmployeeRequests';
import EmployeeCalendar from './EmployeeCalendar';
import EmployeeProfile from './EmployeeProfile';
import MobileNav from '../components/MobileNav';

type EntryType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

type GeoResult = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: 'gps_high' | 'gps_low' | 'cache' | 'fallback';
  errorMessage?: string;
  timestampISO: string;
};

function TimeControl() {
  const [currentState, setCurrentState] = useState<'initial' | 'working' | 'paused'>('initial');
  const [loading, setLoading] = useState(false);
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string | null>(null);
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [showWorkCenterSelector, setShowWorkCenterSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [geolocation, setGeolocation] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  // =========================
  // Helpers: Work Center (SIEMPRE)
  // =========================
  const resolveWorkCenterForEntry = async (employeeId: string): Promise<string> => {
    // 1) Si ya fue seleccionado en UI
    if (selectedWorkCenter) return selectedWorkCenter;

    // 2) Si ya cargamos centros asignados
    if (workCenters && workCenters.length > 0) return workCenters[0];

    // 3) Perfil (fresh)
    const { data: employeeData, error: employeeError } = await supabase
      .from('employee_profiles')
      .select('work_centers')
      .eq('id', employeeId)
      .single();

    if (!employeeError && employeeData?.work_centers?.length) {
      const centers = employeeData.work_centers as string[];
      setWorkCenters(centers);
      if (centers.length === 1) setSelectedWorkCenter(centers[0]);
      return centers[0];
    }

    // 4) Último fichaje (por si perfil está vacío)
    const { data: lastActive, error: lastActiveError } = await supabase
      .from('time_entries')
      .select('work_center')
      .eq('employee_id', employeeId)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (!lastActiveError && lastActive && lastActive.length > 0 && lastActive[0]?.work_center) {
      const wc = lastActive[0].work_center as string;
      setSelectedWorkCenter(wc);
      return wc;
    }

    throw new Error('No tienes centros de trabajo asignados. Contacta con tu empresa.');
  };

  // =========================
  // Helpers: Geolocation (SIEMPRE)
  // =========================
  const GEO_CACHE_KEY = 'lastKnownGeolocation';

  const readCachedGeo = (): GeoResult | null => {
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GeoResult;
      if (
        typeof parsed?.latitude === 'number' &&
        typeof parsed?.longitude === 'number' &&
        typeof parsed?.timestampISO === 'string'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  const writeCachedGeo = (geo: GeoResult) => {
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo));
    } catch {
      // ignore
    }
  };

  const getPosition = (options: PositionOptions) =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible en el navegador.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });

  /**
   * Devuelve SIEMPRE coords para guardar:
   * - GPS alta precisión
   * - GPS baja precisión
   * - cache
   * - fallback 0,0 (SIN romper fichaje)
   */
  const getGeolocationSafe = async (): Promise<GeoResult> => {
    const nowISO = new Date().toISOString();

    // 1) High accuracy
    try {
      const pos = await getPosition({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });

      const geo: GeoResult = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        source: 'gps_high',
        timestampISO: nowISO,
      };
      writeCachedGeo(geo);
      return geo;
    } catch (e1: any) {
      // 2) Low accuracy
      try {
        const pos = await getPosition({
          enableHighAccuracy: false,
          timeout: 20000,
          maximumAge: 60000,
        });

        const geo: GeoResult = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
          source: 'gps_low',
          timestampISO: nowISO,
        };
        writeCachedGeo(geo);
        return geo;
      } catch (e2: any) {
        // 3) Cache
        const cached = readCachedGeo();
        if (cached) {
          return {
            ...cached,
            source: 'cache',
            errorMessage:
              (e2 && (e2.message || e2.toString?.())) ||
              (e1 && (e1.message || e1.toString?.())) ||
              'No se pudo obtener GPS, se usa última ubicación conocida.',
            timestampISO: nowISO,
          };
        }

        // 4) Fallback
        return {
          latitude: 0,
          longitude: 0,
          accuracy: null,
          source: 'fallback',
          errorMessage:
            (e2 && (e2.message || e2.toString?.())) ||
            (e1 && (e1.message || e1.toString?.())) ||
            'No se pudo obtener GPS y no existe ubicación en caché.',
          timestampISO: nowISO,
        };
      }
    }
  };

  // =========================
  // Init: cargar centros + recuperar estado
  // =========================
  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const employeeId = localStorage.getItem('employeeId');
        if (!employeeId) throw new Error('No se encontró el ID del empleado');

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
          const lastEntryType = lastEntry[0].entry_type as EntryType;

          if (lastEntry[0].work_center) setSelectedWorkCenter(lastEntry[0].work_center);

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

  // =========================
  // Action: registrar fichaje (SIEMPRE centro + SIEMPRE ubicación)
  // =========================
  const handleTimeEntry = async (entryType: EntryType) => {
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      // Para clock_in: si hay varios centros y no eligió, mostramos selector
      if (entryType === 'clock_in') {
        if (workCenters.length === 0) {
          // Intentamos resolver para no fallar por “carga tardía”
          await resolveWorkCenterForEntry(employeeId);
        }
        if (workCenters.length > 1 && !selectedWorkCenter) {
          setShowWorkCenterSelector(true);
          return;
        }
      }

      // Centro SIEMPRE
      const workCenterToUse = await resolveWorkCenterForEntry(employeeId);

      // Ubicación SIEMPRE (sin romper fichaje)
      const geo = await getGeolocationSafe();
      setGeolocation({ latitude: geo.latitude, longitude: geo.longitude });

      // Compatibilidad con columnas existentes
      const locationData: {
        latitude: number;
        longitude: number;
        location_latitude: number;
        location_longitude: number;
        location_accuracy: number | null;
      } = {
        latitude: geo.latitude,
        longitude: geo.longitude,
        location_latitude: geo.latitude,
        location_longitude: geo.longitude,
        location_accuracy: geo.accuracy,
      };

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
        connection: (navigator as any).connection
          ? {
              effectiveType: (navigator as any).connection.effectiveType,
              downlink: (navigator as any).connection.downlink,
              rtt: (navigator as any).connection.rtt,
            }
          : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: new Date().toISOString(),

        // Audit (no requiere cambios de esquema DB, va dentro de device_info)
        geoAudit: {
          source: geo.source,
          accuracy: geo.accuracy,
          errorMessage: geo.errorMessage || null,
          recordedAt: geo.timestampISO,
        },
      };

      // Importante: work_center SIEMPRE para TODOS los tipos
      const entryData = {
        employee_id: employeeId,
        entry_type: entryType,
        timestamp: new Date().toISOString(),
        ...locationData,
        is_active: true,
        work_center: workCenterToUse,
        device_info: deviceInfo,
      };

      const { error: insertError } = await supabase.from('time_entries').insert([entryData]);
      if (insertError) throw insertError;

      // Estado UI
      switch (entryType) {
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
      }

      // Avisos sin bloquear
      if (geo.source === 'cache') {
        setError('Aviso: no se pudo obtener GPS en tiempo real; se registró la última ubicación conocida.');
      } else if (geo.source === 'fallback') {
        setError('Aviso: no se pudo obtener GPS; se registró ubicación de respaldo (0,0). Revisa permisos/GPS.');
      }
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'Error al registrar');
    } finally {
      setLoading(false);
    }
  };

  const handleClockInClick = async () => {
    try {
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      if (workCenters.length === 0) {
        await resolveWorkCenterForEntry(employeeId);
      }

      if (workCenters.length === 1) {
        setSelectedWorkCenter(workCenters[0]);
        handleTimeEntry('clock_in');
      } else {
        setShowWorkCenterSelector(true);
      }
    } catch (e: any) {
      setError(e?.message || 'No tienes centros de trabajo asignados');
    }
  };

  // ✅ MISMA estética: solo añadimos la acción (sin cambiar estilos)
  const handleSelectWorkCenter = async (center: string) => {
    setSelectedWorkCenter(center);
    setShowWorkCenterSelector(false);
    setError(null);

    // Al elegir centro en el selector, fichamos entrada inmediatamente
    await handleTimeEntry('clock_in');
  };

  const getStateText = () => {
    switch (currentState) {
      case 'working':
        return 'Trabajando';
      case 'paused':
        return 'En Pausa';
      default:
        return 'Fuera de Turno';
    }
  };

  const getStateColor = () => {
    switch (currentState) {
      case 'working':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'paused':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="px-4 pt-6 pb-20">
      <div className="max-w-md mx-auto space-y-4">
        <div className={`p-4 rounded-xl border-2 ${getStateColor()}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Estado actual:</span>
            <span className="text-lg font-bold">{getStateText()}</span>
          </div>
        </div>

        {selectedWorkCenter && currentState !== 'initial' && (
          <div className="p-4 bg-blue-50 rounded-xl border-2 border-blue-200">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <div className="flex-1">
                <p className="text-xs text-blue-600 font-medium">Centro de trabajo</p>
                <p className="text-sm font-bold text-blue-900">{selectedWorkCenter}</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {showWorkCenterSelector && currentState === 'initial' && (
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-gray-900">Selecciona el centro:</h3>
            {workCenters.map((center) => (
              <button
                key={center}
                onClick={() => handleSelectWorkCenter(center)}
                className="w-full bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 font-medium py-3 px-4 rounded-xl transition-colors touch-manipulation"
              >
                {center}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleClockInClick}
            disabled={currentState !== 'initial' || loading || (workCenters.length > 1 && !selectedWorkCenter)}
            className={`w-full ${
              currentState === 'initial'
                ? 'bg-green-600 hover:bg-green-700 active:bg-green-800'
                : 'bg-gray-300'
            } text-white font-bold py-5 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 shadow-lg touch-manipulation`}
          >
            <LogIn className="h-7 w-7" />
            <span className="text-xl">Entrada</span>
          </button>

          <button
            onClick={() => handleTimeEntry('break_start')}
            disabled={currentState !== 'working' || loading}
            className={`w-full ${
              currentState === 'working'
                ? 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700'
                : 'bg-gray-300'
            } text-white font-bold py-5 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 shadow-lg touch-manipulation`}
          >
            <Pause className="h-7 w-7" />
            <span className="text-xl">Pausa</span>
          </button>

          <button
            onClick={() => handleTimeEntry('break_end')}
            disabled={currentState !== 'paused' || loading}
            className={`w-full ${
              currentState === 'paused'
                ? 'bg-green-500 hover:bg-green-600 active:bg-green-700'
                : 'bg-gray-300'
            } text-white font-bold py-5 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 shadow-lg touch-manipulation`}
          >
            <RotateCcw className="h-7 w-7" />
            <span className="text-xl">Volver</span>
          </button>

          <button
            onClick={() => handleTimeEntry('clock_out')}
            disabled={currentState === 'initial' || loading}
            className={`w-full ${
              currentState !== 'initial'
                ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
                : 'bg-gray-300'
            } text-white font-bold py-5 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all duration-200 disabled:opacity-50 shadow-lg touch-manipulation`}
          >
            <LogOut className="h-7 w-7" />
            <span className="text-xl">Salida</span>
          </button>
        </div>

        {/* ✅ Hyperlink sin cambiar estética: mismo “card” que ya usas */}
        <a
          href="https://elearning.trama.org/login/loginPage"
          target="_blank"
          rel="noopener noreferrer"
          className="block p-4 bg-blue-50 rounded-xl border-2 border-blue-200 touch-manipulation"
        >
          <div className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            <div className="flex-1">
              <p className="text-xs text-blue-600 font-medium">Formación</p>
              <p className="text-sm font-bold text-blue-900">Accede a Trama e-learning</p>
            </div>
          </div>
        </a>

        {/* Mostrar ubicación registrada (opcional, pero útil en móvil) */}
        {geolocation.latitude !== null && geolocation.longitude !== null && (
          <div className="p-4 bg-purple-50 rounded-xl border-2 border-purple-200">
            <p className="text-xs text-purple-700 font-medium">
              Ubicación registrada: Lat {geolocation.latitude}, Lon {geolocation.longitude}
            </p>
            {geolocation.latitude === 0 && geolocation.longitude === 0 && (
              <p className="text-xs text-purple-700 mt-1">
                Nota: ubicación de respaldo (0,0). Revisa permisos/GPS para registrar la ubicación real.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded-lg">
          <p className="text-xs text-blue-900 leading-relaxed">
            <strong className="font-semibold">Obligación Legal:</strong> Conforme al artículo 34.9 del Estatuto de los Trabajadores, es obligatorio registrar la jornada laboral diaria de cada trabajador.
          </p>
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

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email || null;
      setUserEmail(email);

      try {
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
            const shouldShowPending = data.calendar_signature_requested === true && data.calendar_report_signed !== true;
            setCalendarSignaturePending(shouldShowPending);
            return;
          }
        }

        if (email) {
          const { data, error } = await supabase
            .from('employee_profiles')
            .select('id, fiscal_name, calendar_signature_requested, calendar_report_signed')
            .eq('email', email)
            .single();
          if (!error && data) {
            setEmployeeId(data.id);
            setEmployeeName(data.fiscal_name);
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

  const navItems = [
    { path: '/empleado', icon: Clock, label: 'Fichar' },
    { path: '/empleado/historial', icon: History, label: 'Historial' },
    { path: '/empleado/solicitudes', icon: FileText, label: 'Solicitudes' },
    { path: '/empleado/calendario', icon: CalendarIcon, label: 'Calendario' },
    { path: '/empleado/perfil', icon: User, label: 'Perfil' },
  ];

  // (location se mantiene por si MobileNav lo usa internamente; no lo tocamos)
  void location;

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <MobileHeader
        title="Trabajador/a"
        subtitle={employeeName || undefined}
        userName={employeeName || undefined}
        userEmail={userEmail || undefined}
        onLogout={handleLogout}
        icon={<Clock className="h-6 w-6 text-green-600" />}
      />

      <div className="pt-20">
        {calendarSignaturePending && (
          <div className="mx-4 mt-4 bg-orange-500 text-white p-4 rounded-xl shadow-lg">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-sm">Firma Pendiente</h3>
                <p className="text-xs mt-1">Debes firmar el calendario anual</p>
              </div>
              <button
                onClick={() => navigate('/empleado/calendario')}
                className="px-3 py-2 bg-white text-orange-600 rounded-lg text-sm font-medium whitespace-nowrap touch-manipulation"
              >
                Firmar
              </button>
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

      <MobileNav items={navItems} />
    </div>
  );
}

export default EmployeeDashboard;
