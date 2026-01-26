// WorkScheduleModal.tsx 

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Plus,
  Trash,
  Calendar,
  Copy,
  CheckCircle,
  Info,
  AlertTriangle,
  Pencil,
  Save
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Employee {
  id: string;
  fiscal_name: string;
  total_hours?: number;
  total_annual_hours?: number;
  work_centers: string[];
}

interface DaySchedule {
  morning: { start: string; end: string };
  afternoon: { start: string; end: string; enabled: boolean };
}

interface WeekSchedule {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  weekStart?: string;
}

interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  work_centers: string[];
  holiday_type?: string;
}

interface VacationRow {
  id: string;
  employee_id: string;
  company_id?: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  status?: string;
  notes?: string | null;
  created_at?: string;
}

interface WorkScheduleModalProps {
  employee: Employee;
  onClose: () => void;
  onSave: (scheduleData: string, employeeId: string) => void; // (se mantiene por compatibilidad, pero "Guardar" YA NO redirige)
  initialSchedule?: string;
}

const emptyDaySchedule: DaySchedule = {
  morning: { start: '', end: '' }, // ✅ default --:-- (vacío)
  afternoon: { start: '', end: '', enabled: false }
};

const defaultWeekSchedule: WeekSchedule = {
  monday: { ...emptyDaySchedule },
  tuesday: { ...emptyDaySchedule },
  wednesday: { ...emptyDaySchedule },
  thursday: { ...emptyDaySchedule },
  friday: { ...emptyDaySchedule },
  saturday: { ...emptyDaySchedule },
  sunday: { ...emptyDaySchedule }
};

// -------------------------
// Helpers de fechas (LOCAL) ✅ (evita el bug de desplazamiento por toISOString/UTC)
// -------------------------
const pad2 = (n: number) => String(n).padStart(2, '0');
const dateToYMDLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ymdToDateLocal = (ymd: string) => {
  const [y, m, da] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, da || 1, 12, 0, 0, 0); // mediodía para evitar DST edge cases
};

const getDayKeyFromIndex = (i: number): keyof WeekSchedule => {
  return (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i] as keyof WeekSchedule);
};

const dayKeyIndex: Record<keyof WeekSchedule, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
  weekStart: -1
} as any;

// -------------------------
// Horas
// -------------------------
const parseTimeToHours = (timeString: string): number => {
  if (!timeString) return 0;
  const [hours, minutes] = timeString.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours + minutes / 60;
};

const calcDayHours = (daySchedule: DaySchedule) => {
  let total = 0;
  if (daySchedule.morning.start && daySchedule.morning.end) {
    total += Math.max(0, parseTimeToHours(daySchedule.morning.end) - parseTimeToHours(daySchedule.morning.start));
  }
  if (daySchedule.afternoon.enabled && daySchedule.afternoon.start && daySchedule.afternoon.end) {
    total += Math.max(0, parseTimeToHours(daySchedule.afternoon.end) - parseTimeToHours(daySchedule.afternoon.start));
  }
  return total;
};

// ✅ Horas de una semana pero contando SOLO días cuyo año calendario coincide con "year"
const calculateWeekHoursForCalendarYear = (weekStart: string, weekSchedule: WeekSchedule, year: number): number => {
  let total = 0;

  (['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as (keyof WeekSchedule)[]).forEach((dayKey) => {
    const ymd = (() => {
      const base = ymdToDateLocal(weekStart);
      const idx = dayKeyIndex[dayKey];
      const d = new Date(base);
      d.setDate(base.getDate() + idx);
      return dateToYMDLocal(d);
    })();

    const d = ymdToDateLocal(ymd);
    if (d.getFullYear() !== year) return; // ✅ SOLO días del año real

    total += calcDayHours((weekSchedule as any)[dayKey]);
  });

  return total;
};

// -------------------------
// Modal principal
// -------------------------
export default function WorkScheduleModal({ employee, onClose, onSave }: WorkScheduleModalProps) {
  const [schedule, setSchedule] = useState<WeekSchedule>(defaultWeekSchedule);
  const [selectedWeek, setSelectedWeek] = useState<string>(getCurrentWeekStart());
  const [schedules, setSchedules] = useState<Record<string, WeekSchedule>>({});

  // ✅ Año “activo” según la semana seleccionada (discriminación por año)
// Año ISO de la semana: el año del jueves de esa semana (lunes + 3 días)
const getWeekYearISO = (weekStartYmd: string) => {
  const monday = ymdToDateLocal(weekStartYmd);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  return thursday.getFullYear();
};

  // ✅ Año “activo” según la semana seleccionada (ISO week-year)
const selectedYear = useMemo(() => {
  if (!selectedWeek) return new Date().getFullYear();
  return getWeekYearISO(selectedWeek);
}, [selectedWeek]);

  const [totalAssignedHours, setTotalAssignedHours] = useState<number>(0);
  const [remainingHours, setRemainingHours] = useState<number>((employee.total_annual_hours || employee.total_hours || 0)); // ✅ puede ser negativo

  // Festivos
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [excludedHolidays, setExcludedHolidays] = useState<Set<string>>(new Set());
  const [holidayWarning, setHolidayWarning] = useState<{ show: boolean; day: string; holiday: string; holidayId?: string } | null>(null);
  const [ignoredHolidays, setIgnoredHolidays] = useState<Set<string>>(new Set());
  const [showExcludeHolidayModal, setShowExcludeHolidayModal] = useState(false);
  const [pendingHolidayAction, setPendingHolidayAction] = useState<{ day: keyof WeekSchedule; holidayId: string } | null>(null);

  // Vacaciones (nuevo)
  const [vacations, setVacations] = useState<VacationRow[]>([]);
  const [vacationDaysSet, setVacationDaysSet] = useState<Set<string>>(new Set()); // YYYY-MM-DD
  const [showVacationsPopup, setShowVacationsPopup] = useState(false);
  const [showVacationCreate, setShowVacationCreate] = useState(false);
  const [vacationStartDate, setVacationStartDate] = useState('');
  const [vacationEndDate, setVacationEndDate] = useState('');
  const [vacationNotes, setVacationNotes] = useState('');

  // Warning (vacaciones sobre días laborales) + bloqueo (vacaciones sobre festivo)
  const [showVacationWorkdaysWarning, setShowVacationWorkdaysWarning] = useState(false);
  const [vacationWorkDaysDetected, setVacationWorkDaysDetected] = useState<string[]>([]);
  const pendingVacationInsertRef = useRef<any>(null);

  const [showVacationHolidayBlocked, setShowVacationHolidayBlocked] = useState(false);
  const [vacationHolidayBlockedDates, setVacationHolidayBlockedDates] = useState<{ date: string; name: string }[]>([]);

  // Guardado / Salir
  const [loading, setLoading] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const [showLeaveModal, setShowLeaveModal] = useState(false); // Guardar y salir con horas descuadradas

  // Aplicar a todo el año / rango
  const [showConfirmationAllYear, setShowConfirmationAllYear] = useState(false);

  const [showDateRangeModal, setShowDateRangeModal] = useState(false);
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');

  // Conflictos al aplicar (festivo/vacación) uno por uno
  type ApplyConflict = {
    date: string; // YYYY-MM-DD
    type: 'holiday' | 'vacation';
    label: string;
  };
  const [applyQueue, setApplyQueue] = useState<{ mode: 'range' | 'year'; dates: string[]; index: number } | null>(null);
  const [applyConflicts, setApplyConflicts] = useState<ApplyConflict[]>([]);
  const [showApplyConflictModal, setShowApplyConflictModal] = useState(false);

  // -------------------------
  // Cargar datos iniciales
  // -------------------------
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);

        // 1) Schedules (todas las fechas del empleado)
        const { data: schedulesData, error: schedulesError } = await supabase
          .from('employee_schedules')
          .select('*')
          .eq('employee_id', employee.id)
          .order('date', { ascending: true });

        if (schedulesError) throw schedulesError;

        const schedulesByWeek: Record<string, WeekSchedule> = {};

        if (schedulesData && schedulesData.length > 0) {
          const weeksMap = new Map<string, any[]>();

          schedulesData.forEach((row: any) => {
            const date = ymdToDateLocal(row.date);
            const dow = date.getDay(); // 0=Sun..6=Sat (local)
            const monday = new Date(date);
            // mover a lunes
            const diff = dow === 0 ? -6 : 1 - dow;
            monday.setDate(date.getDate() + diff);
            const mondayStr = dateToYMDLocal(monday);

            if (!weeksMap.has(mondayStr)) weeksMap.set(mondayStr, []);
            weeksMap.get(mondayStr)!.push(row);
          });

          weeksMap.forEach((days, weekStart) => {
            const weekSchedule: WeekSchedule = { ...JSON.parse(JSON.stringify(defaultWeekSchedule)), weekStart };

            days.forEach((dayRow: any) => {
              const d = ymdToDateLocal(dayRow.date);
              const jsDow = d.getDay(); // 0..6
              const key = (['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][jsDow] as any) as keyof WeekSchedule;

              // key puede ser sunday..saturday
              if (key && (weekSchedule as any)[key]) {
                (weekSchedule as any)[key] = {
                  morning: { start: dayRow.morning_start || '', end: dayRow.morning_end || '' },
                  afternoon: { start: dayRow.afternoon_start || '', end: dayRow.afternoon_end || '', enabled: !!dayRow.enabled }
                };
              }
            });

            // ✅ Normaliza: nuestro WeekSchedule usa monday..sunday
            // ya existe sunday también, perfecto (lo usamos)
            schedulesByWeek[weekStart] = weekSchedule;
          });
        }

        setSchedules(schedulesByWeek);

        if (schedulesByWeek[selectedWeek]) {
          setSchedule(schedulesByWeek[selectedWeek]);
        } else {
          setSchedule({ ...JSON.parse(JSON.stringify(defaultWeekSchedule)), weekStart: selectedWeek });
        }

        // 2) Holidays
        const { data: holidaysData, error: holidaysError } = await supabase
          .from('holidays')
          .select('*')
          .or(`holiday_type.eq.nacional,work_centers.ov.{${employee.work_centers.join(',')}}`);

        if (holidaysError) throw holidaysError;
        setHolidays(holidaysData || []);

        // 3) Excluded holidays
        const { data: exclusionsData, error: exclusionsError } = await supabase
          .from('employee_holiday_exclusions')
          .select('holiday_id')
          .eq('employee_id', employee.id);

        if (exclusionsError) throw exclusionsError;
        setExcludedHolidays(new Set(exclusionsData?.map((e: any) => e.holiday_id) || []));

        // 4) Vacations (del año seleccionado)
        await fetchVacationsForYear(selectedYear);
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, selectedWeek]);

  // ✅ refetch vacaciones al cambiar de año
  useEffect(() => {
    fetchVacationsForYear(selectedYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, employee.id]);

  const fetchVacationsForYear = async (year: number) => {
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      const { data, error } = await supabase
        .from('employee_vacations')
        .select('*')
        .eq('employee_id', employee.id)
        .or(`and(start_date.lte.${yearEnd},end_date.gte.${yearStart})`)
        .order('start_date', { ascending: true });

      if (error) throw error;

      const rows = (data || []) as VacationRow[];
      setVacations(rows);

      // construir set de días (para colorear en el modal)
      const days = new Set<string>();
      rows.forEach((v) => {
        const s = ymdToDateLocal(v.start_date);
        const e = ymdToDateLocal(v.end_date);
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          days.add(dateToYMDLocal(d));
        }
      });
      setVacationDaysSet(days);
    } catch (err) {
      console.error('Error fetching vacations:', err);
      setVacations([]);
      setVacationDaysSet(new Set());
    }
  };

  // -------------------------
  // Cálculo de horas (✅ por año y ✅ permite negativo)
  // -------------------------
