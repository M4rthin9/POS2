import { useEffect, useMemo, useState } from 'react';
import { fmt, TH } from '@cida/shared';
import { api, type AdminProduct } from '../lib/api';
import { Button, Card, EmptyRow } from '../components/ui';
import { PriceTagSheet } from '../components/PriceTagSheet';
import { TAG_LAYOUTS, perSheet } from '../components/tagLayouts';
import { MIN_MODULE_MM, moduleWidthMm } from '../components/Barcode';
import { printNode } from '../lib/print';

export default function PriceTagsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [copies, setCopies] = useState<Record<number, number>>({});
  const [layoutId, setLayoutId] = useState(TAG_LAYOUTS[0].id);
  const [dark, setDark] = useState(false);

  const layout = TAG_LAYOUTS.find((l) => l.id === layoutId) ?? TAG_LAYOUTS[0];
  // Dark ground is a stand-sign finish only — stickers are scanned, and a black
  // label kills barcode contrast.
  const darkable = layout.kind === 'lstand';
  const isDark = darkable && dark;

  async function load() {
    setProducts(null);
    try {
      const [ps, settings] = await Promise.all([api.products(), api.adminSettings()]);
      setProducts(ps.filter((p) => p.active));
      setLogoUrl(settings.logo_url?.trim() || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setProducts([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const list = products ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term));
  }, [products, q]);

  // One entry per copy — pagination is then purely the sheet's job.
  const tags = useMemo(() => {
    const out: AdminProduct[] = [];
    for (const p of products ?? []) {
      const n = copies[p.id] ?? 0;
      for (let i = 0; i < n; i++) out.push(p);
    }
    return out;
  }, [products, copies]);

  const sheets = Math.ceil(tags.length / perSheet(layout));

  function setCopy(id: number, n: number) {
    setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(999, n)) }));
  }

  function selectAll() {
    setCopies(Object.fromEntries(visible.map((p) => [p.id, Math.max(1, copies[p.id] ?? 0)])));
  }

  async function printTags() {
    const root = document.getElementById('tag-print');
    // The mascot is a data URI, but settings.logo_url may be remote — decode
    // everything first so the clone never prints a half-loaded image. A broken
    // URL rejects and is ignored rather than blocking the print.
    const imgs = Array.from(root?.querySelectorAll('img') ?? []);
    await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
    printNode(root);
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{TH.priceTags}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={layoutId}
            onChange={(e) => setLayoutId(e.target.value)}
            className="border border-slate-300 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-800/20"
          >
            <optgroup label={TH.stickerTags}>
              {TAG_LAYOUTS.filter((l) => l.kind === 'sticker').map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={TH.standSigns}>
              {TAG_LAYOUTS.filter((l) => l.kind === 'lstand').map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </optgroup>
          </select>
          {darkable && (
            <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer" title={TH.darkTagHint}>
              <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} className="accent-slate-800" />
              {TH.darkTag}
            </label>
          )}
          <Button variant="dark" onClick={printTags} disabled={!tags.length}>
            🖨️ {TH.printTags}
          </Button>
        </div>
      </div>

      {error && <p className="no-print text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      <div className="no-print grid lg:grid-cols-2 gap-4 items-start">
        <Card
          title={TH.products}
          action={
            <div className="flex gap-2">
              <Button onClick={selectAll}>{TH.selectAll}</Button>
              <Button onClick={() => setCopies({})}>{TH.clearSelection}</Button>
            </div>
          }
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={TH.search}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-slate-800/20"
          />
          <div className="max-h-[26rem] overflow-y-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {products === null ? (
                  <EmptyRow colSpan={4} label="…" />
                ) : visible.length === 0 ? (
                  <EmptyRow colSpan={4} label={TH.noProducts} />
                ) : (
                  visible.map((p) => {
                    // Stand signs carry no barcode, so the density check is sticker-only.
                    const mm = layout.kind === 'sticker' ? moduleWidthMm(p.sku, layout.codeW) : Infinity;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-1.5 pr-2">
                          <div className="font-medium text-slate-800 leading-tight">{p.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {p.sku}
                            {mm < MIN_MODULE_MM && <span className="ml-2 text-amber-600">⚠ {TH.barcodeTooDense}</span>}
                          </div>
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap text-slate-500">{fmt(p.price)}</td>
                        <td className="py-1.5 pl-2 w-20">
                          <input
                            type="number"
                            min={0}
                            value={copies[p.id] ?? 0}
                            onChange={(e) => setCopy(p.id, Number(e.target.value) || 0)}
                            className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-800/20"
                          />
                        </td>
                        <td className="py-1.5 pl-1 w-8">
                          <button
                            onClick={() => setCopy(p.id, (copies[p.id] ?? 0) + 1)}
                            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold"
                            aria-label={TH.add}
                          >
                            +
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={`${TH.tagsSelected}: ${tags.length}`}
          action={<span className="text-xs text-slate-500">{sheets} {TH.sheets} · {perSheet(layout)} {TH.tagsPerSheet}</span>}
        >
          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3">{TH.tagPrintHint}</p>
          {isDark && <p className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-lg p-2 mb-3">{TH.darkTagHint}</p>}
          {tags.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">{TH.noTagsSelected}</p>
          ) : (
            <div className={`overflow-auto max-h-[28rem] rounded-xl p-3 ${isDark ? 'bg-slate-300' : 'bg-slate-100'}`}>
              <PriceTagSheet tags={tags} layout={layout} logoUrl={logoUrl} dark={isDark} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
