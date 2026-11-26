import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { fullName } from '../lib/format';
import { normalizeSongTitle } from '@shared/songs.ts';
import { normalizeYouTubeUrl, validateText, type PerformanceType, type PreparationStatus, type Side } from '@shared/validation.ts';
import type { Participant, Performance } from '../lib/types';
import { Badge, Button, cx, ErrorBox, Field, Loading, Notice, PageHeader, Segmented, SideBadge, TextInput } from '../components/ui';
import { IconCheck, IconSearch, IconX } from '../components/icons';

interface SongSummary {
  key: string;
  title: string;
  count: number;
}

export function PerformanceFormPage() {
  const { id } = useParams();
  const isNew = !id;
  useDocumentTitle(isNew ? 'New performance' : 'Edit performance');
  const existing = useApi<{ performance: Performance }>(isNew ? null : 'admin/performances/get', { id });
  const people = useApi<{ participants: Participant[] }>('admin/participants/list');
  const songs = useApi<{ songs: SongSummary[] }>('admin/songs/list');

  if ((!isNew && existing.loading) || people.loading) return <Loading />;
  if (existing.error) return <ErrorBox error={existing.error} onRetry={existing.reload} />;
  if (people.error) return <ErrorBox error={people.error} onRetry={people.reload} />;

  return (
    <div>
      <PageHeader title={isNew ? 'New performance' : 'Edit performance'} back={isNew ? '/admin/performances' : `/admin/performances/${id}`} />
      <PerformanceForm
        key={existing.data?.performance.id ?? 'new'}
        initial={existing.data?.performance}
        people={(people.data?.participants ?? []).filter((p) => p.is_active || existing.data?.performance.participants.some((x) => x.id === p.id))}
        songs={songs.data?.songs ?? []}
      />
    </div>
  );
}

function PerformanceForm({ initial, people, songs }: { initial?: Performance; people: Participant[]; songs: SongSummary[] }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    display_name: initial?.display_name ?? '',
    side: (initial?.side ?? '') as Side | '',
    performance_type: (initial?.performance_type ?? '') as PerformanceType | '',
    song_title: initial?.song_title ?? '',
    artist: initial?.artist ?? '',
    youtube_url: initial?.youtube_url ?? '',
    admin_notes: initial?.admin_notes ?? '',
    preparation_status: (initial?.preparation_status ?? 'draft') as PreparationStatus,
  });
  const [selected, setSelected] = useState<string[]>(initial?.participants.map((p) => p.id) ?? []);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yt, setYt] = useState<{ busy: boolean; title?: string; author?: string; message?: string }>({ busy: false });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Live duplicate-title warning (warning only, never blocks saving)
  const dupCount = useMemo(() => {
    const key = normalizeSongTitle(form.song_title);
    if (!key) return 0;
    const s = songs.find((x) => x.key === key);
    if (!s) return 0;
    return s.count - (initial && initial.normalized_song_title === key ? 1 : 0);
  }, [form.song_title, songs, initial]);
  const dupKey = normalizeSongTitle(form.song_title);

  async function lookupYouTube() {
    if (!normalizeYouTubeUrl(form.youtube_url)) {
      setYt({ busy: false, message: 'Enter a youtube.com or youtu.be link first.' });
      return;
    }
    setYt({ busy: true });
    try {
      const r = await api<{ ok: boolean; title?: string; author?: string; message?: string }>('admin/youtube-lookup', { url: form.youtube_url });
      setYt({ busy: false, ...r });
    } catch (e) {
      setYt({ busy: false, message: errorMessage(e) });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string | null> = {
      display_name: validateText(form.display_name, 'Performance name', 120, true),
      side: form.side ? null : 'Choose Bride or Groom side.',
      performance_type: form.performance_type ? null : 'Choose Solo or Group.',
      song_title: validateText(form.song_title, 'Song title', 200, true),
      youtube_url: form.youtube_url.trim() && !normalizeYouTubeUrl(form.youtube_url) ? 'Must be a youtube.com or youtu.be link.' : null,
      participants: form.performance_type === 'solo' && selected.length > 1 ? 'A solo can only have one participant.' : null,
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setError('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ performance: Performance }>('admin/performances/save', {
        id: initial?.id,
        ...form,
        participant_ids: selected,
        expected_version: initial?.version,
      });
      navigate(`/admin/performances/${r.performance.id}`, { replace: true, state: { justSaved: true } });
    } catch (err) {
      setError(errorMessage(err)); // form data is kept so nothing is lost
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Field label="Performance name" htmlFor="display_name" error={errors.display_name} hint="e.g. “Bride's cousins group” or “Rahul solo”">
        <TextInput id="display_name" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
      </Field>
      <Field label="Side" error={errors.side}>
        <Segmented
          name="Side"
          value={form.side}
          onChange={(v) => set('side', v)}
          options={[
            { value: 'bride', label: 'Bride', className: 'border-pink-500 bg-pink-50 text-pink-800' },
            { value: 'groom', label: 'Groom', className: 'border-indigo-500 bg-indigo-50 text-indigo-800' },
          ]}
        />
      </Field>
      <Field label="Type" error={errors.performance_type}>
        <Segmented
          name="Type"
          value={form.performance_type}
          onChange={(v) => set('performance_type', v)}
          options={[
            { value: 'solo', label: 'Solo' },
            { value: 'group', label: 'Group' },
          ]}
        />
      </Field>

      <ParticipantPicker people={people} selected={selected} onChange={setSelected} error={errors.participants} side={form.side} />

      <Field label="YouTube link (optional)" htmlFor="youtube_url" error={errors.youtube_url} hint="Reference only — audio is never taken from YouTube.">
        <div className="flex gap-2">
          <TextInput id="youtube_url" type="url" inputMode="url" placeholder="https://youtu.be/…" value={form.youtube_url} onChange={(e) => set('youtube_url', e.target.value)} />
          <Button variant="secondary" size="sm" busy={yt.busy} onClick={lookupYouTube} className="shrink-0">
            Get title
          </Button>
        </div>
      </Field>
      {yt.title ? (
        <Notice>
          <p>
            YouTube title: <strong className="break-words">{yt.title}</strong>
            {yt.author ? <> · {yt.author}</> : null}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => set('song_title', yt.title!)}>
              Use as song title
            </Button>
            {yt.author ? (
              <Button size="sm" variant="secondary" onClick={() => set('artist', yt.author!)}>
                Use channel as artist
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs">Tip: shorten it to just the song name so duplicate checks work well.</p>
        </Notice>
      ) : yt.message ? (
        <Notice tone="warning">{yt.message}</Notice>
      ) : null}

      <Field label="Song title" htmlFor="song_title" error={errors.song_title}>
        <TextInput id="song_title" value={form.song_title} onChange={(e) => set('song_title', e.target.value)} />
      </Field>
      {dupCount > 0 ? (
        <Notice tone="warning">
          This title is already used by {dupCount} other performance{dupCount > 1 ? 's' : ''}.{' '}
          <Link to={`/admin/songs/${encodeURIComponent(dupKey)}`} className="font-semibold underline">
            Compare clips
          </Link>
          . You can still save — different sections of the same song are fine.
        </Notice>
      ) : null}
      <Field label="Artist (optional)" htmlFor="artist">
        <TextInput id="artist" value={form.artist} onChange={(e) => set('artist', e.target.value)} />
      </Field>
      <Field label="Notes (admin only, optional)" htmlFor="admin_notes">
        <textarea
          id="admin_notes"
          rows={3}
          value={form.admin_notes}
          onChange={(e) => set('admin_notes', e.target.value)}
          className="block w-full rounded-xl border border-stone-300 bg-white p-3 text-base focus:border-rose-500 focus:ring-2 focus:ring-rose-200 focus:outline-none"
        />
      </Field>
      <Field label="Status" hint={initial?.has_audio ? undefined : 'Upload the trimmed audio before marking Ready.'}>
        <Segmented
          name="Status"
          value={form.preparation_status}
          onChange={(v) => set('preparation_status', v)}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'ready', label: 'Ready', className: 'border-emerald-600 bg-emerald-50 text-emerald-800' },
          ]}
        />
      </Field>

      {error ? <ErrorBox error={new Error(error)} /> : null}
      <div className="sticky bottom-20 z-10 -mx-4 bg-stone-50/95 px-4 py-2 backdrop-blur">
        <Button type="submit" size="lg" block busy={busy}>
          {initial ? 'Save changes' : 'Create performance'}
        </Button>
        {!initial ? <p className="mt-1 text-center text-xs text-stone-500">You can upload the audio on the next screen.</p> : null}
      </div>
    </form>
  );
}

