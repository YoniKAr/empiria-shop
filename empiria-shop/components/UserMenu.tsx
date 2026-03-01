'use client';

import { useState, useRef, useEffect } from 'react';
import { LayoutDashboard, User, LogOut, ChevronDown } from 'lucide-react';

interface UserMenuProps {
  userName: string;
  userPicture: string | null;
  userRole: string | null;
}

const DASHBOARD_URLS: Record<string, { label: string; href: string }[]> = {
  admin: [
    { label: 'Admin Dashboard', href: 'https://admin.empiriaindia.com/dashboard' },
    { label: 'Organizer Dashboard', href: 'https://organizer.empiriaindia.com/dashboard' },
  ],
  organizer: [
    { label: 'Organizer Dashboard', href: 'https://organizer.empiriaindia.com/dashboard' },
  ],
  non_profit: [
    { label: 'Organizer Dashboard', href: 'https://organizer.empiriaindia.com/dashboard' },
  ],
};

export default function UserMenu({ userName, userPicture, userRole }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const dashboardLinks = userRole ? DASHBOARD_URLS[userRole] || [] : [];
  const firstName = userName?.split(' ')[0] || 'User';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 cursor-pointer group"
      >
        <span className="text-sm font-medium hidden sm:block">Hi, {firstName}</span>
        <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden border border-gray-200">
          {userPicture && (
            <img src={userPicture} alt="Profile" className="w-full h-full object-cover" />
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* User info header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
            {userRole && (
              <p className="text-xs text-gray-500 capitalize mt-0.5">
                {userRole === 'non_profit' ? 'Non-Profit' : userRole}
              </p>
            )}
          </div>

          {/* Dashboard links */}
          {dashboardLinks.length > 0 && (
            <div className="py-1 border-b border-gray-100">
              {dashboardLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <LayoutDashboard size={16} className="text-gray-400" />
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {/* Profile & Sign out */}
          <div className="py-1">
            <a
              href="/auth/logout"
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              onClick={() => setOpen(false)}
            >
              <LogOut size={16} />
              Sign Out
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
