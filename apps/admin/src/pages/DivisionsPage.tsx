import { useEffect, useState } from 'react';
import type { Division } from '@cida/shared';
import { TH } from '@cida/shared';
import { api } from '../lib/api';

interface Draft {
  id: number | null;
  name: string;
  icon: string;
  sort_order: string;
}

const emptyDraft: Draft = { id: null, name: '', icon: '📦', sort_order: '0' };

export default function DivisionsPage() {
  const [divisions, setDivisions] = useState<Division[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setDivisions(null);
    try {
      setDivisions(await api.adminDivisions());
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setDivisions([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(d: Division) {
    setDraft({ id: d.id, name: d.name, icon: d.icon, sort_order: String(d.sort_order) });
  }

  async function save() {
    if (!draft.name.trim()) {
      setError('กรอกชื่อแผนก');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (draft.id === null) {
        await api.createDivision({ name: draft.name.trim(), icon: draft.icon || '📦', sort_order: Number(draft.sort_order) || 0 });
      } else {
        await api.updateDivision(draft.id, { name: draft.name.trim(), icon: draft.icon || '📦', sort_order: Number(draft.sort_order) || 0 });
      }
      setDraft(emptyDraft);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: Division) {
    if (!confirm(`ลบแผนก ${d.name}?`)) return;
    try {
      await api.deleteDivision(d.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{TH.divisions}</h1>
        <button onClick={() => { setDraft(emptyDraft); setError(''); }} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">
          + {TH.add}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold text-slate-800 text-sm">{draft.id === null ? TH.add : `${TH.edit} #${draft.id}`}</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={TH.name} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} placeholder="ไอคอน (emoji)" maxLength={4} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value.replace(/[^\d]/g, '') })} type="number" placeholder={TH.order} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex items-center gap-4">
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

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-4 py-2 text-left font-medium">{TH.icon}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.name}</th>
              <th className="px-4 py-2 text-right font-medium">{TH.order}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {divisions === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">…</td>
              </tr>
            ) : divisions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">{TH.noData}</td>
              </tr>
            ) : (
              divisions.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-400">{d.id}</td>
                  <td className="px-4 py-2 text-xl">{d.icon}</td>
                  <td className="px-4 py-2">{d.name}</td>
                  <td className="px-4 py-2 text-right">{d.sort_order}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(d)} className="text-emerald-600 hover:underline text-xs font-semibold mr-3">
                      {TH.edit}
                    </button>
                    <button onClick={() => remove(d)} className="text-red-500 hover:underline text-xs font-semibold">
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
  );
}
