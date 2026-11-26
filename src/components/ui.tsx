// Small, phone-first UI kit. Touch targets are at least 44px tall.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { IconBack, IconCopy, IconWarning, IconX } from './icons';
import { copyText } from '../lib/format';

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}
export { cx };

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'warning';
const variants: Record<Variant, string> = {
  primary: 'bg-rose-700 text-white active:bg-rose-800 disabled:bg-rose-300',
  secondary: 'bg-white text-stone-800 border border-stone-300 active:bg-stone-100 disabled:text-stone-400',
  danger: 'bg-white text-red-700 border border-red-300 active:bg-red-50 disabled:text-red-300',
  ghost: 'bg-transparent text-stone-700 active:bg-stone-200/60 disabled:text-stone-400',
  success: 'bg-emerald-600 text-white active:bg-emerald-700 disabled:bg-emerald-300',
  warning: 'bg-amber-500 text-stone-900 active:bg-amber-600 disabled:bg-amber-200',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg' | 'sm';
  busy?: boolean;
  block?: boolean;
}

export function Button({ variant = 'primary', size = 'md', busy, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600',
        size === 'lg' && 'min-h-14 px-5 text-lg',
        size === 'md' && 'min-h-12 px-4 text-base',
        size === 'sm' && 'min-h-11 px-3 text-sm',
        block && 'w-full',
        variants[variant],
        className,
      )}
    >
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-6 w-6')}
    />
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-stone-500">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
      <IconWarning className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="break-words">{message}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg px-2 font-semibold underline">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'success'; children: ReactNode }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return <div className={cx('rounded-xl border p-3 text-sm leading-relaxed', tones[tone])}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-4 py-10 text-center">
      <p className="text-lg font-semibold text-stone-700">{title}</p>
      {children ? <div className="mt-2 text-stone-500">{children}</div> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-stone-200 bg-white p-4 shadow-sm', className)}>{children}</div>;
}

export function PageHeader({ title, back, action, subtitle }: { title: string; back?: string; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2">
      {back ? (
        <Link to={back} aria-label="Back" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 active:bg-stone-200">
          <IconBack size={24} />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1 pt-1">
        <h1 className="text-2xl leading-tight font-bold break-words text-stone-900">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-stone-500">{subtitle}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-stone-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-sm text-stone-500">{hint}</p> : null}
      {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'block min-h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900',
        'placeholder:text-stone-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-200 focus:outline-none',
        props.className,
      )}
    />
  );
}

export function Segmented<T extends string>({ value, onChange, options, name }: { value: T | ''; onChange: (v: T) => void; options: { value: T; label: string; className?: string }[]; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-12 rounded-xl border px-2 font-semibold',
            value === o.value ? o.className ?? 'border-rose-600 bg-rose-50 text-rose-800' : 'border-stone-300 bg-white text-stone-600',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'stone', className }: { children: ReactNode; tone?: 'stone' | 'rose' | 'indigo' | 'green' | 'amber' | 'red' | 'sky'; className?: string }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-700',
    rose: 'bg-pink-100 text-pink-800',
    indigo: 'bg-indigo-100 text-indigo-800',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-800',
    sky: 'bg-sky-100 text-sky-800',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

export function SideBadge({ side }: { side: string | null | undefined }) {
  if (side === 'bride') return <Badge tone="rose">Bride</Badge>;
  if (side === 'groom') return <Badge tone="indigo">Groom</Badge>;
  return <Badge>No side</Badge>;
}

/** Two-tap inline confirmation (no modal). First tap arms, second tap acts. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Tap again to confirm', ...rest }: ButtonProps & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...rest}
      variant={armed ? 'danger' : rest.variant}
      className={cx(rest.className, armed && 'ring-2 ring-red-400')}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      onClick={async () => toast(await copyText(text) ? 'Copied' : 'Could not copy — please copy manually')}
      aria-label={`${label}: ${text}`}
    >
      <IconCopy size={18} /> {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Toasts (one at a time, bottom of screen, optional action e.g. Undo)
// ---------------------------------------------------------------------------
interface ToastState {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'error';
}
type ToastFn = (message: string, opts?: { actionLabel?: string; onAction?: () => void; tone?: 'default' | 'error'; duration?: number }) => void;

const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<ToastFn>((message, opts = {}) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, actionLabel: opts.actionLabel, onAction: opts.onAction, tone: opts.tone });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), opts.duration ?? (opts.onAction ? 6000 : 3000));
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
        {toast ? (
          <div className={cx('pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-2 text-white shadow-lg', toast.tone === 'error' ? 'bg-red-700' : 'bg-stone-900')}>
            <span className="py-1">{toast.message}</span>
            {toast.onAction ? (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 font-bold text-amber-300 uppercase"
                onClick={() => {
                  toast.onAction?.();
                  setToast(null);
                }}
              >
                {toast.actionLabel ?? 'Undo'}
              </button>
            ) : (
              <button type="button" aria-label="Dismiss" className="flex h-11 w-9 items-center justify-center" onClick={() => setToast(null)}>
                <IconX size={18} />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </ToastCtx.Provider>
  );
}
