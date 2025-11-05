import { supabase } from './supabase';

type TimeEntry = {
  id: string;
  employee_id: string;
  entry_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  timestamp: string;
  is_active: boolean;
};

type WorkSchedule = {
  day: string;
  start_time: string;
  end_time: string;
  is_working: boolean;
};

type BuiltSegment = {
  clockIn: string;
  clockOut: string;
  breakMs: number;
};

const buildSegmentsFromEntries = (entries: TimeEntry[], nowISO?: string): BuiltSegment[] => {
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
        if (currentIn) {
          const endOfDay = new Date(currentIn);
          endOfDay.setHours(23, 59, 59, 999);
          closeCurrent(endOfDay.toISOString());
        }
        currentIn = ts;
        breakStart = null;
        breakAccumMs = 0;
        break;

      case 'break_start':
        if (currentIn && !breakStart) {
          breakStart = ts;
        }
        break;

      case 'break_end':
        if (currentIn && breakStart) {
          const ms = new Date(ts).getTime() - new Date(breakStart).getTime();
          if (ms > 0) breakAccumMs += ms;
          breakStart = null;
        }
        break;

      case 'clock_out':
        if (currentIn) {
          closeCurrent(ts);
        }
        break;
    }
  }

  if (currentIn) {
    const endISO = nowISO || new Date().toISOString();
    closeCurrent(endISO);
  }

  return segments;
};

const computeSegmentHours = (startISO: string, endISO: string, breakMs: number = 0): number => {
  const startMs = new Date(startISO).getTime();
  let endMs = new Date(endISO).getTime();
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;

  const grossMs = Math.max(0, endMs - startMs);
  const workedMs = Math.max(0, grossMs - (breakMs || 0));
  return workedMs / (1000 * 60 * 60);
};

const getWeekBounds = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
};

export const calculateLateClockIns = async (employeeId: string, workSchedule: WorkSchedule[], startDate: Date, endDate: Date) => {
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
    const entryDate = new Date(entry.timestamp);
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][entryDate.getDay()];
    const schedule = workSchedule.find(s => s.day === dayOfWeek);

    if (schedule && schedule.is_working && schedule.start_time) {
      const [hours, minutes] = schedule.start_time.split(':').map(Number);
      const scheduledTime = new Date(entryDate);
      scheduledTime.setHours(hours, minutes, 0, 0);

      const delayMinutes = (entryDate.getTime() - scheduledTime.getTime()) / (1000 * 60);

      if (delayMinutes > 15) {
        alarms.push({
          alarm_type: 'late_clock_in',
          alarm_date: entryDate.toISOString().split('T')[0],
          description: `Fichaje de entrada con retraso de ${Math.round(delayMinutes)} minutos. Hora programada: ${schedule.start_time}, Hora real: ${entryDate.toTimeString().slice(0, 5)}`,
          hours_involved: delayMinutes / 60,
        });
      }
    }
  }

  return alarms;
};

