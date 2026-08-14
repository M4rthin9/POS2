import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CartItem, CidaEvent, Division, PaymentMethod, Product, Sale } from '@cida/shared';
import { fmt, fmtDate, TH } from '@cida/shared';
import { api, syncQueue, getQueue, addToQueue } from '../lib/api';
import { useAuth } from '../store/auth';
import { useCart, cartTotals } from '../store/cart';
import { getHeld, holdCart, releaseHeld, type HeldCart } from '../store/held';
import PromptPayModal from '../components/PromptPayModal';
import SplitBillModal, { type SplitPayment } from '../components/SplitBillModal';
import { Receipt } from '../components/Receipt';
import { printNode } from '../lib/print';

export default function SalesPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const { items, discount, eventId, add, setQty, remove, setDiscount, setEvent, clear, load: loadCart, bindUser } = useCart();

  // Booth devices are shared between shifts — a new cashier starts clean.
  useEffect(() => {
    bindUser(user?.id ?? null);
  }, [user?.id, bindUser]);

  const [events, setEvents] = useState<CidaEvent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [settings, setSettings] = useState({
    promptpay_id: '',
    org_name: '',
    org_subtitle: '',
    org_address: '',
    tax_id: '',
    receipt_footer: '',
    logo_url: '',
    print_size: '80mm',
  });
  const [activeDiv, setActiveDiv] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'cash' | 'pp' | 'split' | 'held' | null>(null);
  const [held, setHeld] = useState<HeldCart[]>(getHeld());
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
      // Several booths sell at once, so every ACTIVE event is selectable and the
      // cashier chooses the one they are working. Closed events are hidden so a
      // sale cannot land on a finished event.
      api.activeEvents().then((evs) => {
        setEvents(evs);
        const stillValid = eventId && evs.some((e) => e.id === eventId);
        if (!stillValid) setEvent(evs.length === 1 ? evs[0].id : null);
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

  // Sold-out products stay on the grid so staff can see what ran out, but they
  // sink to the bottom so they never crowd out what is still sellable.
  const filtered = useMemo(() => {
    const match = products.filter((p) => {
      if (activeDiv !== 'all' && p.division_id !== activeDiv) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const isOut = (p: Product) => p.stock !== null && p.stock <= 0;
    return [...match].sort((a, b) => Number(isOut(a)) - Number(isOut(b)));
  }, [products, activeDiv, search]);

  const soldOutCount = useMemo(() => products.filter((p) => p.stock !== null && p.stock <= 0).length, [products]);

  const { subtotal, total } = cartTotals(items, discount);
  const change = cashGiven !== '' && modal === 'cash' ? Math.max(0, Number(cashGiven) - total) : 0;

  async function confirmSale(method: PaymentMethod, payments?: SplitPayment[]) {
    if (!eventId || items.length === 0) return;
    setBusy(true);
    setError('');
    const payload = {
      event_id: eventId,
      items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      discount,
      payment_method: method,
      client_sale_id: crypto.randomUUID(),
      ...(payments?.length ? { payments } : {}),
    };
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
    // Print only the receipt, not the whole app behind the modal — the preview
    // shows up much faster this way.
    printNode(receiptRef.current, { skipWebFonts: true });
  }

  // ── Hold / retrieve cart ──
  function park() {
    if (items.length === 0) return;
    const event = events.find((e) => e.id === eventId);
    holdCart({
      label: `${event?.name ?? '—'} · ${items.length} ${TH.records}`,
      event_id: eventId,
      items,
      discount,
      total,
    });
    setHeld(getHeld());
    clear();
    setShowCart(false);
  }

  function retrieve(cart: HeldCart) {
    // Anything currently in the cart is parked rather than dropped.
    if (items.length > 0) park();
    loadCart(cart.items as CartItem[], cart.discount, cart.event_id);
    releaseHeld(cart.id);
    setHeld(getHeld());
    setModal(null);
  }

  function discard(id: string) {
    releaseHeld(id);
    setHeld(getHeld());
  }

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  const cartCount = items.reduce((a, i) => a + i.qty, 0);

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-3 md:px-4 py-2.5 flex items-center justify-between gap-2 shadow-lg z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/icon-192.svg" alt="" className="w-9 h-9 rounded-lg bg-white/10 p-1" />
          <div className="min-w-0">
            <div className="font-bold leading-tight truncate">{settings.org_name || TH.appName}</div>
            <div className="text-[11px] text-slate-300 truncate">
              {user?.display_name} · {user?.role === 'admin' || user?.role === 'superadmin' ? TH.admin : TH.cashier}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            onClick={doSync}
            title={TH.sync}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${online ? (queue.length ? 'bg-amber-500 text-black' : 'bg-emerald-600/90 text-white') : 'bg-red-500/90 text-white'}`}
          >
            {online ? (queue.length ? `⤓ ${queue.length}` : '●') : '✕'}
          </button>
          <select
            value={eventId ?? ''}
            onChange={(e) => setEvent(e.target.value ? Number(e.target.value) : null)}
            className={`hidden sm:block text-black text-sm rounded-lg px-2 py-1.5 max-w-44 ${eventId ? 'bg-white' : 'bg-amber-300 font-semibold'}`}
          >
            <option value="">— เลือกกิจกรรม —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button onClick={() => navigate('/history')} className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition">
            {TH.history}
          </button>
          <button onClick={() => navigate('/settings')} className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition">
            ⚙️
          </button>
          <button onClick={logout} className="px-2.5 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm transition">
            {TH.logout}
          </button>
        </div>
      </header>

      {/* Event selector (mobile) */}
      <div className="sm:hidden bg-white border-b px-3 py-1.5">
        <select
          value={eventId ?? ''}
          onChange={(e) => setEvent(e.target.value ? Number(e.target.value) : null)}
          className={`w-full text-sm rounded-lg px-2 py-1.5 border ${eventId ? 'bg-slate-50 border-slate-200' : 'bg-amber-100 border-amber-300 font-semibold'}`}
        >
          <option value="">— เลือกกิจกรรม —</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {/* Several events can be open at once, so the cashier must say which booth
          they are on before anything can be rung up. */}
      {!eventId && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2.5 flex items-center gap-2">
          <span className="text-lg">🎪</span>
          <span>
            {events.length === 0 ? 'ยังไม่มีกิจกรรมที่เปิดขาย กรุณาติดต่อผู้ดูแลระบบ' : 'กรุณาเลือกกิจกรรมที่ปฏิบัติหน้าที่ก่อนเริ่มขาย'}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && !modal && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-2 flex items-center justify-between gap-3">
          <span>{error}</span>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="font-semibold underline">
              {TH.retry}
            </button>
            <button onClick={() => setError('')} className="font-bold px-2">
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Products */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 flex gap-2 items-center bg-white border-b">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={TH.search}
                className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <button onClick={() => setShowCart(true)} className="md:hidden relative px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold active:scale-95 transition">
              🛒 <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full min-w-4 h-4 px-1">{cartCount}</span>
            </button>
          </div>

          <div className="no-scrollbar overflow-x-auto flex gap-2 px-3 py-2 bg-white border-b">
            <button
              onClick={() => setActiveDiv('all')}
              className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap transition ${activeDiv === 'all' ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              ทั้งหมด
            </button>
            {divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDiv(d.id)}
                className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap transition ${activeDiv === d.id ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {d.icon} {d.name}
              </button>
            ))}
            {soldOutCount > 0 && (
              <span className="px-3 py-1.5 rounded-full text-sm whitespace-nowrap bg-red-50 text-red-600 font-semibold flex-none">
                {TH.outOfStock} {soldOutCount}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <div className="text-center text-slate-400 mt-20">
                <div className="text-4xl mb-2">📦</div>
                {TH.noProducts}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                {filtered.map((p) => {
                  const out = p.stock !== null && p.stock <= 0;
                  const inCart = items.find((i) => i.product_id === p.id);
                  return (
                    <button
                      key={p.id}
                      disabled={out}
                      onClick={() => !out && add(p)}
                      className={`relative bg-white rounded-2xl shadow-sm border p-2.5 text-left active:scale-[0.97] transition overflow-hidden ${
                        out ? 'border-red-200 bg-red-50/40' : 'border-slate-100 hover:shadow-md hover:border-slate-200'
                      }`}
                    >
                      {/* Sold-out items stay visible and clearly marked so staff
                          can tell "we sold it all" from "we never stocked it". */}
                      {out && (
                        <span className="absolute top-2 left-2 z-10 bg-red-600 text-white text-[10px] font-bold rounded-md px-1.5 py-0.5 shadow">
                          {TH.outOfStock}
                        </span>
                      )}
                      {p.image_url ? (
                        <div className={`relative ${out ? 'grayscale opacity-60' : ''}`}>
                          <img src={p.image_url} alt={p.name} className="w-full aspect-square object-cover rounded-xl mb-2 bg-slate-100" />
                          {inCart && (
                            <span className="absolute top-1.5 right-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center shadow">
                              {inCart.qty}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className={`w-full aspect-square rounded-xl mb-2 bg-slate-100 flex items-center justify-center text-4xl ${out ? 'grayscale opacity-60' : ''}`}>
                          {inCart ? (
                            <span className="relative">
                              🛍️
                              <span className="absolute -top-2 -right-3 bg-emerald-600 text-white text-[10px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center shadow">
                                {inCart.qty}
                              </span>
                            </span>
                          ) : (
                            '🛍️'
                          )}
                        </div>
                      )}
                      <div className="text-sm font-medium leading-tight h-10 line-clamp-2">{p.name}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-emerald-600 font-bold">{fmt(p.price)}</span>
                        {p.stock !== null && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${out ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'}`}>
                            {out ? TH.outOfStock : `คง ${p.stock}`}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Cart (desktop) */}
        <aside className="hidden md:flex w-80 flex-col bg-white border-l border-slate-200">
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
            onSplit={() => setModal('split')}
            onHold={park}
            onHeld={() => setModal('held')}
            heldCount={held.length}
          />
        </aside>
      </div>

      {/* Mobile bottom cart bar */}
      {!showCart && cartCount > 0 && (
        <button
          onClick={() => setShowCart(true)}
          className="md:hidden fixed bottom-3 inset-x-3 z-30 bg-slate-900 text-white rounded-2xl px-4 py-3 flex items-center justify-between shadow-xl active:scale-[0.99] transition"
        >
          <span className="flex items-center gap-2 font-semibold">
            🛒 {cartCount} รายการ
          </span>
          <span className="flex items-center gap-3">
            <span className="text-emerald-400 font-bold text-lg">{fmt(total)}</span>
            <span className="text-xs bg-white/15 rounded-lg px-2 py-1">ดูตะกร้า →</span>
          </span>
        </button>
      )}

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
              onSplit={() => {
                setShowCart(false);
                setModal('split');
              }}
              onHold={park}
              onHeld={() => {
                setShowCart(false);
                setModal('held');
              }}
              heldCount={held.length}
            />
          </div>
        </div>
      )}

      {/* Cash modal */}
      {modal === 'cash' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-1">รับเงินสด</h2>
            <p className="text-sm text-slate-500 mb-3">
              ยอดรวม: <span className="font-bold text-emerald-600">{fmt(total)}</span>
            </p>
            <input
              value={cashGiven}
              onChange={(e) => setCashGiven(e.target.value.replace(/[^\d.]/g, ''))}
              type="number"
              min="0"
              inputMode="decimal"
              placeholder="รับเงินมา"
              autoFocus
              className="w-full border border-slate-300 rounded-xl px-3 py-3 text-xl mb-3 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="mb-4 text-sm flex items-center justify-between bg-emerald-50 rounded-xl px-3 py-2.5">
              <span className="text-emerald-700">เงินทอน</span>
              <span className="font-bold text-emerald-600 text-lg">{fmt(change)}</span>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setModal(null)} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition">
                {TH.cancel}
              </button>
              <button
                onClick={() => confirmSale('Cash')}
                disabled={busy || Number(cashGiven || 0) < total}
                className="py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40 hover:bg-emerald-500 transition"
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

      {/* Split bill modal */}
      {modal === 'split' && (
        <SplitBillModal
          total={total}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          onConfirm={(payments) => {
            // payment_method is the largest tender; the API re-derives it too.
            const primary = payments.reduce((a, p) => (p.amount > a.amount ? p : a));
            confirmSale(primary.method, payments);
          }}
        />
      )}

      {/* Held carts */}
      {modal === 'held' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-slate-800">⏸ {TH.heldCarts}</h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600 text-xl px-1">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {held.length === 0 ? (
                <p className="text-center text-slate-400 py-8">{TH.noHeldCarts}</p>
              ) : (
                held.map((c) => (
                  <div key={c.id} className="border border-slate-200 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.label}</div>
                        <div className="text-xs text-slate-400">{fmtDate(c.created_at)}</div>
                      </div>
                      <div className="text-emerald-600 font-bold whitespace-nowrap">{fmt(c.total)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button
                        onClick={() => discard(c.id)}
                        className="py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition"
                      >
                        🗑 {TH.discardCart}
                      </button>
                      <button
                        onClick={() => retrieve(c)}
                        className="py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition"
                      >
                        ▶ {TH.retrieveCart}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {lastSale && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
            <Receipt ref={receiptRef} sale={lastSale} settings={settings} />
            <div className="grid grid-cols-2 gap-3 mt-4 sticky bottom-0 bg-white pt-2">
              <button onClick={() => setLastSale(null)} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition">
                {TH.close}
              </button>
              <button onClick={printReceipt} className="py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition">
                🖨 {TH.print}
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
  onSplit: () => void;
  onHold: () => void;
  onHeld: () => void;
  heldCount: number;
}

function CartPanel({ items, discount, subtotal, total, busy, onQty, onRemove, onDiscount, onCash, onPP, onSplit, onHold, onHeld, heldCount }: CartPanelProps) {
  return (
    <>
      <div className="px-4 py-3 font-bold text-slate-800 border-b flex items-center justify-between gap-2">
        <span>🛒 {TH.cart}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onHeld}
            className="relative text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 transition"
          >
            ⏸ {TH.heldCarts}
            {heldCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[10px] rounded-full min-w-4 h-4 px-1">{heldCount}</span>
            )}
          </button>
          <span className="text-xs font-semibold text-slate-400">{items.length} รายการ</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-center text-slate-400 mt-10">
            <div className="text-3xl mb-1">🛒</div>
            {TH.cartEmpty}
          </div>
        ) : (
          items.map((it) => (
            <div key={it.product_id} className="flex items-center gap-2 border border-slate-200 rounded-xl p-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{it.name}</div>
                <div className="text-xs text-emerald-600 font-semibold">{fmt(it.price)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onQty(it.product_id, it.qty - 1)} className="w-7 h-7 rounded-lg bg-slate-100 font-bold hover:bg-slate-200 active:scale-90 transition">
                  −
                </button>
                <span className="w-7 text-center font-semibold">{it.qty}</span>
                <button onClick={() => onQty(it.product_id, it.qty + 1)} className="w-7 h-7 rounded-lg bg-slate-100 font-bold hover:bg-slate-200 active:scale-90 transition">
                  +
                </button>
              </div>
              <button onClick={() => onRemove(it.product_id)} className="text-red-400 hover:text-red-600 px-1 transition">
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
            className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>
        <div className="flex justify-between items-center pt-1">
          <span className="font-bold">{TH.total}</span>
          <span className="font-bold text-2xl text-emerald-600">{fmt(total)}</span>
        </div>
        {items.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={onCash} disabled={busy} className="py-3.5 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 disabled:opacity-40 active:scale-[0.98] transition">
                💵 {TH.cash}
              </button>
              <button onClick={onPP} disabled={busy} className="py-3.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40 active:scale-[0.98] transition">
                📱 {TH.promptpay}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onSplit} disabled={busy} className="py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 disabled:opacity-40 active:scale-[0.98] transition">
                🧮 {TH.splitBill}
              </button>
              <button onClick={onHold} disabled={busy} className="py-2.5 rounded-xl bg-amber-100 text-amber-800 font-semibold text-sm hover:bg-amber-200 disabled:opacity-40 active:scale-[0.98] transition">
                ⏸ {TH.holdCart}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