function ParticipantPicker({ people: initialPeople, selected, onChange, error, side }: { people: Participant[]; selected: string[]; onChange: (ids: string[]) => void; error?: string | null; side: Side | '' }) {
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<Participant[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const people = useMemo(() => [...added, ...initialPeople], [added, initialPeople]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const needle = q.trim().toLowerCase();
  const matches = people
    .filter((p) => !needle || fullName(p).toLowerCase().includes(needle))
    .slice(0, 50);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const words = q.trim().split(/\s+/).filter(Boolean);
  const canQuickAdd = words.length >= 2 && !people.some((p) => fullName(p).toLowerCase() === needle);

  async function quickAdd() {
    setAdding(true);
    setAddError(null);
    try {
      const r = await api<{ participant: Participant }>('admin/participants/save', {
        first_name: words.slice(0, -1).join(' '),
        last_name: words[words.length - 1],
        side: side || null,
      });
      setAdded((a) => [r.participant, ...a]);
      onChange([...selected, r.participant.id]);
      setQ('');
    } catch (e) {
      setAddError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Field label={`Participants (${selected.length} selected)`} error={error}>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => {
            const p = byId.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex min-h-10 items-center gap-1 rounded-full bg-rose-100 py-1 pr-2 pl-3 text-sm font-semibold text-rose-900"
                aria-label={`Remove ${p ? fullName(p) : 'person'}`}
              >
                {p ? fullName(p) : 'Unknown'} <IconX size={16} />
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
        <TextInput type="search" placeholder="Search people to add" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search participants" />
      </div>
      <ul className="max-h-72 divide-y divide-stone-100 overflow-y-auto rounded-xl border border-stone-200 bg-white">
        {canQuickAdd ? (
          <li className="p-2">
            <Button size="sm" variant="secondary" block busy={adding} onClick={quickAdd}>
              + Add “{words.slice(0, -1).join(' ')} {words[words.length - 1]}” as a new person
            </Button>
            {addError ? <p className="mt-1 text-sm text-red-700">{addError}</p> : null}
          </li>
        ) : null}
        {matches.length === 0 ? (
          <li className="p-3 text-sm text-stone-500">No match. Type a first and last name to add a new person.</li>
        ) : (
          matches.map((p) => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => toggle(p.id)} className={cx('flex min-h-12 w-full items-center gap-3 px-3 text-left', on && 'bg-rose-50')} aria-pressed={on}>
                  <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', on ? 'border-rose-700 bg-rose-700 text-white' : 'border-stone-300')}>
                    {on ? <IconCheck size={16} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{fullName(p)}</span>
                  <SideBadge side={p.side} />
                  {p.account ? null : <Badge>Manual</Badge>}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Field>
  );
}