useEffect(() => {
  let totalHoursYear = 0;

  Object.entries(schedules).forEach(([weekStart, weekSchedule]) => {
    // ✅ Solo consideramos semanas que “pertenecen” al año ISO seleccionado (para no iterar de más)
    const yISO = getWeekYearISO(weekStart);
    if (yISO !== selectedYear) return;

    // ✅ Pero contamos SOLO los días cuyo año calendario coincide con selectedYear
    totalHoursYear += calculateWeekHoursForCalendarYear(weekStart, weekSchedule, selectedYear);
  });

  setTotalAssignedHours(totalHoursYear);

  const totalAnnualHours = employee.total_annual_hours || employee.total_hours || 0;
  setRemainingHours(totalAnnualHours - totalHoursYear);
}, [schedules, employee.total_annual_hours, employee.total_hours, selectedYear]);

  // -------------------------
  // Utilidades de semana/día
  // -------------------------
  function getCurrentWeekStart(): string {
    const now = new Date();
    const dow = now.getDay(); // 0 Sun..6 Sat
    const monday = new Date(now);
    const diff = dow === 0 ? -6 : 1 - dow;
    monday.setDate(now.getDate() + diff);
    return dateToYMDLocal(monday);
  }

  const getDateForSelectedWeekDay = (weekStartYmd: string, day: keyof WeekSchedule): string => {
    const base = ymdToDateLocal(weekStartYmd);
    const idx = dayKeyIndex[day];
    const d = new Date(base);
    d.setDate(base.getDate() + idx);
    return dateToYMDLocal(d);
  };

  const dayNamesES: Record<keyof WeekSchedule, string> = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo',
    weekStart: ''
  } as any;

  const formatDateLong = (ymd: string) => {
    const d = ymdToDateLocal(ymd);
    return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // -------------------------
  // Edición de día (mantiene warning festivo existente)
  // -------------------------
  const handleDayChange = (
    day: keyof WeekSchedule,
    period: 'morning' | 'afternoon',
    field: 'start' | 'end',
    value: string
  ) => {
    // Si el día es VACACIONES, permitimos editar (por si quieren forzar horario) pero lo avisamos al aplicar masivo.
    // Para edición manual: no bloqueamos.

    // Check festivo (como antes)
    if (selectedWeek) {
      const dateString = getDateForSelectedWeekDay(selectedWeek, day);
      const holiday = holidays.find((h) => h.date === dateString && !excludedHolidays.has(h.id));

      if (holiday && !ignoredHolidays.has(`${dateString}-${day}-${period}-${field}`)) {
        setHolidayWarning({
          show: true,
          day: dayNamesES[day],
          holiday: holiday.name,
          holidayId: holiday.id
        });
        return;
      }
    }

    setSchedule((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [period]: { ...prev[day][period], [field]: value }
      }
    }));
  };

  const toggleAfternoonShift = (day: keyof WeekSchedule) => {
    if (selectedWeek) {
      const dateString = getDateForSelectedWeekDay(selectedWeek, day);
      const holiday = holidays.find((h) => h.date === dateString && !excludedHolidays.has(h.id));

      if (holiday && !schedule[day].afternoon.enabled && !ignoredHolidays.has(`${dateString}-${day}-afternoon-toggle`)) {
        setHolidayWarning({
          show: true,
          day: dayNamesES[day],
          holiday: holiday.name,
          holidayId: holiday.id
        });
        return;
      }
    }

    setSchedule((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        afternoon: { ...prev[day].afternoon, enabled: !prev[day].afternoon.enabled }
      }
    }));
  };

  // -------------------------
  // Copias
  // -------------------------
  const copyScheduleToAllDays = (fromDay: keyof WeekSchedule) => {
    const daySchedule = schedule[fromDay];
    setSchedule((prev) => {
      const next = { ...prev } as any;
      (['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as (keyof WeekSchedule)[]).forEach((d) => {
        if (d !== fromDay) next[d] = JSON.parse(JSON.stringify(daySchedule));
      });
      return next;
    });
  };

  const copyScheduleToWeekdays = (fromDay: keyof WeekSchedule) => {
    const daySchedule = schedule[fromDay];
    setSchedule((prev) => {
      const next = { ...prev } as any;
      (['monday','tuesday','wednesday','thursday','friday'] as (keyof WeekSchedule)[]).forEach((d) => {
        if (d !== fromDay) next[d] = JSON.parse(JSON.stringify(daySchedule));
      });
      return next;
    });
  };

  // -------------------------
  // Cambio de semana (YA NO fuerza lunes; solo muestra la semana del día elegido)
  // ✅ pero la lógica interna sigue siendo "semanaStart = lunes de esa semana" para editar semana completa
  // -------------------------
  const [showDateError, setShowDateError] = useState(false);

  const handleWeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = ymdToDateLocal(e.target.value);
    const dow = picked.getDay(); // 0..6

    // Ajustamos a lunes SOLO para el “weekStart” (editamos semana completa) pero informamos.
    if (dow !== 1) {
      setShowDateError(true);
      setTimeout(() => setShowDateError(false), 2500);
    }

    const monday = new Date(picked);
    const diff = dow === 0 ? -6 : 1 - dow;
    monday.setDate(picked.getDate() + diff);

    const newWeek = dateToYMDLocal(monday);
    setSelectedWeek(newWeek);

    if (schedules[newWeek]) {
      setSchedule(schedules[newWeek]);
    } else {
      setSchedule({ ...JSON.parse(JSON.stringify(defaultWeekSchedule)), weekStart: newWeek });
    }
  };

  // -------------------------
  // Guardar semana (✅ NO redirige; se queda en el modal)
  // -------------------------
