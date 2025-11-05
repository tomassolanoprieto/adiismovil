import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { UserPlus, UserX, Download, Upload, Search, Check, X, Edit, Save, Clock } from 'lucide-react';
import WorkScheduleModal from '../components/WorkScheduleModal';

interface Employee {
  id: string;
  fiscal_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  document_type: string;
  document_number: string;
  work_centers: string[];
  pin: string;
  employee_id: string;
  seniority_date: string;
  job_positions: string[];
  country: string;
  timezone: string;
  phone: string;
  total_hours: number;
  weekly_hours?: number;
  work_schedule?: string;
  calendar_signature_requested?: boolean;
  calendar_report_signed?: boolean;
  calendar_report_pdf_url?: string;
  calendar_report_signed_at?: string;
}

interface NewEmployee {
  fiscal_name: string;
  email: string;
  document_type: string;
  document_number: string;
  work_centers: string[];
  country: string;
  timezone: string;
  phone: string;
  employee_id: string;
  seniority_date: string;
  job_positions: string[];
  total_hours: number;
  weekly_hours: number;
}

export default function CompanyEmployees() {
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [showActive, setShowActive] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWorkCenter, setSelectedWorkCenter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmployee, setNewEmployee] = useState<NewEmployee>({
    fiscal_name: '',
    email: '',
    document_type: 'DNI',
    document_number: '',
    work_centers: [],
    country: 'España',
    timezone: 'Europe/Madrid',
    phone: '',
    employee_id: '',
    seniority_date: '',
    job_positions: [],
    total_hours: 0,
    weekly_hours: 40
  });
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingEmployeeData, setEditingEmployeeData] = useState<Employee | null>(null);
  const [workCenterInput, setWorkCenterInput] = useState('');
  const [jobPositionInput, setJobPositionInput] = useState('');
  const [existingWorkCenters, setExistingWorkCenters] = useState<string[]>([]);
  const [existingJobPositions, setExistingJobPositions] = useState<string[]>([]);
  const [showWorkScheduleModal, setShowWorkScheduleModal] = useState(false);
  const [selectedEmployeeForSchedule, setSelectedEmployeeForSchedule] = useState<Employee | null>(null);

  const employeesPerPage = 25;

  useEffect(() => {
    fetchEmployees();
    fetchExistingWorkCenters();
    fetchExistingJobPositions();
  }, [showActive]);

  const fetchEmployees = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('employee_profiles')
        .select('*')
        .eq('company_id', user.id)
        .eq('is_active', showActive)
        .order('fiscal_name', { ascending: true });

      if (data) {
        setEmployees(data);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const fetchExistingWorkCenters = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('employee_profiles')
        .select('work_centers')
        .eq('company_id', user.id);

      if (data) {
        const uniqueWorkCenters = Array.from(new Set(data.flatMap(emp => emp.work_centers)));
        setExistingWorkCenters(uniqueWorkCenters);
      }
    } catch (err) {
      console.error('Error fetching work centers:', err);
    }
  };

  const fetchExistingJobPositions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('employee_profiles')
        .select('job_positions')
        .eq('company_id', user.id);

      if (data) {
        const uniqueJobPositions = Array.from(new Set(data.flatMap(emp => emp.job_positions)));
        setExistingJobPositions(uniqueJobPositions);
      }
    } catch (err) {
      console.error('Error fetching job positions:', err);
    }
  };

  const handleEditClick = (employee: Employee) => {
    setEditingEmployeeId(employee.id);
    setEditingEmployeeData(employee);
  };

  const handleSaveClick = async () => {
    if (!editingEmployeeData) return;

    try {
      setLoading(true);
      setError(null);

      const originalEmployee = employees.find(e => e.id === editingEmployeeData.id);

      const hoursChanged = originalEmployee?.total_annual_hours !== editingEmployeeData.total_annual_hours;
      const centersChanged = JSON.stringify(originalEmployee?.work_centers?.sort()) !== JSON.stringify(editingEmployeeData.work_centers?.sort());

      if ((hoursChanged || centersChanged) && originalEmployee?.work_schedule) {
        const currentYear = new Date().getFullYear();

        const { data: existingHistory } = await supabase
          .from('calendar_history')
          .select('version')
          .eq('employee_id', editingEmployeeData.id)
          .eq('year', currentYear)
          .order('version', { ascending: false })
          .limit(1);

        const nextVersion = (existingHistory?.[0]?.version || 0) + 1;

        await supabase
          .from('calendar_history')
          .insert({
            employee_id: editingEmployeeData.id,
            year: currentYear,
            calendar_data: {
              work_schedule: originalEmployee.work_schedule,
              total_annual_hours: originalEmployee.total_annual_hours,
              work_centers: originalEmployee.work_centers
            },
            version: nextVersion,
            reason: hoursChanged ? 'Cambio de jornada anual' : 'Cambio de centro de trabajo',
            changed_by: (await supabase.auth.getUser()).data.user?.email || 'Sistema'
          });

        console.log(`Calendario guardado en historial: versión ${nextVersion}`);
      }

      const { error } = await supabase
        .from('employee_profiles')
        .update(editingEmployeeData)
        .eq('id', editingEmployeeData.id);

      if (error) throw error;

      await fetchEmployees();
      setEditingEmployeeId(null);
      setEditingEmployeeData(null);

      if (hoursChanged || centersChanged) {
        alert('Cambios guardados. El calendario anterior se guardó en el historial. Considera reenviar el calendario para firma.');
      }
    } catch (err) {
      console.error('Error updating employee:', err);
      setError(err instanceof Error ? err.message : 'Error al actualizar empleado');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelClick = () => {
    setEditingEmployeeId(null);
    setEditingEmployeeData(null);
  };

  const handleInputChange = (field: keyof Employee, value: string | string[] | number) => {
    if (editingEmployeeData) {
      setEditingEmployeeData({ ...editingEmployeeData, [field]: value });
    }
  };

  const handleAddWorkCenter = () => {
    if (workCenterInput.trim() === '') return;

    if (!existingWorkCenters.includes(workCenterInput)) {
      setExistingWorkCenters([...existingWorkCenters, workCenterInput]);
    }

    if (!newEmployee.work_centers.includes(workCenterInput)) {
      setNewEmployee({
        ...newEmployee,
        work_centers: [...newEmployee.work_centers, workCenterInput.trim()]
      });
    }

    setWorkCenterInput('');
  };

  const handleRemoveWorkCenter = (index: number) => {
    const newWorkCenters = newEmployee.work_centers.filter((_, i) => i !== index);
    setNewEmployee({
      ...newEmployee,
      work_centers: newWorkCenters
    });
  };

  const handleAddJobPosition = () => {
    if (jobPositionInput.trim() === '') return;

    if (!existingJobPositions.includes(jobPositionInput)) {
      setExistingJobPositions([...existingJobPositions, jobPositionInput]);
    }

    if (!newEmployee.job_positions.includes(jobPositionInput)) {
      setNewEmployee({
        ...newEmployee,
        job_positions: [...newEmployee.job_positions, jobPositionInput.trim()]
      });
    }

    setJobPositionInput('');
  };

  const handleRemoveJobPosition = (index: number) => {
    const newJobPositions = newEmployee.job_positions.filter((_, i) => i !== index);
    setNewEmployee({
      ...newEmployee,
      job_positions: newJobPositions
    });
  };

  const handleAddEmployee = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No se encontró el usuario autenticado');

      if (
        !newEmployee.fiscal_name ||
        !newEmployee.email ||
        !newEmployee.employee_id ||
        !newEmployee.seniority_date
      ) {
        throw new Error('Todos los campos obligatorios deben estar completos');
      }

      const seniorityDate = new Date(newEmployee.seniority_date);
      const currentYear = new Date().getFullYear();
      const startOfYear = new Date(currentYear, 0, 1);
      const endOfYear = new Date(currentYear, 11, 31);

      let proportionalHours = newEmployee.total_hours || 0;

      if (seniorityDate > startOfYear && proportionalHours > 0) {
        const totalDaysInYear = Math.ceil((endOfYear.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
        const remainingDays = Math.ceil((endOfYear.getTime() - seniorityDate.getTime()) / (1000 * 60 * 60 * 24));
        const proportion = remainingDays / totalDaysInYear;
        proportionalHours = Math.round(proportionalHours * proportion);

        console.log(`Cálculo proporcional: ${remainingDays}/${totalDaysInYear} días = ${(proportion * 100).toFixed(1)}% → ${proportionalHours}h`);
      }

      const { error } = await supabase
        .from('employee_profiles')
        .insert([{
          ...newEmployee,
          total_annual_hours: proportionalHours,
          company_id: user.id,
          is_active: true
        }]);

      if (error) throw error;

      await fetchEmployees();
      setIsAdding(false);
      setNewEmployee({
        fiscal_name: '',
        email: '',
        document_type: 'DNI',
        document_number: '',
        work_centers: [],
        country: 'España',
        timezone: 'Europe/Madrid',
        phone: '',
        employee_id: '',
        seniority_date: '',
        job_positions: [],
        total_hours: 0,
        weekly_hours: 40
      });
    } catch (err) {
      console.error('Error adding employee:', err);
      setError(err instanceof Error ? err.message : 'Error al añadir empleado');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateSelected = async () => {
    try {
      setLoading(true);

      const { error: updateError } = await supabase
        .from('employee_profiles')
        .update({ is_active: false })
        .in('id', selectedEmployees);

      if (updateError) {
        throw updateError;
      }

      setShowActive(false);
      await fetchEmployees();
      setSelectedEmployees([]);

      alert('Empleados desactivados correctamente');
    } catch (err) {
      console.error('Error deactivating employees:', err);
      alert('Error al desactivar empleados');
    } finally {
      setLoading(false);
    }
  };

  const handleActivateSelected = async () => {
    try {
      setLoading(true);

      const { error: updateError } = await supabase
        .from('employee_profiles')
        .update({ is_active: true })
        .in('id', selectedEmployees);

      if (updateError) {
        throw updateError;
      }

      setShowActive(true);
      await fetchEmployees();
      setSelectedEmployees([]);

      alert('Empleados reactivados correctamente');
    } catch (err) {
      console.error('Error reactivating employees:', err);
      alert('Error al reactivar empleados');
    } finally {
      setLoading(false);
    }
  };

  const handleExportEmployees = () => {
    const csvContent = [
      ['ID', 'Nombre', 'Tipo Documento', 'Documento', 'Email', 'Centros de Trabajo', 'Fecha Incorporación', 'Fecha Antigüedad', 'Estado', 'Puestos de Trabajo', 'Jornada Cómputo Total', 'Jornada Semanal'],
      ...employees.map(emp => [
        emp.employee_id,
        emp.fiscal_name,
        emp.document_type,
        emp.document_number,
        emp.email,
        emp.work_centers.join('; '),
        new Date(emp.created_at).toLocaleDateString(),
        emp.seniority_date ? new Date(emp.seniority_date).toLocaleDateString() : '',
        emp.is_active ? 'Activo' : 'Inactivo',
        emp.job_positions ? emp.job_positions.join('; ') : '',
        emp.total_hours || 0,
        emp.weekly_hours || 40
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'empleados.csv';
    link.click();
  };

  const handleImportEmployees = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target?.files?.[0];
    if (!file) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        const rows = text.split('\n').slice(1);

        for (const row of rows) {
          try {
            const [
              employee_id,
              fiscal_name,
              document_type,
              document_number,
              email,
              work_centers_str,
              _created_at,
              seniority_date,
              _is_active,
              job_positions_str,
              total_hours_str
            ] = row.split(',').map(field => field.trim().replace(/^"|"$/g, ''));

            if (!fiscal_name || !email) continue;

            const work_centers = work_centers_str ? work_centers_str.split(';').map(wc => wc.trim()) : [];
            const job_positions = job_positions_str ? job_positions_str.split(';').map(jp => jp.trim()) : [];
            const total_hours = total_hours_str ? parseInt(total_hours_str) || 0 : 0;

            let formattedSeniorityDate = null;
            if (seniority_date) {
              try {
                const [day, month, year] = seniority_date.split('/');
                if (day && month && year) {
                  formattedSeniorityDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

                  if (isNaN(Date.parse(formattedSeniorityDate))) {
                    formattedSeniorityDate = null;
                  }
                }
              } catch (err) {
                console.warn('Invalid date format:', seniority_date);
                formattedSeniorityDate = null;
              }
            }

            const { error: profileError } = await supabase
              .from('employee_profiles')
              .insert([{
                employee_id: employee_id || '',
                fiscal_name,
                email: email.toLowerCase(),
                document_type: document_type || 'DNI',
                document_number: document_number || '',
                work_centers,
                country: 'España',
                timezone: 'Europe/Madrid',
                seniority_date: formattedSeniorityDate,
                job_positions,
                total_hours,
                company_id: user.id,
                is_active: true
              }]);

            if (profileError) {
              console.error('Error importing employee:', profileError);
              continue;
            }
          } catch (err) {
            console.error('Error processing row:', err);
            continue;
          }
        }

        await fetchEmployees();

        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    } catch (err) {
      console.error('Error in handleImportEmployees:', err);
    }
  };

  const handleOpenWorkScheduleModal = (employee: Employee) => {
    setSelectedEmployeeForSchedule(employee);
    setShowWorkScheduleModal(true);
  };

  const handleSaveWorkSchedule = async (scheduleData: string, employeeId: string) => {
    if (!selectedEmployeeForSchedule) return;

    try {
      setLoading(true);

      const { error } = await supabase
        .from('employee_profiles')
        .update({ work_schedule: scheduleData })
        .eq('id', selectedEmployeeForSchedule.id);

      if (error) throw error;

      await fetchEmployees();
      setShowWorkScheduleModal(false);
      setSelectedEmployeeForSchedule(null);

      navigate(`/empresa/calendario?employee=${employeeId}`);
    } catch (err) {
      console.error('Error updating work schedule:', err);
      setError(err instanceof Error ? err.message : 'Error al actualizar el horario laboral');
    } finally {
      setLoading(false);
    }
  };

const filteredEmployees = employees.filter(emp => {
  const matchesText =
    emp.fiscal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.email.toLowerCase().includes(searchTerm.toLowerCase());

  const matchesCenter =
    selectedWorkCenter === '' ||
    (Array.isArray(emp.work_centers) && emp.work_centers.includes(selectedWorkCenter));

  return matchesText && matchesCenter;
});

  const totalPages = Math.ceil(filteredEmployees.length / employeesPerPage);
  const currentEmployees = filteredEmployees.slice(
    (currentPage - 1) * employeesPerPage,
    currentPage * employeesPerPage
  );

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-4">
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="w-5 h-5" />
            Añadir un nuevo empleado
          </button>
          {showActive ? (
            <button
              onClick={handleDeactivateSelected}
              disabled={selectedEmployees.length === 0 || loading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserX className="w-5 h-5" />
              Desactivar Seleccionados
            </button>
          ) : (
            <button
              onClick={handleActivateSelected}
              disabled={selectedEmployees.length === 0 || loading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-5 h-5" />
              Activar Seleccionados
            </button>
          )}
          <button
            onClick={handleExportEmployees}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-5 h-5" />
            Exportar empleados
          </button>
          <div className="relative">
            <input
              type="file"
              accept=".csv"
              onChange={handleImportEmployees}
              className="hidden"
              id="import-file"
              ref={fileInputRef}
            />
            <label
              htmlFor="import-file"
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
            >
              <Upload className="w-5 h-5" />
              Importar empleados
            </label>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setShowActive(true)}
            className={`px-4 py-2 rounded-lg ${
              showActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Usuarios activos
          </button>
          <button
            onClick={() => setShowActive(false)}
            className={`px-4 py-2 rounded-lg ${
              !showActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Usuarios inactivos
          </button>
        </div>
      </div>

{/* BARRA DE FILTROS COMPACTA */}
<div className="mb-4">
  <div className="flex flex-col md:flex-row md:items-end gap-3">
    {/* Empleados */}
    <div className="md:flex-1">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Empleados
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Nombre o email..."
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>
    </div>

    {/* Centro de trabajo */}
    <div className="md:flex-1">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Centro de trabajo
      </label>
      <select
        value={selectedWorkCenter}
        onChange={(e) => { setSelectedWorkCenter(e.target.value); setCurrentPage(1); }}
        className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">Todos los centros</option>
        {existingWorkCenters.map((center) => (
          <option key={center} value={center}>{center}</option>
        ))}
      </select>
    </div>
  </div>
</div>

      {isAdding && (
        <div
          className="fixed inset-0 overflow-y-auto bg-black bg-opacity-50 z-50"
          style={{ paddingTop: '2vh', paddingBottom: '2vh' }}
        >
          <div className="flex items-center justify-center min-h-full p-4">
            <div
              ref={modalRef}
              className="bg-white rounded-lg p-6 max-w-3xl w-full my-8"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Añadir Nuevo Empleado</h2>
                <button
                  onClick={() => setIsAdding(false)}
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

              <form onSubmit={(e) => { e.preventDefault(); handleAddEmployee(); }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ID Empleado
                  </label>
                  <input
                    type="text"
                    value={newEmployee.employee_id}
                    onChange={(e) => setNewEmployee({ ...newEmployee, employee_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha de Antigüedad
                  </label>
                  <input
                    type="date"
                    value={newEmployee.seniority_date}
                    onChange={(e) => setNewEmployee({ ...newEmployee, seniority_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={newEmployee.fiscal_name}
                    onChange={(e) => setNewEmployee({ ...newEmployee, fiscal_name: e.target.value })}
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
                    value={newEmployee.email}
                    onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
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
                    value={newEmployee.phone}
                    onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Documento
                  </label>
                  <select
                    value={newEmployee.document_type}
                    onChange={(e) => setNewEmployee({ ...newEmployee, document_type: e.target.value })}
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
                    value={newEmployee.document_number}
                    onChange={(e) => setNewEmployee({ ...newEmployee, document_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Centros de Trabajo
                  </label>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={workCenterInput}
                      onChange={(e) => setWorkCenterInput(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Seleccionar centro de trabajo</option>
                      {existingWorkCenters.map((center, index) => (
                        <option key={index} value={center}>{center}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={workCenterInput}
                      onChange={(e) => setWorkCenterInput(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Añadir nuevo centro de trabajo"
                    />
                    <button
                      type="button"
                      onClick={handleAddWorkCenter}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Añadir
                    </button>
                  </div>
                  <div className="space-y-2">
                    {newEmployee.work_centers.map((center, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                        <span>{center}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveWorkCenter(index)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Puestos de Trabajo
                  </label>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={jobPositionInput}
                      onChange={(e) => setJobPositionInput(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Seleccionar puesto de trabajo</option>
                      {existingJobPositions.map((position, index) => (
                        <option key={index} value={position}>{position}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={jobPositionInput}
                      onChange={(e) => setJobPositionInput(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Añadir nuevo puesto de trabajo"
                    />
                    <button
                      type="button"
                      onClick={handleAddJobPosition}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Añadir
                    </button>
                  </div>
                  <div className="space-y-2">
                    {newEmployee.job_positions.map((position, index) => (
                      <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                        <span>{position}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveJobPosition(index)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Jornada Cómputo Total
                  </label>
                  <input
                    type="number"
                    value={newEmployee.total_hours}
                    onChange={(e) => setNewEmployee({ ...newEmployee, total_hours: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Jornada Semanal (Horas)
                  </label>
                  <input
                    type="number"
                    value={newEmployee.weekly_hours}
                    onChange={(e) => setNewEmployee({ ...newEmployee, weekly_hours: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    min="0"
                    step="0.5"
                  />
                </div>

                <div className="flex justify-end gap-4 mt-6">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Añadiendo...' : 'Añadir Empleado'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 bg-gray-50 text-left">
                  <input
                    type="checkbox"
                    checked={selectedEmployees.length === currentEmployees.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedEmployees(currentEmployees.map(emp => emp.id));
                      } else {
                        setSelectedEmployees([]);
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nombre
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tipo Documento
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Documento
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Centros de Trabajo
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  PIN
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha Incorporación
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha Antigüedad
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Puestos de Trabajo
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Jornada Cómputo Total
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Horario Laboral
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Jornada Semanal
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {currentEmployees.map((employee) => {
                const needsSignature = employee.calendar_signature_requested && !employee.calendar_report_signed;
                return (
                <tr key={employee.id} className={`hover:bg-gray-50 ${needsSignature ? 'bg-red-50' : ''}`}>
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedEmployees.includes(employee.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEmployees([...selectedEmployees, employee.id]);
                        } else {
                          setSelectedEmployees(selectedEmployees.filter(id => id !== employee.id));
                        }
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="text"
                        value={editingEmployeeData?.employee_id || ''}
                        onChange={(e) => handleInputChange('employee_id', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.employee_id
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="text"
                        value={editingEmployeeData?.fiscal_name || ''}
                        onChange={(e) => handleInputChange('fiscal_name', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.fiscal_name
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <select
                        value={editingEmployeeData?.document_type || ''}
                        onChange={(e) => handleInputChange('document_type', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      >
                        <option value="DNI">DNI</option>
                        <option value="NIE">NIE</option>
                        <option value="Pasaporte">Pasaporte</option>
                      </select>
                    ) : (
                      employee.document_type
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="text"
                        value={editingEmployeeData?.document_number || ''}
                        onChange={(e) => handleInputChange('document_number', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.document_number
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="email"
                        value={editingEmployeeData?.email || ''}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.email
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="text"
                        value={editingEmployeeData?.work_centers.join(', ') || ''}
                        onChange={(e) => handleInputChange('work_centers', e.target.value.split(','))}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.work_centers.join(', ')
                    )}
                                    </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="text"
                        value={editingEmployeeData?.pin || ''}
                        onChange={(e) => handleInputChange('pin', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.pin
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {new Date(employee.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="date"
                        value={editingEmployeeData?.seniority_date || ''}
                        onChange={(e) => handleInputChange('seniority_date', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.seniority_date ? new Date(employee.seniority_date).toLocaleDateString() : ''
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="text"
                        value={editingEmployeeData?.job_positions.join(', ') || ''}
                        onChange={(e) => handleInputChange('job_positions', e.target.value.split(','))}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                      />
                    ) : (
                      employee.job_positions ? employee.job_positions.join(', ') : ''
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <input
                        type="number"
                        value={editingEmployeeData?.total_hours || 0}
                        onChange={(e) => handleInputChange('total_hours', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded-lg"
                        min="0"
                      />
                    ) : (
                      employee.total_hours || 0
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleOpenWorkScheduleModal(employee)}
                      className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      <span>Configurar</span>
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {employee.weekly_hours || 40}h
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                      employee.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {employee.is_active ? (
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
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingEmployeeId === employee.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveClick}
                          className="p-1 text-green-600 hover:text-green-800"
                        >
                          <Save className="w-5 h-5" />
                        </button>
                        <button
                          onClick={handleCancelClick}
                          className="p-1 text-red-600 hover:text-red-800"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleEditClick(employee)}
                        className="p-1 text-blue-600 hover:text-blue-800"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-700">
                Página {currentPage} de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Horario Laboral */}
      {showWorkScheduleModal && selectedEmployeeForSchedule && (
        <WorkScheduleModal
          employee={selectedEmployeeForSchedule}
          onClose={() => setShowWorkScheduleModal(false)}
          onSave={handleSaveWorkSchedule}
          initialSchedule={selectedEmployeeForSchedule.work_schedule || ''}
        />
      )}
    </div>
  );
}