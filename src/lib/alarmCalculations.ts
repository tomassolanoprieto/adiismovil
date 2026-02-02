import { supabase } from './supabase';

type TimeEntry = {
  id: string;
  employee_id: string;
  entry_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  timestamp: string;
  is_active: boolean;
};

type WorkSchedule = {
  date: string;            // YYYY-MM-DD (CLAVE)
  start_time: string;      // HH:mm
  end_time: string;        // HH:mm
  is_working: boolean;     // true si hay jornada real ese día
};

type BuiltSegment = {
  clockIn: string;
  clockOut: string;
  breakMs: number;
};

// --- Helpers robustos de fecha (evitan UTC shifting) ---
const pad2 = (n: number) => String(n).padStart(2, '0');

const dateKeyLocal = (d: Date) => {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const dateKeyFromISO = (iso: string) => dateKeyLocal(new Date(iso));

const parseLocalDateTime = (dateKey: string, hhmm: string) => {
  // Importante: SIN "Z" para que sea hora local
  return new Date(`${dateKey}T${hhmm}:00`);
};

const isSameLocalDay = (a: Date, b: Date) => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

const endOfLocalDayISO = (dateKey: string) => {
  const d = new Date(`${dateKey}T12:00:00`); // mediodía para evitar shifts
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

const startOfLocalDayISO = (dateKey: string) => {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

// --- Segment builder ---
// ✅ cambio clave: si falta clock_out, se cierra con fallbackCloseISO (si se pasa),
// y SOLO si no hay fallback se usa now.
const buildSegmentsFromEntries = (entries: TimeEntry[], fallbackCloseISO?: string): BuiltSegment[] => {
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
        // si había uno abierto, lo cerramos al final del día local del clock_in anterior
        if (currentIn) {
          const prevDateKey = dateKeyFromISO(currentIn);
          closeCurrent(endOfLocalDayISO(prevDateKey));
        }
        currentIn = ts;
        breakStart = null;
        breakAccumMs = 0;
        break;

      case 'break_start':
        if (currentIn && !breakStart) breakStart = ts;
        break;

      case 'break_end':
        if (currentIn && breakStart) {
          const ms = new Date(ts).getTime() - new Date(breakStart).getTime();
          if (ms > 0) breakAccumMs += ms;
          breakStart = null;
        }
        break;

      case 'clock_out':
        if (currentIn) closeCurrent(ts);
        break;
    }
  }

  if (currentIn) {
    const endISO = fallbackCloseISO || new Date().toISOString();
    closeCurrent(endISO);
  }

  return segments;
};

const computeSegmentHours = (startISO: string, endISO: string, breakMs: number = 0): number => {
  const startMs = new Date(startISO).getTime();
  let endMs = new Date(endISO).getTime();

  // seguridad por si entra invertido
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;

  const grossMs = Math.max(0, endMs - startMs);
  const workedMs = Math.max(0, grossMs - (breakMs || 0));
  return workedMs / (1000 * 60 * 60);
};

// Semana LUNES->DOMINGO, pero usando “día local” y evitando ISO-shift
const getWeekBoundsLocal = (date: Date) => {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0); // mediodía para evitar saltos

  const day = d.getDay(); // 0 domingo, 1 lunes...
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
};

// --- Schedule map (por FECHA, no por dayOfWeek) ---
type ScheduleMap = Record<string, WorkSchedule>;

