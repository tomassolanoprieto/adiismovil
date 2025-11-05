import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User, KeyRound, Save, AlertCircle, Clock, Calendar, Edit, Plus, Trash, Copy } from 'lucide-react';
import WorkScheduleModal from '../components/WorkScheduleModal';

const getCurrentWeekStart = (): string => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
};

export default function EmployeeProfile() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [allowScheduleConfig, setAllowScheduleConfig] = useState(false);
  const [profile, setProfile] = useState<{
    email: string;
    pin: string;
    fiscal_name: string;
    document_type: string;
    document_number: string;
    delegation: string;
    employee_id: string;
    work_centers: string[];
    job_positions: string[];
    seniority_date: string;
    work_schedule: { 
      [key: string]: { 
        morning_shift?: { start_time: string, end_time: string },
        afternoon_shift?: { start_time: string, end_time: string }
      } | null 
    };
  } | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [employeeSchedules, setEmployeeSchedules] = useState<any[]>([]);
  const [currentWeek, setCurrentWeek] = useState<string>(getCurrentWeekStart());
  const [showWorkScheduleModal, setShowWorkScheduleModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [weekSchedule, setWeekSchedule] = useState<any>({});

  useEffect(() => {
    fetchProfile();
    fetchEmployeeSchedules();
    fetchCompanySettings();
  }, []);

  const fetchCompanySettings = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      // Get employee's company_id first
      const { data: employeeData, error: employeeError } = await supabase
        .from('employee_profiles')
        .select('company_id')
        .eq('id', employeeId)
        .single();

      if (employeeError) throw employeeError;
      if (!employeeData?.company_id) return;

      // Get company settings
      const { data: companyData, error: companyError } = await supabase
        .from('company_profiles')
        .select('allow_employee_schedule_config')
        .eq('id', employeeData.company_id)
        .single();

      if (companyError) throw companyError;
      setAllowScheduleConfig(companyData?.allow_employee_schedule_config || false);
    } catch (err) {
      console.error('Error fetching company settings:', err);
    }
  };

  const fetchProfile = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      const { data: profile, error } = await supabase
        .from('employee_profiles')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (error) throw error;
      setProfile(profile);
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError('Error al cargar el perfil');
    }
  };

  const fetchEmployeeSchedules = async () => {
    try {
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) return;

      const { data, error } = await supabase
        .from('employee_schedules')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', currentWeek)
        .order('date', { ascending: true });

      if (error) throw error;
      setEmployeeSchedules(data || []);
    } catch (err) {
      console.error('Error fetching employee schedules:', err);
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
        throw new Error('El PIN debe ser de 6 dígitos numéricos');
      }

      if (newPin !== confirmPin) {
        throw new Error('Los PINs no coinciden');
      }

      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) {
        throw new Error('No se encontró el ID del empleado');
      }

      const { error: updateError } = await supabase
        .rpc('update_employee_pin', {
          p_employee_id: employeeId,
          p_new_pin: newPin
        });

      if (updateError) throw updateError;

      setSuccess(true);
      setNewPin('');
      setConfirmPin('');
      await fetchProfile();
    } catch (err) {
      console.error('Error updating PIN:', err);
      setError(err instanceof Error ? err.message : 'Error al actualizar el PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleEditSchedule = () => {
    setShowWorkScheduleModal(true);
  };

  const handleSaveWorkSchedule = async (scheduleData: string) => {
    try {
      setLoading(true);
      
      const employeeId = localStorage.getItem('employeeId');
      if (!employeeId) throw new Error('No se encontró el ID del empleado');

      // Update the work_schedule field in employee_profiles
      const { error } = await supabase
        .from('employee_profiles')
        .update({ work_schedule: scheduleData })
        .eq('id', employeeId);

      if (error) throw error;

      await fetchEmployeeSchedules();
      setShowWorkScheduleModal(false);
      setSuccess(true);
      
    } catch (err) {
      console.error('Error updating work schedule:', err);
      setError(err instanceof Error ? err.message : 'Error al actualizar el horario laboral');
    } finally {
      setLoading(false);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const currentDate = new Date(currentWeek);
    if (direction === 'prev') {
      currentDate.setDate(currentDate.getDate() - 7);
    } else {
      currentDate.setDate(currentDate.getDate() + 7);
    }
    setCurrentWeek(currentDate.toISOString().split('T')[0]);
  };

  useEffect(() => {
    fetchEmployeeSchedules();
  }, [currentWeek]);

  const getScheduleForDate = (date: string) => {
    return employeeSchedules.find(schedule => schedule.date === date);
  };

  const formatTime = (time: string | null) => {
    if (!time) return '--:--';
    return time;
  };

  const renderWeekSchedule = () => {
    const weekStart = new Date(currentWeek);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      return date;
    });

    const dayNames = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    return (
      <div className="space-y-4">
        {weekDays.map((date, index) => {
          const dateString = date.toISOString().split('T')[0];
          const schedule = getScheduleForDate(dateString);
          const dayName = dayNames[index];

          return (
            <div key={dateString} className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-medium text-lg">{dayName}</h4>
                <span className="text-sm text-gray-500">
                  {date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Turno Mañana */}
                <div className="bg-blue-50 p-3 rounded-lg">
                  <h5 className="font-medium text-blue-800 mb-2">Turno Mañana</h5>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Entrada:</span>
                      <span className="font-medium">{formatTime(schedule?.morning_start)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Salida:</span>
                      <span className="font-medium">{formatTime(schedule?.morning_end)}</span>
                    </div>
                  </div>
                </div>

                {/* Turno Tarde */}
                <div className="bg-orange-50 p-3 rounded-lg">
                  <h5 className="font-medium text-orange-800 mb-2">Turno Tarde</h5>
                  {schedule?.enabled && schedule?.afternoon_start && schedule?.afternoon_end ? (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Entrada:</span>
                        <span className="font-medium">{formatTime(schedule.afternoon_start)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Salida:</span>
                        <span className="font-medium">{formatTime(schedule.afternoon_end)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-2">
                      No programado
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-6">Mi Perfil</h2>

        {/* Información del perfil */}
        <div className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Nombre</h3>
              </div>
              <p className="text-gray-700">{profile?.fiscal_name}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Correo Electrónico</h3>
              </div>
              <p className="text-gray-700">{profile?.email}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Tipo Documento</h3>
              </div>
              <p className="text-gray-700">{profile?.document_type}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Número Documento</h3>
              </div>
              <p className="text-gray-700">{profile?.document_number}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Delegación</h3>
              </div>
              <p className="text-gray-700">{profile?.delegation}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">ID</h3>
              </div>
              <p className="text-gray-700">{profile?.employee_id}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Centros de Trabajo</h3>
              </div>
              <p className="text-gray-700">{profile?.work_centers?.join(', ')}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Puestos de Trabajo</h3>
              </div>
              <p className="text-gray-700">{profile?.job_positions?.join(', ')}</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Antigüedad</h3>
              </div>
              <p className="text-gray-700">{profile?.seniority_date}</p>
            </div>
          </div>
        </div>

        {/* Formulario para cambiar PIN */}
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4">Cambiar PIN</h3>
          
          {error && (
            <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 text-green-700">
              PIN actualizado correctamente
            </div>
          )}

          <form onSubmit={handleUpdatePin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nuevo PIN
              </label>
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                maxLength={6}
                pattern="\d{6}"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Ingresa 6 dígitos"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirmar Nuevo PIN
              </label>
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                maxLength={6}
                pattern="\d{6}"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Confirma los 6 dígitos"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {loading ? 'Actualizando...' : 'Actualizar PIN'}
            </button>
          </form>
        </div>

        {/* Horario Laboral Asignado - Solo mostrar si está permitido */}
        {allowScheduleConfig && (
          <div className="mt-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                Mi Horario Laboral
              </h3>
              <button
                onClick={handleEditSchedule}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Edit className="w-4 h-4" />
                Modificar Horario
              </button>
            </div>
            
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => navigateWeek('prev')}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                ← Semana Anterior
              </button>
              
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <span className="font-medium">
                  Semana del {new Date(currentWeek).toLocaleDateString('es-ES', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric' 
                  })}
                </span>
              </div>
              
              <button
                onClick={() => navigateWeek('next')}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Semana Siguiente →
              </button>
            </div>

            {employeeSchedules.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No tienes horario laboral asignado para esta semana</p>
                <p className="text-sm text-gray-500 mt-2">
                  Contacta con tu supervisor para que configure tu horario
                </p>
              </div>
            ) : (
              renderWeekSchedule()
            )}
          </div>
        )}
      </div>

      {/* Work Schedule Modal */}
      {showWorkScheduleModal && profile && allowScheduleConfig && (
        <WorkScheduleModal
          employee={{
            id: profile.id || '',
            fiscal_name: profile.fiscal_name,
            total_hours: profile.total_hours || 0,
            work_centers: profile.work_centers || []
          }}
          onClose={() => setShowWorkScheduleModal(false)}
          onSave={handleSaveWorkSchedule}
          initialSchedule={profile.work_schedule || ''}
        />
      )}
    </div>
  );
}