import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LogOut, Pause, RotateCcw, LogIn, Clock, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MobileNav from '../components/MobileNav';
import EmployeeHistory from './EmployeeHistory';
import EmployeeRequests from './EmployeeRequests';
import EmployeeCalendar from './EmployeeCalendar';
import EmployeeProfile from './EmployeeProfile';

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

  // -------------------- Work Centers helpers (como referencia) --------------------
  const normalizeWorkCenters = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
    if (typeof raw === 'string') return [raw];
    return [];
  };

  const tryParseJsonArray = (value: string): any[] | null => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const ensureWorkCentersIsArrayInDB = async (employeeId: string) => {
    const { data, error } = await supabase
      .from('employee_profiles')
      .select('work_centers')
      .eq('id', employeeId)
      .single();

    if (error) return;

    const raw = (data as any)?.work_centers;

    if (Array.isArray(raw)) return;

    let fixedArray: any[] = [];

    if (typeof raw === 'string') {
      const parsed = tryParseJsonArray(raw);
      fixedArray = parsed ?? [raw];
    } else if (raw !== null && raw !== undefined) {
      fixedArray = [raw];
    } else {
      fixedArray = [];
    }

    // Intento A: guardar como array real
    let upErr = (
      await supabase
        .from('employee_profiles')
        .update({ work_centers: fixedArray })
        .eq('id', employeeId)
    ).error;

    // Intento B: si falla, guardar como JSON string
    if (upErr) {
      upErr = (
        await supabase
          .from('employee_profiles')
          .update({ work_centers: JSON.stringify(fixedArray) })
          .eq('id', employeeId)
      ).error;
    }

    // Verificación final
    const { data: check, error: checkErr } = await supabase
      .from('employee_profiles')
      .select('work_centers')
      .eq('id', employeeId)
      .single();

    if (checkErr) return;

    const finalRaw = (check as any)?.work_centers;

    if (!Array.isArray(finalRaw)) {
      throw new Error(
        'No se puede fichar: el campo work_centers del perfil está guardado como valor simple (scalar) y una policy/trigger espera un array. ' +
          'Debe corregirse en BD (o permitir update del perfil).'
      );
    }
  };

  const resolveWorkCenterForEntry = async (employeeId: string): Promise<string> => {
    if (selectedWorkCenter) return selectedWorkCenter;
    if (workCenters && workCenters.length > 0) return workCenters[0];

    const { data: employeeData, error: employeeError } = await supabase
      .from('employee_profiles')
      .select('work_centers')
      .eq('id', employeeId)
      .single();

    if (!employeeError && employeeData?.work_centers !== undefined) {
      const centers = normalizeWorkCenters(employeeData.work_centers);
      if (centers.length) {
        setWorkCenters(centers);
        if (centers.length === 1) setSelectedWorkCenter(centers[0]);
        return centers[0];
      }
    }

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

  // -------------------- Geolocation helpers (como referencia) --------------------
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

  const getPosition = (options: PositionOptions) => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible en el navegador.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  };

  const getGeolocationSafe = async (): Promise<GeoResult> => {
    const nowISO = new Date().toISOString();

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

  // -------------------- init: active session + centers --------------------
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
        if (employeeData?.work_centers !== undefined) {
          const centers = normalizeWorkCenters(employeeData.work_centers);
          setWorkCenters(centers);
          if (centers.length === 1) setSelectedWorkCenter(centers[0]);
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

  // -------------------- main: handle entry (misma lógica referencia) --------------------
  const handleTimeEntry = async (entryType: EntryType, workCenterOverride?: string) => {
    try {
      setLoading(true);
      setError(null);

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      await ensureWorkCentersIsArrayInDB(employeeId);

      if (entryType === 'clock_in') {
        if (workCenters.length === 0) {
          await resolveWorkCenterForEntry(employeeId);
        }
        if (workCenters.length > 1 && !workCenterOverride && !selectedWorkCenter) {
          setShowWorkCenterSelector(true);
          return;
        }
      }

      const workCenterToUse = workCenterOverride ?? (await resolveWorkCenterForEntry(employeeId));

      const geo = await getGeolocationSafe();
      setGeolocation({ latitude: geo.latitude, longitude: geo.longitude });

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
        geoAudit: {
          source: geo.source,
          accuracy: geo.accuracy,
          errorMessage: geo.errorMessage || null,
          recordedAt: geo.timestampISO,
        },
      };

      const entryData = {
        employee_id: employeeId,
        entry_type: entryType,
        timestamp: new Date().toISOString(),
        ...locationData,
        is_active: true,
        work_center: workCenterToUse,
        device_info: deviceInfo,
      };

      let insertErr: any = null;

      // Intento 1: work_center string
      {
        const { error } = await supabase
          .from('time_entries')
          .insert([{ ...entryData, work_center: workCenterToUse }]);
        insertErr = error;
      }

      // Intento 2: si falla por scalar/array
      if (insertErr?.code === '22023') {
        const { error } = await supabase
          .from('time_entries')
          .insert([{ ...entryData, work_center: [workCenterToUse] } as any]);
        insertErr = error;
      }

      if (insertErr) throw insertErr;

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

      if (workCenters.length === 0) {
        const employeeId = localStorage.getItem('employeeId');
        if (!employeeId) throw new Error('No se encontró el ID del empleado');
        await resolveWorkCenterForEntry(employeeId);
      }

      if (workCenters.length === 1) {
        setSelectedWorkCenter(workCenters[0]);
        await handleTimeEntry('clock_in');
        return;
      }

      setShowWorkCenterSelector(true);
    } catch (e: any) {
      setError(e?.message || 'No tienes centros de trabajo asignados');
    }
  };

  const handleSelectWorkCenter = async (center: string) => {
    setSelectedWorkCenter(center);
    setShowWorkCenterSelector(false);
    setError(null);

    // fichar entrada con override (sin depender del state inmediato)
    await handleTimeEntry('clock_in', center);
  };

  // -------------------- UI (MISMA estética de tu página móvil) --------------------
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="space-y-6 max-w-md mx-auto">
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Control de Tiempo</h2>

          <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
            <p className="text-sm text-blue-900 leading-relaxed">
              <strong className="font-semibold">Obligación Legal de Registro Horario:</strong> Conforme al artículo 34.9 del
              Estatuto de los Trabajadores, es obligatorio registrar la jornada laboral diaria de cada trabajador,
              incluyendo el horario concreto de inicio y finalización. Este registro debe realizarse de forma exacta y veraz.
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
                {workCenters.map((center) => (
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
              disabled={currentState !== 'initial' || loading}
              className={`w-full ${
                currentState === 'initial' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <LogIn className="h-6 w-6" />
              <span className="text-xl">Entrada</span>
            </button>

            <button
              onClick={() => handleTimeEntry('break_start')}
              disabled={currentState !== 'working' || loading}
              className={`w-full ${
                currentState === 'working' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <Pause className="h-6 w-6" />
              <span className="text-xl">Pausa</span>
            </button>

            <button
              onClick={() => handleTimeEntry('break_end')}
              disabled={currentState !== 'paused' || loading}
              className={`w-full ${
                currentState === 'paused' ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <RotateCcw className="h-6 w-6" />
              <span className="text-xl">Volver</span>
            </button>

            <button
              onClick={() => handleTimeEntry('clock_out')}
              disabled={currentState === 'initial' || loading}
              className={`w-full ${
                currentState !== 'initial' ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-400'
              } text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200 disabled:opacity-50`}
            >
              <LogOut className="h-6 w-6" />
              <span className="text-xl">Salida</span>
            </button>
          </div>

          {selectedWorkCenter && currentState !== 'initial' && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <p className="text-green-700 font-medium">Centro de trabajo actual: {selectedWorkCenter}</p>
            </div>
          )}

          {geolocation.latitude !== null && geolocation.longitude !== null && (
            <div className="mt-4 p-4 bg-purple-50 rounded-lg">
              <p className="text-purple-700 font-medium">
                Ubicación registrada: Latitud {geolocation.latitude}, Longitud {geolocation.longitude}
              </p>
              {geolocation.latitude === 0 && geolocation.longitude === 0 && (
                <p className="text-purple-700 text-sm mt-1">
                  Nota: ubicación de respaldo (0,0). Revisa permisos/GPS para registrar la ubicación real.
                </p>
              )}
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
            const shouldShowPending =
              data.calendar_signature_requested === true && data.calendar_report_signed !== true;
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
            const shouldShowPending =
              data.calendar_signature_requested === true && data.calendar_report_signed !== true;
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
          const shouldShowPending =
            row.calendar_signature_requested === true && row.calendar_report_signed !== true;
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
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <nav className="bg-white shadow-sm sticky top-0 z-40">
        <div className="px-4">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center">
              <Clock className="h-6 w-6 text-blue-600 mr-2" />
              <span className="text-lg font-bold text-gray-900">TimeControl</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center text-gray-700 hover:text-gray-900 p-2"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </nav>

      {calendarSignaturePending && (
        <div className="px-4 pt-4">
          <div className="bg-orange-500 text-white p-3 rounded-lg shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5" />
              <h3 className="font-semibold text-sm">Firma de Calendario Pendiente</h3>
            </div>
            <p className="text-xs mb-2">Tu empresa ha solicitado que firmes el calendario anual.</p>
            <Link
              to="/empleado/calendario"
              className="block w-full text-center px-4 py-2 bg-white text-orange-600 rounded-lg hover:bg-orange-50 transition-colors font-medium text-sm"
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

      <MobileNav role="employee" />
    </div>
  );
}

export default EmployeeDashboard;
