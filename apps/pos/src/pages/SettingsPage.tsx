import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicSettings } from '@cida/shared';
import { TH } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const [settings, setSettings] = useState<PublicSettings>({
    org_name: '',
    org_subtitle: '',
    org_address: '',
    tax_id: '',
    receipt_footer: '',
    promptpay_id: '',
    logo_url: '',
    print_size: '80mm',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.publicSettings().then(setSettings).catch(() => {});
  }, []);

  function set<K extends keyof PublicSettings>(k: K, v: PublicSettings[K]) {
    setSaved(false);
    setSettings((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    try {
      await api.updateSettings(settings);
      setSaved(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : TH.error);
    }
  }

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <div className="font-bold leading-tight">{TH.settings}</div>
          <div className="text-xs text-slate-300">
            {user?.display_name} · {isAdmin ? TH.admin : TH.cashier}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/')} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition">
            ← {TH.back}
          </button>
          <button onClick={logout} className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm transition">
            {TH.logout}
          </button>
        </div>
      </header>

      <div className="p-4 max-w-xl mx-auto w-full flex-1">
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{TH.orgName}</span>
            <input value={settings.org_name} onChange={(e) => set('org_name', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{TH.orgSubtitle}</span>
            <input value={settings.org_subtitle} onChange={(e) => set('org_subtitle', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{TH.orgAddress}</span>
            <input value={settings.org_address} onChange={(e) => set('org_address', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{TH.logoUrl}</span>
            <input value={settings.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://…/logo.png" className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            {settings.logo_url && (
              <img src={settings.logo_url} alt="" className="mt-2 h-14 w-14 object-contain rounded-lg border border-slate-200" />
            )}
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{TH.taxId}</span>
            <input value={settings.tax_id} onChange={(e) => set('tax_id', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{TH.receiptFooter}</span>
            <input value={settings.receipt_footer} onChange={(e) => set('receipt_footer', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          </label>

          <div className="border-t pt-3 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-600">{TH.printSize}</span>
              <select value={settings.print_size} onChange={(e) => set('print_size', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white">
                <option value="58mm">58mm (ใบเสร็จร้อน)</option>
                <option value="80mm">80mm (A4 / เครื่องพิมพ์ใหญ่)</option>
              </select>
              <span className="text-xs text-slate-400">{TH.printSizeHint}</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">{TH.promptpayId}</span>
              <input
                value={settings.promptpay_id}
                onChange={(e) => set('promptpay_id', e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <span className="text-xs text-slate-400">13 หลัก (Tax ID) หรือ 15 หลัก (e-Wallet)</span>
            </label>
          </div>

          {saved && <p className="text-sm text-emerald-600 font-medium">{TH.saved}</p>}

          <button onClick={save} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 active:scale-[0.99] transition">
            {TH.save}
          </button>
        </div>
      </div>
    </div>
  );
}
