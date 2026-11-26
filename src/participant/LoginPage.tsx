import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, errorMessage, tokens } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { Button, ErrorBox, Field, Notice, TextInput } from '../components/ui';
import { AuthShell, PinInput, usePublicConfig } from './shared';

export function LoginPage() {
  useDocumentTitle('Log in');
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { message?: string } | null)?.message;
  const config = usePublicConfig();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!phone.trim() || pin.length !== 4) {
      setError('Please enter your mobile number and 4-digit PIN.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; must_change_pin: boolean }>('participant/login', { phone, pin });
      tokens.set('participant', r.token);
      navigate(r.must_change_pin ? '/change-pin' : '/tracker', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Log in" eventName={config.data?.event_name}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {notice ? <Notice tone="warning">{notice}</Notice> : null}
        <Field label="Mobile number" htmlFor="phone">
          <TextInput id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="4-digit PIN" htmlFor="pin">
          <PinInput id="pin" value={pin} onChange={setPin} />
        </Field>
        {error ? <ErrorBox error={new Error(error)} /> : null}
        <Button type="submit" size="lg" block busy={busy}>
          Log in
        </Button>
        <Notice>
          <strong>Forgot your PIN?</strong> Ask the organiser to reset it. You will then log in once with <strong>0000</strong> and
          choose a new PIN.
        </Notice>
        {config.data?.registration_enabled !== false ? (
          <p className="text-center text-stone-600">
            New here?{' '}
            <Link to="/register" className="font-semibold text-rose-700 underline">
              Register
            </Link>
          </p>
        ) : null}
      </form>
    </AuthShell>
  );
}