const pickStartEndFromScheduleRow = (es: any): { start?: string; end?: string; isWorking: boolean } => {
  // Detectar “no laborable” aunque exista fila:
  // - si no hay ningún tramo horario, NO es laborable
  // - si hay flags típicos de vacaciones/festivo/ausencia, NO es laborable
  const hasMorning = !!(es.morning_start && es.morning_end);
  const hasAfternoon = !!(es.afternoon_start && es.afternoon_end);
  const hasAnyShift = hasMorning || hasAfternoon;

  const looksLikeVacationOrHoliday =
    !!es.is_vacation ||
    !!es.is_holiday ||
    !!es.is_holyday || // por si hay typo en tu DB
    !!es.vacation ||
    !!es.holiday ||
    !!es.festivo ||
    !!es.vacaciones ||
    es.day_type === 'vacation' ||
    es.day_type === 'holiday' ||
    es.type === 'vacation' ||
    es.type === 'holiday' ||
    es.status === 'vacation' ||
    es.status === 'holiday';

  // enabled: si existe y es false, consideramos no laborable (o al menos “sin jornada”)
  const enabled = es.enabled === undefined ? true : !!es.enabled;

  const isWorking = enabled && hasAnyShift && !looksLikeVacationOrHoliday;

  if (!isWorking) return { isWorking: false };

  // start: el más temprano; end: el más tarde
  const candidatesStart = [es.morning_start, es.afternoon_start].filter(Boolean) as string[];
  const candidatesEnd = [es.morning_end, es.afternoon_end].filter(Boolean) as string[];

  const start = candidatesStart.sort()[0];
  const end = candidatesEnd.sort().slice(-1)[0];

  return { start, end, isWorking: true };
};

const buildScheduleMapByDate = (employeeScheduleRows: any[]): ScheduleMap => {
  const map: ScheduleMap = {};

  for (const es of employeeScheduleRows || []) {
    if (!es?.date) continue;

    // es.date viene como YYYY-MM-DD normalmente; NO lo pases por new Date() para decidir el día
    const dateKey = String(es.date).slice(0, 10);

    const { start, end, isWorking } = pickStartEndFromScheduleRow(es);
    map[dateKey] = {
      date: dateKey,
      start_time: start || '',
      end_time: end || '',
      is_working: isWorking,
    };
  }

  return map;
};

// --- Alarmas ---
export const calculateLateClockIns = async (
  employeeId: string,
  scheduleByDate: ScheduleMap,
  startDate: Date,
  endDate: Date
) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('entry_type', 'clock_in')
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  for (const entry of entries) {
    const dateKey = dateKeyFromISO(entry.timestamp);
    const schedule = scheduleByDate[dateKey];

    if (!schedule || !schedule.is_working || !schedule.start_time) continue;

    const entryTime = new Date(entry.timestamp);
    const scheduledTime = parseLocalDateTime(dateKey, schedule.start_time);

    const delayMinutes = (entryTime.getTime() - scheduledTime.getTime()) / (1000 * 60);
    if (delayMinutes > 15) {
      alarms.push({
        alarm_type: 'late_clock_in',
        alarm_date: dateKey,
        description: `Fichaje de entrada con retraso de ${Math.round(delayMinutes)} minutos. Hora programada: ${schedule.start_time}, Hora real: ${entryTime.toTimeString().slice(0, 5)}`,
        hours_involved: delayMinutes / 60,
      });
    }
  }

  return alarms;
};

