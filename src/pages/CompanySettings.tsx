import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { UserPlus, Search, Check, X } from 'lucide-react';

interface Supervisor {
  id: string;
  fiscal_name: string;
  email: string;
  phone: string;
  document_type: string;
  document_number: string;
  supervisor_type: 'center';
  work_centers: string[];
  pin: string;
  is_active: boolean;
  created_at: string;
}

interface NewSupervisor {
  fiscal_name: string;
  email: string;
  phone: string;
  document_type: string;
  document_number: string;
  supervisor_type: 'center';
  work_centers: string[];
  employee_id: string;
}

export default function CompanySettings() {
  const modalRef = useRef<HTMLDivElement>(null);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [isAddingSuper, setIsAddingSuper] = useState(false);
  const [activeTab, setActiveTab] = useState<'supervisors' | 'workCenters' | 'collectiveAgreements' | 'holidays'>('supervisors');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [workCenterOptions, setWorkCenterOptions] = useState<string[]>([]);
  const [newSupervisor, setNewSupervisor] = useState<NewSupervisor>({
    fiscal_name: '',
    email: '',
    phone: '',
    document_type: 'DNI',
    document_number: '',
    supervisor_type: 'center',
    work_centers: [],
    employee_id: ''
  });

  useEffect(() => {
    fetchSupervisors();
    fetchWorkCenters();
  }, []);

  const fetchSupervisors = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('supervisor_profiles')
        .select(`
          id,
          fiscal_name,
          email,
          phone,
          document_type,
          document_number,
          supervisor_type,
          work_centers,
          pin,
          is_active,
          created_at
        `)
        .eq('company_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSupervisors(data || []);
    } catch (err) {
      console.error('Error fetching supervisors:', err);
    }
  };

  const fetchWorkCenters = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('employee_profiles')
        .select('work_centers')
        .eq('company_id', user.id);

      if (error) throw error;

      const uniqueWorkCenters = Array.from(new Set(data.flatMap(profile => profile.work_centers)));
      setWorkCenterOptions(uniqueWorkCenters);
    } catch (err) {
      console.error('Error fetching work centers:', err);
    }
  };

  const handleAddSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No se encontró el usuario autenticado');

      const pin = Math.floor(100000 + Math.random() * 900000).toString();

      const { error: insertError } = await supabase
        .from('supervisor_profiles')
        .insert([{
          ...newSupervisor,
          company_id: user.id,
          pin,
          is_active: true
        }]);

      if (insertError) throw insertError;

      await fetchSupervisors();
      setIsAddingSuper(false);
      setNewSupervisor({
        fiscal_name: '',
        email: '',
        phone: '',
        document_type: 'DNI',
        document_number: '',
        supervisor_type: 'center',
        work_centers: [],
        employee_id: ''
      });

      alert(`Supervisor creado con éxito.\n\nCredenciales para Portal Supervisor:\nEmail: ${newSupervisor.email}\nPIN: ${pin}\n\nPor favor, comparta estas credenciales de forma segura.`);

    } catch (err) {
      console.error('Error adding supervisor:', err);
      setError(err instanceof Error ? err.message : 'Error al añadir supervisor');
    } finally {
      setLoading(false);
    }
  };

  const filteredSupervisors = supervisors.filter(sup =>
    sup.fiscal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sup.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Tabs Navigation */}
        <div className="bg-white rounded-xl shadow-sm mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('supervisors')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'supervisors'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Coordinadores
              </button>
              <button
                onClick={() => setActiveTab('workCenters')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'workCenters'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Centros de Trabajo
              </button>
              <button
                onClick={() => setActiveTab('collectiveAgreements')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'collectiveAgreements'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Convenio Colectivo
              </button>
              <button
                onClick={() => setActiveTab('holidays')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'holidays'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Festivos
              </button>
            </nav>
          </div>
        </div>

        {activeTab === 'supervisors' && (
        <>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Coordinadores</h2>
            <button
              onClick={() => setIsAddingSuper(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-5 h-5" />
              Añadir Coordinador
            </button>
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Buscar coordinadores..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Supervisors Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Asignaciones
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PIN
                  </th>
                  <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSupervisors.map((supervisor) => (
                  <tr key={supervisor.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {supervisor.fiscal_name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-500">
                        {supervisor.email}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        Centro
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-500">
                        {supervisor.work_centers?.join(', ')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-mono text-gray-900">
                        {supervisor.pin}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        supervisor.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {supervisor.is_active ? (
                          <>
                            <Check className="w-3 h-3" />
                            Activo
                          </>
                        ) : (
                          <>
                            <X className="w-3 h-3" />
                            Inactivo
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add Supervisor Modal */}
        {isAddingSuper && (
          <div className="fixed inset-0 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div 
              ref={modalRef}
              className="bg-white rounded-lg p-6 max-w-md w-full my-8"
              style={{ maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="flex justify-between items-center mb-4 sticky top-0 bg-white z-10 py-2">
                <h2 className="text-xl font-semibold">Añadir Nuevo Coordinador</h2>
                <button
                  onClick={() => setIsAddingSuper(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              {error && (
                <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleAddSupervisor} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={newSupervisor.fiscal_name}
                    onChange={(e) => setNewSupervisor({...newSupervisor, fiscal_name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={newSupervisor.email}
                    onChange={(e) => setNewSupervisor({...newSupervisor, email: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    value={newSupervisor.phone}
                    onChange={(e) => setNewSupervisor({...newSupervisor, phone: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Documento
                  </label>
                  <select
                    value={newSupervisor.document_type}
                    onChange={(e) => setNewSupervisor({...newSupervisor, document_type: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="DNI">DNI</option>
                    <option value="NIE">NIE</option>
                    <option value="Pasaporte">Pasaporte</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número de Documento
                  </label>
                  <input
                    type="text"
                    value={newSupervisor.document_number}
                    onChange={(e) => setNewSupervisor({...newSupervisor, document_number: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Centros de Trabajo
                  </label>
                  <select
                    multiple
                    value={newSupervisor.work_centers}
                    onChange={(e) => {
                      const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
                      setNewSupervisor({...newSupervisor, work_centers: selectedOptions});
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                    size={5}
                  >
                    {workCenterOptions.map(center => (
                      <option key={center} value={center}>
                        {center}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-gray-500">
                    Mantén presionado Ctrl (Cmd en Mac) para seleccionar múltiples centros
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ID de Empleado
                  </label>
                  <input
                    type="text"
                    value={newSupervisor.employee_id}
                    onChange={(e) => setNewSupervisor({...newSupervisor, employee_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end gap-4 mt-6 sticky bottom-0 bg-white py-4 border-t">
                  <button
                    type="button"
                    onClick={() => setIsAddingSuper(false)}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Añadiendo...' : 'Añadir Coordinador'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        </>
        )}

        {activeTab === 'workCenters' && (
          <WorkCentersTab />
        )}

        {activeTab === 'collectiveAgreements' && (
          <CollectiveAgreementsTab />
        )}

        {activeTab === 'holidays' && (
          <HolidaysTab />
        )}
      </div>
    </div>
  );
}

function WorkCentersTab() {
  const [workCenters, setWorkCenters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCenter, setSelectedCenter] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showHolidaysModal, setShowHolidaysModal] = useState(false);
  const [showAddHolidayModal, setShowAddHolidayModal] = useState(false);
  const [collectiveAgreements, setCollectiveAgreements] = useState<any[]>([]);
  const [centerHolidays, setCenterHolidays] = useState<any[]>([]);
  const [newCenterHoliday, setNewCenterHoliday] = useState({
    name: '',
    date: ''
  });
  const [comunidades] = useState([
    'Andalucía', 'Aragón', 'Asturias', 'Islas Baleares', 'Canarias', 'Cantabria',
    'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Comunidad Valenciana',
    'Extremadura', 'Galicia', 'La Rioja', 'Madrid', 'Murcia', 'Navarra', 'País Vasco'
  ]);
  const [municipios] = useState([
    'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Málaga', 'Murcia',
    'Palma de Mallorca', 'Las Palmas', 'Bilbao', 'Alicante', 'Córdoba', 'Valladolid',
    'Vigo', 'Gijón', 'Hospitalet de Llobregat', 'A Coruña', 'Vitoria', 'Granada',
    'Elche', 'Oviedo', 'Badalona', 'Cartagena', 'Terrassa', 'Jerez de la Frontera',
    'Sabadell', 'Santa Cruz de Tenerife', 'Móstoles', 'Alcalá de Henares', 'Pamplona'
  ]);
  const [editAddress, setEditAddress] = useState({
    address: '',
    comunidad: '',
    municipio: '',
    postal_code: '',
    collective_agreement_id: ''
  });

  useEffect(() => {
    fetchWorkCenters();
    fetchCollectiveAgreements();
  }, []);

  const fetchCollectiveAgreements = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('collective_agreements')
        .select('*')
        .eq('company_id', user.id);

      if (error) throw error;
      setCollectiveAgreements(data || []);
    } catch (err) {
      console.error('Error fetching collective agreements:', err);
    }
  };

  const fetchWorkCenters = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: employees, error: empError } = await supabase
        .from('employee_profiles')
        .select('work_centers')
        .eq('company_id', user.id);

      if (empError) throw empError;

      const uniqueCenters = new Set<string>();
      employees?.forEach(emp => {
        if (Array.isArray(emp.work_centers)) {
          emp.work_centers.forEach(center => uniqueCenters.add(center));
        }
      });

      const { data: addressData } = await supabase
        .from('work_center_address')
        .select('*')
        .eq('company_id', user.id);

      const centersWithAddress = Array.from(uniqueCenters).map(centerName => {
        const address = addressData?.find(addr => addr.work_center_name === centerName);
        return {
          id: centerName,
          name: centerName,
          address
        };
      });

      setWorkCenters(centersWithAddress || []);
    } catch (err) {
      console.error('Error fetching work centers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (center: any) => {
    setSelectedCenter(center);
    setEditAddress({
      address: center.address?.address || '',
      comunidad: center.address?.comunidad || '',
      municipio: center.address?.municipio || '',
      postal_code: center.address?.postal_code || '',
      collective_agreement_id: center.address?.collective_agreement_id || ''
    });
    setShowEditModal(true);
  };

  const handleViewHolidays = async (center: any) => {
    setSelectedCenter(center);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .eq('company_id', user.id)
        .contains('work_centers', [center.name])
        .order('date', { ascending: true });

      if (error) throw error;
      setCenterHolidays(data || []);
      setShowHolidaysModal(true);
    } catch (err) {
      console.error('Error fetching center holidays:', err);
    }
  };

  const handleAddCenterHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !selectedCenter) return;

      const { error } = await supabase
        .from('holidays')
        .insert({
          company_id: user.id,
          name: newCenterHoliday.name,
          date: newCenterHoliday.date,
          holiday_type: 'work_center',
          work_centers: [selectedCenter.name],
          work_center: selectedCenter.name
        });

      if (error) throw error;

      await handleViewHolidays(selectedCenter);
      setShowAddHolidayModal(false);
      setNewCenterHoliday({ name: '', date: '' });
    } catch (err) {
      console.error('Error adding center holiday:', err);
    }
  };

  const handleSaveAddress = async () => {
    try {
      if (!selectedCenter) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (selectedCenter.address) {
        const { error } = await supabase
          .from('work_center_address')
          .update({
            ...editAddress,
            updated_at: new Date().toISOString()
          })
          .eq('work_center_name', selectedCenter.name)
          .eq('company_id', user.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('work_center_address')
          .insert({
            company_id: user.id,
            work_center_name: selectedCenter.name,
            ...editAddress
          });

        if (error) throw error;
      }

      if (editAddress.collective_agreement_id) {
        const { data: agreement } = await supabase
          .from('collective_agreements')
          .select('total_annual_hours')
          .eq('id', editAddress.collective_agreement_id)
          .single();

        if (agreement) {
          await supabase
            .from('employee_profiles')
            .update({ total_annual_hours: agreement.total_annual_hours })
            .eq('company_id', user.id)
            .contains('work_centers', [selectedCenter.name]);
        }
      }

      await fetchWorkCenters();
      setShowEditModal(false);
      setSelectedCenter(null);
    } catch (err) {
      console.error('Error saving address:', err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="text-xl font-semibold mb-6">Centros de Trabajo</h2>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nombre
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Dirección
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Comunidad
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Municipio
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Convenio Colectivo
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Festivos
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center">
                  Cargando...
                </td>
              </tr>
            ) : workCenters.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center">
                  No hay centros de trabajo
                </td>
              </tr>
            ) : (
              workCenters.map((center) => {
                const agreement = collectiveAgreements.find(a => a.id === center.address?.collective_agreement_id);
                return (
                <tr key={center.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {center.name}
                  </td>
                  <td className="px-6 py-4">
                    {center.address?.address || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {center.address?.comunidad || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {center.address?.municipio || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {agreement?.name || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleViewHolidays(center)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Ver Festivos
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleEditClick(center)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Configurar
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showEditModal && selectedCenter && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">
                  Configurar Dirección: {selectedCenter.name}
                </h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveAddress();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dirección
                  </label>
                  <input
                    type="text"
                    value={editAddress.address}
                    onChange={(e) => setEditAddress({ ...editAddress, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Comunidad Autónoma
                  </label>
                  <select
                    value={editAddress.comunidad}
                    onChange={(e) => setEditAddress({ ...editAddress, comunidad: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Selecciona una comunidad</option>
                    {comunidades.map((com) => (
                      <option key={com} value={com}>
                        {com}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Municipio
                  </label>
                  <select
                    value={editAddress.municipio}
                    onChange={(e) => setEditAddress({ ...editAddress, municipio: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Selecciona un municipio</option>
                    {municipios.map((mun) => (
                      <option key={mun} value={mun}>
                        {mun}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Código Postal
                  </label>
                  <input
                    type="text"
                    value={editAddress.postal_code}
                    onChange={(e) => setEditAddress({ ...editAddress, postal_code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Convenio Colectivo
                  </label>
                  <select
                    value={editAddress.collective_agreement_id}
                    onChange={(e) => setEditAddress({ ...editAddress, collective_agreement_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Sin convenio</option>
                    {collectiveAgreements.map((agreement) => (
                      <option key={agreement.id} value={agreement.id}>
                        {agreement.name} ({agreement.total_annual_hours}h)
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-gray-500">
                    Al seleccionar un convenio, la jornada anual de los empleados de este centro se actualizará automáticamente.
                  </p>
                </div>

                <div className="flex justify-end gap-4 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showHolidaysModal && selectedCenter && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">
                  Festivos de {selectedCenter.name}
                </h2>
                <button
                  onClick={() => setShowHolidaysModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <button
                  onClick={() => setShowAddHolidayModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <UserPlus className="w-5 h-5" />
                  Añadir Festivo Específico de Este Centro
                </button>
              </div>
              {centerHolidays.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No hay festivos configurados para este centro</p>
              ) : (
                <div className="space-y-3">
                  {centerHolidays.map((holiday) => (
                    <div key={holiday.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium">{holiday.name}</p>
                        <p className="text-sm text-gray-500">
                          {new Date(holiday.date).toLocaleDateString('es-ES', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAddHolidayModal && selectedCenter && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full">
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Añadir Festivo para {selectedCenter.name}</h3>
              <form onSubmit={handleAddCenterHoliday} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del Festivo
                  </label>
                  <input
                    type="text"
                    value={newCenterHoliday.name}
                    onChange={(e) => setNewCenterHoliday({ ...newCenterHoliday, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={newCenterHoliday.date}
                    onChange={(e) => setNewCenterHoliday({ ...newCenterHoliday, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <p className="text-sm text-gray-500">
                  Este festivo solo afectará al centro de trabajo {selectedCenter.name}
                </p>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddHolidayModal(false)}
                    className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Añadir Festivo
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectiveAgreementsTab() {
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAgreement, setNewAgreement] = useState({
    name: '',
    total_annual_hours: 1826
  });

  useEffect(() => {
    fetchAgreements();
  }, []);

  const fetchAgreements = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('collective_agreements')
        .select('*')
        .eq('company_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAgreements(data || []);
    } catch (err) {
      console.error('Error fetching agreements:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('collective_agreements')
        .insert({
          company_id: user.id,
          name: newAgreement.name,
          total_annual_hours: newAgreement.total_annual_hours
        });

      if (error) throw error;

      await fetchAgreements();
      setShowAddModal(false);
      setNewAgreement({ name: '', total_annual_hours: 1826 });
    } catch (err) {
      console.error('Error adding agreement:', err);
    }
  };

  const handleDeleteAgreement = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este convenio colectivo?')) return;

    try {
      const { error } = await supabase
        .from('collective_agreements')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchAgreements();
    } catch (err) {
      console.error('Error deleting agreement:', err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Convenios Colectivos</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <UserPlus className="w-5 h-5" />
          Añadir Nuevo Convenio
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nombre del Convenio
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Jornada Cómputo Total
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-6 py-4 text-center">
                  Cargando...
                </td>
              </tr>
            ) : agreements.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-4 text-center">
                  No hay convenios colectivos
                </td>
              </tr>
            ) : (
              agreements.map((agreement) => (
                <tr key={agreement.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {agreement.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {agreement.total_annual_hours} horas
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleDeleteAgreement(agreement.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Añadir Nuevo Convenio Colectivo</h3>
              <form onSubmit={handleAddAgreement} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del Convenio
                  </label>
                  <input
                    type="text"
                    value={newAgreement.name}
                    onChange={(e) => setNewAgreement({ ...newAgreement, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Jornada Cómputo Total (horas anuales)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newAgreement.total_annual_hours}
                    onChange={(e) => setNewAgreement({ ...newAgreement, total_annual_hours: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Añadir Convenio
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HolidaysTab() {
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [workCenters, setWorkCenters] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState({
    name: '',
    date: '',
    holiday_type: 'work_center' as 'work_center' | 'comunidad' | 'municipio',
    work_center: '',
    comunidad: '',
    municipio: ''
  });
  const [comunidades] = useState([
    'Andalucía', 'Aragón', 'Asturias', 'Islas Baleares', 'Canarias', 'Cantabria',
    'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Comunidad Valenciana',
    'Extremadura', 'Galicia', 'La Rioja', 'Madrid', 'Murcia', 'Navarra', 'País Vasco'
  ]);
  const [municipios] = useState([
    'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Málaga', 'Murcia',
    'Palma de Mallorca', 'Las Palmas', 'Bilbao', 'Alicante', 'Córdoba', 'Valladolid',
    'Vigo', 'Gijón', 'Hospitalet de Llobregat', 'A Coruña', 'Vitoria', 'Granada',
    'Elche', 'Oviedo', 'Badalona', 'Cartagena', 'Terrassa', 'Jerez de la Frontera',
    'Sabadell', 'Santa Cruz de Tenerife', 'Móstoles', 'Alcalá de Henares', 'Pamplona'
  ]);

  useEffect(() => {
    fetchHolidays();
    fetchWorkCenters();
  }, []);

  const fetchWorkCenters = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: employees, error } = await supabase
        .from('employee_profiles')
        .select('work_centers')
        .eq('company_id', user.id);

      if (error) throw error;

      const uniqueCenters = new Set<string>();
      employees?.forEach(emp => {
        if (Array.isArray(emp.work_centers)) {
          emp.work_centers.forEach(center => uniqueCenters.add(center));
        }
      });

      setWorkCenters(Array.from(uniqueCenters));
    } catch (err) {
      console.error('Error fetching work centers:', err);
    }
  };

  const fetchHolidays = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .eq('company_id', user.id)
        .order('date', { ascending: true });

      if (error) throw error;
      setHolidays(data || []);
    } catch (err) {
      console.error('Error fetching holidays:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let affectedWorkCenters: string[] = [];

      if (newHoliday.holiday_type === 'nacional') {
        affectedWorkCenters = workCenters;
      } else if (newHoliday.holiday_type === 'work_center') {
        if (!newHoliday.work_center) {
          alert('Por favor selecciona un centro de trabajo');
          return;
        }
        affectedWorkCenters = [newHoliday.work_center];
      } else if (newHoliday.holiday_type === 'comunidad') {
        if (!newHoliday.comunidad) {
          alert('Por favor selecciona una comunidad');
          return;
        }
        const { data: addressData } = await supabase
          .from('work_center_address')
          .select('work_center_name')
          .eq('company_id', user.id)
          .eq('comunidad', newHoliday.comunidad);

        affectedWorkCenters = addressData?.map(addr => addr.work_center_name) || [];
      } else if (newHoliday.holiday_type === 'municipio') {
        if (!newHoliday.municipio) {
          alert('Por favor selecciona un municipio');
          return;
        }
        const { data: addressData } = await supabase
          .from('work_center_address')
          .select('work_center_name')
          .eq('company_id', user.id)
          .eq('municipio', newHoliday.municipio);

        affectedWorkCenters = addressData?.map(addr => addr.work_center_name) || [];
      }

      const { error } = await supabase
        .from('holidays')
        .insert({
          company_id: user.id,
          name: newHoliday.name,
          date: newHoliday.date,
          holiday_type: newHoliday.holiday_type === 'nacional' ? 'comunidad' : newHoliday.holiday_type,
          work_center: affectedWorkCenters.length > 0 ? affectedWorkCenters[0] : null,
          work_centers: affectedWorkCenters,
          comunidad: newHoliday.holiday_type === 'nacional' ? 'NACIONAL' : (newHoliday.holiday_type === 'comunidad' ? newHoliday.comunidad : null),
          municipio: newHoliday.holiday_type === 'municipio' ? newHoliday.municipio : null
        });

      if (error) throw error;

      await fetchHolidays();
      setShowAddModal(false);
      setNewHoliday({
        name: '',
        date: '',
        holiday_type: 'work_center',
        work_center: '',
        comunidad: '',
        municipio: ''
      });
    } catch (err) {
      console.error('Error adding holiday:', err);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este festivo?')) return;

    try {
      const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchHolidays();
    } catch (err) {
      console.error('Error deleting holiday:', err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Configuración de Festivos</h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <UserPlus className="w-5 h-5" />
          Añadir Festivo
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nombre
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Fecha
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tipo
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Centros de Trabajo
              </th>
              <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center">
                  Cargando...
                </td>
              </tr>
            ) : holidays.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center">
                  No hay festivos configurados
                </td>
              </tr>
            ) : (
              holidays.map((holiday) => {
                const typeLabel = holiday.holiday_type === 'nacional' ? 'Nacional' :
                                  holiday.holiday_type === 'work_center' ? 'Centro de Trabajo' :
                                holiday.holiday_type === 'comunidad' ? 'Comunidad' : 'Municipio';
                return (
                <tr key={holiday.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {holiday.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {new Date(holiday.date).toLocaleDateString('es-ES')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                      {typeLabel}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {holiday.work_centers?.map((center: string) => (
                        <span key={center} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                          {center}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleDeleteHoliday(holiday.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Añadir Festivo</h3>
              <form onSubmit={handleAddHoliday} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del Festivo
                  </label>
                  <input
                    type="text"
                    value={newHoliday.name}
                    onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={newHoliday.date}
                    onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Festivo
                  </label>
                  <select
                    value={newHoliday.holiday_type}
                    onChange={(e) => setNewHoliday({ ...newHoliday, holiday_type: e.target.value as 'nacional' | 'work_center' | 'comunidad' | 'municipio' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="nacional">Nacional</option>
                    <option value="work_center">Centro de Trabajo</option>
                    <option value="comunidad">Comunidad</option>
                    <option value="municipio">Municipio</option>
                  </select>
                </div>

                {newHoliday.holiday_type === 'work_center' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Centro de Trabajo
                    </label>
                    <select
                      value={newHoliday.work_center}
                      onChange={(e) => setNewHoliday({ ...newHoliday, work_center: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Selecciona un centro</option>
                      {workCenters.map((center) => (
                        <option key={center} value={center}>
                          {center}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {newHoliday.holiday_type === 'comunidad' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Comunidad Autónoma
                    </label>
                    <select
                      value={newHoliday.comunidad}
                      onChange={(e) => setNewHoliday({ ...newHoliday, comunidad: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Selecciona una comunidad</option>
                      {comunidades.map((com) => (
                        <option key={com} value={com}>
                          {com}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {newHoliday.holiday_type === 'municipio' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Municipio
                    </label>
                    <select
                      value={newHoliday.municipio}
                      onChange={(e) => setNewHoliday({ ...newHoliday, municipio: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">Selecciona un municipio</option>
                      {municipios.map((mun) => (
                        <option key={mun} value={mun}>
                          {mun}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Añadir Festivo
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}