export const calculateMissedClockIns = async (employeeId: string, workSchedule: WorkSchedule[], startDate: Date, endDate: Date) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error) return alarms;

  const currentDate = new Date(startDate);
  const now = new Date();

  while (currentDate <= endDate) {
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDate.getDay()];
    const schedule = workSchedule.find(s => s.day === dayOfWeek);

    if (schedule && schedule.is_working) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayEntries = entries?.filter(e => e.timestamp.startsWith(dateStr)) || [];

      const clockInEntries = dayEntries.filter(e => e.entry_type === 'clock_in');
      const clockOutEntries = dayEntries.filter(e => e.entry_type === 'clock_out');

      const hasClockIn = clockInEntries.length > 0;
      const hasClockOut = clockOutEntries.length > 0;

      if (currentDate < now) {
        if (!hasClockIn) {
          alarms.push({
            alarm_type: 'missed_clock_in',
            alarm_date: dateStr,
            description: `No se registró fichaje de entrada en un día laboral programado (${schedule.start_time} - ${schedule.end_time})`,
            hours_involved: 0,
          });
        } else if (!hasClockOut) {
          const endTime = new Date(`${dateStr}T${schedule.end_time}`);
          const oneHourAfterEnd = new Date(endTime.getTime() + 60 * 60 * 1000);

          if (now > oneHourAfterEnd) {
            alarms.push({
              alarm_type: 'missed_clock_out',
              alarm_date: dateStr,
              description: `No se registró fichaje de salida en un día laboral con entrada registrada (horario: ${schedule.start_time} - ${schedule.end_time})`,
              hours_involved: 0,
            });
          }
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return alarms;
};

export const calculateOvertime = async (employeeId: string, workSchedule: WorkSchedule[], startDate: Date, endDate: Date) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDate.getDay()];
    const schedule = workSchedule.find(s => s.day === dayOfWeek);

    if (schedule && schedule.is_working) {
      const dayEntries = entries.filter(e => e.timestamp.startsWith(dateStr));
      const segments = buildSegmentsFromEntries(dayEntries);

      let totalWorkedHours = 0;
      for (const seg of segments) {
        totalWorkedHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
      }

      const [startHours, startMinutes] = schedule.start_time.split(':').map(Number);
      const [endHours, endMinutes] = schedule.end_time.split(':').map(Number);
      const scheduledHours = (endHours * 60 + endMinutes - startHours * 60 - startMinutes) / 60;

      const overtime = totalWorkedHours - scheduledHours;
      if (overtime > 0.5) {
        alarms.push({
          alarm_type: 'overtime',
          alarm_date: dateStr,
          description: `Horas extras: ${overtime.toFixed(2)} horas trabajadas más del horario programado (${scheduledHours.toFixed(2)}h programadas, ${totalWorkedHours.toFixed(2)}h trabajadas)`,
          hours_involved: overtime,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return alarms;
};

export const calculateWorkShortfall = async (employeeId: string, workSchedule: WorkSchedule[], startDate: Date, endDate: Date) => {
  const alarms: any[] = [];

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDate.getDay()];
    const schedule = workSchedule.find(s => s.day === dayOfWeek);

    if (schedule && schedule.is_working) {
      const dayEntries = entries.filter(e => e.timestamp.startsWith(dateStr));
      const segments = buildSegmentsFromEntries(dayEntries);

      let totalWorkedHours = 0;
      for (const seg of segments) {
        totalWorkedHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
      }

      const [startHours, startMinutes] = schedule.start_time.split(':').map(Number);
      const [endHours, endMinutes] = schedule.end_time.split(':').map(Number);
      const scheduledHours = (endHours * 60 + endMinutes - startHours * 60 - startMinutes) / 60;

      const shortfall = scheduledHours - totalWorkedHours;
      if (shortfall > 0.5 && currentDate < new Date()) {
        alarms.push({
          alarm_type: 'work_shortfall',
          alarm_date: dateStr,
          description: `Merma de trabajo: ${shortfall.toFixed(2)} horas menos del horario programado (${scheduledHours.toFixed(2)}h programadas, ${totalWorkedHours.toFixed(2)}h trabajadas)`,
          hours_involved: shortfall,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return alarms;
};

export const calculateWorkedVacations = async (employeeId: string, startDate: Date, endDate: Date) => {
  const alarms: any[] = [];

  const { data: vacations, error: vacError } = await supabase
    .from('employee_vacations')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('end_date', startDate.toISOString().split('T')[0])
    .lte('start_date', endDate.toISOString().split('T')[0]);

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
    const vacStart = new Date(vacation.start_date);
    const vacEnd = new Date(vacation.end_date);
    vacEnd.setHours(23, 59, 59, 999);

    const currentDate = new Date(vacStart);
    while (currentDate <= vacEnd) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayEntries = entries.filter(e => e.timestamp.startsWith(dateStr));

      if (dayEntries.length > 0) {
        const segments = buildSegmentsFromEntries(dayEntries);
        let totalHours = 0;
        for (const seg of segments) {
          totalHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
        }

        if (totalHours > 0) {
          alarms.push({
            alarm_type: 'worked_vacation',
            alarm_date: dateStr,
            description: `Trabajó ${totalHours.toFixed(2)} horas durante periodo de vacaciones (${vacation.start_date} a ${vacation.end_date})`,
            hours_involved: totalHours,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
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

  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const { monday, sunday } = getWeekBounds(currentDate);

    const weekEntries = entries.filter(e => {
      const entryDate = new Date(e.timestamp);
      return entryDate >= monday && entryDate <= sunday;
    });

    const segments = buildSegmentsFromEntries(weekEntries);
    let totalWeekHours = 0;
    for (const seg of segments) {
      totalWeekHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
    }

    if (totalWeekHours > 45) {
      const mondayStr = monday.toISOString().split('T')[0];
      const existingAlarm = alarms.find(a => a.alarm_date === mondayStr && a.alarm_type === 'weekly_45h_exceeded');

      if (!existingAlarm) {
        alarms.push({
          alarm_type: 'weekly_45h_exceeded',
          alarm_date: mondayStr,
          description: `Superó el límite de 45 horas semanales: ${totalWeekHours.toFixed(2)} horas trabajadas (semana del ${mondayStr} al ${sunday.toISOString().split('T')[0]})`,
          hours_involved: totalWeekHours - 45,
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 7);
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

  const startDate = new Date(year, 0, 1);
  const today = new Date();
  const endDate = year === today.getFullYear() ? today : new Date(year, 11, 31, 23, 59, 59, 999);

  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .gte('timestamp', startDate.toISOString())
    .lte('timestamp', endDate.toISOString());

  if (error || !entries) return alarms;

  const segments = buildSegmentsFromEntries(entries);
  let totalYearHours = 0;
  for (const seg of segments) {
    totalYearHours += computeSegmentHours(seg.clockIn, seg.clockOut, seg.breakMs);
  }

  if (totalYearHours > annualLimit) {
    const alarmDate = year === today.getFullYear() ? today.toISOString().split('T')[0] : endDate.toISOString().split('T')[0];

    alarms.push({
      alarm_type: 'annual_hours_exceeded',
      alarm_date: alarmDate,
      description: `Superó el límite anual de ${annualLimit.toFixed(2)} horas: ${totalYearHours.toFixed(2)} horas trabajadas en el año ${year} (exceso: ${(totalYearHours - annualLimit).toFixed(2)}h)`,
      hours_involved: totalYearHours - annualLimit,
    });
  }

  return alarms;
};

export const generateAllAlarms = async (employeeId: string, supervisorId: string, startDate: Date, endDate: Date) => {
  const { data: employeeSchedule, error: scheduleError } = await supabase
    .from('employee_schedules')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('date', startDate.toISOString().split('T')[0])
    .lte('date', endDate.toISOString().split('T')[0]);

  if (scheduleError || !employeeSchedule || employeeSchedule.length === 0) {
    return [];
  }

  const scheduleMap: { [key: string]: WorkSchedule } = {};
  employeeSchedule.forEach(es => {
    const date = new Date(es.date);
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
    if (!scheduleMap[dayOfWeek] && es.morning_start && es.morning_end) {
      const startTime = es.morning_start;
      const endTime = es.enabled && es.afternoon_end ? es.afternoon_end : es.morning_end;

      scheduleMap[dayOfWeek] = {
        day: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        is_working: true,
      };
    }
  });

  const scheduleArray = Object.values(scheduleMap);

  const allAlarms: any[] = [];

  const lateClockIns = await calculateLateClockIns(employeeId, scheduleArray, startDate, endDate);
  allAlarms.push(...lateClockIns);

  const missedClockIns = await calculateMissedClockIns(employeeId, scheduleArray, startDate, endDate);
  allAlarms.push(...missedClockIns);

  const overtime = await calculateOvertime(employeeId, scheduleArray, startDate, endDate);
  allAlarms.push(...overtime);

  const workShortfall = await calculateWorkShortfall(employeeId, scheduleArray, startDate, endDate);
  allAlarms.push(...workShortfall);

  const workedVacations = await calculateWorkedVacations(employeeId, startDate, endDate);
  allAlarms.push(...workedVacations);

  const weekly45h = await calculateWeekly45HourExceeded(employeeId, startDate, endDate);
  allAlarms.push(...weekly45h);

  const currentYear = new Date().getFullYear();
  const annualExceeded = await calculateAnnualHoursExceeded(employeeId, currentYear);
  allAlarms.push(...annualExceeded);

  const alarmsToInsert = allAlarms.map(alarm => ({
    ...alarm,
    supervisor_id: supervisorId,
    employee_id: employeeId,
  }));

  return alarmsToInsert;
};
