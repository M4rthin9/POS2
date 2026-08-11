import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { TH } from '@cida/shared';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setTokens = useAuth((s) => s.setTokens);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.login(username.trim(), pin);
      if (res.user.role !== 'admin') {
        setError('บัญชีนี้ไม่มีสิทธิ์ใช้งาน Admin');
        return;
      }
      setTokens(res.access_token, res.refresh_token, res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.loginError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">📊</div>
          <h1 className="text-xl font-bold text-slate-800">CIDA Admin</h1>
          <p className="text-sm text-slate-500 mt-1">{TH.appName}</p>
        </div>

        <label className="block text-sm font-medium text-slate-600 mb-1">{TH.username}</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
          autoCapitalize="none"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-800"
        />

        <label className="block text-sm font-medium text-slate-600 mb-1">{TH.pin}</label>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ''))}
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="••••"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-800"
        />

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}

        <button onClick={submit} disabled={busy || !username || pin.length < 4} className="w-full py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 disabled:opacity-40">
          {busy ? '…' : TH.login}
        </button>
      </div>
    </div>
  );
}
