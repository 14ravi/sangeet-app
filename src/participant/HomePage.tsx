import { Link } from 'react-router';
import { tokens } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { AuthShell, PrivacyNote, usePublicConfig } from './shared';

export function HomePage() {
  const { data } = usePublicConfig();
  useDocumentTitle('Welcome');
  const loggedIn = !!tokens.get('participant');
  return (
    <AuthShell title="Dance performances" eventName={data?.event_name}>
      <div className="space-y-3">
        <p className="text-center text-stone-600">
          Register to follow who is dancing at the {data?.event_name ?? 'Sangeet'} and to download your own music.
        </p>
        {loggedIn ? (
          <Link to="/tracker" className="flex min-h-14 items-center justify-center rounded-xl bg-rose-700 text-lg font-semibold text-white">
            Open progress tracker
          </Link>
        ) : (
          <>
            {data?.registration_enabled !== false ? (
              <Link to="/register" className="flex min-h-14 items-center justify-center rounded-xl bg-rose-700 text-lg font-semibold text-white">
                Register
              </Link>
            ) : null}
            <Link to="/login" className="flex min-h-14 items-center justify-center rounded-xl border border-stone-300 bg-white text-lg font-semibold text-stone-800">
              Log in
            </Link>
          </>
        )}
        <div className="pt-6">
          <PrivacyNote />
        </div>
      </div>
    </AuthShell>
  );
}
