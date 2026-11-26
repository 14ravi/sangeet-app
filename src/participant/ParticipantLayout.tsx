import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, AUTH_EVENT, PIN_CHANGE_EVENT, tokens } from '../lib/api';
import { useApi } from '../lib/hooks';
import { cx, ErrorBox, Loading, Notice } from '../components/ui';
import { IconLock, IconLogout } from '../components/icons';
import { usePublicConfig } from './shared';

interface Me {
  first_name: string;
  last_name: string;
  must_change_pin: boolean;
  linked: boolean;
  link_status: string;
}

export function ParticipantLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [hasToken] = useState(() => !!tokens.get('participant'));
  const me = useApi<Me>(hasToken ? 'participant/me' : null);
  const config = usePublicConfig();
  const flash = (location.state as { message?: string } | null)?.message;

  useEffect(() => {
    const onExpired = (e: Event) => {
      if ((e as CustomEvent).detail?.kind === 'participant') {
        navigate('/login', { replace: true, state: { message: (e as CustomEvent).detail?.message } });
      }
    };
    const onPin = () => navigate('/change-pin', { replace: true });
    window.addEventListener(AUTH_EVENT, onExpired);
    window.addEventListener(PIN_CHANGE_EVENT, onPin);
    return () => {
      window.removeEventListener(AUTH_EVENT, onExpired);
      window.removeEventListener(PIN_CHANGE_EVENT, onPin);
    };
  }, [navigate]);

  if (!hasToken) return <Navigate to="/login" replace />;
  if (me.loading) return <Loading />;
  if (me.error) {
    return (
      <main className="mx-auto max-w-md p-4">
        <ErrorBox error={me.error} onRetry={me.reload} />
      </main>
    );
  }
  if (me.data?.must_change_pin) return <Navigate to="/change-pin" replace />;

  async function logout() {
    try {
      await api('participant/logout');
    } catch {
      /* ignore */
    }
    tokens.clear('participant');
    navigate('/login', { replace: true });
  }

  const tab = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx('flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm font-semibold', isActive ? 'bg-white text-rose-800 shadow-sm' : 'text-rose-50')
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="min-h-dvh">
      <header className="bg-rose-800 px-4 pt-4 pb-3 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold tracking-wide text-rose-200 uppercase">{config.data?.event_name ?? 'Sangeet'}</p>
            <p className="truncate text-lg font-bold">Hi {me.data?.first_name}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/change-pin')}
            aria-label="Change PIN"
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-rose-900"
          >
            <IconLock />
          </button>
          <button type="button" onClick={logout} aria-label="Log out" className="flex h-11 items-center gap-1 rounded-full px-3 font-semibold active:bg-rose-900">
            <IconLogout /> <span className="text-sm">Log out</span>
          </button>
        </div>
        <nav className="mx-auto mt-3 flex max-w-2xl gap-1 rounded-xl bg-rose-900/50 p-1">
          {tab('/tracker', 'Progress')}
          {tab('/my', 'My dances')}
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4 pb-16">
        {flash ? (
          <div className="mb-3">
            <Notice tone="success">{flash}</Notice>
          </div>
        ) : null}
        <Outlet context={me.data} />
      </main>
    </div>
  );
}
