import type { ReactNode } from 'react';
import { TH } from '@cida/shared';

// Shared primitives extracted from the per-page inline Tailwind that had
// accumulated across the admin app. Class strings match the previous markup so
// nothing shifts visually.

export function Card({
  title,
  action,
  children,
  className = '',
  bodyClassName = 'p-4',
  dense,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section className={`bg-white rounded-2xl shadow-sm avoid-break ${className}`}>
      {(title || action) && (
        <header className={`flex items-center justify-between gap-2 ${dense ? 'px-4 py-2.5' : 'px-4 py-3'} border-b border-slate-100`}>
          {typeof title === 'string' ? <h3 className="font-semibold text-slate-800 text-sm">{title}</h3> : title}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const TONES = {
  slate: 'text-slate-800',
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
  violet: 'text-violet-600',
} as const;

export type Tone = keyof typeof TONES;

export function StatTile({
  label,
  value,
  sub,
  tone = 'slate',
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-3 avoid-break">
      <div className="text-[11px] text-slate-500 flex items-center gap-1 leading-tight">
        {icon && <span aria-hidden>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-lg font-bold mt-0.5 tabular-nums ${TONES[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-50 text-emerald-700',
  sky: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  violet: 'bg-violet-50 text-violet-700',
};

export function Badge({ tone = 'slate', children }: { tone?: string; children: ReactNode }) {
  return <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${BADGE_TONES[tone] ?? BADGE_TONES.slate}`}>{children}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="no-print fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl p-5 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-2xl max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl px-1" aria-label={TH.close}>
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="mt-5">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorBar({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className="no-print mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
      <span>{message}</span>
      <button onClick={onDismiss} className="font-bold px-2">
        ✕
      </button>
    </div>
  );
}

export function EmptyRow({ colSpan, label = TH.noData }: { colSpan: number; label?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-slate-400">
        {label}
      </td>
    </tr>
  );
}

/** Table shell with the repeated head/body styling and horizontal scroll container. */
export function Table({ head, children, className = '' }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm ${className}`}>
        <thead className="bg-slate-50 text-slate-500">{head}</thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Button({
  variant = 'ghost',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'dark' }) {
  const base = 'px-3 py-1.5 rounded-xl text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm',
    dark: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm',
    danger: 'bg-red-600 text-white hover:bg-red-500',
    ghost: 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50',
  }[variant];
  return <button {...props} className={`${base} ${styles} ${className}`} />;
}

/** Hand-rolled bar chart — the app deliberately carries no chart library. */
export function MiniBarChart({ data, format }: { data: Record<string, number>; format: (n: number) => string }) {
  const days = Object.keys(data).sort();
  if (!days.length) return <p className="text-sm text-slate-400">{TH.noData}</p>;
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="flex items-end gap-2 h-36 overflow-x-auto">
      {days.map((d) => (
        <div key={d} className="flex flex-col items-center flex-none">
          <div className="text-[10px] text-slate-500">{format(data[d])}</div>
          <div
            className="w-8 bg-emerald-500 rounded-t"
            style={{ height: `${Math.round((data[d] / max) * 90)}px`, minHeight: 4 }}
          />
          <div className="text-[10px] text-slate-500 mt-1">{d.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

/** Proportional split bar, used for the payment-method breakdown. */
export function ShareBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <div className="h-2 rounded-full bg-slate-100" />;
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex">
      {parts.map((p) => (
        <div key={p.label} className={p.color} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />
      ))}
    </div>
  );
}
