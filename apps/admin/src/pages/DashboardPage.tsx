import { useEffect, useState } from 'react';
import type { Overview, Stats } from '@cida/shared';
import { fmt, TH, PAYMENT_LABELS } from '@cida/shared';
import { api } from '../lib/api';

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.overview().then(setOverview).catch(() => {});
    api.stats().then(setStats).catch(() => {});
  }, []);

  const cards = overview
    ? [
        { label: TH.totalRevenue, value: fmt(overview.total_revenue), accent: 'text-emerald-600' },
        { label: TH.todayRevenue, value: fmt(overview.today_revenue), accent: 'text-emerald-600' },
        { label: TH.totalSales, value: String(overview.total_sales), accent: 'text-slate-800' },
        { label: TH.todaySales, value: String(overview.today_sales), accent: 'text-slate-800' },
        { label: TH.products, value: String(overview.total_products), accent: 'text-slate-800' },
        { label: TH.users, value: String(overview.total_users), accent: 'text-slate-800' },
      ]
    : [];

  const daily = stats?.daily ?? {};
  const days = Object.keys(daily).sort();
  const maxDay = Math.max(1, ...Object.values(daily));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{TH.dashboard}</h1>
        <p className="text-sm text-slate-500">
          {overview?.active_event ? `🎪 ${TH.activeEvent}: ${overview.active_event}` : 'ไม่มีกิจกรรมที่เปิดขาย'}
        </p>
      </div>

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-xl shadow-sm p-4">
              <div className="text-xs text-slate-500">{c.label}</div>
              <div className={`text-xl font-bold mt-1 ${c.accent}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className="grid lg:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-semibold text-slate-800 mb-3">{TH.paymentBreakdown}</h2>
            {Object.keys(stats.payment_breakdown).length === 0 ? (
              <p className="text-sm text-slate-400">{TH.noData}</p>
            ) : (
              <ul className="space-y-2">
                {Object.entries(stats.payment_breakdown).map(([k, v]) => (
                  <li key={k} className="flex justify-between text-sm">
                    <span className="text-slate-600">{PAYMENT_LABELS[k] || k}</span>
                    <span className="font-semibold">{fmt(v)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-semibold text-slate-800 mb-3">{TH.divisionBreakdown}</h2>
            {Object.keys(stats.division_breakdown).length === 0 ? (
              <p className="text-sm text-slate-400">{TH.noData}</p>
            ) : (
              <ul className="space-y-2">
                {Object.entries(stats.division_breakdown).map(([k, v]) => (
                  <li key={k} className="flex justify-between text-sm">
                    <span className="text-slate-600">{k}</span>
                    <span className="font-semibold">{fmt(v)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-semibold text-slate-800 mb-3">{TH.productBreakdown}</h2>
            {Object.keys(stats.product_breakdown).length === 0 ? (
              <p className="text-sm text-slate-400">{TH.noData}</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {Object.entries(stats.product_breakdown).map(([k, v]) => (
                  <li key={k} className="flex justify-between text-sm">
                    <span className="text-slate-600 truncate pr-2">{k}</span>
                    <span className="font-semibold whitespace-nowrap">
                      {v.qty}× {fmt(v.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {days.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold text-slate-800 mb-3">{TH.dailyChart}</h2>
          <div className="flex items-end gap-2 h-40 overflow-x-auto">
            {days.map((d) => (
              <div key={d} className="flex flex-col items-center flex-none">
                <div className="text-[10px] text-slate-500">{fmt(daily[d])}</div>
                <div
                  className="w-10 bg-emerald-500 rounded-t"
                  style={{ height: `${Math.round((daily[d] / maxDay) * 100)}px`, minHeight: 4 }}
                />
                <div className="text-[10px] text-slate-500 mt-1">{d.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
