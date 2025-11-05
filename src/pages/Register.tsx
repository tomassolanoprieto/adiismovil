import React, { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Register() {
  const { portal } = useParams();
  const navigate = useNavigate();
  const portalTitle = portal === 'empresa' ? 'Empresa' : 'Empleado';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const timeZones = [
    'Europe/Madrid',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
  ];

  const countries = [
    'España',
    'Portugal',
    'Francia',
    'Italia',
    'Alemania',
    'Reino Unido',
  ];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;
    const fiscalName = formData.get('fiscalName') as string;
    const phone = formData.get('phone') as string;
    const country = formData.get('country') as string;
    const timezone = formData.get('timezone') as string;

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      setLoading(false);
      return;
    }

    try {
      // 1. Crear usuario autenticado en Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: undefined, // No redirect needed
          data: {
            fiscal_name: fiscalName,
            phone: phone,
            country: country,
            timezone: timezone
          }
        }
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Error al crear el usuario');

      // 2. Crear perfil de empresa usando el ID del usuario autenticado
      const { error: profileError } = await supabase
        .from('company_profiles')
        .insert([{
          id: authData.user.id, // Usar el ID del usuario autenticado
          fiscal_name: fiscalName,
          email: email,
          phone: phone,
          country: country,
          timezone: timezone,
          password: password // Almacenar password para referencia informativa
        }]);

      if (profileError) throw profileError;

      setSuccess(true);
      
      // Redirigir después de 2 segundos
      setTimeout(() => {
        navigate(`/login/${portal}`);
      }, 2000);

    } catch (err) {
      console.error('Error en registro:', err);
      setError(err instanceof Error ? err.message : 'Error en el registro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-xl">
        <div className="text-center mb-8">
          <Clock className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">Registro {portalTitle}</h2>
          <p className="text-gray-600">Crea tu cuenta nueva</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 text-green-700">
            ¡Registro exitoso! Redirigiendo...
          </div>
        )}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Fiscal
            </label>
            <input
              name="fiscalName"
              type="text"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono
            </label>
            <input
              name="phone"
              type="text" // Cambiado de 'tel' a 'text' para eliminar validación
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Correo Electrónico
            </label>
            <input
              name="email"
              type="text" // Cambiado de 'email' a 'text' para eliminar validación
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              País
            </label>
            <select
              name="country"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Selecciona un país</option>
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zona Horaria
            </label>
            <select
              name="timezone"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Selecciona una zona horaria</option>
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              name="password"
              type="password"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirmar Contraseña
            </label>
            <input
              name="confirmPassword"
              type="password"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div className="flex items-start">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              required
            />
            <label className="ml-2 text-sm text-gray-600">
              He leído y acepto las{' '}
              <Link to="/privacy" className="text-blue-600 hover:text-blue-800">
                Condiciones Generales de Contratación y política de privacidad
              </Link>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition duration-300 disabled:opacity-50"
          >
            {loading ? 'Registrando...' : 'Registrarse'}
          </button>
        </form>

        <p className="mt-6 text-center text-gray-600">
          ¿Ya tienes una cuenta?{' '}
          <Link
            to={`/login/${portal}`}
            className="text-blue-600 hover:text-blue-800 font-semibold"
          >
            Iniciar Sesión
          </Link>
        </p>
      </div>
    </div>
  );
}