import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useUser } from './UserContext';

interface Employee {
  id: string;
  fiscal_name: string;
  email: string;
  work_centers: string[];
  is_active: boolean;
  company_id: string;
}

interface TimeEntry {
  id: string;
  employee_id: string;
  entry_type: string;
  timestamp: string;
  time_type?: string;
  work_center?: string;
}

interface CompanyContextType {
  employees: Employee[];
  timeEntries: TimeEntry[];
  loading: boolean;
  error: string | null;
  refreshData: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useUser();
  const companyId = user?.company_id;

  const fetchData = async () => {
    try {
      if (!companyId) {
        throw new Error('No se ha identificado la empresa del usuario.');
      }

      setLoading(true);
      setError(null);

      console.log('Fetching employees and time entries...');

      // Obtener empleados activos de la empresa del usuario
      const { data: employeesData, error: employeesError } = await supabase
        .from('employee_profiles')
        .select('*')
        .eq('is_active', true)
        .eq('company_id', companyId); // Filtra por empresa

      if (employeesError) throw employeesError;

      // Ordenar empleados alfabéticamente por nombre (fiscal_name)
      const sortedEmployees = employeesData.sort((a, b) =>
        a.fiscal_name.localeCompare(b.fiscal_name)
      );

      // Obtener entradas de tiempo de los empleados de la empresa
      const { data: timeEntriesData, error: timeEntriesError } = await supabase
        .from('time_entries')
        .select('*')
        .in(
          'employee_id',
          sortedEmployees.map((emp) => emp.id)
        ); // Filtra por IDs de empleados de la empresa

      if (timeEntriesError) throw timeEntriesError;

      console.log('Employees:', sortedEmployees);
      console.log('Time Entries:', timeEntriesData);

      setEmployees(sortedEmployees || []);
      setTimeEntries(timeEntriesData || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyId) {
      fetchData();

      // Suscripción a cambios en tiempo real
      const employeesChannel = supabase.channel('employee-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'employee_profiles', filter: `company_id=eq.${companyId}` },
          () => {
            console.log('Employee changes detected, refreshing data...');
            fetchData();
          }
        )
        .subscribe();

      const timeEntriesChannel = supabase.channel('time-entry-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'time_entries' },
          () => {
            console.log('Time entry changes detected, refreshing data...');
            fetchData();
          }
        )
        .subscribe();

      return () => {
        employeesChannel.unsubscribe();
        timeEntriesChannel.unsubscribe();
      };
    }
  }, [companyId]); // Ejecuta el efecto cuando cambie el companyId

  return (
    <CompanyContext.Provider value={{ employees, timeEntries, loading, error, refreshData: fetchData }}>
      {children}
    </CompanyContext.Provider>
  );
}

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};