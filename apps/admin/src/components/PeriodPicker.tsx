import { TH } from '@cida/shared';
import { PRESETS, type Period } from '../lib/period';

export interface PeriodState {
  period: Period;
  from: string;
  to: string;
}

export default function PeriodPicker({
  value,
  onChange,
  children,
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange({ ...value, period: p.id })}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              value.period === p.id ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange({ ...value, period: 'custom' })}
        className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition ${
          value.period === 'custom' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        {TH.periodCustom}
      </button>
      {value.period === 'custom' && (
        <>
          <input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm"
          />
          <input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm"
          />
        </>
      )}
      {children}
    </div>
  );
}
