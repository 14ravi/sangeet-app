// In-app player for one performance's uploaded clip. The short-lived signed
// URL is fetched only when Play is first tapped (nothing preloads on page
// load), and is re-fetched automatically if it has expired.
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatDuration } from '@shared/duration.ts';
import { IconDownload, IconPause, IconPlay, IconRestart } from './icons';
import { Button, cx, useToast } from './ui';

const PLAY_EVENT = 'sangeet:audio-play';

interface Props {
  performanceId: string;
  knownDuration?: number | null;
  compact?: boolean;
  label?: string;
  /** Participant listening to their own dance (server checks membership). */
  asParticipant?: boolean;
}

export function AudioPlayer({ performanceId, knownDuration, compact, label, asParticipant }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(knownDuration ?? null);
  const [error, setError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const resumeAt = useRef<number | null>(null);
  const fetchedAt = useRef(0);

  // Only one clip plays at a time across the page.
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== performanceId) audioRef.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, [performanceId]);

  async function fetchUrl(): Promise<string> {
    const r = await api<{ url: string }>(asParticipant ? 'participant/audio-download' : 'admin/audio/url', { performance_id: performanceId, purpose: 'play' });
    fetchedAt.current = Date.now();
    return r.url;
  }

  async function startPlayback(audio: HTMLAudioElement) {
    try {
      await audio.play();
      setNeedsTap(false);
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError') setNeedsTap(true);
      else setError('Could not play this clip.');
    }
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (playing) {
      audio.pause();
      return;
    }
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: performanceId }));
    // URLs last 15 minutes; refresh a bit early.
    if (!src || Date.now() - fetchedAt.current > 13 * 60 * 1000) {
      setLoading(true);
      try {
        const url = await fetchUrl();
        resumeAt.current = src ? audio.currentTime : null;
        audio.src = url;
        setSrc(url);
      } catch (e) {
        setError(errorMessage(e));
        setLoading(false);
        return;
      }
    }
    await startPlayback(audio);
  }

  function restart() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    audio.currentTime = 0;
    if (!playing) void toggle();
  }

  async function onAudioError() {
    // Most likely an expired signed URL: fetch a fresh one once and resume.
    const audio = audioRef.current;
    if (!audio || !src || Date.now() - fetchedAt.current < 5000) {
      setError('Could not load this clip. Check your connection and try again.');
      setLoading(false);
      setPlaying(false);
      return;
    }
    try {
      resumeAt.current = audio.currentTime;
      const url = await fetchUrl();
      audio.src = url;
      setSrc(url);
      await startPlayback(audio);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const total = duration ?? knownDuration ?? 0;

  return (
    <div className={cx('min-w-0', compact ? '' : 'rounded-xl bg-stone-100 p-3')}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
          if (resumeAt.current != null) {
            e.currentTarget.currentTime = resumeAt.current;
            resumeAt.current = null;
          }
        }}
        onError={() => void onAudioError()}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? `Pause ${label ?? 'clip'}` : `Play ${label ?? 'clip'}`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-700 text-white shadow active:bg-rose-800"
        >
          {loading && !playing ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : playing ? (
            <IconPause size={22} />
          ) : (
            <IconPlay size={22} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(total))}
            step={1}
            value={Math.min(Math.round(current), Math.max(1, Math.round(total)))}
            disabled={!src}
            aria-label="Seek"
            onChange={(e) => {
              const a = audioRef.current;
              if (a && src) a.currentTime = Number(e.target.value);
              setCurrent(Number(e.target.value));
            }}
            className="h-11 w-full accent-rose-700"
          />
          <div className="-mt-2 flex justify-between text-xs text-stone-500 tabular-nums">
            <span>{formatDuration(current)}</span>
            <span>{formatDuration(total || null)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={restart}
          disabled={!src}
          aria-label="Replay from start"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 active:bg-stone-200 disabled:opacity-30"
        >
          <IconRestart size={20} />
        </button>
      </div>
      {needsTap ? <p className="mt-1 text-sm text-stone-600">Ready — tap play again.</p> : null}
      {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

/** Downloads the clip using the generated ORDER_SIDE_NAMES_TYPE_DURATION filename. */
export function DownloadAudioButton({ performanceId, asParticipant, className }: { performanceId: string; asParticipant?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="sm"
      busy={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ url: string; filename: string }>(
            asParticipant ? 'participant/audio-download' : 'admin/audio/url',
            asParticipant ? { performance_id: performanceId } : { performance_id: performanceId, purpose: 'download' },
          );
          const a = document.createElement('a');
          a.href = r.url;
          a.download = r.filename;
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast(`Downloading ${r.filename}`);
        } catch (e) {
          toast(errorMessage(e), { tone: 'error' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <IconDownload size={18} /> Download
    </Button>
  );
}
