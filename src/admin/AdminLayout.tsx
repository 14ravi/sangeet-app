import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { AUTH_EVENT, tokens } from '../lib/api';
import { useApi } from '../lib/hooks';
import { cx, ErrorBox, Loading } from '../components/ui';
import { IconDance, IconHome, IconList, IconMusic, IconSettings, IconUsers } from '../components/icons';

const NAV = [
  { to: '/admin', label: 'Home', icon: IconHome, end: true },
  { to: '/admin/people', label: 'People', icon: IconUsers },
  { to: '/admin/performances', label: 'Dances', icon: IconDance },
  { to: '/admin/songs', label: 'Songs', icon: IconMusic },
  { to: '/admin/live', label: 'Order', icon: IconList },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const [hasToken] = useState(() => !!tokens.get('admin'));
  // Server-side session check; every admin API call is also checked server-side.
  const me = useApi<{ ok: boolean }>(hasToken ? 'admin/me' : null);

  useEffect(() => {
    const onExpired = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.kind === 'admin') navigate('/admin/login', { replace: true, state: { message: 'Your admin session ended. Please log in again.' } });
    };
    window.addEventListener(AUTH_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EVENT, onExpired);
  }, [navigate]);

  if (!hasToken) return <Navigate to="/admin/login" replace />;
  if (me.loading && !me.data) return <Loading />;
  if (me.error && !me.data) {
    return (
      <main className="mx-auto max-w-md p-4">
        <ErrorBox error={me.error} onRetry={me.reload} />
      </main>
    );
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-30 border-b border-rose-900/20 bg-rose-800 text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Link to="/admin" className="min-w-0 flex-1 truncate text-lg font-bold">
            Sangeet Admin
          </Link>
          <NavLink
            to="/admin/settings"
            aria-label="Settings"
            className={({ isActive }) => cx('flex h-11 w-11 items-center justify-center rounded-full', isActive ? 'bg-rose-950/40' : 'active:bg-rose-900')}
          >
            <IconSettings size={22} />
          </NavLink>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">
        <Outlet />
      </main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur" aria-label="Admin">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx('flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold', isActive ? 'text-rose-700' : 'text-stone-500')
              }
            >
              <Icon size={24} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
