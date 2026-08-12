import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CidaEvent, Division, Product, Sale } from '@cida/shared';
import { fmt, TH } from '@cida/shared';
import { api, syncQueue, getQueue, addToQueue } from '../lib/api';
import { useAuth } from '../store/auth';
import { useCart, cartTotals } from '../store/cart';
import PromptPayModal from '../components/PromptPayModal';
import { Receipt } from '../components/Receipt';

export default function SalesPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const { items, discount, eventId, add, setQty, remove, setDiscount, setEvent, clear } = useCart();

  const [events, setEvents] = useState<CidaEvent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [settings, setSettings] = useState({ promptpay_id: '', org_name: '', org_subtitle: '', org_address: '', tax_id: '', receipt_footer: '' });
  const [activeDiv, setActiveDiv] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'cash' | 'pp' | null>(null);
  const [cashGiven, setCashGiven] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState(getQueue());
  const [showCart, setShowCart] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    setError('');
    await Promise.all([
      api.publicSettings().then((s) => setSettings(s)),
      api.divisions().then(setDivisions),
      api.events().then((evs) => {
        setEvents(evs);
        const stillValid = eventId && evs.some((e) => e.id === eventId);
        if (!stillValid) {
          const active = evs.find((e) => e.status === 'ACTIVE');
          setEvent(active ? active.id : evs.length ? evs[0].id : null);
        }
      }),
    ]).catch(() => setError(TH.error));
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (eventId) {
      api.eventProducts(eventId).then(setProducts).catch(() => {
        setProducts([]);
        setError(TH.error);
      });
    } else {
      setProducts([]);
    }
  }, [eventId]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  async function doSync() {
    if (online) {
      const res = await syncQueue();
      setQueue(getQueue());
      if (res.ok) alert(`${TH.synced} (${res.ok})`);
      if (res.failed) alert(`${TH.syncPending}: ${res.failed}`);
    }
  }

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (activeDiv !== 'all' && p.division_id !== activeDiv) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, activeDiv, search]);

  const { subtotal, total } = cartTotals(items, discount);
  const change = cashGiven !== '' && modal === 'cash' ? Math.max(0, Number(cashGiven) - total) : 0;

  async function confirmSale(method: 'Cash' | 'PromptPay') {
    if (!eventId || items.length === 0) return;
    setBusy(true);
    setError('');
    const payload = { event_id: eventId, items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })), discount, payment_method: method };
    if (!navigator.onLine) {
      addToQueue(payload);
      setModal(null);
      setQueue(getQueue());
      clear();
      alert(`${TH.offline} - ${TH.offlinePending}`);
      setBusy(false);
      return;
    }
    try {
      const sale = await api.createSale(payload);
      setModal(null);
      setLastSale(sale);
      setCashGiven('');
      clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  function printReceipt() {
    window.print();
  }

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-bold leading-tight">{settings.org_name || TH.appName}</div>
          <div className="text-xs text-slate-300">
            {user?.display_name} ({user?.role === 'admin' ? TH.admin : TH.cashier})
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={doSync}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${online ? (queue.length ? 'bg-amber-500 text-black' : 'bg-emerald-600 text-white') : 'bg-red-500 text-white'}`}
          >
            {online ? (queue.length ? `⤓ ${queue.length}` : '●') : '✕'}
          </button>
          <select value={eventId ?? ''} onChange={(e) => setEvent(Number(e.target.value))} className="text-black text-sm rounded-lg px-2 py-1.5 bg-white">
            <option value="">เลือกงาน</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button onClick={() => navigate('/history')} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            {TH.history}
          </button>
          <button onClick={() => navigate('/settings')} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            ⚙️
          </button>
          <button onClick={logout} className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm">
            {TH.logout}
          </button>
        </div>
      </header>

      {/* Main */}
      {error && !modal && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-2 flex items-center justify-between gap-3">
          <span>{error}</span>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="font-semibold underline">
              {TH.retry}
            </button>
            <button onClick={() => setError('')} className="font-bold px-2">✕</button>
          </div>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {/* Products */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 flex gap-2 items-center bg-white border-b">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={TH.search}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
            <button onClick={() => setShowCart(true)} className="md:hidden relative px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold">
              🛒 <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full min-w-4 h-4 px-1">{items.length}</span>
            </button>
          </div>

          <div className="no-scrollbar overflow-x-auto flex gap-2 px-3 py-2 bg-white border-b">
            <button
              onClick={() => setActiveDiv('all')}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${activeDiv === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
            >
              ทั้งหมด
            </button>
            {divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDiv(d.id)}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${activeDiv === d.id ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
              >
                {d.icon} {d.name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <div className="text-center text-slate-400 mt-20">
                <div className="text-4xl mb-2">📦</div>
                {TH.noProducts}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filtered.map((p) => {
                  const out = p.stock !== null && p.stock <= 0;
                  const inCart = items.find((i) => i.product_id === p.id);
                  return (
                    <button
                      key={p.id}
                      disabled={out}
                      onClick={() => !out && add(p)}
                      className={`bg-white rounded-xl shadow-sm border p-2 text-left active:scale-[0.98] transition ${out ? 'opacity-40' : 'hover:shadow-md'}`}
                    >
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-full h-24 object-cover rounded-lg mb-2 bg-slate-100" />
                      ) : (
                        <div className="w-full h-24 rounded-lg mb-2 bg-slate-100 flex items-center justify-center text-3xl">🛍️</div>
                      )}
                      <div className="text-sm font-medium leading-tight h-10 line-clamp-2">{p.name}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-emerald-600 font-bold text-sm">{fmt(p.price)}</span>
                        {p.stock !== null && <span className={`text-[10px] ${out ? 'text-red-500' : 'text-slate-400'}`}>{out ? TH.outOfStock : `คง ${p.stock}`}</span>}
                      </div>
                      {inCart && <div className="mt-1 text-xs font-semibold text-slate-800 bg-slate-100 rounded-md py-0.5 text-center">ในตะกร้า {inCart.qty}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Cart (desktop) */}
        <aside className="hidden md:flex w-80 flex-col bg-white border-l">
          <CartPanel
            items={items}
            discount={discount}
            subtotal={subtotal}
            total={total}
            busy={busy}
            onQty={setQty}
            onRemove={remove}
            onDiscount={setDiscount}
            onCash={() => setModal('cash')}
            onPP={() => setModal('pp')}
          />
        </aside>
      </div>

      {/* Cart drawer (mobile) */}
      {showCart && (
        <div className="fixed inset-0 z-40 bg-black/50 flex justify-end" onClick={() => setShowCart(false)}>
          <div className="w-full max-w-sm bg-white h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
            <CartPanel
              items={items}
              discount={discount}
              subtotal={subtotal}
              total={total}
              busy={busy}
              onQty={setQty}
              onRemove={remove}
              onDiscount={setDiscount}
              onCash={() => {
                setShowCart(false);
                setModal('cash');
              }}
              onPP={() => {
                setShowCart(false);
                setModal('pp');
              }}
            />
          </div>
        </div>
      )}

      {/* Cash modal */}
      {modal === 'cash' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold mb-3">รับเงินสด</h2>
            <div className="text-sm text-slate-500 mb-1">ยอดรวม: {fmt(total)}</div>
            <input
              value={cashGiven}
              onChange={(e) => setCashGiven(e.target.value.replace(/[^\d.]/g, ''))}
              type="number"
              min="0"
              inputMode="decimal"
              placeholder="รับเงินมา"
              autoFocus
              className="w-full border border-slate-300 rounded-lg px-3 py-3 text-xl mb-2 focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
            <div className="mb-4 text-sm">
              เงินทอน: <span className="font-bold text-emerald-600">{fmt(change)}</span>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setModal(null)} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold">
                {TH.cancel}
              </button>
              <button
                onClick={() => confirmSale('Cash')}
                disabled={busy || Number(cashGiven || 0) < total}
                className="py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40"
              >
                {busy ? '…' : TH.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PromptPay modal */}
      {modal === 'pp' && (
        <PromptPayModal
          promptpayId={settings.promptpay_id}
          amount={total}
          onClose={() => setModal(null)}
          onDone={() => confirmSale('PromptPay')}
        />
      )}

      {/* Receipt modal */}
      {lastSale && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 w-full max-w-xs">
            <Receipt ref={receiptRef} sale={lastSale} settings={settings} />
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button onClick={() => setLastSale(null)} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold">
                {TH.close}
              </button>
              <button onClick={printReceipt} className="py-3 rounded-xl bg-slate-800 text-white font-bold">
                {TH.print}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CartPanelProps {
  items: { product_id: number; sku: string; name: string; price: number; qty: number }[];
  discount: number;
  subtotal: number;
  total: number;
  busy: boolean;
  onQty: (productId: number, qty: number) => void;
  onRemove: (productId: number) => void;
  onDiscount: (v: number) => void;
  onCash: () => void;
  onPP: () => void;
}

function CartPanel({ items, discount, subtotal, total, busy, onQty, onRemove, onDiscount, onCash, onPP }: CartPanelProps) {
  return (
    <>
      <div className="px-4 py-3 font-bold text-slate-800 border-b">🛒 {TH.cart}</div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-center text-slate-400 mt-10">
            <div className="text-3xl mb-1">🛒</div>
            {TH.cartEmpty}
          </div>
        ) : (
          items.map((it) => (
            <div key={it.product_id} className="flex items-center gap-2 border border-slate-200 rounded-lg p-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{it.name}</div>
                <div className="text-xs text-slate-500">{fmt(it.price)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onQty(it.product_id, it.qty - 1)} className="w-7 h-7 rounded-md bg-slate-100 font-bold">
                  −
                </button>
                <span className="w-7 text-center font-semibold">{it.qty}</span>
                <button onClick={() => onQty(it.product_id, it.qty + 1)} className="w-7 h-7 rounded-md bg-slate-100 font-bold">
                  +
                </button>
              </div>
              <button onClick={() => onRemove(it.product_id)} className="text-red-400 px-1">
                ✕
              </button>
            </div>
          ))
        )}
      </div>
      <div className="border-t p-4 space-y-2">
        <div className="flex justify-between text-sm text-slate-600">
          <span>{TH.subtotal}</span>
          <span>{fmt(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{TH.discount}</span>
          <input
            value={discount || ''}
            onChange={(e) => onDiscount(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
            type="number"
            min="0"
            placeholder="0"
            className="w-24 border border-slate-300 rounded-md px-2 py-1 text-right"
          />
        </div>
        <div className="flex justify-between font-bold text-lg">
          <span>{TH.total}</span>
          <span className="text-emerald-600">{fmt(total)}</span>
        </div>
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={onCash} disabled={busy} className="py-3 rounded-xl bg-slate-800 text-white font-bold disabled:opacity-40">
              💵 {TH.cash}
            </button>
            <button onClick={onPP} disabled={busy} className="py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40">
              📱 {TH.promptpay}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
