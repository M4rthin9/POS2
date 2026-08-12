import { useEffect, useState } from 'react';
import type { Division } from '@cida/shared';
import { fmt, TH } from '@cida/shared';
import { api, type AdminProduct, type ProductInput } from '../lib/api';

interface Draft {
  id: number | null;
  sku: string;
  name: string;
  division_id: number | '';
  price: string;
  stock: string;
  active: boolean;
  image_url: string | null;
}

const emptyDraft: Draft = { id: null, sku: '', name: '', division_id: '', price: '', stock: '', active: true, image_url: null };

const MAX_IMAGE_BYTES = 700 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ProductsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  async function load() {
    setProducts(null);
    try {
      const [ps, ds] = await Promise.all([api.products(), api.adminDivisions()]);
      setProducts(ps);
      setDivisions(ds);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setProducts([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(p: AdminProduct) {
    setDraft({ id: p.id, sku: p.sku, name: p.name, division_id: p.division_id ?? '', price: String(p.price), stock: p.stock === null ? '' : String(p.stock), active: p.active, image_url: p.image_url ?? null });
  }

  async function onImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('เลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('ไฟล์รูปใหญ่เกินไป (ไม่เกิน 700KB)');
      return;
    }
    setError('');
    const dataUrl = await fileToBase64(file);
    setDraft((d) => ({ ...d, image_url: dataUrl }));
  }

  async function save() {
    if (!draft.sku.trim() || !draft.name.trim()) {
      setError('กรอก SKU และชื่อสินค้า');
      return;
    }
    setBusy(true);
    setError('');
    const input: ProductInput = {
      sku: draft.sku.trim(),
      name: draft.name.trim(),
      division_id: draft.division_id === '' ? null : Number(draft.division_id),
      price: Number(draft.price) || 0,
      stock: draft.stock === '' ? null : Number(draft.stock),
      active: draft.active,
      image_url: draft.image_url,
    };
    try {
      if (draft.id === null) {
        await api.createProduct(input);
      } else {
        await api.updateProduct(draft.id, input);
      }
      setDraft(emptyDraft);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: AdminProduct) {
    if (!confirm(`ลบสินค้า ${p.name}?`)) return;
    try {
      await api.deleteProduct(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }

  async function doImport() {
    const lines = importText.split('\n').filter((l) => l.trim());
    const rows: ProductInput[] = lines.map((line) => {
      const [sku, name, price, stock] = line.split(',').map((s) => s.trim());
      return { sku, name, price: Number(price) || 0, stock: stock === undefined || stock === '' ? null : Number(stock) };
    });
    if (!rows.length) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.importProducts(rows);
      setShowImport(false);
      setImportText('');
      await load();
      alert(`นำเข้า ${res.imported} รายการ`);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{TH.products}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport((v) => !v)} className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm font-semibold hover:bg-slate-50">
            {TH.import}
          </button>
          <button onClick={() => { setDraft(emptyDraft); setError(''); }} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">
            + {TH.add}
          </button>
        </div>
      </div>

      {showImport && (
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
          <h2 className="font-semibold text-slate-800 text-sm">{TH.importProducts}</h2>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
            placeholder={'SKU,ชื่อ,ราคา,สต็อก\nSKU001,ข้าวผัดหมู,40,100'}
            className="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-800"
          />
          <button onClick={doImport} disabled={busy || !importText.trim()} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold disabled:opacity-40">
            {busy ? '…' : TH.import}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold text-slate-800 text-sm">{draft.id === null ? TH.add : `${TH.edit} #${draft.id}`}</h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
              {draft.image_url ? (
                <img src={draft.image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl">🛍️</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold cursor-pointer text-center transition">
                เลือกรูป
                <input type="file" accept="image/*" onChange={onImageSelect} className="hidden" />
              </label>
              {draft.image_url && (
                <button onClick={() => setDraft((d) => ({ ...d, image_url: null }))} className="text-xs text-red-500 hover:underline">
                  ลบรูป
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="SKU" className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-400" />
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={TH.name} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-400" />
            <select value={draft.division_id} onChange={(e) => setDraft({ ...draft, division_id: e.target.value === '' ? '' : Number(e.target.value) })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-400">
              <option value="">— {TH.division} —</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.icon} {d.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d.]/g, '') })} type="number" min="0" placeholder={TH.price} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-400" />
              <input value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value.replace(/[^\d]/g, '') })} type="number" min="0" placeholder={TH.qty} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800/20 focus:border-slate-400" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="w-4 h-4" />
            {TH.active}
          </label>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition disabled:opacity-40">
            {busy ? '…' : TH.save}
          </button>
          {draft.id !== null && (
            <button onClick={() => setDraft(emptyDraft)} className="text-sm text-slate-500 hover:text-slate-700">
              {TH.cancel}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2" />
                <th className="px-4 py-2 text-left font-medium">SKU</th>
                <th className="px-4 py-2 text-left font-medium">{TH.name}</th>
                <th className="px-4 py-2 text-left font-medium">{TH.division}</th>
                <th className="px-4 py-2 text-right font-medium">{TH.price}</th>
                <th className="px-4 py-2 text-right font-medium">{TH.qty}</th>
                <th className="px-4 py-2 text-center font-medium">{TH.status}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products === null ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    …
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    {TH.noData}
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center text-base">
                        {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : '🛍️'}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2 text-slate-500">{p.division_name ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(p.price)}</td>
                    <td className="px-4 py-2 text-right">{p.stock === null ? '∞' : p.stock}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                        {p.active ? TH.active : TH.inactive}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(p)} className="text-emerald-600 hover:underline text-xs font-semibold mr-3">
                        {TH.edit}
                      </button>
                      <button onClick={() => remove(p)} className="text-red-500 hover:underline text-xs font-semibold">
                        {TH.delete}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