export const calculateMissedClockIns = async (
  employeeId: string,
  scheduleByDate: ScheduleMap,
  startDate: Date,
  endDate: Date
) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error) return alarms;

  const now = new Date();
  const cursor = new Date(startDate);
  cursor.setHours(12, 0, 0, 0);

  const endCursor = new Date(endDate);
  endCursor.setHours(12, 0, 0, 0);

  while (cursor <= endCursor) {
    const dateKey = dateKeyLocal(cursor);
    const schedule = scheduleByDate[dateKey];

    // ✅ FIX: si NO hay jornada real ese día, NO se generan alarmas
    if (!schedule || !schedule.is_working) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    const dayEntries = (entries || []).filter((e: any) => dateKeyFromISO(e.timestamp) === dateKey);

    const hasClockIn = dayEntries.some((e: any) => e.entry_type === 'clock_in');
    const hasClockOut = dayEntries.some((e: any) => e.entry_type === 'clock_out');

    // Solo para días pasados (hoy no)
    const dayDate = new Date(`${dateKey}T12:00:00`);
    if (dayDate < new Date(dateKeyLocal(now) + 'T12:00:00')) {
      if (!hasClockIn) {
        alarms.push({
          alarm_type: 'missed_clock_in',
          alarm_date: dateKey,
          description: `No se registró fichaje de entrada en un día laboral programado (${schedule.start_time} - ${schedule.end_time})`,
          hours_involved: 0,
        });
      } else if (!hasClockOut) {
        // si no hay salida, esperamos a 1h después del fin programado
        if (schedule.end_time) {
          const endTime = parseLocalDateTime(dateKey, schedule.end_time);
          const oneHourAfterEnd = new Date(endTime.getTime() + 60 * 60 * 1000);
          if (now > oneHourAfterEnd) {
            alarms.push({
              alarm_type: 'missed_clock_out',
              alarm_date: dateKey,
              description: `No se registró fichaje de salida en un día laboral con entrada registrada (horario: ${schedule.start_time} - ${schedule.end_time})`,
              hours_involved: 0,
            });
          }
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return alarms;
};

export const calculateOvertime = async (
  employeeId: string,
  scheduleByDate: ScheduleMap,
  startDate: Date,
  endDate: Date
) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  const cursor = new Date(startDate);
  cursor.setHours(12, 0, 0, 0);

  const endCursor = new Date(endDate);
  endCursor.setHours(12, 0, 0, 0);

  while (cursor <= endCursor) {
    const dateKey = dateKeyLocal(cursor);
    const schedule = scheduleByDate[dateKey];

    if (!schedule || !schedule.is_working) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    const dayEntries = entries.filter((e: any) => dateKeyFromISO(e.timestamp) === dateKey);

    // ✅ FIX: si falta clock_out, cerrar al final del día (o now si es hoy)
    const now = new Date();
    const fallbackCloseISO = isSameLocalDay(cursor, now) ? now.toISOString() : endOfLocalDayISO(dateKey);

    const segments = buildSegmentsFromEntries(dayEntries, fallbackCloseISO);

    let totalWorkedHours = 0;
    for (const seg of segments) {
      totalWorkedHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
    }

    // horas programadas del día
    const startDT = parseLocalDateTime(dateKey, schedule.start_time);
    const endDT = parseLocalDateTime(dateKey, schedule.end_time);
    const scheduledHours = Math.max(0, (endDT.getTime() - startDT.getTime()) / (1000 * 60 * 60));

    const overtime = totalWorkedHours - scheduledHours;
    if (overtime > 0.5) {
      alarms.push({
        alarm_type: 'overtime',
        alarm_date: dateKey,
        description: `Horas extras: ${overtime.toFixed(2)} horas trabajadas más del horario programado (${scheduledHours.toFixed(
          2
        )}h programadas, ${totalWorkedHours.toFixed(2)}h trabajadas)`,
        hours_involved: overtime,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return alarms;
};

export const calculateWorkShortfall = async (
  employeeId: string,
  scheduleByDate: ScheduleMap,
  startDate: Date,
  endDate: Date
) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  const now = new Date();
  const cursor = new Date(startDate);
  cursor.setHours(12, 0, 0, 0);

  const endCursor = new Date(endDate);
  endCursor.setHours(12, 0, 0, 0);

  while (cursor <= endCursor) {
    const dateKey = dateKeyLocal(cursor);
    const schedule = scheduleByDate[dateKey];

    if (!schedule || !schedule.is_working) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    const dayEntries = entries.filter((e: any) => dateKeyFromISO(e.timestamp) === dateKey);

    const fallbackCloseISO = isSameLocalDay(cursor, now) ? now.toISOString() : endOfLocalDayISO(dateKey);
    const segments = buildSegmentsFromEntries(dayEntries, fallbackCloseISO);

    let totalWorkedHours = 0;
    for (const seg of segments) {
      totalWorkedHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
    }

    const startDT = parseLocalDateTime(dateKey, schedule.start_time);
    const endDT = parseLocalDateTime(dateKey, schedule.end_time);
    const scheduledHours = Math.max(0, (endDT.getTime() - startDT.getTime()) / (1000 * 60 * 60));

    const shortfall = scheduledHours - totalWorkedHours;

    // solo pasado (no hoy)
    const isPast = new Date(`${dateKey}T12:00:00`) < new Date(`${dateKeyLocal(now)}T12:00:00`);

    if (shortfall > 0.5 && isPast) {
      alarms.push({
        alarm_type: 'work_shortfall',
        alarm_date: dateKey,
        description: `Merma de trabajo: ${shortfall.toFixed(2)} horas menos del horario programado (${scheduledHours.toFixed(
          2
        )}h programadas, ${totalWorkedHours.toFixed(2)}h trabajadas)`,
        hours_involved: shortfall,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return alarms;
};

export const calculateWorkedVacations = async (employeeId: string, startDate: Date, endDate: Date) => {
  const alarms: any[] = [];

  const { data: vacations, error: vacError } = await supabase
    .from('employee_vacations')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('end_date', dateKeyLocal(startDate))
    .lte('start_date', dateKeyLocal(endDate));

  if (vacError || !vacations) return alarms;

  const { data: entries, error: entriesError } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (entriesError || !entries) return alarms;

  for (const vacation of vacations) {
    const vacStartKey = String(vacation.start_date).slice(0, 10);
    const vacEndKey = String(vacation.end_date).slice(0, 10);

    const cursor = new Date(`${vacStartKey}T12:00:00`);
    const endCursor = new Date(`${vacEndKey}T12:00:00`);

    while (cursor <= endCursor) {
      const dateKey = dateKeyLocal(cursor);
      const dayEntries = entries.filter((e: any) => dateKeyFromISO(e.timestamp) === dateKey);

      if (dayEntries.length > 0) {
        const fallbackCloseISO = endOfLocalDayISO(dateKey);
        const segments = buildSegmentsFromEntries(dayEntries, fallbackCloseISO);

        let totalHours = 0;
        for (const seg of segments) {
          totalHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
        }

        if (totalHours > 0) {
          alarms.push({
            alarm_type: 'worked_vacation',
            alarm_date: dateKey,
            description: `Trabajó ${totalHours.toFixed(2)} horas durante periodo de vacaciones (${vacStartKey} a ${vacEndKey})`,
            hours_involved: totalHours,
          });
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return alarms;
};

export const calculateWeekly45HourExceeded = async (employeeId: string, startDate: Date, endDate: Date) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  // ✅ FIX: arrancar siempre desde el LUNES de la semana del startDate
  let cursor = getWeekBoundsLocal(startDate).monday;
  const endLimit = new Date(endDate);
  endLimit.setHours(23, 59, 59, 999);

  while (cursor <= endLimit) {
    const { monday, sunday } = getWeekBoundsLocal(cursor);

    const weekEntries = entries.filter((e: any) => {
      const dt = new Date(e.timestamp);
      return dt >= monday && dt <= sunday;
    });

    // cerrar abiertos a domingo fin (si faltan clock_out)
    const fallbackCloseISO = sunday.toISOString();
    const segments = buildSegmentsFromEntries(weekEntries, fallbackCloseISO);

    let totalWeekHours = 0;
    for (const seg of segments) {
      totalWeekHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
    }

    const mondayKey = dateKeyLocal(monday);
    const sundayKey = dateKeyLocal(sunday);

    if (totalWeekHours > 45) {
      const existing = alarms.find(
        (a) => a.alarm_type === 'weekly_45h_exceeded' && a.alarm_date === mondayKey
      );
      if (!existing) {
        alarms.push({
          alarm_type: 'weekly_45h_exceeded',
          alarm_date: mondayKey,
          description: `Superó el límite de 45 horas semanales: ${totalWeekHours.toFixed(
            2
          )} horas trabajadas (semana del ${mondayKey} al ${sundayKey})`,
          hours_involved: totalWeekHours - 45,
        });
      }
    }

    // siguiente semana
    cursor = new Date(monday);
    cursor.setDate(monday.getDate() + 7);
    cursor.setHours(0, 0, 0, 0);
  }

  return alarms;
};

export const calculateAnnualHoursExceeded = async (employeeId: string, year: number) => {
  const alarms: any[] = [];

  const { data: employeeProfile, error: profileError } = await supabase
    .from('employee_profiles')
    .select('weekly_hours')
    .eq('id', employeeId)
    .single();

  if (profileError || !employeeProfile || !employeeProfile.weekly_hours) return alarms;

  const annualLimit = employeeProfile.weekly_hours * 52;

  const start = new Date(year, 0, 1);
  start.setHours(0, 0, 0, 0);

  const today = new Date();
  const end = year === today.getFullYear() ? today : new Date(year, 11, 31, 23, 59, 59, 999);

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', end.toISOString());

  if (error || !entries) return alarms;

  const fallbackCloseISO = end.toISOString();
  const segments = buildSegmentsFromEntries(entries, fallbackCloseISO);

  let totalYearHours = 0;
  for (const seg of segments) {
    totalYearHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
  }

  if (totalYearHours > annualLimit) {
    const alarmDate = year === today.getFullYear() ? dateKeyLocal(today) : dateKeyLocal(end);

    alarms.push({
      alarm_type: 'annual_hours_exceeded',
      alarm_date: alarmDate,
      description: `Superó el límite anual de ${annualLimit.toFixed(2)} horas: ${totalYearHours.toFixed(
        2
      )} horas trabajadas en el año ${year} (exceso: ${(totalYearHours - annualLimit).toFixed(2)}h)`,
      hours_involved: totalYearHours - annualLimit,
    });
  }

  return alarms;
};

export const generateAllAlarms = async (employeeId: string, supervisorId: string, startDate: Date, endDate: Date) => {
  // Traemos horarios POR FECHA (no por dayOfWeek)
  const startKey = dateKeyLocal(startDate);
  const endKey = dateKeyLocal(endDate);

  const { data: employeeSchedule, error: scheduleError } = await supabase
    .from('employee_schedules')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('date', startKey)
    .lte('date', endKey);

  // Si no hay schedules, no generamos alarmas de horario.
  if (scheduleError || !employeeSchedule || employeeSchedule.length === 0) {
    return [];
  }

  const scheduleByDate = buildScheduleMapByDate(employeeSchedule);

  const allAlarms: any[] = [];

  const lateClockIns = await calculateLateClockIns(employeeId, scheduleByDate, startDate, endDate);
  allAlarms.push(...lateClockIns);

  const missed = await calculateMissedClockIns(employeeId, scheduleByDate, startDate, endDate);
  allAlarms.push(...missed);

  const overtime = await calculateOvertime(employeeId, scheduleByDate, startDate, endDate);
  allAlarms.push(...overtime);

  const shortfall = await calculateWorkShortfall(employeeId, scheduleByDate, startDate, endDate);
  allAlarms.push(...shortfall);

  const workedVacations = await calculateWorkedVacations(employeeId, startDate, endDate);
  allAlarms.push(...workedVacations);

  const weekly45h = await calculateWeekly45HourExceeded(employeeId, startDate, endDate);
  allAlarms.push(...weekly45h);

  const currentYear = new Date().getFullYear();
  const annualExceeded = await calculateAnnualHoursExceeded(employeeId, currentYear);
  allAlarms.push(...annualExceeded);

  const alarmsToInsert = allAlarms.map((alarm) => ({
    ...alarm,
    supervisor_id: supervisorId,
    employee_id: employeeId,
  }));

  return alarmsToInsert;
};