const saveCurrentWeekToDB = async () => {
  // dates de la semana (lunes..domingo)
  const weekStartDate = ymdToDateLocal(selectedWeek);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartDate);
    d.setDate(weekStartDate.getDate() + i);
    return dateToYMDLocal(d);
  });

  const daySchedules = weekDates.map((date, i) => {
    const dayName = getDayKeyFromIndex(i);
    const ds = schedule[dayName];
    return {
      employee_id: employee.id,
      date,
      morning_start: ds.morning.start || null,
      morning_end: ds.morning.end || null,
      afternoon_start: ds.afternoon.enabled && ds.afternoon.start ? ds.afternoon.start : null,
      afternoon_end: ds.afternoon.enabled && ds.afternoon.end ? ds.afternoon.end : null,
      enabled: !!ds.afternoon.enabled
    };
  });

  await supabase.from('employee_schedules').delete().eq('employee_id', employee.id).in('date', weekDates);
  const { error } = await supabase.from('employee_schedules').insert(daySchedules);
  if (error) throw error;

  const updatedWeek: WeekSchedule = {
    ...JSON.parse(JSON.stringify(schedule)),
    weekStart: selectedWeek
  };

  // ✅ sincroniza el editor con lo que acabas de persistir
  setSchedule(updatedWeek);

  // ✅ actualiza cache de semanas inmediatamente (dispara recálculo de horas y render de lista)
  setSchedules((prev) => ({ ...prev, [selectedWeek]: updatedWeek }));
}; // ✅ IMPORTANTÍSIMO: cerrar la función aquí

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await saveCurrentWeekToDB();

      // ✅ Ya NO hacemos redirect aquí. Y evitamos llamar onSave para no disparar navegación del parent.
      // Si quieres mantener compatibilidad de backend/legacy, descomenta y asegura que el parent NO navegue.
      // const formatted = { weeks: { ...schedules, [selectedWeek]: { ...schedule, weekStart: selectedWeek } } };
      // onSave(JSON.stringify(formatted), employee.id);

      setSaveToast('✅ Guardado correctamente');
      setTimeout(() => setSaveToast(null), 2200);
    } catch (error) {
      console.error('Error saving schedule:', error);
      alert('Error al guardar el horario');
    } finally {
      setLoading(false);
    }
  };

const handleSaveAndExit = async () => {
  try {
    setLoading(true);
    await saveCurrentWeekToDB();

    // si queda descuadrado (positivo o negativo) => warning
    if (Math.abs(remainingHours) > 0.0001) {
      setShowLeaveModal(true);
      return;
    }

    // ✅ en vez de navegar, cerramos el modal
    onClose();
  } catch (err) {
    console.error(err);
    alert('Error al guardar');
  } finally {
    setLoading(false);
  }
};

  const clearScheduleForDateInLocalState = (ymd: string) => {
  // Limpia el día en schedules + si está en la semana seleccionada también en schedule
  const d = ymdToDateLocal(ymd);
  const jsDow = d.getDay(); // 0..6
  const idx = (jsDow === 0 ? 6 : jsDow - 1); // lunes=0..domingo=6
  const key = getDayKeyFromIndex(idx);

  // 1) limpiar el editor de la semana actual si corresponde a la misma semana
  const weekMonday = new Date(d);
  const diff = jsDow === 0 ? -6 : 1 - jsDow;
  weekMonday.setDate(d.getDate() + diff);
  const weekStart = dateToYMDLocal(weekMonday);

  if (weekStart === selectedWeek) {
    setSchedule((prev) => ({
      ...prev,
      [key]: { ...emptyDaySchedule }
    }));
  }

  // 2) limpiar schedules cacheados
  setSchedules((prev) => {
    const next: Record<string, WeekSchedule> = { ...prev };
    if (next[weekStart]) {
      next[weekStart] = { ...next[weekStart], [key]: { ...emptyDaySchedule } } as any;
    }
    return next;
  });
};

