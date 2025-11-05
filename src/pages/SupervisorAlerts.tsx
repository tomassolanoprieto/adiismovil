import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AlertTriangle, Clock, Download, Search, RefreshCw, Check, X } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import CalendarSignatureAlert from '../components/CalendarSignatureAlert';

interface Alarm {
  id: string;
  supervisor_id: string;
  employee_id: string;
  alarm_type: 'late_clock_in' | 'missed_clock_in' | 'missed_clock_out' | 'overtime' | 'work_shortfall' | 'worked_vacation' | 'weekly_45h_exceeded' | 'annual_hours_exceeded';
  alarm_date: string;
  description: string;
  hours_involved: number;
  is_read: boolean;
  email_sent: boolean;
  created_at: string;
  employee?: {
    fiscal_name: string;
    work_centers: string[];
  };
}

export default function SupervisorAlerts() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [filteredAlarms, setFilteredAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const [supervisorEmail] = useState<string | null>(() => localStorage.getItem('supervisorEmail'));

  useEffect(() => {
    console.log('SupervisorAlerts mounted. Email:', supervisorEmail);
    loadAlarms();
  }, []);

  useEffect(() => {
    filterAlarms();
  }, [alarms, selectedType, searchTerm, showUnreadOnly]);

  const loadAlarms = async () => {
    console.log('=== LOADING ALARMS START ===');
    console.log('Supervisor Email from state:', supervisorEmail);

    try {
      setLoading(true);

      if (!supervisorEmail) {
        console.error('❌ No supervisor email in state');
        const storedEmail = localStorage.getItem('supervisorEmail');
        console.error('Email in localStorage:', storedEmail);
        toast.error('No se encontró el email del coordinador');
        setLoading(false);
        return;
      }

      console.log('✓ Fetching supervisor profile for:', supervisorEmail);

      const { data: supervisorData, error: supervisorError } = await supabase
        .from('supervisor_profiles')
        .select('id')
        .eq('email', supervisorEmail)
        .eq('is_active', true)
        .maybeSingle();

      console.log('Supervisor query result:', { supervisorData, supervisorError });

      if (supervisorError) {
        console.error('❌ Error fetching supervisor profile:', supervisorError);
        toast.error('Error al obtener el perfil del coordinador');
        setLoading(false);
        return;
      }

      if (!supervisorData) {
        console.error('❌ No supervisor profile found for email:', supervisorEmail);
        toast.error('No se encontró el perfil del coordinador');
        setLoading(false);
        return;
      }

      const supervisorId = supervisorData.id;
      console.log('✓ Supervisor ID found:', supervisorId);

      console.log('Fetching alarms for supervisor ID:', supervisorId);

      const { data: alarmsData, error: alarmsError } = await supabase
        .from('coordinator_alarms')
        .select(`
          *,
          employee:employee_profiles(fiscal_name, work_centers)
        `)
        .eq('supervisor_id', supervisorId)
        .order('alarm_date', { ascending: false })
        .order('created_at', { ascending: false });

      console.log('Alarms query result:', { alarmsData, alarmsError, count: alarmsData?.length });

      if (alarmsError) {
        console.error('❌ Error fetching alarms:', alarmsError);
        throw alarmsError;
      }

      console.log('✓ Alarms loaded successfully:', alarmsData?.length || 0);
      console.log('Alarms data:', alarmsData);

      setAlarms(alarmsData || []);

      if (alarmsData && alarmsData.length > 0) {
        toast.success(`${alarmsData.length} alarma(s) cargada(s)`);
      } else {
        console.log('⚠️ No alarms found for supervisor');
      }
    } catch (error) {
      console.error('❌ ERROR LOADING ALARMS:', error);
      toast.error('Error al cargar las alarmas');
    } finally {
      setLoading(false);
      console.log('=== LOADING ALARMS END ===');
    }
  };

  const filterAlarms = () => {
    console.log('Filtering alarms. Total alarms:', alarms.length);
    let filtered = [...alarms];

    if (selectedType !== 'all') {
      filtered = filtered.filter(alarm => alarm.alarm_type === selectedType);
      console.log('After type filter:', filtered.length);
    }

    if (searchTerm) {
      filtered = filtered.filter(alarm =>
        alarm.employee?.fiscal_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        alarm.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (showUnreadOnly) {
      filtered = filtered.filter(alarm => !alarm.is_read);
      console.log('After unread filter:', filtered.length);
    }

    console.log('Final filtered alarms:', filtered.length);
    setFilteredAlarms(filtered);
  };

  const markAsRead = async (alarmId: string) => {
    try {
      const { error } = await supabase
        .from('coordinator_alarms')
        .update({ is_read: true })
        .eq('id', alarmId);

      if (error) throw error;

      setAlarms(prev =>
        prev.map(alarm =>
          alarm.id === alarmId ? { ...alarm, is_read: true } : alarm
        )
      );

      toast.success('Alarma marcada como leída');
    } catch (error) {
      console.error('Error marking alarm as read:', error);
      toast.error('Error al marcar como leída');
    }
  };

  const deleteAlarm = async (alarmId: string) => {
    if (!confirm('¿Está seguro de que desea eliminar esta alarma?')) return;

    try {
      const { error } = await supabase
        .from('coordinator_alarms')
        .delete()
        .eq('id', alarmId);

      if (error) throw error;

      setAlarms(prev => prev.filter(alarm => alarm.id !== alarmId));
      toast.success('Alarma eliminada');
    } catch (error) {
      console.error('Error deleting alarm:', error);
      toast.error('Error al eliminar la alarma');
    }
  };

  const exportToExcel = () => {
    const exportData = filteredAlarms.map(alarm => ({
      'Empleado': alarm.employee?.fiscal_name || 'N/A',
      'Tipo': getAlarmTypeText(alarm.alarm_type),
      'Fecha': new Date(alarm.alarm_date).toLocaleDateString('es-ES'),
      'Descripción': alarm.description,
      'Horas involucradas': alarm.hours_involved.toFixed(2),
      'Estado': alarm.is_read ? 'Leída' : 'No leída',
      'Email enviado': alarm.email_sent ? 'Sí' : 'No',
      'Creada': new Date(alarm.created_at).toLocaleString('es-ES'),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alarmas');

    const fileName = `alarmas_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success('Excel exportado correctamente');
  };

  const getAlarmTypeText = (type: string): string => {
    switch (type) {
      case 'late_clock_in':
        return 'Fichaje con retraso';
      case 'missed_clock_in':
        return 'Entrada no realizada';
      case 'missed_clock_out':
        return 'Salida no realizada';
      case 'overtime':
        return 'Horas extras';
      case 'work_shortfall':
        return 'Merma de trabajo';
      case 'worked_vacation':
        return 'Trabajó en vacaciones';
      case 'weekly_45h_exceeded':
        return 'Superó 45h semanales';
      case 'annual_hours_exceeded':
        return 'Superó límite anual';
      default:
        return type;
    }
  };

  const getAlarmTypeColor = (type: string): string => {
    switch (type) {
      case 'late_clock_in':
        return 'bg-yellow-100 text-yellow-800';
      case 'missed_clock_in':
        return 'bg-red-100 text-red-800';
      case 'missed_clock_out':
        return 'bg-red-100 text-red-800';
      case 'overtime':
        return 'bg-orange-100 text-orange-800';
      case 'work_shortfall':
        return 'bg-red-100 text-red-800';
      case 'worked_vacation':
        return 'bg-purple-100 text-purple-800';
      case 'weekly_45h_exceeded':
        return 'bg-pink-100 text-pink-800';
      case 'annual_hours_exceeded':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getAlarmTypeCounts = () => {
    return {
      all: alarms.length,
      late_clock_in: alarms.filter(a => a.alarm_type === 'late_clock_in' && !a.is_read).length,
      missed_clock_in: alarms.filter(a => a.alarm_type === 'missed_clock_in' && !a.is_read).length,
      missed_clock_out: alarms.filter(a => a.alarm_type === 'missed_clock_out' && !a.is_read).length,
      overtime: alarms.filter(a => a.alarm_type === 'overtime' && !a.is_read).length,
      work_shortfall: alarms.filter(a => a.alarm_type === 'work_shortfall' && !a.is_read).length,
      worked_vacation: alarms.filter(a => a.alarm_type === 'worked_vacation' && !a.is_read).length,
      weekly_45h_exceeded: alarms.filter(a => a.alarm_type === 'weekly_45h_exceeded' && !a.is_read).length,
      annual_hours_exceeded: alarms.filter(a => a.alarm_type === 'annual_hours_exceeded' && !a.is_read).length,
    };
  };

  const counts = getAlarmTypeCounts();

  return (
    <div className="p-8">
      <Toaster position="top-right" />
      <div className="max-w-7xl mx-auto">
        <CalendarSignatureAlert />

        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Alarmas Automáticas</h1>
          <p className="text-gray-600">
            Sistema de alarmas basado en fichajes y horarios laborales
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-6">
          <button
            onClick={() => setSelectedType('all')}
            className={`p-4 rounded-lg border-2 transition-all ${
              selectedType === 'all'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-blue-600">{counts.all}</div>
            <div className="text-xs text-gray-600 mt-1">Todas</div>
          </button>

          <button
            onClick={() => setSelectedType('late_clock_in')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'late_clock_in'
                ? 'border-yellow-600 bg-yellow-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-yellow-600">{counts.late_clock_in}</div>
            <div className="text-xs text-gray-600 mt-1">Retrasos</div>
          </button>

          <button
            onClick={() => setSelectedType('missed_clock_in')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'missed_clock_in'
                ? 'border-red-600 bg-red-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-red-600">{counts.missed_clock_in}</div>
            <div className="text-xs text-gray-600 mt-1">Sin Entrada</div>
          </button>

          <button
            onClick={() => setSelectedType('missed_clock_out')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'missed_clock_out'
                ? 'border-red-600 bg-red-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-red-600">{counts.missed_clock_out}</div>
            <div className="text-xs text-gray-600 mt-1">Sin Salida</div>
          </button>

          <button
            onClick={() => setSelectedType('overtime')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'overtime'
                ? 'border-orange-600 bg-orange-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-orange-600">{counts.overtime}</div>
            <div className="text-xs text-gray-600 mt-1">Horas a compensar de más</div>
          </button>

          <button
            onClick={() => setSelectedType('work_shortfall')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'work_shortfall'
                ? 'border-red-600 bg-red-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-red-600">{counts.work_shortfall}</div>
            <div className="text-xs text-gray-600 mt-1">Horas a compensar de menos</div>
          </button>

          <button
            onClick={() => setSelectedType('worked_vacation')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'worked_vacation'
                ? 'border-purple-600 bg-purple-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-purple-600">{counts.worked_vacation}</div>
            <div className="text-xs text-gray-600 mt-1">Fichajes fuera de jornada</div>
          </button>

          <button
            onClick={() => setSelectedType('weekly_45h_exceeded')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'weekly_45h_exceeded'
                ? 'border-pink-600 bg-pink-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-pink-600">{counts.weekly_45h_exceeded}</div>
            <div className="text-xs text-gray-600 mt-1">+45h/sem</div>
          </button>

          <button
            onClick={() => setSelectedType('annual_hours_exceeded')}
            className={`p-4 rounded-lg border-2 transition-all relative ${
              selectedType === 'annual_hours_exceeded'
                ? 'border-red-600 bg-red-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl font-bold text-red-600">{counts.annual_hours_exceeded}</div>
            <div className="text-xs text-gray-600 mt-1">Límite Anual</div>
          </button>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex-1 min-w-[300px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar por empleado o descripción..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  showUnreadOnly
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                {showUnreadOnly ? 'Ver todas' : 'Solo no leídas'}
              </button>

              <button
                onClick={loadAlarms}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </button>

              <button
                onClick={exportToExcel}
                disabled={filteredAlarms.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Exportar
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Empleado
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Descripción
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Horas
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
                      Cargando alarmas...
                    </td>
                  </tr>
                ) : filteredAlarms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <div className="text-gray-500">
                        {alarms.length === 0 ? (
                          <>
                            <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                            <p className="text-lg font-medium">No hay alarmas registradas</p>
                            <p className="text-sm mt-2">Las alarmas aparecerán aquí cuando se generen</p>
                          </>
                        ) : (
                          <>
                            <Search className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                            <p className="text-lg font-medium">No se encontraron alarmas</p>
                            <p className="text-sm mt-2">Intenta ajustar los filtros de búsqueda</p>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAlarms.map((alarm) => (
                    <tr
                      key={alarm.id}
                      className={`hover:bg-gray-50 ${
                        !alarm.is_read ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        {!alarm.is_read ? (
                          <div className="w-3 h-3 bg-blue-600 rounded-full" title="No leída" />
                        ) : (
                          <Check className="w-4 h-4 text-green-600" title="Leída" />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {alarm.employee?.fiscal_name || 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${getAlarmTypeColor(
                            alarm.alarm_type
                          )}`}
                        >
                          {getAlarmTypeText(alarm.alarm_type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(alarm.alarm_date).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-md">
                        {alarm.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {alarm.hours_involved > 0
                          ? `${alarm.hours_involved.toFixed(2)}h`
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-2">
                          {!alarm.is_read && (
                            <button
                              onClick={() => markAsRead(alarm.id)}
                              className="text-blue-600 hover:text-blue-800"
                              title="Marcar como leída"
                            >
                              <Check className="w-5 h-5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteAlarm(alarm.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Eliminar"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 text-sm text-gray-500 text-center">
          Mostrando {filteredAlarms.length} de {alarms.length} alarmas
        </div>
      </div>
    </div>
  );
}
