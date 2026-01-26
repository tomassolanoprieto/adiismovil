import React, { useState } from 'react';
import { LogOut, Menu, X, User } from 'lucide-react';

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  userName?: string;
  userEmail?: string;
  onLogout: () => void;
  icon?: React.ReactNode;
}

export default function MobileHeader({
  title,
  subtitle,
  userName,
  userEmail,
  onLogout,
  icon
}: MobileHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 safe-top z-40 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {icon && <div className="flex-shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
              {subtitle && (
                <p className="text-xs text-gray-500 truncate">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex-shrink-0 p-2 text-gray-600 hover:text-gray-900 touch-manipulation"
          >
            {showMenu ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setShowMenu(false)}
          />
          <div className="fixed top-14 right-0 w-64 bg-white shadow-xl z-50 rounded-bl-xl safe-top">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {userName || 'Usuario'}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {userEmail || ''}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-2">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-red-50 rounded-lg transition-colors touch-manipulation"
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Cerrar sesión</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
