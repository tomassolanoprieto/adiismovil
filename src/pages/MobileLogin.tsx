import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, User, Shield, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import emailjs from '@emailjs/browser';

function MobileLogin() {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState<'employee' | 'coordinator' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const handleRoleSelection = (role: 'employee' | 'coordinator') => {
    setSelectedRole(role);
    setError(null);
    setFormData({ email: '', password: '' });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (selectedRole === 'employee') {
        const { data: employeeData, error: employeeError } = await supabase
          .from('employee_profiles')
          .select('*')
          .eq('email', formData.email)
          .eq('pin', formData.password)
          .eq('is_active', true)
          .single();

        if (employeeError || !employeeData) {
          throw new Error('Credenciales inválidas');
        }

        const { error: sessionError } = await supabase
          .rpc('verify_employee_credentials', {
            p_email: formData.email,
            p_pin: formData.password
          });

        if (sessionError) throw sessionError;

        localStorage.setItem('employeeId', employeeData.id);
        navigate('/empleado');
      } else if (selectedRole === 'coordinator') {
        const { data: supervisorData, error: supervisorError } = await supabase
          .from('supervisor_profiles')
          .select('*')
          .eq('email', formData.email)
          .eq('pin', formData.password)
          .eq('is_active', true)
          .eq('supervisor_type', 'center')
          .single();

        if (supervisorError || !supervisorData) {
          throw new Error('Credenciales inválidas');
        }

        localStorage.setItem('supervisorEmail', supervisorData.email);
        navigate('/supervisor/centro');
      }
    } catch (err) {
      console.error('Error de inicio de sesión:', err);
      setError(err instanceof Error ? err.message : 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRecoverySuccess(false);

    try {
      const tableName = selectedRole === 'employee' ? 'employee_profiles' : 'supervisor_profiles';
      const { data, error } = await supabase
        .from(tableName)
        .select('pin, email')
        .eq('email', recoveryEmail)
        .eq('is_active', true)
        .single();

      if (error || !data?.pin) {
        throw new Error('No se encontró ningún usuario activo con ese email');
      }

      const result = await emailjs.send(
        'service_otiqowa',
        'template_8bsjbnl',
        {
          to_email: data.email,
          pin: data.pin
        },
        'KxnX0MtAANy2LPlwd'
      );

      if (result.status === 200) {
        setRecoverySuccess(true);
        setRecoveryEmail('');
      } else {
        throw new Error('Error al enviar el correo');
      }
    } catch (err) {
      console.error('Error en recuperación de PIN:', err);
      setError('No se pudo procesar la solicitud. Por favor, verifica que el correo sea correcto.');
    } finally {
      setLoading(false);
    }
  };

  if (!selectedRole) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Clock className="w-20 h-20 text-blue-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-900 mb-2">TimeControl</h1>
            <p className="text-gray-600">Gestión de Tiempo</p>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => handleRoleSelection('employee')}
              className="w-full bg-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all border-2 border-transparent hover:border-blue-500 active:scale-95"
            >
              <User className="w-12 h-12 text-blue-600 mx-auto mb-3" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Trabajador/a</h3>
              <p className="text-gray-600 text-sm">Gestiona tu tiempo y solicitudes</p>
            </button>

            <button
              onClick={() => handleRoleSelection('coordinator')}
              className="w-full bg-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all border-2 border-transparent hover:border-purple-500 active:scale-95"
            >
              <Shield className="w-12 h-12 text-purple-600 mx-auto mb-3" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Coordinador/a</h3>
              <p className="text-gray-600 text-sm">Supervisa y gestiona tu equipo</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <button
          onClick={() => {
            setSelectedRole(null);
            setShowRecovery(false);
            setError(null);
          }}
          className="mb-6 text-gray-600 hover:text-gray-900 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Cambiar tipo de usuario
        </button>

        <div className="bg-white p-6 rounded-xl shadow-xl">
          <div className="text-center mb-6">
            {selectedRole === 'employee' ? (
              <User className="w-12 h-12 text-blue-600 mx-auto mb-3" />
            ) : (
              <Shield className="w-12 h-12 text-purple-600 mx-auto mb-3" />
            )}
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              {selectedRole === 'employee' ? 'Portal Trabajador/a' : 'Portal Coordinador/a'}
            </h2>
            <p className="text-gray-600 text-sm">Inicia sesión en tu cuenta</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded">
              {error}
            </div>
          )}

          {recoverySuccess && (
            <div className="mb-4 p-3 bg-green-50 border-l-4 border-green-500 text-green-700 text-sm rounded">
              Se ha enviado un correo con tu PIN.
            </div>
          )}

          {showRecovery ? (
            <form onSubmit={handleRecoverySubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                  placeholder="tu@email.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition duration-300 disabled:opacity-50 active:scale-95"
                >
                  {loading ? 'Enviando...' : 'Enviar PIN'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRecovery(false)}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-lg transition duration-300 active:scale-95"
                >
                  Volver al inicio de sesión
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                  placeholder="tu@email.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PIN
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base pr-12"
                    placeholder="123456"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Ingresa el PIN de 6 dígitos proporcionado
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full ${
                  selectedRole === 'coordinator' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
                } text-white font-semibold py-3 rounded-lg transition duration-300 disabled:opacity-50 active:scale-95`}
              >
                {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              </button>

              <button
                type="button"
                onClick={() => setShowRecovery(true)}
                className="w-full text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                ¿Olvidaste tu PIN?
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default MobileLogin;
