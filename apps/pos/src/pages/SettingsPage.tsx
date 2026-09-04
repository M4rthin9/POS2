import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicSettings } from '@cida/shared';
import { TH } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { printNode } from '../lib/print';
import {
  autoConnect,
  bluetoothAvailable,
  forgetPrinter,
  isConnected,
  pickPrinter,
  rememberedPrinter,
} from '../lib/bluetooth-printer';
import { builtInPrinter, openCashDrawer, printTestPage } from '../lib/escpos';

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
    print_size: '58mm',
  });
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [printerConnected, setPrinterConnected] = useState(false);
  const builtIn = builtInPrinter();
  const testTicketRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.publicSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoaded(true));
    // The built-in printer needs no pairing, so Bluetooth is only probed when
    // this terminal does not have one.
    if (builtIn) return;
    setPrinterName(rememberedPrinter()?.name ?? null);
    autoConnect().finally(() => setPrinterConnected(isConnected()));
  }, [builtIn]);

  async function connectPrinter() {
    setError('');
    try {
      const rec = await pickPrinter();
      setPrinterName(rec.name);
      setPrinterConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }

  async function testPrint() {
    setError('');
    try {
      await printTestPage(settings);
      setPrinterConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }

  async function forget() {
    await forgetPrinter();
    setPrinterName(null);
    setPrinterConnected(false);
  }

  /** Print the test ticket through the browser's normal printer picker. */
  function normalPrintTest() {
    setError('');
    setNotice('');
    printNode(testTicketRef.current);
  }

  /**
   * Wipes this device's local sale state. Needed when the shop database is
   * reset: a leftover offline-queue entry would otherwise replay an old sale
   * into the fresh ledger on the next sync.
   */
  function clearLocalData() {
    for (const key of ['cida_pos_offline_queue', 'cida_pos_held_carts', 'cida_pos_cart']) {
      localStorage.removeItem(key);
    }
    setNotice(TH.clearLocalDataDone);
    setTimeout(() => setNotice(''), 4000);
  }

  function set<K extends keyof PublicSettings>(k: K, v: PublicSettings[K]) {
    setSaved(false);
    setSettings((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setError('');
    try {
      await api.updateSettings(settings);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
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
        {error && <div className="mb-3 bg-red-50 text-red-700 text-sm font-semibold rounded-xl px-4 py-2.5">{error}</div>}
        {notice && <div className="mb-3 bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-xl px-4 py-2.5">{notice}</div>}
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

          <button
            onClick={save}
            disabled={!loaded}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 active:scale-[0.99] transition disabled:opacity-50"
          >
            {TH.save}
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">{builtIn ? TH.builtInPrinter : TH.btPrinter}</span>
            {builtIn ? (
              <span className="text-xs font-medium text-emerald-600">{TH.builtInPrinterReady}</span>
            ) : printerName ? (
              <span className={`text-xs font-medium ${printerConnected ? 'text-emerald-600' : 'text-slate-400'}`}>
                {printerConnected ? `${TH.btConnected} · ${printerName}` : `${TH.btNotConnected} · ${printerName}`}
              </span>
            ) : null}
          </div>
          {builtIn ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={testPrint} className="py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition">
                {TH.btTestPrint}
              </button>
              <button onClick={openCashDrawer} className="py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition">
                {TH.openCashDrawer}
              </button>
            </div>
          ) : bluetoothAvailable() ? (
            <>
              <span className="block text-xs text-slate-400">{TH.btPickHint}</span>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={connectPrinter} className="py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition">
                  {TH.btConnect}
                </button>
                <button onClick={testPrint} className="py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition">
                  {TH.btTestPrint}
                </button>
              </div>
              {printerName && (
                <button onClick={forget} className="w-full py-2 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 transition">
                  {TH.btForget}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="block text-xs text-amber-600">{TH.btNotSupported}</span>
              <span className="block text-xs text-slate-400">{TH.normalPrinterHint}</span>
              <button onClick={normalPrintTest} className="w-full py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition">
                {TH.normalPrinterTest}
              </button>
            </>
          )}
        </div>

        {/* Hidden printable test ticket used by the "normal printer" fallback. */}
        <div className="hidden">
          <div
            ref={testTicketRef}
            id="receipt-print"
            data-print-size={settings.print_size?.includes('58') ? '58mm' : '80mm'}
            className="bg-white text-slate-900 text-[12px] leading-snug px-3 py-4 font-mono"
            style={{ maxWidth: settings.print_size?.includes('58') ? '58mm' : '80mm' }}
          >
            <div className="flex flex-col items-center text-center">
              {settings.org_name && <div className="font-bold text-[13px] leading-tight">{settings.org_name}</div>}
              <div className="font-bold text-[13px] mt-1">ทดสอบเครื่องพิมพ์ (ปกติ)</div>
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span className="text-slate-500">{TH.printSize}</span>
                <span className="font-semibold">{settings.print_size}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">เวลา</span>
                <span>{new Date().toLocaleString('th-TH')}</span>
              </div>
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="text-center">เรียบร้อย ✓</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2 mt-4">
          <span className="text-sm font-bold text-slate-700">{TH.clearLocalData}</span>
          <p className="text-xs text-slate-400">{TH.clearLocalDataHint}</p>
          <button
            onClick={clearLocalData}
            className="w-full py-2.5 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 transition"
          >
            {TH.clearLocalData}
          </button>
        </div>
      </div>
    </div>
  );
}
