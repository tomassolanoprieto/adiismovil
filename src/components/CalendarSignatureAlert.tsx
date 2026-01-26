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

  // ✅ Igual que en CompanyCalendar: normalizar centros para comparar bien
  const normalizeCenter = (s: any) =>
    (s ?? '').toString().trim().replace(/\s+/g, ' ').toUpperCase();

  const unique = (arr: string[]) => Array.from(new Set(arr));

  useEffect(() => {
    checkPendingCalendars();
    // Si quieres que se refresque automáticamente, puedes añadir un interval aquí.
  }, []);

  const checkPendingCalendars = async () => {
    try {
      const supervisorEmail = localStorage.getItem('supervisorEmail');
      if (!supervisorEmail) {
        setLoading(false);
        return;
      }

      // 1) Cargar supervisor + sus centros
      const { data: supervisorData, error: supervisorErr } = await supabase
        .from('supervisor_profiles')
        .select('company_id, work_centers, is_active, supervisor_type')
        .eq('email', supervisorEmail)
        .maybeSingle();

      if (supervisorErr) {
        console.error('Error fetching supervisor:', supervisorErr);
        setLoading(false);
        return;
      }

      if (!supervisorData || !supervisorData.company_id) {
        setLoading(false);
        return;
      }

      // (Opcional pero recomendado): si no es supervisor center / no está activo, no mostrar
      if (supervisorData.is_active === false) {
        setLoading(false);
        return;
      }

      const supervisorWorkCenters = unique(
        (supervisorData.work_centers || [])
          .map(normalizeCenter)
          .filter(Boolean)
      );

      if (supervisorWorkCenters.length === 0) {
        // Si el supervisor no tiene centros asignados, nunca debe ver alert
        setShowAlert(false);
        setLoading(false);
        return;
      }

      // 2) ✅ Buscar approvals SOLO de centros que coincidan con los del supervisor
      //    IMPORTANTE: hay 1 fila por centro, así que NO podemos hacer "limit(1)" global.
      const currentYear = new Date().getFullYear();

      const { data: approvals, error: approvalsErr } = await supabase
        .from('calendar_approvals')
        .select('id, work_centers, calendars_sent_to_employees, created_at, year, status')
        .eq('company_id', supervisorData.company_id)
        .eq('year', currentYear)
        .eq('status', 'company_approved')
        .overlaps('work_centers', supervisorWorkCenters)
        .order('created_at', { ascending: false });

      if (approvalsErr) {
        console.error('Error fetching calendar approvals:', approvalsErr);
        setShowAlert(false);
        setLoading(false);
        return;
      }

      if (!approvals || approvals.length === 0) {
        // No hay approvals para sus centros => no hay alert
        setShowAlert(false);
        setLoading(false);
        return;
      }

      // 3) Quedarnos SOLO con approvals “pendientes de envío a empleados”
      //    (calendars_sent_to_employees != true)
      const pendingApprovals = approvals.filter(
        (a: any) => a.calendars_sent_to_employees !== true
      );

      if (pendingApprovals.length === 0) {
        // Todo enviado ya para sus centros
        setShowAlert(false);
        setLoading(false);
        return;
      }

      // 4) Centros aprobados pendientes (esto es la clave para NO alertar a centros no seleccionados)
      const approvedCentersPending = unique(
        pendingApprovals
          .flatMap((a: any) => Array.isArray(a.work_centers) ? a.work_centers : [])
          .map(normalizeCenter)
          .filter(Boolean)
      );

      if (approvedCentersPending.length === 0) {
        setShowAlert(false);
        setLoading(false);
        return;
      }

      // 5) Empleados pendientes SOLO en esos centros (y que todavía no tengan solicitud de firma)
      const { data: employeesData, error: empErr } = await supabase
        .from('employee_profiles')
        .select('id, fiscal_name, work_centers, calendar_signature_requested, calendar_report_signed')
        .eq('company_id', supervisorData.company_id)
        .eq('is_active', true)
        .or('calendar_signature_requested.is.null,calendar_signature_requested.eq.false');

      if (empErr) {
        console.error('Error fetching employees:', empErr);
        setShowAlert(false);
        setLoading(false);
        return;
      }

      const employeesList = (employeesData || []) as Employee[];

      const pendingEmployees = employeesList.filter((emp) => {
        const empCenters = (emp.work_centers || []).map(normalizeCenter).filter(Boolean);
        return empCenters.some((c) => approvedCentersPending.includes(c));
      });

      if (pendingEmployees.length > 0) {
        setEmployeesCount(pendingEmployees.length);
        setShowAlert(true);
      } else {
        setShowAlert(false);
      }
    } catch (error) {
      console.error('Error checking pending calendars:', error);
      setShowAlert(false);
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
