import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './store/auth';
import { api } from './lib/api';
import { TH } from '@cida/shared';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/ProductsPage';
import EventsPage from './pages/EventsPage';
import UsersPage from './pages/UsersPage';
import DivisionsPage from './pages/DivisionsPage';
import SalesPage from './pages/SalesPage';
import SettingsPage from './pages/SettingsPage';

const NAV = [
  { to: '/', label: TH.dashboard, icon: '📊', end: true },
  { to: '/products', label: TH.products, icon: '📦' },
  { to: '/events', label: TH.events, icon: '🎪' },
  { to: '/divisions', label: TH.divisions, icon: '🗂️' },
  { to: '/users', label: TH.users, icon: '👥' },
  { to: '/sales', label: TH.sales, icon: '🧾' },
  { to: '/settings', label: TH.settings, icon: '⚙️' },
];

function Layout() {
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const navigate = useNavigate();

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 flex">
      <aside className="hidden md:flex flex-col w-60 bg-slate-900 text-white">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="font-bold">CIDA Admin</div>
          <div className="text-xs text-slate-400">{user?.display_name}</div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isActive ? 'bg-white/15 font-semibold' : 'hover:bg-white/10'}`
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="m-2 px-3 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm text-left">
          🚪 {TH.logout}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <div className="font-bold">CIDA Admin</div>
          <div className="flex gap-2">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `px-2 py-1 rounded text-xs ${isActive ? 'bg-white/15' : ''}`}>
                {n.icon}
              </NavLink>
            ))}
            <button onClick={logout} className="px-2 py-1 rounded text-xs bg-red-600/80">
              🚪
            </button>
          </div>
        </div>
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/divisions" element={<DivisionsPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const authed = !!user && !!accessToken && user.role === 'admin';

  if (!authed) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return <Layout />;
}
