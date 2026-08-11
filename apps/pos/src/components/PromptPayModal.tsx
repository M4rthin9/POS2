import { QRCodeSVG } from 'qrcode.react';
import { generatePayload, fmt } from '@cida/shared';

interface Props {
  promptpayId: string;
  amount: number;
  onClose: () => void;
  onDone: () => void;
}

export default function PromptPayModal({ promptpayId, amount, onClose, onDone }: Props) {
  const { payload, targetType } = generatePayload(promptpayId, amount);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-800 mb-1">QR PromptPay</h2>
        <p className="text-sm text-slate-500 mb-4">สแกน QR Code เพื่อชำระเงิน</p>
        <div className="bg-white border-2 border-slate-100 rounded-xl p-3 inline-block mx-auto">
          <QRCodeSVG value={payload} size={220} level="M" />
        </div>
        <p className="text-3xl font-bold text-emerald-600 mt-4">{fmt(amount)}</p>
        <p className="text-xs text-slate-400 mt-1">
          PromptPay ID: {promptpayId} ({targetType === 'ewallet' ? 'e-Wallet' : targetType === 'taxid' ? 'Tax ID' : 'เบอร์โทร'})
        </p>
        <div className="grid grid-cols-2 gap-3 mt-5">
          <button onClick={onClose} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200">
            ปิด
          </button>
          <button onClick={onDone} className="py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500">
            รับเงินแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}
