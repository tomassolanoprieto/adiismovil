import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Calendar, Clock, User, Bell, Users, History } from 'lucide-react';

interface MobileNavProps {
  role: 'employee' | 'coordinator';
}

function MobileNav({ role }: MobileNavProps) {
  const location = useLocation();

  const employeeLinks = [
    { to: '/empleado', icon: Home, label: 'Inicio' },
    { to: '/empleado/historial', icon: History, label: 'Historial' },
    { to: '/empleado/calendario', icon: Calendar, label: 'Calendario' },
    { to: '/empleado/solicitudes', icon: Clock, label: 'Solicitudes' },
    { to: '/empleado/perfil', icon: User, label: 'Perfil' }
  ];

  const coordinatorLinks = [
    { to: '/supervisor/centro', icon: Home, label: 'Inicio' },
    { to: '/supervisor/centro/empleados', icon: Users, label: 'Empleados' },
    { to: '/supervisor/centro/alertas', icon: Bell, label: 'Alertas' },
    { to: '/supervisor/centro/calendario', icon: Calendar, label: 'Calendario' },
    { to: '/supervisor/centro/solicitudes', icon: Clock, label: 'Solicitudes' }
  ];

  const links = role === 'employee' ? employeeLinks : coordinatorLinks;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-safe z-50">
      <div className="flex justify-around items-center h-16">
        {links.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to ||
            (to !== '/' && location.pathname.startsWith(to));

          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileNav;
