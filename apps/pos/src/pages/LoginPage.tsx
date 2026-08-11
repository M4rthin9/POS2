import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { TH } from '@cida/shared';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setTokens = useAuth((s) => s.setTokens);
  const navigate = useNavigate();

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.login(username.trim(), pin);
      setTokens(res.access_token, res.refresh_token, res.user);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.loginError);
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4 && username.trim()) {
      // auto submit on 4-digit PIN
    }
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🧾</div>
          <h1 className="text-xl font-bold text-slate-800">{TH.appName}</h1>
          <p className="text-sm text-slate-500 mt-1">{TH.orgName}</p>
        </div>

        <label className="block text-sm font-medium text-slate-600 mb-1">{TH.username}</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoCapitalize="none"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-800"
        />

        <label className="block text-sm font-medium text-slate-600 mb-1">{TH.pin}</label>
        <div className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 text-center text-2xl tracking-[0.5em] bg-slate-50">
          {'●'.repeat(pin.length)}
          <span className="opacity-30">{'○'.repeat(4 - pin.length)}</span>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} className="py-4 text-xl font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300">
              {d}
            </button>
          ))}
          <button onClick={backspace} className="py-4 text-lg rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500">
            ⌫
          </button>
          <button onClick={() => press('0')} className="py-4 text-xl font-semibold rounded-xl bg-slate-100 hover:bg-slate-200">
            0
          </button>
          <button onClick={submit} disabled={busy} className="py-4 text-lg font-bold rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
            {busy ? '…' : '→'}
          </button>
        </div>

        <button onClick={submit} disabled={busy || !username || pin.length < 4} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40">
          {TH.login}
        </button>
      </div>
    </div>
  );
}
