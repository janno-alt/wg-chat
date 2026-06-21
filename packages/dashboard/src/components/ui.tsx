import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700',
    ghost: 'border border-slate-300 text-slate-700 hover:bg-slate-100',
    danger: 'border border-red-300 text-red-600 hover:bg-red-50',
    subtle: 'text-slate-500 hover:text-slate-800 hover:bg-slate-100',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-slate-700">{title}</h3>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500"
    />
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone] ?? tones.slate}`}>{children}</span>;
}

export function Spinner({ label = 'Lädt …' }: { label?: string }) {
  return <div className="py-6 text-center text-sm text-slate-400">{label}</div>;
}

export function ErrorNote({ error }: { error: string }) {
  return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Lädt Daten und liefert reload(). deps steuern Neuladen. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((d) => alive && setState({ data: d, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}
