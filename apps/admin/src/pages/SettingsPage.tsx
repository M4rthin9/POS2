import { useEffect, useState } from 'react';
import { TH } from '@cida/shared';
import { api } from '../lib/api';

const FIELDS: { key: string; label: string }[] = [
  { key: 'org_name', label: TH.orgName },
  { key: 'org_subtitle', label: TH.orgSubtitle },
  { key: 'org_address', label: TH.orgAddress },
  { key: 'logo_url', label: TH.logoUrl },
  { key: 'tax_id', label: TH.taxId },
  { key: 'promptpay_id', label: TH.promptpayId },
  { key: 'receipt_footer', label: TH.receiptFooter },
  { key: 'print_size', label: TH.printSize },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminSettings().then(setSettings).catch((e) => setError(e instanceof Error ? e.message : TH.error));
  }, []);

  function set(key: string, value: string) {
    setSaved(false);
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await api.updateAdminSettings(settings);
      setSettings(res);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold text-slate-800">{TH.settings}</h1>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-sm font-medium text-slate-600">{f.label}</span>
            <input
              value={settings[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
          </label>
        ))}
        <p className="text-xs text-slate-400">{TH.printSizeHint}</p>

        {saved && <p className="text-sm text-emerald-600 font-medium">{TH.saved}</p>}

        <button onClick={save} disabled={busy} className="w-full py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 disabled:opacity-40">
          {busy ? '…' : TH.save}
        </button>
      </div>
    </div>
  );
}