const restoreHolidayAndClearWorkday = async (holidayId: string, ymd: string) => {
  try {
    setLoading(true);

    // 1) Restablecer festivo: eliminar exclusión
    const { error: delExclErr } = await supabase
      .from('employee_holiday_exclusions')
      .delete()
      .eq('employee_id', employee.id)
      .eq('holiday_id', holidayId);

    if (delExclErr) throw delExclErr;

    // actualizar state excluded
    setExcludedHolidays((prev) => {
      const next = new Set(prev);
      next.delete(holidayId);
      return next;
    });

    // 2) Quitar horario de ese día: borrar schedules para esa fecha
    const { error: delSchedErr } = await supabase
      .from('employee_schedules')
      .delete()
      .eq('employee_id', employee.id)
      .eq('date', ymd);

    if (delSchedErr) throw delSchedErr;

    // 3) Limpiar el día en UI (dejar --:-- / vacío)
    clearScheduleForDateInLocalState(ymd);

    setSaveToast('✅ Festivo restablecido y horario eliminado para ese día');
    setTimeout(() => setSaveToast(null), 2400);
  } catch (err) {
    console.error(err);
    alert('Error al restablecer el festivo');
  } finally {
    setLoading(false);
  }
};

  // -------------------------
  // Eliminar semana completa
  // -------------------------
  const handleDeleteWeek = async (weekStart: string) => {
    try {
      setLoading(true);

      const weekStartDate = ymdToDateLocal(weekStart);
      const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStartDate);
        d.setDate(weekStartDate.getDate() + i);
        return dateToYMDLocal(d);
      });

      const { error } = await supabase
        .from('employee_schedules')
        .delete()
        .eq('employee_id', employee.id)
        .in('date', weekDates);

      if (error) throw error;

      setSchedules((prev) => {
        const next = { ...prev };
        delete next[weekStart];
        return next;
      });

      if (selectedWeek === weekStart) {
        const remaining = Object.keys(schedules).filter((k) => k !== weekStart).sort();
        const fallback = remaining[0] || getCurrentWeekStart();
        setSelectedWeek(fallback);
        setSchedule(schedules[fallback] || defaultWeekSchedule);
      }
    } catch (error) {
      console.error('Error deleting week:', error);
      alert('Error al eliminar la semana');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------
  // Vacaciones: utilidades
  // -------------------------
  const expandRangeDays = (startYmd: string, endYmd: string) => {
    const s = ymdToDateLocal(startYmd);
    const e = ymdToDateLocal(endYmd);
    const out: string[] = [];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(dateToYMDLocal(d));
    return out;
  };

  const checkHolidaysInRange = (startYmd: string, endYmd: string) => {
    const days = expandRangeDays(startYmd, endYmd);
    const blocked: { date: string; name: string }[] = [];
    days.forEach((d) => {
      const h = holidays.find((x) => x.date === d && !excludedHolidays.has(x.id));
      if (h) blocked.push({ date: d, name: h.name });
    });
    return blocked;
  };

  const checkWorkSchedulesInRange = async (startYmd: string, endYmd: string) => {
    const { data, error } = await supabase
      .from('employee_schedules')
      .select('date, morning_start, morning_end, afternoon_start, afternoon_end, enabled')
      .eq('employee_id', employee.id)
      .gte('date', startYmd)
      .lte('date', endYmd);

    if (error) throw error;

    const rows = data || [];
    const workDays = rows
      .filter((r: any) => (r.morning_start && r.morning_end) || (r.enabled && r.afternoon_start && r.afternoon_end))
      .map((r: any) => r.date);

    return { workDays, rows };
  };

  const deleteSchedulesInRange = async (startYmd: string, endYmd: string) => {
    const days = expandRangeDays(startYmd, endYmd);
    const { error } = await supabase
      .from('employee_schedules')
      .delete()
      .eq('employee_id', employee.id)
      .in('date', days);
    if (error) throw error;

    // actualiza state local (quitando horas)
    setSchedules((prev) => {
      const next: Record<string, WeekSchedule> = { ...prev };
      // removemos/limpiamos los días en las semanas afectadas
      days.forEach((ymd) => {
        const d = ymdToDateLocal(ymd);
        const jsDow = d.getDay(); // 0..6
        const weekMonday = new Date(d);
        const diff = jsDow === 0 ? -6 : 1 - jsDow;
        weekMonday.setDate(d.getDate() + diff);
        const weekStart = dateToYMDLocal(weekMonday);

        const idx = (jsDow === 0 ? 6 : jsDow - 1); // lunes=0..domingo=6
        const key = getDayKeyFromIndex(idx);

        if (next[weekStart]) {
          next[weekStart] = { ...next[weekStart], [key]: { ...emptyDaySchedule } } as any;
        }
      });
      return next;
    });
  };

  const insertVacation = async (payload: any) => {
    const { error } = await supabase.from('employee_vacations').insert(payload);
    if (error) throw error;
    await fetchVacationsForYear(selectedYear);
  };

  const handleCreateVacation = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!vacationStartDate || !vacationEndDate) return;

    if (ymdToDateLocal(vacationStartDate) > ymdToDateLocal(vacationEndDate)) {
      alert('La fecha de inicio debe ser anterior a la fecha de fin');
      return;
    }

    try {
      setLoading(true);

      // ✅ NO permitir vacaciones en festivos
      const blocked = checkHolidaysInRange(vacationStartDate, vacationEndDate);
      if (blocked.length > 0) {
        setVacationHolidayBlockedDates(blocked);
        setShowVacationHolidayBlocked(true);
        return;
      }

      // company_id (como en SupervisorCalendar)
      const { data: companyData, error: compErr } = await supabase
        .from('employee_profiles')
        .select('company_id')
        .eq('id', employee.id)
        .single();

      if (compErr) throw compErr;
      if (!companyData?.company_id) throw new Error('No company_id');

      // ✅ Si hay días laborales en el rango => warning y si continúa: descontar (borrando schedules)
      const { workDays } = await checkWorkSchedulesInRange(vacationStartDate, vacationEndDate);

      const payload = {
        employee_id: employee.id,
        company_id: companyData.company_id,
        start_date: vacationStartDate,
        end_date: vacationEndDate,
        status: 'approved',
        notes: vacationNotes || null
      };

      if (workDays.length > 0) {
        setVacationWorkDaysDetected(workDays);
        pendingVacationInsertRef.current = payload;
        setShowVacationWorkdaysWarning(true);
        return;
      }

      // no hay laborales -> insert directo
      await insertVacation(payload);

      setShowVacationCreate(false);
      setVacationStartDate('');
      setVacationEndDate('');
      setVacationNotes('');
      setSaveToast('✅ Vacaciones añadidas');
      setTimeout(() => setSaveToast(null), 2200);
    } catch (err) {
      console.error(err);
      alert('Error al crear vacaciones');
    } finally {
      setLoading(false);
    }
  };

  const confirmVacationWithWorkDays = async () => {
    const payload = pendingVacationInsertRef.current;
    if (!payload) {
      setShowVacationWorkdaysWarning(false);
      return;
    }

    try {
      setLoading(true);

      // ✅ Acción requerida: cambiar estatus a vacaciones y descontar horas:
      // -> borramos los schedules en ese rango (reduce horas asignadas => recalcula pendientes)
      await deleteSchedulesInRange(payload.start_date, payload.end_date);

      // -> insert vacaciones
      await insertVacation(payload);

      setShowVacationWorkdaysWarning(false);
      pendingVacationInsertRef.current = null;
      setVacationWorkDaysDetected([]);

      setShowVacationCreate(false);
      setVacationStartDate('');
      setVacationEndDate('');
      setVacationNotes('');
      setSaveToast('✅ Vacaciones añadidas (horario laboral descontado)');
      setTimeout(() => setSaveToast(null), 2500);
    } catch (err) {
      console.error(err);
      alert('Error al confirmar vacaciones');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVacation = async (vacId: string) => {
    try {
      setLoading(true);
      const { error } = await supabase.from('employee_vacations').delete().eq('id', vacId);
      if (error) throw error;
      await fetchVacationsForYear(selectedYear);
      setSaveToast('✅ Vacaciones eliminadas');
      setTimeout(() => setSaveToast(null), 2000);
    } catch (err) {
      console.error(err);
      alert('Error al eliminar vacaciones');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------
  // Aplicar a todo el año (✅ año de selectedWeek) + colas de conflictos (festivo/vacación)
  // -------------------------
  const applyScheduleToAllYear = () => setShowConfirmationAllYear(true);

  const buildDatesForAllYear = (year: number) => {
    const start = new Date(year, 0, 1, 12, 0, 0, 0);
    const end = new Date(year, 11, 31, 12, 0, 0, 0);

    const dates: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(dateToYMDLocal(d));
    }
    return dates;
  };

  const confirmApplyToAllYear = async () => {
    try {
      setLoading(true);

      const allDates = buildDatesForAllYear(selectedYear);

      // preparar cola de aplicación (festivos/vacaciones requieren decisión)
      const conflicts: ApplyConflict[] = [];
      allDates.forEach((d) => {
        const holiday = holidays.find((h) => h.date === d && !excludedHolidays.has(h.id));
        if (holiday) conflicts.push({ date: d, type: 'holiday', label: `Festivo: ${holiday.name}` });
        if (vacationDaysSet.has(d)) conflicts.push({ date: d, type: 'vacation', label: `Vacaciones` });
      });

      setApplyConflicts(conflicts);
      setApplyQueue({ mode: 'year', dates: allDates, index: 0 });
      setShowConfirmationAllYear(false);

      if (conflicts.length > 0) {
        setShowApplyConflictModal(true);
      } else {
        // sin conflictos: aplicar todo directo
        await applyScheduleToSpecificDates(allDates);
        setSaveToast('✅ Horario aplicado a todo el año');
        setTimeout(() => setSaveToast(null), 2200);
      }
    } catch (err) {
      console.error(err);
      alert('Error al preparar aplicación anual');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------
  // Aplicar a rango (✅ NO ajusta a lunes-domingo, aplica el día de semana correspondiente)
  // + conflictos uno por uno (festivo/vacación) preguntando si aplicar
  // -------------------------
  const applyScheduleToDateRange = () => setShowDateRangeModal(true);

  const confirmApplyToDateRange = async () => {
    try {
      setLoading(true);

      if (!rangeStartDate || !rangeEndDate) {
        alert('Por favor, selecciona ambas fechas');
        return;
      }
      if (ymdToDateLocal(rangeStartDate) > ymdToDateLocal(rangeEndDate)) {
        alert('La fecha de inicio debe ser anterior a la fecha de fin');
        return;
      }

      const dates = expandRangeDays(rangeStartDate, rangeEndDate);

      const conflicts: ApplyConflict[] = [];
      dates.forEach((d) => {
        const holiday = holidays.find((h) => h.date === d && !excludedHolidays.has(h.id));
        if (holiday) conflicts.push({ date: d, type: 'holiday', label: `Festivo: ${holiday.name}` });
        if (vacationDaysSet.has(d)) conflicts.push({ date: d, type: 'vacation', label: `Vacaciones` });
      });

      setApplyConflicts(conflicts);
      setApplyQueue({ mode: 'range', dates, index: 0 });
      setShowDateRangeModal(false);
      setRangeStartDate('');
      setRangeEndDate('');

      if (conflicts.length > 0) {
        setShowApplyConflictModal(true);
      } else {
        await applyScheduleToSpecificDates(dates);
        setSaveToast('✅ Horario aplicado al rango');
        setTimeout(() => setSaveToast(null), 2200);
      }
    } catch (err) {
      console.error(err);
      alert('Error al aplicar al rango');
    } finally {
      setLoading(false);
    }
  };

  // Aplicar el patrón semanal actual (schedule) a una lista de fechas:
  // - calcula el dayKey por día de semana real de cada fecha (✅ no desplaza)
  // - escribe employee_schedules para cada fecha
  const applyScheduleToSpecificDates = async (dates: string[], skipDates?: Set<string>) => {
    const toApply = dates.filter((d) => !(skipDates?.has(d)));
    if (toApply.length === 0) return;

    const rows = toApply.map((ymd) => {
      const d = ymdToDateLocal(ymd);
      const jsDow = d.getDay(); // 0..6
      const idx = (jsDow === 0 ? 6 : jsDow - 1); // lunes=0..domingo=6
      const key = getDayKeyFromIndex(idx);
      const ds = schedule[key];

      return {
        employee_id: employee.id,
        date: ymd,
        morning_start: ds.morning.start || null,
        morning_end: ds.morning.end || null,
        afternoon_start: ds.afternoon.enabled && ds.afternoon.start ? ds.afternoon.start : null,
        afternoon_end: ds.afternoon.enabled && ds.afternoon.end ? ds.afternoon.end : null,
        enabled: !!ds.afternoon.enabled
      };
    });

    // delete prev
    await supabase.from('employee_schedules').delete().eq('employee_id', employee.id).in('date', toApply);

    // insert batches
    const batchSize = 200;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('employee_schedules').insert(batch);
      if (error) throw error;
    }

    // state local: actualiza weeks afectadas
    setSchedules((prev) => {
      const next: Record<string, WeekSchedule> = { ...prev };

      toApply.forEach((ymd) => {
        const d = ymdToDateLocal(ymd);
        const jsDow = d.getDay();
        const weekMonday = new Date(d);
        const diff = jsDow === 0 ? -6 : 1 - jsDow;
        weekMonday.setDate(d.getDate() + diff);
        const weekStart = dateToYMDLocal(weekMonday);

        const idx = (jsDow === 0 ? 6 : jsDow - 1);
        const key = getDayKeyFromIndex(idx);

        const baseWeek = next[weekStart] || ({ ...JSON.parse(JSON.stringify(defaultWeekSchedule)), weekStart } as WeekSchedule);
        (baseWeek as any)[key] = JSON.parse(JSON.stringify(schedule[key]));
        next[weekStart] = baseWeek;
      });

      return next;
    });
  };

  // -------------------------
  // UI helpers (vacaciones/festivo en semana)
  // -------------------------
const isSelectedWeekHoliday = (day: keyof WeekSchedule) => {
  const d = getDateForSelectedWeekDay(selectedWeek, day);

  // Festivo “real” por fecha (aunque esté excluido)
  const holiday = holidays.find((h) => h.date === d);

  if (!holiday) {
    return { isHoliday: false, isExcluded: false, name: '', id: '', date: d };
  }

  const isExcluded = excludedHolidays.has(holiday.id);

  // isHoliday = existe y NO está excluido
  return {
    isHoliday: !isExcluded,
    isExcluded,
    name: holiday.name,
    id: holiday.id,
    date: d
  };
};

  const isSelectedWeekVacationDay = (day: keyof WeekSchedule) => {
    const d = getDateForSelectedWeekDay(selectedWeek, day);
    return { isVacation: vacationDaysSet.has(d), date: d };
  };

  // -------------------------
  // A PARTIR DE AQUÍ EMPIEZA EL RENDER (lo sigo en PARTE 2)
  // -------------------------
const renderDaySchedule = (day: keyof WeekSchedule, dayName: string) => {
  const holidayInfo = isSelectedWeekHoliday(day);
  const vacationInfo = isSelectedWeekVacationDay(day);

// ✅ Solo bloqueamos edición por VACACIONES.
// ✅ Festivo NO excluido: SE PUEDE EDITAR, pero saltará el warning de confirmación (handleDayChange).
const isBlockedByVacation = vacationInfo.isVacation;

// ✅ En vacaciones mostramos vacío. En festivo mostramos el horario real (para que puedas escribir).
const daySchedule = isBlockedByVacation ? emptyDaySchedule : schedule[day];

  return (
    <div
      className={`border rounded-lg p-4 mb-4 ${
        holidayInfo.isHoliday ? 'border-orange-300 bg-orange-50' : ''
      } ${vacationInfo.isVacation ? 'border-purple-300 bg-purple-50' : ''}`}
    >
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            {dayName}
{(holidayInfo.isHoliday || holidayInfo.isExcluded) && (
  <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${
    holidayInfo.isExcluded ? 'bg-gray-200 text-gray-800' : 'bg-orange-100 text-orange-800'
  }`}>
    <AlertTriangle className="w-3 h-3" />
    {holidayInfo.isExcluded ? `Festivo (excluido): ${holidayInfo.name}` : `Festivo: ${holidayInfo.name}`}
  </span>
)}

{holidayInfo.isExcluded && holidayInfo.id && (
  <button
    type="button"
    onClick={() => restoreHolidayAndClearWorkday(holidayInfo.id, holidayInfo.date)}
    className="text-xs px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-700"
    disabled={loading}
    title="Restaura el festivo y elimina el horario laboral de este día"
  >
    Restablecer festivo
  </button>
)}
            {vacationInfo.isVacation && (
              <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded-full flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Vacaciones
              </span>
            )}
          </h3>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copyScheduleToWeekdays(day)}
              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              Copiar a L-V
            </button>
            <button
              type="button"
              onClick={() => copyScheduleToAllDays(day)}
              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              Copiar a todos
            </button>
          </div>
        </div>

<div className="mb-4">
  <h4 className="font-medium text-sm mb-2">Turno de mañana</h4>
  <div className="grid grid-cols-2 gap-3">
    <div>
      <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
      <input
  type="time"
  value={daySchedule.morning.start}
  onChange={(e) => handleDayChange(day, 'morning', 'start', e.target.value)}
  disabled={isBlockedByVacation}
  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
/>
    </div>

    <div>
      <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
      <input
        type="time"
        value={daySchedule.morning.end}
        onChange={(e) => handleDayChange(day, 'morning', 'end', e.target.value)}
        disabled={isBlockedByVacation}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
      />
    </div>
  </div>
</div>

<div className="mb-2">
  <div className="flex items-center justify-between mb-2">
    <h4 className="font-medium text-sm">Turno de tarde</h4>
 <button
  type="button"
  onClick={() => toggleAfternoonShift(day)}
  disabled={isBlockedByVacation}
  className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
    daySchedule.afternoon.enabled
      ? 'bg-red-100 text-red-700 hover:bg-red-200'
      : 'bg-green-100 text-green-700 hover:bg-green-200'
  } disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
>
      {daySchedule.afternoon.enabled ? (
        <>
          <Trash className="w-3 h-3" />
          <span>Eliminar turno</span>
        </>
      ) : (
        <>
          <Plus className="w-3 h-3" />
          <span>Añadir horario</span>
        </>
      )}
    </button>
  </div>

  {daySchedule.afternoon.enabled && (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
        <input
          type="time"
          value={daySchedule.afternoon.start}
          onChange={(e) => handleDayChange(day, 'afternoon', 'start', e.target.value)}
          disabled={isBlockedByVacation}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
        <input
          type="time"
          value={daySchedule.afternoon.end}
          onChange={(e) => handleDayChange(day, 'afternoon', 'end', e.target.value)}
          disabled={isBlockedByVacation}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  )}
</div>
      </div>
    );
  };

const formatScheduleForDisplay = () => {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const keys: (keyof WeekSchedule)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  return days
    .map((name, idx) => {
      const k = keys[idx];

const holidayInfo = isSelectedWeekHoliday(k);
const vacationInfo = isSelectedWeekVacationDay(k);
const isNonWorkingDay = vacationInfo.isVacation || (holidayInfo.isHoliday && !holidayInfo.isExcluded);
const d = isNonWorkingDay ? emptyDaySchedule : schedule[k];

      let text = `${name}: ${d.morning.start || '--:--'} - ${d.morning.end || '--:--'}`;
      if (d.afternoon.enabled) {
        text += ` y ${d.afternoon.start || '--:--'} - ${d.afternoon.end || '--:--'}`;
      }
      return text;
    })
    .join('\n');
};

  const formatDate = (ymd: string) => formatDateLong(ymd);

const calculateWeekHours = (weekStart: string, weekSchedule: WeekSchedule): number =>
  calculateWeekHoursForCalendarYear(weekStart, weekSchedule, selectedYear);

// -------------------------
// Conflictos al aplicar (FIX: sin condiciones de carrera)
// -------------------------

// -------------------------
// Conflictos al aplicar (FIX: "Aplicar igualmente" aplica ESE día y avanza)
// -------------------------

// Fechas ya resueltas (para que el modal avance). Incluye tanto:
// - fechas "skip" (el usuario dijo dejar como está)
// - fechas "applied" (el usuario dijo aplicar igualmente)
const [resolvedApplyDates, setResolvedApplyDates] = useState<Set<string>>(new Set());

// Mantén skipApplyDates solo como "NO aplicar"
const [skipApplyDates, setSkipApplyDates] = useState<Set<string>>(new Set());

const getNextConflictByOrder = (skip: Set<string>, resolved: Set<string>) => {
  if (!applyQueue) return null;

  for (const d of applyQueue.dates) {
    // si ya está resuelta (aplicada o skip), no preguntar de nuevo
    if (resolved.has(d)) continue;

    const c = applyConflicts.find((x) => x.date === d);
    if (c && (c.type === 'holiday' || c.type === 'vacation') && !skip.has(d)) {
      return c;
    }
  }
  return null;
};

// Aplica el horario SOLO a una fecha (aunque sea festivo/vacaciones)
const applyScheduleToSingleDate = async (ymd: string) => {
  // reutiliza la misma lógica de applyScheduleToSpecificDates pero para 1 fecha
  const d = ymdToDateLocal(ymd);
  const jsDow = d.getDay();
  const idx = (jsDow === 0 ? 6 : jsDow - 1);
  const key = getDayKeyFromIndex(idx);
  const ds = schedule[key];

  const row = {
    employee_id: employee.id,
    date: ymd,
    morning_start: ds.morning.start || null,
    morning_end: ds.morning.end || null,
    afternoon_start: ds.afternoon.enabled && ds.afternoon.start ? ds.afternoon.start : null,
    afternoon_end: ds.afternoon.enabled && ds.afternoon.end ? ds.afternoon.end : null,
    enabled: !!ds.afternoon.enabled
  };

  // delete prev ese día
  const { error: delErr } = await supabase
    .from('employee_schedules')
    .delete()
    .eq('employee_id', employee.id)
    .eq('date', ymd);

  if (delErr) throw delErr;

  // insert ese día
  const { error: insErr } = await supabase.from('employee_schedules').insert([row]);
  if (insErr) throw insErr;

  // actualizar state local (cache de semanas)
  setSchedules((prev) => {
    const next: Record<string, WeekSchedule> = { ...prev };

    const dd = ymdToDateLocal(ymd);
    const js = dd.getDay();
    const weekMonday = new Date(dd);
    const diff = js === 0 ? -6 : 1 - js;
    weekMonday.setDate(dd.getDate() + diff);
    const weekStart = dateToYMDLocal(weekMonday);

    const dayIdx = (js === 0 ? 6 : js - 1);
    const dayKey = getDayKeyFromIndex(dayIdx);

    const baseWeek =
      next[weekStart] || ({ ...JSON.parse(JSON.stringify(defaultWeekSchedule)), weekStart } as WeekSchedule);

    (baseWeek as any)[dayKey] = JSON.parse(JSON.stringify(schedule[dayKey]));
    next[weekStart] = baseWeek;

    return next;
  });
};

// Finalizar: aplicar a todas las fechas EXCEPTO las que el usuario decidió "dejar como está"
const proceedApplyAfterConflicts = async (finalSkip: Set<string>) => {
  if (!applyQueue) return;
  try {
    setLoading(true);

    await applyScheduleToSpecificDates(applyQueue.dates, finalSkip);

    setShowApplyConflictModal(false);
    setApplyQueue(null);
    setApplyConflicts([]);
    setSkipApplyDates(new Set());
    setResolvedApplyDates(new Set());

    setSaveToast('✅ Horario aplicado (conflictos resueltos)');
    setTimeout(() => setSaveToast(null), 2400);
  } catch (err) {
    console.error(err);
    alert('Error aplicando horario');
  } finally {
    setLoading(false);
  }
};

const handleConflictDecision = async (applyAnyway: boolean) => {
  if (!applyQueue) return;

  const current = getNextConflictByOrder(skipApplyDates, resolvedApplyDates);

  // Si ya no hay conflictos pendientes, terminar
  if (!current) {
    await proceedApplyAfterConflicts(new Set(skipApplyDates));
    return;
  }

  try {
    setLoading(true);

    // Si el usuario quiere aplicar igualmente: aplicamos SOLO ese día ahora mismo
    if (applyAnyway) {
      await applyScheduleToSingleDate(current.date);
    } else {
      // si NO quiere aplicar: lo marcamos como skip
      const nextSkip = new Set(skipApplyDates);
      nextSkip.add(current.date);
      setSkipApplyDates(nextSkip);
    }

    // En ambos casos, marcamos la fecha como resuelta para avanzar
    const nextResolved = new Set(resolvedApplyDates);
    nextResolved.add(current.date);
    setResolvedApplyDates(nextResolved);

    // ¿Queda otro conflicto?
    const next = getNextConflictByOrder(
      applyAnyway ? skipApplyDates : new Set(skipApplyDates).add(current.date),
      nextResolved
    );

    if (!next) {
      // ya no hay más -> aplicar al resto excluyendo skip
      const finalSkip = applyAnyway ? new Set(skipApplyDates) : new Set(skipApplyDates).add(current.date);
      await proceedApplyAfterConflicts(finalSkip);
      return;
    }

    // fuerza re-render del modal
    setApplyConflicts((prev) => [...prev]);
  } catch (err) {
    console.error(err);
    alert('Error resolviendo conflicto');
  } finally {
    setLoading(false);
  }
};

  // -------------------------
  // Render
  // -------------------------
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Configurar Horario - {employee.fiscal_name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar">
            <X className="w-6 h-6" />
          </button>
        </div>

        {saveToast && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
            {saveToast}
          </div>
        )}

        {loading && (
          <div className="mb-4 p-4 bg-blue-50 rounded-lg text-center">
            <p>Cargando...</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Week selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Semana del horario (solo lunes)
            </label>
            <input
              type="date"
              value={selectedWeek}
              onChange={handleWeekChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {showDateError && (
              <p className="mt-1 text-xs text-red-500">
                Se ha ajustado automáticamente al lunes de esa semana (para editar la semana completa).
              </p>
            )}
          </div>

          {/* Hours information (✅ negativo en naranja) */}
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-blue-600" />
              <h3 className="font-medium">Información de horas (Año {selectedYear})</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Jornada Cómputo Total:</p>
                <p className="font-semibold">{employee.total_annual_hours || employee.total_hours || 0} horas</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Horas asignadas:</p>
                <p className="font-semibold">{totalAssignedHours.toFixed(2)} horas</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Horas pendientes:</p>
                <p
                  className={`font-semibold ${
                    remainingHours < 0 ? 'text-orange-600' : remainingHours > 0 ? 'text-orange-600' : 'text-green-600'
                  }`}
                >
                  {remainingHours.toFixed(2)} horas
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  (si es negativo: has asignado más horas que el cómputo total)
                </p>
              </div>
            </div>
          </div>

          {/* Apply buttons + ✅ botón Vacaciones al lado de rango */}
          <div className="mb-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <button
              type="button"
              onClick={applyScheduleToAllYear}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              disabled={loading}
            >
              <Copy className="w-4 h-4" />
              Aplicar este horario a todas las semanas del año
            </button>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={applyScheduleToDateRange}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                disabled={loading}
              >
                <Calendar className="w-4 h-4" />
                Aplicar a rango de fechas
              </button>

              <button
                type="button"
                onClick={() => setShowVacationsPopup(true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                disabled={loading}
              >
                <Calendar className="w-4 h-4" />
                Vacaciones
              </button>
            </div>
          </div>

          {/* Days */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              {renderDaySchedule('monday', 'Lunes')}
              {renderDaySchedule('tuesday', 'Martes')}
              {renderDaySchedule('wednesday', 'Miércoles')}
              {renderDaySchedule('thursday', 'Jueves')}
            </div>
            <div>
              {renderDaySchedule('friday', 'Viernes')}
              {renderDaySchedule('saturday', 'Sábado')}
              {renderDaySchedule('sunday', 'Domingo')}
            </div>
          </div>

          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-2">Vista previa del horario:</h3>
            <pre className="whitespace-pre-wrap text-sm text-gray-700">{formatScheduleForDisplay()}</pre>
          </div>

          {/* Configured weeks */}
          <div className="mt-6 border-t pt-6">
            <h3 className="font-semibold text-lg mb-4">Semanas configuradas (Año {selectedYear})</h3>
{Object.keys(schedules).filter((w) => getWeekYearISO(w) === selectedYear).length === 0 ? (
  <p className="text-gray-500 italic">No hay semanas configuradas en este año</p>
) : (
  <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
    {Object.entries(schedules)
      .filter(([weekStart]) => getWeekYearISO(weekStart) === selectedYear)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, weekSchedule]) => (
        <div
          key={weekStart}
          className={`p-3 border rounded-lg ${
            weekStart === selectedWeek ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
          }`}
        >
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium">Semana del {formatDate(weekStart)}</p>
              <p className="text-sm text-gray-600">{calculateWeekHours(weekStart, weekSchedule).toFixed(2)} horas semanales</p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedWeek(weekStart);
                  setSchedule(weekSchedule);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
              >
                <Pencil className="w-4 h-4" /> Editar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteWeek(weekStart)}
                className="text-red-600 hover:text-red-800 text-sm flex items-center gap-1"
                disabled={loading}
              >
                <Trash className="w-4 h-4" /> Eliminar
              </button>
            </div>
          </div>
        </div>
      ))}
  </div>
)}
          </div>

          {/* Footer buttons (✅ Guardar + Guardar y salir) */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={loading}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              disabled={loading}
            >
              <Save className="w-4 h-4" />
              {loading ? 'Guardando...' : 'Guardar'}
            </button>

            <button
              type="button"
              onClick={handleSaveAndExit}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors"
              disabled={loading}
            >
              GUARDAR Y SALIR
            </button>
          </div>
        </form>

        {/* ============================
            MODALES
        ============================ */}

        {/* Confirm apply to all year */}
        {showConfirmationAllYear && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">¿Estás seguro?</h3>
                <p className="text-gray-600 mt-2">
                  Esta acción aplicará el horario actual a todas las semanas del año <strong>{selectedYear}</strong>,
                  sobrescribiendo lo existente.
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Si hay festivos o vacaciones, te preguntaré día por día.
                </p>
              </div>
              <div className="flex justify-center gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowConfirmationAllYear(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmApplyToAllYear}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Holiday warning modal (manual edit) */}
        {holidayWarning && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <AlertTriangle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">Día festivo detectado</h3>
                <p className="text-gray-600 mt-2">
                  Estás configurando un horario para el <span className="font-semibold">{holidayWarning.day}</span>, que es un día
                  festivo: <span className="font-semibold">{holidayWarning.holiday}</span>.
                </p>
                <p className="text-gray-600 mt-2">¿Deseas agregar un horario laboral a un día festivo?</p>
              </div>

              <div className="flex justify-center gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => setHolidayWarning(null)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const day = (Object.keys(dayNamesES) as (keyof WeekSchedule)[]).find(
                      (d) => dayNamesES[d] === holidayWarning.day
                    ) as keyof WeekSchedule;

                    if (day && holidayWarning.holidayId) {
                      setPendingHolidayAction({ day, holidayId: holidayWarning.holidayId });
                      setShowExcludeHolidayModal(true);
                    }
                    setHolidayWarning(null);
                  }}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Exclude Holiday Modal (manteniendo tu lógica previa) */}
        {showExcludeHolidayModal && pendingHolidayAction && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <Info className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">Trabajar en día festivo</h3>
                <p className="text-gray-600 mt-2">El empleado trabajará en este día festivo.</p>
                <p className="text-gray-600 mt-2 text-sm">¿Deseas excluir este festivo para este empleado?</p>
              </div>

              <div className="flex justify-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={async () => {
                    const day = pendingHolidayAction.day;
                    const dateString = getDateForSelectedWeekDay(selectedWeek, day);

                    const newIgnored = new Set(ignoredHolidays);
                    newIgnored.add(`${dateString}-${day}-morning-start`);
                    newIgnored.add(`${dateString}-${day}-morning-end`);
                    newIgnored.add(`${dateString}-${day}-afternoon-start`);
                    newIgnored.add(`${dateString}-${day}-afternoon-end`);
                    newIgnored.add(`${dateString}-${day}-afternoon-toggle`);
                    setIgnoredHolidays(newIgnored);

                    if (!schedule[day].afternoon.enabled) {
                      setSchedule((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], afternoon: { ...prev[day].afternoon, enabled: true } }
                      }));
                    }

                    setShowExcludeHolidayModal(false);
                    setPendingHolidayAction(null);
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  No, solo este horario
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await supabase.from('employee_holiday_exclusions').insert({
                        employee_id: employee.id,
                        holiday_id: pendingHolidayAction.holidayId
                      });

                      setExcludedHolidays((prev) => {
                        const next = new Set(prev);
                        next.add(pendingHolidayAction.holidayId);
                        return next;
                      });

                      const day = pendingHolidayAction.day;
                      const dateString = getDateForSelectedWeekDay(selectedWeek, day);

                      const newIgnored = new Set(ignoredHolidays);
                      newIgnored.add(`${dateString}-${day}-morning-start`);
                      newIgnored.add(`${dateString}-${day}-morning-end`);
                      newIgnored.add(`${dateString}-${day}-afternoon-start`);
                      newIgnored.add(`${dateString}-${day}-afternoon-end`);
                      newIgnored.add(`${dateString}-${day}-afternoon-toggle`);
                      setIgnoredHolidays(newIgnored);

                      if (!schedule[day].afternoon.enabled) {
                        setSchedule((prev) => ({
                          ...prev,
                          [day]: { ...prev[day], afternoon: { ...prev[day].afternoon, enabled: true } }
                        }));
                      }
                    } catch (error) {
                      console.error('Error excluding holiday:', error);
                      alert('Error al excluir festivo');
                    }

                    setShowExcludeHolidayModal(false);
                    setPendingHolidayAction(null);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Sí, excluir festivo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Date Range Modal (✅ sin ajustar a lunes-domingo) */}
        {showDateRangeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <Calendar className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">Aplicar horario a rango de fechas</h3>
                <p className="text-gray-600 mt-2">Selecciona el rango exacto al que deseas aplicar este horario.</p>
                <p className="text-xs text-gray-500 mt-2">
                  Se aplicará por <strong>día de la semana</strong> (ej: miércoles usa el horario de “Miércoles”).
                </p>
              </div>

              <div className="space-y-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de inicio</label>
                  <input
                    type="date"
                    value={rangeStartDate}
                    onChange={(e) => setRangeStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de fin</label>
                  <input
                    type="date"
                    value={rangeEndDate}
                    onChange={(e) => setRangeEndDate(e.target.value)}
                    min={rangeStartDate || undefined}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <strong>Nota:</strong> Si el rango incluye <strong>festivos o vacaciones</strong>, se te preguntará día por día.
                  </p>
                </div>
              </div>

              <div className="flex justify-center gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowDateRangeModal(false);
                    setRangeStartDate('');
                    setRangeEndDate('');
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmApplyToDateRange}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  disabled={!rangeStartDate || !rangeEndDate}
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        )}

{showApplyConflictModal && (() => {
  const c = getNextConflictByOrder(skipApplyDates, resolvedApplyDates);
  if (!c) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-10 h-10 text-orange-500 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Día con conflicto detectado</h3>
            <p className="text-gray-700 mt-2">
              Fecha: <strong>{formatDateLong(c.date)}</strong>
            </p>
            <p className="text-gray-700 mt-1">
              Motivo: <strong>{c.label}</strong>
            </p>
            <p className="text-xs text-gray-500 mt-3">
              ¿Quieres aplicar el horario laboral también en este día, o prefieres dejarlo como está?
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => handleConflictDecision(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={loading}
          >
            Dejar como está
          </button>
          <button
            onClick={() => handleConflictDecision(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            disabled={loading}
          >
            Aplicar igualmente
          </button>
        </div>
      </div>
    </div>
  );
})()}

        {/* Vacations popup */}
        {showVacationsPopup && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-purple-600" />
                  Vacaciones - {employee.fiscal_name} (Año {selectedYear})
                </h3>
                <button onClick={() => setShowVacationsPopup(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex justify-end mb-4">
                <button
                  type="button"
                  onClick={() => setShowVacationCreate((v) => !v)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  {showVacationCreate ? 'Cerrar formulario' : 'Crear vacaciones'}
                </button>
              </div>

              {showVacationCreate && (
                <form onSubmit={handleCreateVacation} className="border rounded-lg p-4 mb-5 bg-purple-50 border-purple-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de inicio</label>
                      <input
                        type="date"
                        value={vacationStartDate}
                        onChange={(e) => setVacationStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de fin</label>
                      <input
                        type="date"
                        value={vacationEndDate}
                        onChange={(e) => setVacationEndDate(e.target.value)}
                        min={vacationStartDate || undefined}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notas (opcional)</label>
                    <textarea
                      value={vacationNotes}
                      onChange={(e) => setVacationNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      rows={3}
                      placeholder="Ej: Vacaciones de verano"
                    />
                  </div>

                  <div className="flex justify-end gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowVacationCreate(false);
                        setVacationStartDate('');
                        setVacationEndDate('');
                        setVacationNotes('');
                      }}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      disabled={!vacationStartDate || !vacationEndDate || loading}
                    >
                      Guardar vacaciones
                    </button>
                  </div>
                </form>
              )}

              {vacations.length === 0 ? (
                <p className="text-gray-500 italic">No hay vacaciones registradas este año.</p>
              ) : (
                <div className="space-y-3">
                  {vacations.map((v) => {
                    const days = expandRangeDays(v.start_date, v.end_date).length;
                    return (
                      <div key={v.id} className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded-lg">
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">
                              {formatDateLong(v.start_date)} — {formatDateLong(v.end_date)}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              {days} día{days !== 1 ? 's' : ''}
                            </div>
                            {v.notes && <div className="text-xs text-gray-500 mt-2 italic">{v.notes}</div>}
                          </div>

                          <button
                            onClick={() => handleDeleteVacation(v.id)}
                            className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                            disabled={loading}
                            title="Eliminar vacaciones"
                          >
                            <Trash className="w-4 h-4" />
                            Eliminar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Vacaciones: BLOQUEO por festivo (no permitido) */}
        {showVacationHolidayBlocked && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-10 h-10 text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">Acción no permitida</h3>
                  <p className="text-gray-700 mt-2">
                    No puedes asignar vacaciones en un día que ya es <strong>festivo</strong>.
                  </p>
                  <div className="mt-3 max-h-40 overflow-y-auto space-y-2">
                    {vacationHolidayBlockedDates.map((x, idx) => (
                      <div key={idx} className="text-sm bg-red-50 border border-red-200 rounded p-2">
                        <strong>{formatDateLong(x.date)}</strong> — {x.name}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => {
                    setShowVacationHolidayBlocked(false);
                    setVacationHolidayBlockedDates([]);
                  }}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Vacaciones: WARNING por días laborales (si continúa: borra horarios y recalcula) */}
        {showVacationWorkdaysWarning && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-12 h-12 text-yellow-500 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Advertencia: Días laborables detectados</h3>
                  <p className="mt-2 text-sm text-gray-700">
                    Estás añadiendo vacaciones en un rango que incluye <strong>{vacationWorkDaysDetected.length}</strong> día(s)
                    con horario laboral.
                  </p>

                  <div className="mt-3 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                    <p className="text-sm text-yellow-800 font-medium">
                      Si continúas, esos días pasarán a <strong>vacaciones</strong> y se descontarán las horas asignadas
                      (se recalcularán las horas pendientes).
                    </p>
                  </div>

                  <div className="mt-3 max-h-48 overflow-y-auto">
                    <p className="text-xs font-medium text-gray-700 mb-1">Días laborables en el periodo:</p>
                    <div className="space-y-1">
                      {vacationWorkDaysDetected.map((d, idx) => (
                        <div key={idx} className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded">
                          {formatDateLong(d)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowVacationWorkdaysWarning(false);
                    pendingVacationInsertRef.current = null;
                    setVacationWorkDaysDetected([]);
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmVacationWithWorkDays}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Sí, continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Guardar y salir: warning por horas descuadradas */}
        {showLeaveModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-12 h-12 text-orange-500 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">Horas pendientes descuadradas</h3>
                  <p className="text-gray-700 mt-2">
                    Estás saliendo con horas pendientes en{' '}
                    <strong className="text-orange-600">{remainingHours.toFixed(2)}</strong> horas (Año {selectedYear}).
                  </p>
                  <p className="text-sm text-gray-600 mt-2">¿Seguro que quieres salir?</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowLeaveModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Volver
                </button>
                <button
  onClick={() => {
    setShowLeaveModal(false);
    onClose(); // ✅ cerrar modal
  }}
  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors"
>
  Sí, salir
</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
