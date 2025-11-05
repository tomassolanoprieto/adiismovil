import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate('/')}
          className="mb-8 flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 bg-white rounded-lg shadow-sm hover:shadow transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
          Volver al Inicio
        </button>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Política de Privacidad</h1>

          <div className="space-y-6 text-gray-600">
            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">1. Introducción</h2>
              <p>
                Esta Política de Privacidad describe cómo Control Alt Sup recopila, utiliza y protege la información personal 
                que usted nos proporciona al utilizar nuestra aplicación de control de fichajes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">2. Información que Recopilamos</h2>
              <p className="mb-3">Recopilamos la siguiente información:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Nombre y apellidos</li>
                <li>Correo electrónico</li>
                <li>Número de teléfono</li>
                <li>Documento de identidad</li>
                <li>Centro de trabajo</li>
                <li>Registros de entrada y salida</li>
                <li>Ubicación durante los fichajes</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">3. Uso de la Información</h2>
              <p className="mb-3">Utilizamos esta información para:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Gestionar los registros de jornada laboral</li>
                <li>Cumplir con las obligaciones legales de control horario</li>
                <li>Generar informes de asistencia</li>
                <li>Gestionar solicitudes de ausencia y vacaciones</li>
                <li>Comunicarnos con usted sobre aspectos relacionados con su trabajo</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">4. Protección de Datos</h2>
              <p>
                Nos comprometemos a proteger la seguridad de su información personal y hemos implementado 
                medidas técnicas y organizativas apropiadas para garantizar un nivel de seguridad adecuado 
                al riesgo, incluyendo:
              </p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>Encriptación de datos</li>
                <li>Acceso restringido a la información</li>
                <li>Monitorización de seguridad continua</li>
                <li>Copias de seguridad regulares</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">5. Sus Derechos</h2>
              <p className="mb-3">Usted tiene derecho a:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Acceder a sus datos personales</li>
                <li>Rectificar datos inexactos</li>
                <li>Solicitar la eliminación de sus datos</li>
                <li>Oponerse al tratamiento de sus datos</li>
                <li>Solicitar la limitación del tratamiento</li>
                <li>Portabilidad de sus datos</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">6. Retención de Datos</h2>
              <p>
                Conservaremos sus datos personales durante el tiempo necesario para cumplir con los 
                fines para los que se recopilaron, incluido el cumplimiento de requisitos legales, 
                contables o de informes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">7. Contacto</h2>
              <p>
                Si tiene alguna pregunta sobre esta Política de Privacidad o el tratamiento de sus datos, 
                puede contactarnos en:
              </p>
              <div className="mt-3">
                <p className="font-medium">Control Alt Sup</p>
                <p>Email: mgonzalez@controlaltsup.com</p>
                <p>Teléfono: +34 910 123 456</p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">8. Actualizaciones</h2>
              <p>
                Esta Política de Privacidad puede ser actualizada ocasionalmente. La versión más reciente 
                estará siempre disponible en nuestra aplicación. La fecha de la última actualización es: 
                {new Date().toLocaleDateString()}
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}