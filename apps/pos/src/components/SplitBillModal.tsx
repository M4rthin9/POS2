import { useMemo, useState } from 'react';
import type { PaymentMethod } from '@cida/shared';
import { PAYMENT_LABELS, TH, fmt } from '@cida/shared';

export interface SplitPayment {
  method: PaymentMethod;
  amount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Split one bill across Cash and PromptPay. The tenders must add up to the
 * total exactly — the API rejects anything else.
 */
export default function SplitBillModal({
  total,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  total: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (payments: SplitPayment[]) => void;
}) {
  const [rows, setRows] = useState<{ method: PaymentMethod; amount: string }[]>([
    { method: 'Cash', amount: '' },
    { method: 'PromptPay', amount: '' },
  ]);

  const paid = useMemo(() => round(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)), [rows]);
  const remaining = round(total - paid);

  function update(i: number, patch: Partial<{ method: PaymentMethod; amount: string }>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function fillRemaining(i: number) {
    const others = round(rows.reduce((a, r, idx) => (idx === i ? a : a + (Number(r.amount) || 0)), 0));
    update(i, { amount: String(Math.max(0, round(total - others))) });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-800 mb-1">🧮 {TH.splitBill}</h2>
        <p className="text-sm text-slate-500 mb-3">
          {TH.total}: <span className="font-bold text-emerald-600">{fmt(total)}</span>
        </p>

        <div className="space-y-2 mb-3">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={r.method}
                onChange={(e) => update(i, { method: e.target.value as PaymentMethod })}
                className="border border-slate-300 rounded-xl px-2 py-2.5 text-sm flex-none w-28"
              >
                <option value="Cash">{PAYMENT_LABELS.Cash}</option>
                <option value="PromptPay">{PAYMENT_LABELS.PromptPay}</option>
              </select>
              <input
                value={r.amount}
                onChange={(e) => update(i, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="0"
                className="flex-1 min-w-0 border border-slate-300 rounded-xl px-3 py-2.5 text-right focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                onClick={() => fillRemaining(i)}
                className="flex-none px-2.5 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
                title={TH.splitRemaining}
              >
                =
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setRows([...rows, { method: 'Cash', amount: '' }])}
          className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 mb-3"
        >
          + {TH.addPayment}
        </button>

        <div
          className={`mb-4 text-sm flex items-center justify-between rounded-xl px-3 py-2.5 ${
            remaining === 0 ? 'bg-emerald-50 text-emerald-700' : remaining < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          <span>{remaining < 0 ? TH.splitExceeds : TH.splitRemaining}</span>
          <span className="font-bold text-lg">{fmt(Math.abs(remaining))}</span>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={onClose} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition">
            {TH.cancel}
          </button>
          <button
            onClick={() =>
              onConfirm(rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: round(Number(r.amount)) })))
            }
            disabled={busy || remaining !== 0}
            className="py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40 hover:bg-emerald-500 transition"
          >
            {busy ? '…' : TH.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
