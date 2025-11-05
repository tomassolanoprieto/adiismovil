import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { UserProvider } from './context/UserContext';
import { CompanyProvider } from './context/CompanyContext';
import MobileLogin from './pages/MobileLogin';
import EmployeeDashboard from './pages/EmployeeDashboard';
import SupervisorDashboard from './pages/SupervisorDashboard';
import NotFound from './pages/NotFound';

function App() {
  return (
    <UserProvider>
      <CompanyProvider>
        <Router>
          <Routes>
            {/* Ruta principal - Login */}
            <Route path="/" element={<MobileLogin />} />

            {/* Rutas de dashboards */}
            <Route path="/empleado/*" element={<EmployeeDashboard />} />
            <Route path="/supervisor/centro/*" element={<SupervisorDashboard />} />

            {/* Ruta 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Router>
      </CompanyProvider>
    </UserProvider>
  );
}

export default App;