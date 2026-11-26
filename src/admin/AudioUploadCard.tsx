// Upload / replace / remove the trimmed clip for one performance, with
// progress, clear errors and retry (the chosen file is kept on failure).
import { useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatBytes, readAudioDuration, uploadFile } from '../lib/upload';
import { ACCEPT_ATTRIBUTE, MAX_AUDIO_BYTES, resolveAudioFormat } from '@shared/audio.ts';
import { formatDuration, parseDuration } from '@shared/duration.ts';
import type { Performance } from '../lib/types';
import { AudioPlayer, DownloadAudioButton } from '../components/AudioPlayer';
import { Button, Card, ConfirmButton, ErrorBox, TextInput, useToast } from '../components/ui';
import { IconUpload } from '../components/icons';
import { DurationBadge } from './PerformanceBits';

interface Props {
  performance: Performance;
  maxDuration: number;
  onChange: (p: Performance) => void;
}

export function AudioUploadCard({ performance: p, maxDuration, onChange }: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationInput, setDurationInput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!resolveAudioFormat(f.name, f.type)) {
      setError('That file type is not supported. Please choose an MP3, M4A, AAC, WAV, OGG, FLAC or WEBM audio file.');
      return;
    }
    if (f.size > MAX_AUDIO_BYTES) {
      setError(`That file is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_AUDIO_BYTES)} — export as MP3 or M4A to make it smaller.`);
      return;
    }
    setFile(f);
    setFileDuration(await readAudioDuration(f));
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const format = resolveAudioFormat(file.name, file.type)!;
      const slot = await api<{ upload_id: string; upload_url: string; content_type: string }>('admin/audio/upload-url', {
        performance_id: p.id,
        filename: file.name,
        size: file.size,
        mime: file.type || format.mime,
      });
      await uploadFile(slot.upload_url, file, slot.content_type, setProgress).promise;
      const r = await api<{ performance: Performance }>('admin/audio/finalize', { upload_id: slot.upload_id, duration_seconds: fileDuration });
      onChange(r.performance);
      setFile(null);
      setFileDuration(null);
      if (inputRef.current) inputRef.current.value = '';
      toast(r.performance.duration_seconds ? 'Audio uploaded' : 'Audio uploaded — please enter the duration');
      if (!r.performance.duration_seconds) setDurationInput('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  async function saveDuration() {
    const secs = parseDuration(durationInput ?? '');
    if (!secs || secs < 1 || secs > 3600) {
      setError('Enter the duration as minutes:seconds, e.g. 2:15');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ performance: Performance }>('admin/performances/set-duration', { id: p.id, duration_seconds: secs });
      onChange(r.performance);
      setDurationInput(null);
      toast('Duration saved');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await api<{ performance: Performance }>('admin/audio/remove', { performance_id: p.id });
      onChange(r.performance);
      toast('Audio removed');
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const uploading = progress !== null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Audio clip</h2>
        {p.has_audio ? <DurationBadge seconds={p.duration_seconds} max={maxDuration} /> : null}
      </div>

      {p.has_audio ? (
        <div className="space-y-3">
          <AudioPlayer performanceId={p.id} knownDuration={p.duration_seconds} label={p.display_name} key={p.audio_uploaded_at ?? ''} />
          <p className="text-xs break-all text-stone-500">Original file: {p.original_filename}</p>
          {p.duration_seconds && p.duration_seconds > maxDuration ? (
            <p className="text-sm text-amber-800">
              Longer than the {formatDuration(maxDuration)} limit. This is only a warning — you decide.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <DownloadAudioButton performanceId={p.id} />
            <Button variant="secondary" size="sm" onClick={() => setDurationInput(p.duration_seconds ? formatDuration(p.duration_seconds).replace(/^0/, '') : '')}>
              {p.duration_seconds ? 'Fix duration' : 'Enter duration'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-3 text-stone-600">No audio yet. Upload the already-trimmed clip (MP3 or M4A recommended, up to {formatBytes(MAX_AUDIO_BYTES)}).</p>
      )}

      {durationInput !== null ? (
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-semibold">Duration (m:ss)</span>
            <TextInput inputMode="numeric" placeholder="2:15" value={durationInput} onChange={(e) => setDurationInput(e.target.value)} />
          </label>
          <Button busy={busy} onClick={saveDuration}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setDurationInput(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          id={`audio-${p.id}`}
          onChange={(e) => void choose(e.target.files?.[0])}
          disabled={uploading}
        />
        {file ? (
          <div className="rounded-xl bg-stone-100 p-3">
            <p className="font-semibold break-all">{file.name}</p>
            <p className="text-sm text-stone-600">
              {formatBytes(file.size)} · {fileDuration ? formatDuration(fileDuration) : 'duration unknown (you can enter it after upload)'}
            </p>
            {uploading ? (
              <div className="mt-3">
                <div className="h-3 overflow-hidden rounded-full bg-stone-300" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-rose-600 transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
                </div>
                <p className="mt-1 text-sm text-stone-600">Uploading… {Math.round((progress ?? 0) * 100)}%</p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button onClick={upload}>
                  <IconUpload size={18} /> {error ? 'Retry upload' : 'Upload'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFile(null);
                    setError(null);
                    if (inputRef.current) inputRef.current.value = '';
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        ) : (
          <label
            htmlFor={`audio-${p.id}`}
            className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-rose-300 bg-rose-50 px-4 font-semibold text-rose-800 active:bg-rose-100"
          >
            <IconUpload size={20} /> {p.has_audio ? 'Replace audio file' : 'Choose audio file'}
          </label>
        )}
        {error ? <ErrorBox error={new Error(error)} /> : null}
        {p.has_audio && !file ? (
          <ConfirmButton variant="ghost" size="sm" busy={busy} confirmLabel="Tap again to remove audio" onConfirm={remove} className="w-full text-red-700">
            Remove audio
          </ConfirmButton>
        ) : null}
      </div>
    </Card>
  );
}
