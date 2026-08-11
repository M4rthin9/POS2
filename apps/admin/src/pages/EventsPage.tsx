import { useEffect, useState } from 'react';
import { fmtDateOnly, TH, EVENT_STATUS_LABELS } from '@cida/shared';
import { api, type AdminEvent, type AdminProduct } from '../lib/api';

interface Draft {
  id: number | null;
  code: string;
  name: string;
  date: string;
  location: string;
  status: string;
}

const emptyDraft: Draft = { id: null, code: '', name: '', date: '', location: '', status: 'UPCOMING' };

export default function EventsPage() {
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState<AdminEvent | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function load() {
    setEvents(null);
    try {
      const [evs, ps] = await Promise.all([api.adminEvents(), api.products()]);
      setEvents(evs);
      setProducts(ps);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setEvents([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(e: AdminEvent) {
    setDraft({ id: e.id, code: e.code, name: e.name, date: e.date ? e.date.slice(0, 10) : '', location: e.location ?? '', status: e.status });
  }

  async function save() {
    if (!draft.code.trim() || !draft.name.trim()) {
      setError('กรอกรหัสและชื่อกิจกรรม');
      return;
    }
    setBusy(true);
    setError('');
    const input = { code: draft.code.trim(), name: draft.name.trim(), date: draft.date || null, location: draft.location || null, status: draft.status };
    try {
      if (draft.id === null) {
        await api.createEvent(input);
      } else {
        await api.updateEvent(draft.id, input);
      }
      setDraft(emptyDraft);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  async function activate(e: AdminEvent) {
    if (!confirm(`เปิดขายกิจกรรม "${e.name}"? (กิจกรรมอื่นจะถูกปิด)`)) return;
    try {
      await api.activateEvent(e.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : TH.error);
    }
  }

  async function remove(e: AdminEvent) {
    if (!confirm(`ลบกิจกรรม ${e.name}?`)) return;
    try {
      await api.deleteEvent(e.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : TH.error);
    }
  }

  async function openAssign(ev: AdminEvent) {
    setAssigning(ev);
    try {
      const ids = await api.eventProductIds(ev.id);
      setSelected(new Set(ids));
    } catch (err) {
      setError(err instanceof Error ? err.message : TH.error);
    }
  }

  function toggleProduct(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function saveAssignment() {
    if (!assigning) return;
    setBusy(true);
    try {
      await api.setEventProducts(assigning.id, [...selected]);
      setAssigning(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{TH.events}</h1>
        <button onClick={() => { setDraft(emptyDraft); setError(''); }} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">
          + {TH.add}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold text-slate-800 text-sm">{draft.id === null ? TH.add : `${TH.edit} #${draft.id}`}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="รหัส (EVT002)" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={TH.name} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="สถานที่" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex items-center gap-4">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {Object.entries(EVENT_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold disabled:opacity-40">
            {busy ? '…' : TH.save}
          </button>
          {draft.id !== null && (
            <button onClick={() => setDraft(emptyDraft)} className="text-sm text-slate-500">
              {TH.cancel}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        {events === null ? (
          <div className="text-center text-slate-400 py-10">…</div>
        ) : events.length === 0 ? (
          <div className="text-center text-slate-400 py-10">{TH.noData}</div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-40">
                <div className="font-semibold">
                  {e.name}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${e.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : e.status === 'UPCOMING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>
                    {EVENT_STATUS_LABELS[e.status]}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {e.code} · {e.date ? fmtDateOnly(e.date) : 'ไม่มีวันที่'} {e.location ? `· ${e.location}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openAssign(e)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50">
                  {TH.assignProducts}
                </button>
                {e.status !== 'ACTIVE' && (
                  <button onClick={() => activate(e)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500">
                    ▶ {TH.activate}
                  </button>
                )}
                <button onClick={() => startEdit(e)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50">
                  {TH.edit}
                </button>
                <button onClick={() => remove(e)} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600">
                  {TH.delete}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {assigning && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAssigning(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800 mb-1">{TH.assignProducts}: {assigning.name}</h2>
            <p className="text-xs text-slate-500 mb-3">เลือกสินค้าที่จะขายในกิจกรรมนี้</p>
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {products.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">{TH.noData}</p>
              ) : (
                products.map((p) => (
                  <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleProduct(p.id)} className="w-4 h-4" />
                    <span className="text-sm flex-1">{p.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{p.sku}</span>
                  </label>
                ))
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setAssigning(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-semibold">
                {TH.cancel}
              </button>
              <button onClick={saveAssignment} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white font-bold disabled:opacity-40">
                {busy ? '…' : TH.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
