import { useEffect, useMemo, useState } from 'react';
import { fmt, TH } from '@cida/shared';
import { api, type AdminProduct } from '../lib/api';
import { Button, Card, EmptyRow } from '../components/ui';
import { PriceTagSheet } from '../components/PriceTagSheet';
import { TAG_LAYOUTS, perSheet } from '../components/tagLayouts';
import { printNode } from '../lib/print';

const QR_LAYOUT = TAG_LAYOUTS.find((l) => l.kind === 'qr')!;

export default function QRTagsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [promptpayId, setPromptpayId] = useState('');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [copies, setCopies] = useState<Record<number, number>>({});

  async function load() {
    setProducts(null);
    try {
      const [ps, settings] = await Promise.all([api.products(), api.adminSettings()]);
      setProducts(ps.filter((p) => p.active));
      setLogoUrl(settings.logo_url?.trim() || null);
      setPromptpayId(settings.promptpay_id?.trim() || '');
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

  const tags = useMemo(() => {
    const out: AdminProduct[] = [];
    for (const p of products ?? []) {
      const n = copies[p.id] ?? 0;
      for (let i = 0; i < n; i++) out.push(p);
    }
    return out;
  }, [products, copies]);

  const sheets = Math.ceil(tags.length / perSheet(QR_LAYOUT));

  function setCopy(id: number, n: number) {
    setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(999, n)) }));
  }

  function selectAll() {
    setCopies(Object.fromEntries(visible.map((p) => [p.id, Math.max(1, copies[p.id] ?? 0)])));
  }

  async function printTags() {
    const root = document.getElementById('tag-print');
    const imgs = Array.from(root?.querySelectorAll('img') ?? []);
    await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
    printNode(root);
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{TH.qrPaymentTags}</h1>
        <Button variant="dark" onClick={printTags} disabled={!tags.length || !promptpayId}>
          🖨️ {TH.printQrTags}
        </Button>
      </div>

      {error && <p className="no-print text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      {!promptpayId && (
        <p className="no-print text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          {TH.noPromptPayId}
        </p>
      )}

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
                  <EmptyRow colSpan={3} label="…" />
                ) : visible.length === 0 ? (
                  <EmptyRow colSpan={3} label={TH.noProducts} />
                ) : (
                  visible.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-1.5 pr-2">
                        <div className="font-medium text-slate-800 leading-tight">{p.name}</div>
                        <div className="font-mono text-[11px] text-slate-400">{p.sku}</div>
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={`${TH.qrTagsSelected}: ${tags.length}`}
          action={<span className="text-xs text-slate-500">{sheets} {TH.sheets} · {perSheet(QR_LAYOUT)} {TH.tagsPerSheet}</span>}
        >
          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3">{TH.qrTagHint}</p>
          {tags.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">{TH.noTagsSelected}</p>
          ) : (
            <div className="overflow-auto max-h-[28rem] bg-slate-100 rounded-xl p-3">
              <PriceTagSheet tags={tags} layout={QR_LAYOUT} logoUrl={logoUrl} promptpayId={promptpayId} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
