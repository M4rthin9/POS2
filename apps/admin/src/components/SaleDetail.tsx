import { useEffect, useState } from 'react';
import type { Sale } from '@cida/shared';
import { PAYMENT_LABELS, SALE_STATUS_LABELS, TH, fmt, fmtDate, shortHash } from '@cida/shared';
import { api } from '../lib/api';
import { Badge, Button } from './ui';

const STATUS_TONE: Record<string, string> = { COMPLETED: 'emerald', VOID: 'slate', REFUNDED: 'amber' };

/**
 * Receipt view plus the non-destructive corrections. Void is the default action
 * for admins; refund is superadmin-only. Neither deletes the row, so the ledger
 * hash and the audit trail survive.
 */
export default function SaleDetail({ sale, isSuper, onChanged }: { sale: Sale; isSuper: boolean; onChanged: () => void }) {
  const [full, setFull] = useState<Sale>(sale);
  const [mode, setMode] = useState<'void' | 'refund' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The dashboard and sales list carry sale headers without their items.
  useEffect(() => {
    if (sale.items?.length) return;
    api.sale(sale.id).then(setFull).catch(() => {});
  }, [sale]);

  async function submit() {
    if (!mode) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'void') await api.voidSale(sale.id, reason);
      else await api.refundSale(sale.id, reason);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  const items = full.items ?? [];
  const reversible = full.status === 'COMPLETED';

  return (
    <div>
      <div className="text-xs text-slate-500 space-y-0.5 mb-3">
        <div>
          {fmtDate(full.created_at)} · {full.event_name}
        </div>
        <div>
          {TH.cashier}: {full.cashier_name} · {PAYMENT_LABELS[full.payment_method] ?? full.payment_method}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Badge tone={STATUS_TONE[full.status]}>{SALE_STATUS_LABELS[full.status] ?? full.status}</Badge>
          <span className="font-mono text-[10px] text-slate-400" title={full.tx_hash ?? ''}>
            {TH.txHash}: {shortHash(full.tx_hash)}
          </span>
        </div>
        {full.void_reason && (
          <div className="text-rose-600">
            {TH.reason}: {full.void_reason}
          </div>
        )}
      </div>

      <div className="border-t border-dashed pt-3 space-y-1.5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-400">…</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex justify-between text-sm">
              <span className="text-slate-700">
                {it.name} <span className="text-slate-400">×{Number.isInteger(it.qty) ? it.qty : it.qty.toFixed(2)}</span>
              </span>
              <span className="font-medium tabular-nums">{fmt(it.line_total)}</span>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-dashed mt-3 pt-3 space-y-1">
        <div className="flex justify-between text-sm text-slate-600">
          <span>{TH.subtotal}</span>
          <span className="tabular-nums">{fmt(full.subtotal)}</span>
        </div>
        {full.discount > 0 && (
          <div className="flex justify-between text-sm text-slate-600">
            <span>{TH.discount}</span>
            <span className="tabular-nums">-{fmt(full.discount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-lg">
          <span>{TH.total}</span>
          <span className="text-emerald-600 tabular-nums">{fmt(full.total)}</span>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {reversible && (
        <div className="no-print mt-4 border-t border-slate-100 pt-4">
          {mode === null ? (
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => setMode('void')}>
                ⛔ {TH.voidSale}
              </Button>
              {isSuper && (
                <Button onClick={() => setMode('refund')}>
                  ↩ {TH.refundSale}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">{mode === 'void' ? TH.voidConfirm : TH.refundConfirm}</p>
              <p className="text-xs text-rose-500">{TH.stockRestored}</p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={TH.voidReason}
                autoFocus
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => { setMode(null); setReason(''); }} disabled={busy}>
                  {TH.cancel}
                </Button>
                <Button variant="danger" onClick={submit} disabled={busy}>
                  {busy ? '…' : TH.confirm}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
