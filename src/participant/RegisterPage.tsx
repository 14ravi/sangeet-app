import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, tokens } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { normalizePhone } from '@shared/phone.ts';
import { validateEmail, validateName, validateNewPin } from '@shared/validation.ts';
import { Button, ErrorBox, Field, Loading, Notice, TextInput } from '../components/ui';
import { AuthShell, PinInput, PrivacyNote, usePublicConfig } from './shared';

export function RegisterPage() {
  useDocumentTitle('Register');
  const navigate = useNavigate();
  const config = usePublicConfig();
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', pin: '', pin2: '' });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string | null> = {
      first_name: validateName(form.first_name, 'First name'),
      last_name: validateName(form.last_name, 'Last name'),
      phone: normalizePhone(form.phone) ? null : 'Enter a valid mobile number, e.g. 98765 43210 or +91 98765 43210.',
      email: validateEmail(form.email),
      pin: validateNewPin(form.pin),
      pin2: form.pin === form.pin2 ? null : 'PINs do not match.',
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('participant/register', {
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        email: form.email,
        pin: form.pin,
      });
      tokens.set('participant', r.token);
      navigate('/tracker', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (config.loading) return <Loading />;
  if (config.error) {
    return (
      <AuthShell title="Register">
        <ErrorBox error={config.error} onRetry={config.reload} />
      </AuthShell>
    );
  }
  if (!config.data?.registration_enabled) {
    return (
      <AuthShell title="Registration closed" eventName={config.data?.event_name}>
        <Notice>Registration is currently closed. If you already have an account you can still log in.</Notice>
        <Link to="/login" className="mt-4 flex min-h-12 items-center justify-center rounded-xl border border-stone-300 bg-white font-semibold">
          Log in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Register" eventName={config.data.event_name}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="First name" htmlFor="first_name" error={errors.first_name}>
          <TextInput id="first_name" autoComplete="given-name" value={form.first_name} onChange={(e) => set('first_name')(e.target.value)} />
        </Field>
        <Field label="Last name" htmlFor="last_name" error={errors.last_name}>
          <TextInput id="last_name" autoComplete="family-name" value={form.last_name} onChange={(e) => set('last_name')(e.target.value)} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" error={errors.phone} hint="Used to log in. Indian numbers can be typed without +91.">
          <TextInput id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
        </Field>
        <Field label="Choose a 4-digit PIN" htmlFor="pin" error={errors.pin} hint="You will use this PIN to log in. Don't use 0000.">
          <PinInput id="pin" value={form.pin} onChange={set('pin')} autoComplete="new-password" />
        </Field>
        <Field label="Repeat PIN" htmlFor="pin2" error={errors.pin2}>
          <PinInput id="pin2" value={form.pin2} onChange={set('pin2')} autoComplete="new-password" />
        </Field>
        <Field label="Email (optional)" htmlFor="email" error={errors.email}>
          <TextInput id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />
        </Field>
        {error ? <ErrorBox error={new Error(error)} /> : null}
        <Button type="submit" size="lg" block busy={busy}>
          Register
        </Button>
        <p className="text-center text-stone-600">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-rose-700 underline">
            Log in
          </Link>
        </p>
        <PrivacyNote />
      </form>
    </AuthShell>
  );
}
