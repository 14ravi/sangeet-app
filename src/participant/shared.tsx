import type { ReactNode } from 'react';
import { useApi } from '../lib/hooks';

export interface PublicConfig {
  event_name: string;
  registration_enabled: boolean;
}

export function usePublicConfig() {
  return useApi<PublicConfig>('public/config');
}

export function AuthShell({ title, eventName, children }: { title: string; eventName?: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-8 pb-16">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-800 text-2xl text-amber-200 shadow" aria-hidden>
          ♪
        </div>
        <p className="text-sm font-semibold tracking-wide text-rose-800 uppercase">{eventName ?? 'Sangeet'}</p>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">{title}</h1>
      </div>
      {children}
    </main>
  );
}

export function PrivacyNote() {
  return (
    <p className="text-xs leading-relaxed text-stone-500">
      Privacy: your phone number is typed in by you and is <strong>not verified</strong> by SMS. It is only used by the
      organisers to contact you about the Sangeet and as your login. It is never shown to other participants.
    </p>
  );
}

/** Numeric 4-digit PIN input that shows the phone keypad. */
export function PinInput(props: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; label?: string }) {
  return (
    <input
      id={props.id}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={4}
      autoComplete={props.autoComplete ?? 'current-password'}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      className="block min-h-14 w-full rounded-xl border border-stone-300 bg-white px-3 text-center text-2xl tracking-[0.6em] focus:border-rose-500 focus:ring-2 focus:ring-rose-200 focus:outline-none"
      aria-label={props.label}
    />
  );
}
