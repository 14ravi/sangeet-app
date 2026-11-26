import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, errorMessage, tokens } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { validateNewPin } from '@shared/validation.ts';
import { Button, ErrorBox, Field, Loading, Notice } from '../components/ui';
import { AuthShell, PinInput } from './shared';

interface Me {
  first_name: string;
  must_change_pin: boolean;
}

export function ChangePinPage() {
  useDocumentTitle('Change PIN');
  const navigate = useNavigate();
  const hasToken = !!tokens.get('participant');
  const me = useApi<Me>(hasToken ? 'participant/me' : null);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me.error && !tokens.get('participant')) navigate('/login', { replace: true });
  }, [me.error, navigate]);

  if (!hasToken) return <Navigate to="/login" replace />;
  if (me.loading) return <Loading />;
  if (me.error) {
    return (
      <AuthShell title="Change PIN">
        <ErrorBox error={me.error} onRetry={me.reload} />
      </AuthShell>
    );
  }
  const forced = !!me.data?.must_change_pin;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const err = validateNewPin(pin) ?? (pin !== pin2 ? 'PINs do not match.' : null) ?? (!forced && current.length !== 4 ? 'Enter your current PIN.' : null);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('participant/change-pin', forced ? { new_pin: pin } : { current_pin: current, new_pin: pin });
      navigate('/tracker', { replace: true, state: { message: 'Your new PIN is saved.' } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={forced ? 'Choose a new PIN' : 'Change PIN'}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {forced ? (
          <Notice tone="warning">
            Hi {me.data?.first_name}, your PIN was reset by the organiser. Please choose a new 4-digit PIN to continue.
          </Notice>
        ) : (
          <Field label="Current PIN" htmlFor="current">
            <PinInput id="current" value={current} onChange={setCurrent} />
          </Field>
        )}
        <Field label="New PIN" htmlFor="pin" hint="Any 4 digits except 0000.">
          <PinInput id="pin" value={pin} onChange={setPin} autoComplete="new-password" />
        </Field>
        <Field label="Repeat new PIN" htmlFor="pin2">
          <PinInput id="pin2" value={pin2} onChange={setPin2} autoComplete="new-password" />
        </Field>
        {error ? <ErrorBox error={new Error(error)} /> : null}
        <Button type="submit" size="lg" block busy={busy}>
          Save new PIN
        </Button>
        {!forced ? (
          <Button variant="ghost" block onClick={() => navigate('/tracker')}>
            Cancel
          </Button>
        ) : null}
      </form>
    </AuthShell>
  );
}
