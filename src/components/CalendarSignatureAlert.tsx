import React, { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface Employee {
  id: string;
  fiscal_name: string;
  work_centers: string[];
}

export default function CalendarSignatureAlert() {
  const [showAlert, setShowAlert] = useState(false);
  const [employeesCount, setEmployeesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    checkPendingCalendars();
  }, []);

  const checkPendingCalendars = async () => {
    try {
      const supervisorEmail = localStorage.getItem('supervisorEmail');
      if (!supervisorEmail) {
        setLoading(false);
        return;
      }

      const { data: supervisorData } = await supabase
        .from('supervisor_profiles')
        .select('company_id, work_centers')
        .eq('email', supervisorEmail)
        .maybeSingle();

      if (!supervisorData) {
        setLoading(false);
        return;
      }

      const { data: approvals } = await supabase
        .from('calendar_approvals')
        .select('calendars_sent_to_employees')
        .eq('company_id', supervisorData.company_id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!approvals || approvals.length === 0) {
        setShowAlert(false);
        setLoading(false);
        return;
      }

      if (approvals[0].calendars_sent_to_employees === true) {
        setShowAlert(false);
        setLoading(false);
        return;
      }

      const { data: employeesData } = await supabase
        .from('employee_profiles')
        .select('id, fiscal_name, work_centers, calendar_signature_requested, calendar_report_signed')
        .eq('company_id', supervisorData.company_id)
        .eq('is_active', true)
        .or('calendar_signature_requested.is.null,calendar_signature_requested.eq.false');

      if (employeesData && employeesData.length > 0) {
        const supervisorWorkCenters = supervisorData.work_centers || [];
        const pendingEmployees = employeesData.filter((emp: Employee) =>
          emp.work_centers?.some((center: string) => supervisorWorkCenters.includes(center))
        );

        if (pendingEmployees.length > 0) {
          setEmployeesCount(pendingEmployees.length);
          setShowAlert(true);
        } else {
          setShowAlert(false);
        }
      } else {
        setShowAlert(false);
      }
    } catch (error) {
      console.error('Error checking pending calendars:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !showAlert) {
    return null;
  }

  return (
    <div className="mb-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <FileText className="h-6 w-6 text-blue-500" />
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-blue-800">Envío de Calendarios Pendiente</h3>
          <div className="mt-2 text-sm text-blue-700">
            <p>
              Tienes <strong>{employeesCount} empleado(s)</strong> pendiente(s) de recibir el calendario para firma.
            </p>
            <div className="mt-2">
              <button
                onClick={() => navigate('/supervisor/centro/calendario')}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <FileText className="w-4 h-4 mr-2" />
                Ir a Calendario
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
