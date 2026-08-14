import { useEffect, useState } from 'react';
import { TH } from '@cida/shared';
import { api, type AdminUser } from '../lib/api';
import { useAuth } from '../store/auth';

interface Draft {
  id: number | null;
  username: string;
  display_name: string;
  role: string;
  pin: string;
  active: boolean;
}

const emptyDraft: Draft = { id: null, username: '', display_name: '', role: 'cashier', pin: '', active: true };

export default function UsersPage() {
  const me = useAuth((s) => s.user);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setUsers(null);
    try {
      setUsers(await api.adminUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setUsers([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(u: AdminUser) {
    setDraft({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, pin: '', active: !!u.active });
  }

  async function save() {
    if (!draft.username.trim() || !draft.display_name.trim()) {
      setError('กรอกชื่อผู้ใช้และชื่อแสดง');
      return;
    }
    if (draft.id !== null && draft.id === me?.id && draft.role !== me.role) {
      setError('ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีตัวเอง');
      return;
    }
    if (draft.id === null && !/^\d{4,6}$/.test(draft.pin)) {
      setError('PIN ต้องเป็นตัวเลข 4–6 หลัก');
      return;
    }
    setBusy(true);
    setError('');
    const input = { username: draft.username.trim(), display_name: draft.display_name.trim(), role: draft.role, active: draft.active, ...(draft.pin ? { pin: draft.pin } : {}) };
    try {
      if (draft.id === null) {
        await api.createUser({ ...input, pin: draft.pin });
      } else {
        await api.updateUser(draft.id, input);
      }
      setDraft(emptyDraft);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(u: AdminUser) {
    const pin = prompt(`ตั้ง PIN ใหม่สำหรับ ${u.display_name} (4–6 หลัก)`);
    if (!pin || !/^\d{4,6}$/.test(pin)) return;
    setBusy(true);
    setError('');
    try {
      await api.resetPin(u.id, pin);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: AdminUser) {
    if (u.id === me?.id) {
      setError('ไม่สามารถลบบัญชีของตัวเอง');
      return;
    }
    if (!confirm(`ลบผู้ใช้ ${u.display_name}?`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{TH.users}</h1>
        <button onClick={() => { setDraft(emptyDraft); setError(''); }} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">
          + {TH.add}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold text-slate-800 text-sm">{draft.id === null ? TH.add : `${TH.edit} #${draft.id}`}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} placeholder={TH.username} autoCapitalize="none" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} placeholder={TH.displayName} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="cashier">{TH.cashier}</option>
            <option value="admin">{TH.admin}</option>
            <option value="superadmin">{TH.superadmin}</option>
          </select>
          <input
            value={draft.pin}
            onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/[^\d]/g, '') })}
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder={draft.id === null ? `${TH.pin} *` : `${TH.pin} (ใหม่)`}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="w-4 h-4" />
            {TH.active}
          </label>
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
              <th className="px-4 py-2 text-left font-medium">{TH.username}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.displayName}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.role}</th>
              <th className="px-4 py-2 text-center font-medium">{TH.status}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">…</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">{TH.noData}</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-2">
                    {u.display_name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-slate-400">(me)</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === 'superadmin' ? 'bg-rose-100 text-rose-700' : u.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
                      {u.role === 'superadmin' ? TH.superadmin : u.role === 'admin' ? TH.admin : TH.cashier}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {u.active ? TH.active : TH.inactive}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => resetPin(u)} className="text-amber-600 hover:underline text-xs font-semibold mr-3">
                      {TH.resetPin}
                    </button>
                    <button onClick={() => startEdit(u)} className="text-emerald-600 hover:underline text-xs font-semibold mr-3">
                      {TH.edit}
                    </button>
                    <button onClick={() => remove(u)} className="text-red-500 hover:underline text-xs font-semibold">
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
