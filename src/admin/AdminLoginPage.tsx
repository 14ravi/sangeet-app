import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, errorMessage, tokens } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { Button, ErrorBox, Field, Notice, TextInput } from '../components/ui';
import { AuthShell } from '../participant/shared';

export function AdminLoginPage() {
  useDocumentTitle('Admin login');
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { message?: string } | null)?.message;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('admin/login', { username, password });
      tokens.set('admin', r.token);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Admin login" eventName="Organiser">
      <form onSubmit={submit} className="space-y-4">
        {notice ? <Notice tone="warning">{notice}</Notice> : null}
        <Field label="Username" htmlFor="username">
          <TextInput id="username" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <TextInput id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error ? <ErrorBox error={new Error(error)} /> : null}
        <Button type="submit" size="lg" block busy={busy} disabled={!username || !password}>
          Log in
        </Button>
      </form>
    </AuthShell>
  );
}
