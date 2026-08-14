import { useState } from 'react';
import type { Sale } from '@cida/shared';
import { TH, fmt } from '@cida/shared';

export interface VoidApproval {
  superadmin_username: string;
  superadmin_pin: string;
  reason?: string;
}

/**
 * Cashier-initiated bill void. The bill is only reversed after the approving
 * superadmin's username + PIN are entered and verified by the API.
 */
export default function VoidBillModal({
  sale,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  sale: Sale;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (input: VoidApproval) => void;
}) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-800 mb-1">⛔ {TH.voidBillTitle}</h2>
        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-3">{TH.voidSuperadminNote}</p>

        <div className="bg-slate-50 rounded-xl p-3 mb-4">
          <div className="font-semibold text-sm text-slate-800">#{String(sale.id).padStart(6, '0')}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {TH.total}: <span className="font-bold text-emerald-600">{fmt(sale.total)}</span>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{TH.superadminUsername}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={TH.username}
              autoCapitalize="none"
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{TH.superadminPin}</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ''))}
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{TH.reason}</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={TH.voidReasonPlaceholder}
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={onClose} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition">
            {TH.cancel}
          </button>
          <button
            onClick={() => onConfirm({ superadmin_username: username.trim(), superadmin_pin: pin, reason: reason.trim() })}
            disabled={busy || !username.trim() || !pin}
            className="py-3 rounded-xl bg-red-600 text-white font-bold disabled:opacity-40 hover:bg-red-500 transition"
          >
            {busy ? '…' : TH.voidBill}
          </button>
        </div>
      </div>
    </div>
  );
}
