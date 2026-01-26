import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Shield, Send, User, Eye, EyeOff } from 'lucide-react';
import emailjs from '@emailjs/browser';
import { supabase } from '../lib/supabase';
import adisLogo from '../lib/ADIS LOGO.png';

interface SupportForm {
  fullName: string;
  email: string;
  phone: string;
  description: string;
}

export default function Home() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<SupportForm>({
    fullName: '',
    email: '',
    phone: '',
    description: ''
  });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedRole, setSelectedRole] = useState<'employee' | 'coordinator' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginData, setLoginData] = useState({
    email: '',
    password: ''
  });

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await emailjs.send(
        'service_otiqowa',
        'template_wxr02ix',
        {
          from_name: formData.fullName,
          from_email: formData.email,
          phone: formData.phone,
          message: formData.description,
          to_email: 'tomas.solano@rtsgroup.es'
        },
        'KxnX0MtAANy2LPlwd'
      );

      if (result.status === 200) {
        setSuccess(true);
        setFormData({
          fullName: '',
          email: '',
          phone: '',
          description: ''
        });
      } else {
        throw new Error('Error al enviar el formulario');
      }
    } catch (error) {
      console.error('Error sending support email:', error);
      setError('Error al enviar el formulario. Por favor, inténtelo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleSelection = (role: 'employee' | 'coordinator') => {
    setSelectedRole(role);
    setLoginError(null);
    setLoginData({ email: '', password: '' });
  };

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);

    try {
      if (selectedRole === 'employee') {
        const { data: employeeData, error: employeeError } = await supabase
          .from('employee_profiles')
          .select('*')
          .eq('email', loginData.email)
          .eq('pin', loginData.password)
          .eq('is_active', true)
          .single();

        if (employeeError || !employeeData) {
          throw new Error('Credenciales inválidas');
        }

        const { error: sessionError } = await supabase
          .rpc('verify_employee_credentials', {
            p_email: loginData.email,
            p_pin: loginData.password
          });

        if (sessionError) throw sessionError;

        localStorage.setItem('employeeId', employeeData.id);
        navigate('/empleado');
      } else if (selectedRole === 'coordinator') {
        const { data: supervisorData, error: supervisorError } = await supabase
          .from('supervisor_profiles')
          .select('*')
          .eq('email', loginData.email)
          .eq('pin', loginData.password)
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
      setLoginError(err instanceof Error ? err.message : 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);
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
      setLoginError('No se pudo procesar la solicitud. Por favor, verifica que el correo sea correcto.');
    } finally {
      setLoading(false);
    }
  };

  if (selectedRole) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <button
            onClick={() => {
              setSelectedRole(null);
              setShowRecovery(false);
              setLoginError(null);
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

            {loginError && (
              <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded">
                {loginError}
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
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Correo Electrónico
                  </label>
                  <input
                    type="email"
                    value={loginData.email}
                    onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
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
                      value={loginData.password}
                      onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base pr-12"
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-green-50">
      <div className="container mx-auto px-4 pt-20 pb-32">
        <div className="text-center mb-16">
          <div className="flex justify-center mb-12">
            <img
              src={adisLogo}
              alt="ADIS Logo"
              className="h-28 md:h-36 lg:h-44 object-contain drop-shadow-md"
            />
          </div>

          <h2 className="text-xl text-gray-600 mb-12">
            Gestión inteligente del tiempo de trabajo para empresas con múltiples centros y equipos.
          </h2>

          <div className="max-w-2xl mx-auto mb-8">
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

          <div className="text-center">
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg shadow-md hover:bg-orange-700 transition duration-300"
            >
              <Send className="w-5 h-5" />
              Soporte Técnico
            </button>
          </div>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Formulario de Soporte</h2>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <span className="sr-only">Cerrar</span>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {error && (
                <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
                  {error}
                </div>
              )}

              {success ? (
                <div className="text-center py-8">
                  <div className="mb-4 text-green-600">
                    <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-medium text-gray-900 mb-2">
                    ¡Formulario enviado con éxito!
                  </h3>
                  <p className="text-gray-600 mb-6">
                    Nos pondremos en contacto contigo lo antes posible.
                  </p>
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setSuccess(false);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSupportSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre Completo
                    </label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Correo Electrónico
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Número de Teléfono
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Descripción del Soporte Necesario
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      rows={4}
                      required
                    />
                  </div>

                  <div className="flex justify-end gap-4 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="bg-white py-8">
        <div className="container mx-auto px-4 text-center text-gray-600">
          <p>© {new Date().getFullYear()} Control Alt Sup. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
