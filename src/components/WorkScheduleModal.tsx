import React, { useState, useEffect } from 'react';
import { X, Plus, Trash, Clock, Calendar, Copy, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Employee {
  id: string;
  fiscal_name: string;
  total_hours: number;
  work_centers: string[];
}

interface DaySchedule {
  morning: {
    start: string;
    end: string;
  };
  afternoon: {
    start: string;
    end: string;
    enabled: boolean;
  };
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
  date: string;
  name: string;
  work_centers: string[];
}

interface WorkScheduleModalProps {
  employee: Employee;
  onClose: () => void;
  onSave: (scheduleData: string, employeeId: string) => void;
  initialSchedule?: string;
}

const defaultDaySchedule: DaySchedule = {
  morning: {
    start: '09:00',
    end: '14:00'
  },
  afternoon: {
    start: '16:00',
    end: '19:00',
    enabled: false
  }
};

const defaultWeekSchedule: WeekSchedule = {
  monday: { ...defaultDaySchedule },
  tuesday: { ...defaultDaySchedule },
  wednesday: { ...defaultDaySchedule },
  thursday: { ...defaultDaySchedule },
  friday: { ...defaultDaySchedule },
  saturday: { ...defaultDaySchedule },
  sunday: { ...defaultDaySchedule }
};

export default function WorkScheduleModal({ employee, onClose, onSave, initialSchedule }: WorkScheduleModalProps) {
  const [schedule, setSchedule] = useState<WeekSchedule>(defaultWeekSchedule);
  const [selectedWeek, setSelectedWeek] = useState<string>(getCurrentWeekStart());
  const [schedules, setSchedules] = useState<Record<string, WeekSchedule>>({});
  const [totalAssignedHours, setTotalAssignedHours] = useState<number>(0);
  const [remainingHours, setRemainingHours] = useState<number>(employee.total_hours || 0);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [excludedHolidays, setExcludedHolidays] = useState<Set<string>>(new Set());
  const [holidayWarning, setHolidayWarning] = useState<{show: boolean, day: string, holiday: string, holidayId?: string} | null>(null);
  const [ignoredHolidays, setIgnoredHolidays] = useState<Set<string>>(new Set());
  const [showCompensatoryModal, setShowCompensatoryModal] = useState(false);
  const [selectedHolidayForCompensatory, setSelectedHolidayForCompensatory] = useState<{date: string, name: string} | null>(null);
  const [compensatoryDate, setCompensatoryDate] = useState('');
  const [showExcludeHolidayModal, setShowExcludeHolidayModal] = useState(false);
  const [pendingHolidayAction, setPendingHolidayAction] = useState<{day: string, holidayId: string} | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showDateError, setShowDateError] = useState(false);
  const [showDateRangeModal, setShowDateRangeModal] = useState(false);
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');

  // Load initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);
        
        // Fetch existing schedules from employee_schedules table
        const { data: schedulesData, error: schedulesError } = await supabase
          .from('employee_schedules')
          .select('*')
          .eq('employee_id', employee.id)
          .order('date', { ascending: true });

        if (schedulesError) throw schedulesError;

        // Convert schedules to the weeks format
        const schedulesByWeek: Record<string, WeekSchedule> = {};
        
        if (schedulesData && schedulesData.length > 0) {
          // Group by week (each Monday)
          const weeksMap = new Map<string, any[]>();
          
          schedulesData.forEach(schedule => {
            const date = new Date(schedule.date);
            const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
            const monday = new Date(date);
            monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            const mondayStr = monday.toISOString().split('T')[0];
            
            if (!weeksMap.has(mondayStr)) {
              weeksMap.set(mondayStr, []);
            }
            weeksMap.get(mondayStr)?.push(schedule);
          });

          // Convert to WeekSchedule format
          weeksMap.forEach((days, weekStart) => {
            const weekSchedule: WeekSchedule = { ...defaultWeekSchedule, weekStart };
            
            days.forEach(day => {
              const date = new Date(day.date);
              const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
              
              if (dayName && weekSchedule[dayName as keyof WeekSchedule]) {
                weekSchedule[dayName as keyof WeekSchedule] = {
                  morning: {
                    start: day.morning_start || '',
                    end: day.morning_end || ''
                  },
                  afternoon: {
                    start: day.afternoon_start || '',
                    end: day.afternoon_end || '',
                    enabled: day.enabled || false
                  }
                };
              }
            });
            
            schedulesByWeek[weekStart] = weekSchedule;
          });
        }

        setSchedules(schedulesByWeek);
        
        // Set the current week's schedule
        if (schedulesByWeek[selectedWeek]) {
          setSchedule(schedulesByWeek[selectedWeek]);
        }

        // Fetch holidays
        const { data: holidaysData, error: holidaysError } = await supabase
          .from('holidays')
          .select('*')
          .or(`work_center.in.(${employee.work_centers.map(wc => `"${wc}"`).join(',')}),work_center.is.null`);

        if (holidaysError) throw holidaysError;

        setHolidays(holidaysData || []);

        // Fetch excluded holidays for this employee
        const { data: exclusionsData, error: exclusionsError } = await supabase
          .from('employee_holiday_exclusions')
          .select('holiday_id')
          .eq('employee_id', employee.id);

        if (exclusionsError) throw exclusionsError;

        const excludedIds = new Set(exclusionsData?.map(e => e.holiday_id) || []);
        setExcludedHolidays(excludedIds);
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [employee.id, employee.work_centers, selectedWeek]);

  // Calculate total assigned hours
  useEffect(() => {
    let totalHours = 0;
    
    Object.values(schedules).forEach(weekSchedule => {
      totalHours += calculateTotalHoursForWeek(weekSchedule);
    });
    
    setTotalAssignedHours(totalHours);
    setRemainingHours(Math.max(0, (employee.total_hours || 0) - totalHours));
  }, [schedules, employee.total_hours]);

  const calculateTotalHoursForWeek = (weekSchedule: WeekSchedule): number => {
    let totalHours = 0;
    
    Object.values(weekSchedule).forEach(daySchedule => {
      if (typeof daySchedule === 'object' && 'morning' in daySchedule) {
        // Morning hours
        if (daySchedule.morning.start && daySchedule.morning.end) {
          const morningStart = parseTimeToHours(daySchedule.morning.start);
          const morningEnd = parseTimeToHours(daySchedule.morning.end);
          totalHours += morningEnd - morningStart;
        }
        
        // Afternoon hours if enabled
        if (daySchedule.afternoon.enabled && daySchedule.afternoon.start && daySchedule.afternoon.end) {
          const afternoonStart = parseTimeToHours(daySchedule.afternoon.start);
          const afternoonEnd = parseTimeToHours(daySchedule.afternoon.end);
          totalHours += afternoonEnd - afternoonStart;
        }
      }
    });
    
    return totalHours;
  };

  const parseTimeToHours = (timeString: string): number => {
    if (!timeString || timeString === '') return 0;
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours + (minutes / 60);
  };

  const handleDayChange = (day: keyof WeekSchedule, period: 'morning' | 'afternoon', field: 'start' | 'end', value: string) => {
    // Check if this day is a holiday
    if (selectedWeek) {
      const weekStartDate = new Date(selectedWeek);
      const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(day);
      const dayDate = new Date(weekStartDate);
      dayDate.setDate(weekStartDate.getDate() + dayIndex);
      
      const dateString = dayDate.toISOString().split('T')[0];
      const holiday = holidays.find(h => h.date === dateString && !excludedHolidays.has(h.id));

      if (holiday && !ignoredHolidays.has(`${dateString}-${day}-${period}-${field}`)) {
        const dayNames = {
          monday: 'Lunes',
          tuesday: 'Martes',
          wednesday: 'Miércoles',
          thursday: 'Jueves',
          friday: 'Viernes',
          saturday: 'Sábado',
          sunday: 'Domingo'
        };
        
        setHolidayWarning({
          show: true,
          day: dayNames[day as keyof typeof dayNames],
          holiday: holiday.name,
          holidayId: holiday.id
        });
        return;
      }
    }
    
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [period]: {
          ...prev[day][period],
          [field]: value
        }
      }
    }));
  };

  const toggleAfternoonShift = (day: keyof WeekSchedule) => {
    if (selectedWeek) {
      const weekStartDate = new Date(selectedWeek);
      const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(day);
      const dayDate = new Date(weekStartDate);
      dayDate.setDate(weekStartDate.getDate() + dayIndex);
      
      const dateString = dayDate.toISOString().split('T')[0];
      const holiday = holidays.find(h => h.date === dateString && !excludedHolidays.has(h.id));

      if (holiday && !schedule[day].afternoon.enabled && !ignoredHolidays.has(`${dateString}-${day}-afternoon-toggle`)) {
        const dayNames = {
          monday: 'Lunes',
          tuesday: 'Martes',
          wednesday: 'Miércoles',
          thursday: 'Jueves',
          friday: 'Viernes',
          saturday: 'Sábado',
          sunday: 'Domingo'
        };
        
        setHolidayWarning({
          show: true,
          day: dayNames[day as keyof typeof dayNames],
          holiday: holiday.name,
          holidayId: holiday.id
        });
        return;
      }
    }
    
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        afternoon: {
          ...prev[day].afternoon,
          enabled: !prev[day].afternoon.enabled
        }
      }
    }));
  };

  const copyScheduleToAllDays = (fromDay: keyof WeekSchedule) => {
    const daySchedule = schedule[fromDay];
    
    setSchedule(prev => {
      const newSchedule = { ...prev };
      
      (Object.keys(newSchedule) as Array<keyof WeekSchedule>).forEach(day => {
        if (day !== fromDay && day !== 'weekStart') {
          newSchedule[day] = JSON.parse(JSON.stringify(daySchedule));
        }
      });
      
      return newSchedule;
    });
  };

  const copyScheduleToWeekdays = (fromDay: keyof WeekSchedule) => {
    const daySchedule = schedule[fromDay];
    
    setSchedule(prev => {
      const newSchedule = { ...prev };
      
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
        if (day !== fromDay) {
          newSchedule[day as keyof WeekSchedule] = JSON.parse(JSON.stringify(daySchedule));
        }
      });
      
      return newSchedule;
    });
  };

  const handleWeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedDate = new Date(e.target.value);
    const dayOfWeek = selectedDate.getDay();
    
    if (dayOfWeek !== 1) {
      setShowDateError(true);
      setTimeout(() => setShowDateError(false), 3000);
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      selectedDate.setDate(selectedDate.getDate() - diff);
    }
    
    const newWeek = selectedDate.toISOString().split('T')[0];
    setSelectedWeek(newWeek);
    
    if (schedules[newWeek]) {
      setSchedule(schedules[newWeek]);
    } else {
      setSchedule({
        ...defaultWeekSchedule,
        weekStart: newWeek
      });
    }
  };

  const handleDeleteWeek = async (weekStart: string) => {
    try {
      setLoading(true);
      
      // Calculate dates for this week
      const weekStartDate = new Date(weekStart);
      const weekDates = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStartDate);
        date.setDate(weekStartDate.getDate() + i);
        return date.toISOString().split('T')[0];
      });

      // Delete schedules for these dates
      const { error } = await supabase
        .from('employee_schedules')
        .delete()
        .eq('employee_id', employee.id)
        .in('date', weekDates);

      if (error) throw error;

      // Update local state
      const updatedSchedules = { ...schedules };
      delete updatedSchedules[weekStart];
      setSchedules(updatedSchedules);
      
      // If the current selected week was deleted, select another week or reset
      if (selectedWeek === weekStart) {
        const remainingWeeks = Object.keys(updatedSchedules);
        if (remainingWeeks.length > 0) {
          setSelectedWeek(remainingWeeks[0]);
          setSchedule(updatedSchedules[remainingWeeks[0]]);
        } else {
          setSelectedWeek(getCurrentWeekStart());
          setSchedule(defaultWeekSchedule);
        }
      }
    } catch (error) {
      console.error('Error deleting week:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      
      // Calculate dates for this week
      const weekStartDate = new Date(selectedWeek);
      const weekDates = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStartDate);
        date.setDate(weekStartDate.getDate() + i);
        return date.toISOString().split('T')[0];
      });

      // Prepare schedules for each day
      const daySchedules = weekDates.map((date, i) => {
        const dayName = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i];
        const daySchedule = schedule[dayName as keyof WeekSchedule];
        
        return {
          employee_id: employee.id,
          date,
          morning_start: daySchedule.morning.start || null,
          morning_end: daySchedule.morning.end || null,
          afternoon_start: daySchedule.afternoon.enabled && daySchedule.afternoon.start ? daySchedule.afternoon.start : null,
          afternoon_end: daySchedule.afternoon.enabled && daySchedule.afternoon.end ? daySchedule.afternoon.end : null,
          enabled: daySchedule.afternoon.enabled
        };
      });

      // Delete existing schedules for these dates
      await supabase
        .from('employee_schedules')
        .delete()
        .eq('employee_id', employee.id)
        .in('date', weekDates);

      // Insert new schedules
      const { error } = await supabase
        .from('employee_schedules')
        .insert(daySchedules);

      if (error) throw error;

      // Update local state
      const updatedSchedule = {
        ...schedule,
        weekStart: selectedWeek
      };
      
      const updatedSchedules = {
        ...schedules,
        [selectedWeek]: updatedSchedule
      };
      
      setSchedules(updatedSchedules);
      
      // Format for work_schedule field (backward compatibility)
      const formattedSchedule = {
        weeks: updatedSchedules
      };

      onSave(JSON.stringify(formattedSchedule), employee.id);
    } catch (error) {
      console.error('Error saving schedule:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyScheduleToAllYear = () => {
    setShowConfirmation(true);
  };

  const confirmApplyToAllYear = async () => {
    try {
      setLoading(true);
      
      // Generate dates for all Mondays in the current year
      const currentYear = new Date().getFullYear();
      const startDate = new Date(currentYear, 0, 1); // January 1st
      const endDate = new Date(currentYear, 11, 31); // December 31st
      
      // Find the first Monday of the year
      const firstMonday = new Date(startDate);
      while (firstMonday.getDay() !== 1) {
        firstMonday.setDate(firstMonday.getDate() + 1);
      }
      
      // Generate all Mondays of the year
      const mondays: string[] = [];
      for (let d = new Date(firstMonday); d <= endDate; d.setDate(d.getDate() + 7)) {
        mondays.push(d.toISOString().split('T')[0]);
      }
      
      // Prepare schedules for all weeks
      const allSchedules: any[] = [];
      
      mondays.forEach(monday => {
        const weekStartDate = new Date(monday);
        const weekDates = Array.from({ length: 7 }, (_, i) => {
          const date = new Date(weekStartDate);
          date.setDate(weekStartDate.getDate() + i);
          return date.toISOString().split('T')[0];
        });

        weekDates.forEach((date, i) => {
          const dayName = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i];
          const daySchedule = schedule[dayName as keyof WeekSchedule];
          
          allSchedules.push({
            employee_id: employee.id,
            date,
            morning_start: daySchedule.morning.start || null,
            morning_end: daySchedule.morning.end || null,
            afternoon_start: daySchedule.afternoon.enabled && daySchedule.afternoon.start ? daySchedule.afternoon.start : null,
            afternoon_end: daySchedule.afternoon.enabled && daySchedule.afternoon.end ? daySchedule.afternoon.end : null,
            enabled: daySchedule.afternoon.enabled
          });
        });
      });

      // Delete all existing schedules for this employee
      await supabase
        .from('employee_schedules')
        .delete()
        .eq('employee_id', employee.id);

      // Insert all new schedules in batches
      const batchSize = 100;
      for (let i = 0; i < allSchedules.length; i += batchSize) {
        const batch = allSchedules.slice(i, i + batchSize);
        const { error } = await supabase
          .from('employee_schedules')
          .insert(batch);

        if (error) throw error;
      }

      // Update local state
      const yearSchedules: Record<string, WeekSchedule> = {};
      
      mondays.forEach(monday => {
        yearSchedules[monday] = {
          ...JSON.parse(JSON.stringify(schedule)),
          weekStart: monday
        };
      });
      
      setSchedules(yearSchedules);
      setShowConfirmation(false);
      
      // Format for work_schedule field (backward compatibility)
      const formattedSchedule = {
        weeks: yearSchedules
      };

      onSave(JSON.stringify(formattedSchedule), employee.id);
    } catch (error) {
      console.error('Error applying schedule to all year:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyScheduleToDateRange = () => {
    setShowDateRangeModal(true);
  };

  const adjustToMonday = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 1) {
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      date.setDate(date.getDate() - diff);
    }
    return date.toISOString().split('T')[0];
  };

  const adjustToSunday = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0) {
      const diff = 7 - dayOfWeek;
      date.setDate(date.getDate() + diff);
    }
    return date.toISOString().split('T')[0];
  };

  const handleStartDateChange = (dateString: string) => {
    const adjustedDate = adjustToMonday(dateString);
    setRangeStartDate(adjustedDate);
  };

  const handleEndDateChange = (dateString: string) => {
    const adjustedDate = adjustToSunday(dateString);
    setRangeEndDate(adjustedDate);
  };

  const confirmApplyToDateRange = async () => {
    try {
      setLoading(true);

      if (!rangeStartDate || !rangeEndDate) {
        alert('Por favor, selecciona ambas fechas');
        return;
      }

      const startDate = new Date(rangeStartDate);
      const endDate = new Date(rangeEndDate);

      if (startDate > endDate) {
        alert('La fecha de inicio debe ser anterior a la fecha de fin');
        return;
      }

      // Generate all Mondays in the date range
      const mondays: string[] = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 7)) {
        mondays.push(d.toISOString().split('T')[0]);
      }

      // Prepare schedules for all weeks in range
      const allSchedules: any[] = [];

      mondays.forEach(monday => {
        const weekStartDate = new Date(monday);
        const weekDates = Array.from({ length: 7 }, (_, i) => {
          const date = new Date(weekStartDate);
          date.setDate(weekStartDate.getDate() + i);
          return date.toISOString().split('T')[0];
        });

        weekDates.forEach((date, i) => {
          const dayName = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i];
          const daySchedule = schedule[dayName as keyof WeekSchedule];

          allSchedules.push({
            employee_id: employee.id,
            date,
            morning_start: daySchedule.morning.start || null,
            morning_end: daySchedule.morning.end || null,
            afternoon_start: daySchedule.afternoon.enabled && daySchedule.afternoon.start ? daySchedule.afternoon.start : null,
            afternoon_end: daySchedule.afternoon.enabled && daySchedule.afternoon.end ? daySchedule.afternoon.end : null,
            enabled: daySchedule.afternoon.enabled
          });
        });
      });

      // Delete existing schedules in the date range
      const allDates = allSchedules.map(s => s.date);
      await supabase
        .from('employee_schedules')
        .delete()
        .eq('employee_id', employee.id)
        .in('date', allDates);

      // Insert all new schedules in batches
      const batchSize = 100;
      for (let i = 0; i < allSchedules.length; i += batchSize) {
        const batch = allSchedules.slice(i, i + batchSize);
        const { error } = await supabase
          .from('employee_schedules')
          .insert(batch);

        if (error) throw error;
      }

      // Update local state
      const rangeSchedules: Record<string, WeekSchedule> = {};

      mondays.forEach(monday => {
        rangeSchedules[monday] = {
          ...JSON.parse(JSON.stringify(schedule)),
          weekStart: monday
        };
      });

      // Merge with existing schedules
      const updatedSchedules = {
        ...schedules,
        ...rangeSchedules
      };

      setSchedules(updatedSchedules);
      setShowDateRangeModal(false);
      setRangeStartDate('');
      setRangeEndDate('');

      // Format for work_schedule field (backward compatibility)
      const formattedSchedule = {
        weeks: updatedSchedules
      };

      onSave(JSON.stringify(formattedSchedule), employee.id);
    } catch (error) {
      console.error('Error applying schedule to date range:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderDaySchedule = (day: keyof WeekSchedule, dayName: string) => {
    const daySchedule = schedule[day];

    // Check if this day is a holiday
    let isHoliday = false;
    let holidayName = '';
    let holidayId = '';

    if (selectedWeek) {
      const weekStartDate = new Date(selectedWeek);
      const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(day);
      const dayDate = new Date(weekStartDate);
      dayDate.setDate(weekStartDate.getDate() + dayIndex);

      const dateString = dayDate.toISOString().split('T')[0];
      const holiday = holidays.find(h => h.date === dateString && !excludedHolidays.has(h.id));

      if (holiday) {
        isHoliday = true;
        holidayName = holiday.name;
        holidayId = holiday.id;
      }
    }
    
    return (
      <div className={`border rounded-lg p-4 mb-4 ${isHoliday ? 'border-orange-300 bg-orange-50' : ''}`}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            {dayName}
            {isHoliday && (
              <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded-full flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Festivo: {holidayName}
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
              <input
                type="time"
                value={daySchedule.morning.end}
                onChange={(e) => handleDayChange(day, 'morning', 'end', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                daySchedule.afternoon.enabled 
                  ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {daySchedule.afternoon.enabled ? (
                <>
                  <Trash className="w-3 h-3" />
                  <span>Eliminar turno</span>
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  <span>Añadir turno</span>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
                <input
                  type="time"
                  value={daySchedule.afternoon.end}
                  onChange={(e) => handleDayChange(day, 'afternoon', 'end', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
    const dayKeys: (keyof WeekSchedule)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    return days.map((dayName, index) => {
      const day = dayKeys[index];
      const daySchedule = schedule[day];
      
      let scheduleText = `${dayName}: ${daySchedule.morning.start} - ${daySchedule.morning.end}`;
      
      if (daySchedule.afternoon.enabled) {
        scheduleText += ` y ${daySchedule.afternoon.start} - ${daySchedule.afternoon.end}`;
      }
      
      return scheduleText;
    }).join('\n');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  function getCurrentWeekStart(): string {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday, etc.
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  const calculateWeekHours = (weekSchedule: WeekSchedule): number => {
    return calculateTotalHoursForWeek(weekSchedule);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">
            Configurar Horario - {employee.fiscal_name}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

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
                Se ha ajustado automáticamente al lunes de esa semana
              </p>
            )}
          </div>

          {/* Hours information */}
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-blue-600" />
              <h3 className="font-medium">Información de horas</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Jornada Cómputo Total:</p>
                <p className="font-semibold">{employee.total_hours || 0} horas</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Horas asignadas:</p>
                <p className="font-semibold">{totalAssignedHours.toFixed(2)} horas</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Horas pendientes:</p>
                <p className={`font-semibold ${remainingHours > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {remainingHours.toFixed(2)} horas
                </p>
              </div>
            </div>
          </div>

          {/* Apply to all year and date range buttons */}
          <div className="mb-4 flex gap-3">
            <button
              type="button"
              onClick={applyScheduleToAllYear}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              disabled={loading}
            >
              <Copy className="w-4 h-4" />
              Aplicar este horario a todas las semanas del año
            </button>
            <button
              type="button"
              onClick={applyScheduleToDateRange}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              disabled={loading}
            >
              <Calendar className="w-4 h-4" />
              Aplicar a rango de fechas
            </button>
          </div>

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
            <pre className="whitespace-pre-wrap text-sm text-gray-700">
              {formatScheduleForDisplay()}
            </pre>
          </div>

          {/* List of configured weeks */}
          <div className="mt-6 border-t pt-6">
            <h3 className="font-semibold text-lg mb-4">Semanas configuradas</h3>
            {Object.keys(schedules).length === 0 ? (
              <p className="text-gray-500 italic">No hay semanas configuradas</p>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                {Object.entries(schedules)
                  .sort(([weekA], [weekB]) => weekA.localeCompare(weekB))
                  .map(([weekStart, weekSchedule]) => (
                    <div 
                      key={weekStart} 
                      className={`p-3 border rounded-lg ${weekStart === selectedWeek ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">Semana del {formatDate(weekStart)}</p>
                          <p className="text-sm text-gray-600">
                            {calculateWeekHours(weekSchedule).toFixed(2)} horas semanales
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWeek(weekStart);
                              setSchedule(weekSchedule);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="p-1 text-blue-600 hover:text-blue-800"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteWeek(weekStart)}
                            className="p-1 text-red-600 hover:text-red-800"
                            disabled={loading}
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-4 mt-6">
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
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              disabled={loading}
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>

        {/* Confirmation modal for applying to all year */}
        {showConfirmation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">¿Estás seguro?</h3>
                <p className="text-gray-600 mt-2">
                  Esta acción aplicará el horario actual a todas las semanas del año, sobrescribiendo cualquier configuración existente.
                </p>
              </div>
              <div className="flex justify-center gap-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
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

        {/* Holiday warning modal */}
        {holidayWarning && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <AlertTriangle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">Día festivo detectado</h3>
                <p className="text-gray-600 mt-2">
                  Estás configurando un horario para el <span className="font-semibold">{holidayWarning.day}</span>, que es un día festivo: <span className="font-semibold">{holidayWarning.holiday}</span>.
                </p>
                <p className="text-gray-600 mt-2">
                  ¿Estás seguro de que deseas agregar un horario laboral a un día festivo?
                </p>
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
                    const day = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].find(d => {
                      const dayNames: Record<string, string> = {
                        monday: 'Lunes',
                        tuesday: 'Martes',
                        wednesday: 'Miércoles',
                        thursday: 'Jueves',
                        friday: 'Viernes',
                        saturday: 'Sábado',
                        sunday: 'Domingo'
                      };
                      return dayNames[d] === holidayWarning.day;
                    }) as keyof WeekSchedule;

                    if (day && holidayWarning.holidayId) {
                      setPendingHolidayAction({ day, holidayId: holidayWarning.holidayId });
                      setShowExcludeHolidayModal(true);
                    }

                    setHolidayWarning(null);
                  }}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                >
                  Continuar de todos modos
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Date Range Modal */}
        {showDateRangeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <Calendar className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">Aplicar horario a rango de fechas</h3>
                <p className="text-gray-600 mt-2">
                  Selecciona el rango de fechas al que deseas aplicar este horario.
                </p>
              </div>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de inicio
                  </label>
                  <input
                    type="date"
                    value={rangeStartDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {rangeStartDate && (
                    <p className="text-xs text-blue-600 mt-1">
                      Ajustado al lunes: {new Date(rangeStartDate).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de fin
                  </label>
                  <input
                    type="date"
                    value={rangeEndDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {rangeEndDate && (
                    <p className="text-xs text-blue-600 mt-1">
                      Ajustado al domingo: {new Date(rangeEndDate).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <strong>Nota:</strong> Las fechas se ajustan automáticamente. La fecha de inicio se mueve al lunes de esa semana y la fecha de fin al domingo de esa semana.
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

        {/* Exclude Holiday Modal */}
        {showExcludeHolidayModal && pendingHolidayAction && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="text-center mb-4">
                <Info className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold">Trabajar en día festivo</h3>
                <p className="text-gray-600 mt-2">
                  El empleado trabajará en este día festivo.
                </p>
                <p className="text-gray-600 mt-2 text-sm">
                  ¿Deseas asignar un día compensatorio por trabajar en festivo?
                </p>
              </div>
              <div className="flex justify-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={async () => {
                    const day = pendingHolidayAction.day;
                    const weekStartDate = new Date(selectedWeek);
                    const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(day);
                    const dayDate = new Date(weekStartDate);
                    dayDate.setDate(weekStartDate.getDate() + dayIndex);
                    const dateString = dayDate.toISOString().split('T')[0];

                    const newIgnoredHolidays = new Set(ignoredHolidays);
                    newIgnoredHolidays.add(`${dateString}-${day}-morning-start`);
                    newIgnoredHolidays.add(`${dateString}-${day}-morning-end`);
                    newIgnoredHolidays.add(`${dateString}-${day}-afternoon-start`);
                    newIgnoredHolidays.add(`${dateString}-${day}-afternoon-end`);
                    newIgnoredHolidays.add(`${dateString}-${day}-afternoon-toggle`);
                    setIgnoredHolidays(newIgnoredHolidays);

                    if (!schedule[day as keyof WeekSchedule].afternoon.enabled) {
                      setSchedule(prev => ({
                        ...prev,
                        [day]: {
                          ...prev[day as keyof WeekSchedule],
                          afternoon: {
                            ...prev[day as keyof WeekSchedule].afternoon,
                            enabled: true
                          }
                        }
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
                      await supabase
                        .from('employee_holiday_exclusions')
                        .insert({
                          employee_id: employee.id,
                          holiday_id: pendingHolidayAction.holidayId
                        });

                      const newExcluded = new Set(excludedHolidays);
                      newExcluded.add(pendingHolidayAction.holidayId);
                      setExcludedHolidays(newExcluded);

                      const day = pendingHolidayAction.day;
                      const weekStartDate = new Date(selectedWeek);
                      const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(day);
                      const dayDate = new Date(weekStartDate);
                      dayDate.setDate(weekStartDate.getDate() + dayIndex);
                      const dateString = dayDate.toISOString().split('T')[0];

                      const newIgnoredHolidays = new Set(ignoredHolidays);
                      newIgnoredHolidays.add(`${dateString}-${day}-morning-start`);
                      newIgnoredHolidays.add(`${dateString}-${day}-morning-end`);
                      newIgnoredHolidays.add(`${dateString}-${day}-afternoon-start`);
                      newIgnoredHolidays.add(`${dateString}-${day}-afternoon-end`);
                      newIgnoredHolidays.add(`${dateString}-${day}-afternoon-toggle`);
                      setIgnoredHolidays(newIgnoredHolidays);

                      if (!schedule[day as keyof WeekSchedule].afternoon.enabled) {
                        setSchedule(prev => ({
                          ...prev,
                          [day]: {
                            ...prev[day as keyof WeekSchedule],
                            afternoon: {
                              ...prev[day as keyof WeekSchedule].afternoon,
                              enabled: true
                            }
                          }
                        }));
                      }
                    } catch (error) {
                      console.error('Error excluding holiday:', error);
                    }

                    setShowExcludeHolidayModal(false);
                    setPendingHolidayAction(null);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Sí, excluir festivo
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const day = pendingHolidayAction.day;
                    const weekStartDate = new Date(selectedWeek);
                    const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(day);
                    const dayDate = new Date(weekStartDate);
                    dayDate.setDate(weekStartDate.getDate() + dayIndex);
                    const dateString = dayDate.toISOString().split('T')[0];

                    const holiday = holidays.find(h => h.date === dateString);

                    setSelectedHolidayForCompensatory({
                      date: dateString,
                      name: holiday?.name || 'Festivo'
                    });
                    setShowExcludeHolidayModal(false);
                    setShowCompensatoryModal(true);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Asignar compensatorio
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Compensatory Day Modal */}
        {showCompensatoryModal && selectedHolidayForCompensatory && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">Asignar Día Compensatorio</h3>
                <p className="text-gray-600 text-sm mb-4">
                  Trabajará en festivo: <strong>{selectedHolidayForCompensatory.name}</strong> ({selectedHolidayForCompensatory.date})
                </p>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fecha del día compensatorio:
                </label>
                <input
                  type="date"
                  value={compensatoryDate}
                  onChange={(e) => setCompensatoryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCompensatoryModal(false);
                    setSelectedHolidayForCompensatory(null);
                    setCompensatoryDate('');
                    setPendingHolidayAction(null);
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!compensatoryDate) {
                      alert('Por favor selecciona una fecha para el día compensatorio');
                      return;
                    }

                    try {
                      await supabase
                        .from('compensatory_days')
                        .insert({
                          employee_id: employee.id,
                          holiday_date: selectedHolidayForCompensatory.date,
                          compensatory_date: compensatoryDate,
                          status: 'pending'
                        });

                      if (pendingHolidayAction) {
                        await supabase
                          .from('employee_holiday_exclusions')
                          .insert({
                            employee_id: employee.id,
                            holiday_id: pendingHolidayAction.holidayId
                          });

                        const newExcluded = new Set(excludedHolidays);
                        newExcluded.add(pendingHolidayAction.holidayId);
                        setExcludedHolidays(newExcluded);

                        const day = pendingHolidayAction.day;
                        const dateString = selectedHolidayForCompensatory.date;

                        const newIgnoredHolidays = new Set(ignoredHolidays);
                        newIgnoredHolidays.add(`${dateString}-${day}-morning-start`);
                        newIgnoredHolidays.add(`${dateString}-${day}-morning-end`);
                        newIgnoredHolidays.add(`${dateString}-${day}-afternoon-start`);
                        newIgnoredHolidays.add(`${dateString}-${day}-afternoon-end`);
                        newIgnoredHolidays.add(`${dateString}-${day}-afternoon-toggle`);
                        setIgnoredHolidays(newIgnoredHolidays);

                        if (!schedule[day as keyof WeekSchedule].afternoon.enabled) {
                          setSchedule(prev => ({
                            ...prev,
                            [day]: {
                              ...prev[day as keyof WeekSchedule],
                              afternoon: {
                                ...prev[day as keyof WeekSchedule].afternoon,
                                enabled: true
                              }
                            }
                          }));
                        }
                      }

                      alert(`Día compensatorio asignado para el ${compensatoryDate}`);
                      setShowCompensatoryModal(false);
                      setSelectedHolidayForCompensatory(null);
                      setCompensatoryDate('');
                      setPendingHolidayAction(null);
                    } catch (error) {
                      console.error('Error saving compensatory day:', error);
                      alert('Error al guardar el día compensatorio');
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}