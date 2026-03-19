import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
const fmt = (n: number) => `$${(n || 0).toFixed(2)}`;
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmt(n);

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const HOUR_LABELS: Record<string, string> = {
  '06': '6a', '07': '7a', '08': '8a', '09': '9a', '10': '10a', '11': '11a',
  '12': '12p', '13': '1p', '14': '2p', '15': '3p', '16': '4p', '17': '5p',
  '18': '6p', '19': '7p', '20': '8p', '21': '9p', '22': '10p', '23': '11p', '00': '12a'
};

type PeriodKey = 'today' | 'lastWeek' | '7days' | '30days' | 'lastMonth' | 'thisMonth' | 'custom';

interface ReportData {
  period: { startDate: string; endDate: string };
  overall: { orderCount: number; subtotal: number; taxTotal: number; totalSales: number; totalTip?: number; serviceCharge?: number };
  taxDetails?: Array<{ name: string; rate: number; amount: number }>;
  channels: Record<string, { count: number; subtotal: number; tax: number; sales: number; tips: number }>;
  dineInTableStats: { tableOrderCount: number; avgPerTable: number };
  deliveryPlatforms: Record<string, { count: number; sales: number }>;
  topItems: Array<{ rank: number; name: string; quantity: number; revenue: number }>;
  bottomItems?: Array<{ rank: number; name: string; quantity: number; revenue: number }>;
  totalItems: { totalQuantity: number; uniqueItems: number };
  unpaid?: { orderCount: number; totalAmount: number; channels: Record<string, { count: number; amount: number }> };
  hourlySales?: Array<{ hour: string; order_count: number; revenue: number }>;
  paymentBreakdown?: Array<{ payment_method: string; count: number; net_amount: number; tips: number }>;
  tableTurnover?: Array<{ table_name: string; order_count: number; avg_duration_min: number }>;
  employeeSales?: Array<{ employee: string; order_count: number; revenue: number; avg_check: number }>;
  refundsVoids?: Array<{ type: string; count: number; total: number }>;
}

const CHANNEL_STYLES = [
  { bg: 'from-blue-50 to-blue-100', border: 'border-blue-200', title: 'text-blue-700', accent: 'text-blue-600', badge: 'bg-blue-600' },
  { bg: 'from-emerald-50 to-emerald-100', border: 'border-emerald-200', title: 'text-emerald-700', accent: 'text-emerald-600', badge: 'bg-emerald-600' },
  { bg: 'from-violet-50 to-violet-100', border: 'border-violet-200', title: 'text-violet-700', accent: 'text-violet-600', badge: 'bg-violet-600' },
  { bg: 'from-orange-50 to-orange-100', border: 'border-orange-200', title: 'text-orange-700', accent: 'text-orange-600', badge: 'bg-orange-600' },
];

function getDateRange(period: PeriodKey, customStart: string, customEnd: string) {
  const today = new Date();
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  switch (period) {
    case 'today': return { s: f(today), e: f(today) };
    case 'lastWeek': {
      const dow = today.getDay();
      const lastSun = new Date(today); lastSun.setDate(today.getDate() - dow - 7);
      const lastSat = new Date(lastSun); lastSat.setDate(lastSun.getDate() + 6);
      return { s: f(lastSun), e: f(lastSat) };
    }
    case '7days': { const d = new Date(today); d.setDate(d.getDate() - 6); return { s: f(d), e: f(today) }; }
    case '30days': { const d = new Date(today); d.setDate(d.getDate() - 29); return { s: f(d), e: f(today) }; }
    case 'lastMonth': {
      const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
      const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      return { s: f(first), e: f(last) };
    }
    case 'thisMonth': { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { s: f(d), e: f(today) }; }
    case 'custom': return { s: customStart || f(today), e: customEnd || f(today) };
  }
}

const OperationalReportsPanel: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const fetchData = useCallback(async (p: PeriodKey) => {
    setLoading(true);
    try {
      const { s, e } = getDateRange(p, customStart, customEnd);
      const r = await fetch(`${API_URL}/daily-closings/sales-report?startDate=${s}&endDate=${e}`);
      const j = await r.json();
      if (j.success) setData(j);
    } catch { /* ignore */ }
    setLoading(false);
  }, [customStart, customEnd]);

  useEffect(() => { fetchData(period); }, [period, fetchData]);

  const periods: { key: PeriodKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'lastWeek', label: 'Last Week' },
    { key: '7days', label: 'Last 7 Days' },
    { key: '30days', label: 'Last 30 Days' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="p-5 flex-1 overflow-y-auto">
      {/* Period Selector */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {periods.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
              period === p.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-1 ml-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <span className="text-gray-400">~</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <button onClick={() => fetchData('custom')} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">Search</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : !data ? (
        <div className="text-center py-16 text-gray-400 text-sm">No data available for this period.</div>
      ) : (
        <div className="space-y-5">
          <div className="text-xs text-gray-500">{data.period.startDate} ~ {data.period.endDate}</div>

          {/* ===== 1. Overall Stats ===== */}
          <div>
            <div className="text-xs text-slate-500 font-bold mb-1.5">All Orders (incl. Unpaid)</div>
            <div className="grid grid-cols-5 gap-3">
              {([
                { label: 'Orders', value: data.overall.orderCount.toString(), isTax: false },
                { label: 'Subtotal', value: fmt(data.overall.subtotal), isTax: false },
                { label: 'Tax', value: fmt(data.overall.taxTotal), isTax: true },
                { label: 'Tip', value: fmt(data.overall.totalTip || 0), isTax: false },
                { label: 'Total', value: fmt(data.overall.totalSales), isTax: false },
              ] as const).map(s => (
                <div key={s.label} className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-3 border border-slate-200 text-center">
                  <div className="text-xs text-gray-500 font-medium">{s.label}</div>
                  <div className="text-lg font-extrabold text-slate-800 mt-0.5">{s.value}</div>
                  {s.isTax && data.taxDetails && data.taxDetails.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {data.taxDetails.map((t, i) => (
                        <div key={i} className="text-[11px] text-gray-500">
                          {t.name} ({t.rate}%): {fmt(t.amount)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {data.unpaid && data.unpaid.orderCount > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                  Unpaid: {fmt(data.unpaid.totalAmount)} ({data.unpaid.orderCount} orders)
                </div>
                {(['DINE-IN', 'TOGO', 'ONLINE', 'DELIVERY'] as const).map(ch => {
                  const d = data.unpaid?.channels?.[ch];
                  if (!d || d.count === 0) return null;
                  return (
                    <div key={ch} className="text-xs text-amber-600 bg-amber-50/60 border border-amber-100 rounded px-2 py-0.5">
                      {ch}: {fmt(d.amount)} ({d.count})
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== 2. Channel Breakdown ===== */}
          <div>
            <div className="text-xs text-slate-500 font-bold mb-2">Channel Breakdown <span className="font-normal text-gray-400">(incl. Unpaid)</span></div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Dine-In', key: 'DINE-IN', extra: data.dineInTableStats ? [
                  { k: 'Tables', v: String(data.dineInTableStats.tableOrderCount) },
                  { k: 'Avg/Table', v: fmt(data.dineInTableStats.avgPerTable) }
                ] : [] },
                { label: 'Togo', key: 'TOGO', extra: [] },
                { label: 'Online', key: 'ONLINE', extra: [] },
                { label: 'Delivery', key: 'DELIVERY', extra: [] },
              ].map((p, i) => {
                const ch = data.channels[p.key] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 };
                const c = CHANNEL_STYLES[i];
                return (
                  <div key={p.label} className={`bg-gradient-to-br ${c.bg} rounded-xl border ${c.border} p-3 flex flex-col`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${c.badge}`} />
                      <span className={`font-extrabold text-sm ${c.title}`}>{p.label}</span>
                    </div>
                    <div className={`text-xl font-extrabold ${c.title} leading-tight`}>{fmt(ch.sales)}</div>
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-xs"><span className="text-gray-400">Orders:</span> <span className={`font-bold ${c.accent}`}>{ch.count}</span></div>
                      <div className="text-xs"><span className="text-gray-400">Subtotal:</span> <span className={`font-bold ${c.accent}`}>{fmt(ch.subtotal)}</span></div>
                      <div className="text-xs"><span className="text-gray-400">Tax:</span> <span className={`font-bold ${c.accent}`}>{fmt(ch.tax)}</span></div>
                      {ch.tips > 0 && (
                        <div className="text-xs"><span className="text-gray-400">Tip:</span> <span className={`font-bold ${c.accent}`}>{fmt(ch.tips)}</span></div>
                      )}
                      <div className="text-xs"><span className="text-gray-400">Avg/Order:</span> <span className={`font-bold ${c.accent}`}>{ch.count > 0 ? fmt(ch.sales / ch.count) : '-'}</span></div>
                      {(p.extra || []).map(e => (
                        <div key={e.k} className="text-xs"><span className="text-gray-400">{e.k}:</span> <span className={`font-bold ${c.accent}`}>{e.v}</span></div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== 3. Hourly Sales ===== */}
          {data.hourlySales && data.hourlySales.length > 0 && (() => {
            const allHours = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
            const hourMap = Object.fromEntries(data.hourlySales!.map(h => [h.hour, h]));
            const chart = allHours.map(h => ({ hour: HOUR_LABELS[h] || h, revenue: hourMap[h]?.revenue || 0 }));
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm font-bold text-gray-700 mb-3">Hourly Sales</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chart} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* ===== 4. Pie Charts Row ===== */}
          <div className="grid grid-cols-2 gap-4">
            {/* Channel Pie */}
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="text-sm font-bold text-gray-700 mb-2">Sales by Channel</div>
              {(() => {
                const pieData = Object.entries(data.channels).filter(([, v]) => v.sales > 0).map(([k, v]) => ({ name: k, value: v.sales }));
                const total = pieData.reduce((s, d) => s + d.value, 0);
                if (pieData.length === 0) return <div className="text-center text-gray-400 text-sm py-8">No data</div>;
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-1.5 min-w-0">
                      {pieData.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-xs text-gray-600 truncate">{d.name}</span>
                          <span className="text-xs font-bold text-gray-800 ml-auto flex-shrink-0">{fmt(d.value)}</span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0 w-8 text-right">{total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : ''}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex-shrink-0" style={{ width: 150, height: 150 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} labelLine={false} fontSize={10}>
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie><Tooltip formatter={(v: number) => fmt(v)} /></PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* Delivery Platform Pie */}
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="text-sm font-bold text-gray-700 mb-2">Delivery by Platform</div>
              {(() => {
                const dp = data.deliveryPlatforms || {};
                const pieData = Object.entries(dp).filter(([, v]) => v.sales > 0).map(([k, v]) => ({ name: k, value: v.sales }));
                const total = pieData.reduce((s, d) => s + d.value, 0);
                if (pieData.length === 0) return <div className="text-center text-gray-400 text-sm py-8">No delivery data</div>;
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-1.5 min-w-0">
                      {pieData.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: COLORS[(i + 3) % COLORS.length] }} />
                          <span className="text-xs text-gray-600 truncate">{d.name}</span>
                          <span className="text-xs font-bold text-gray-800 ml-auto flex-shrink-0">{fmt(d.value)}</span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0 w-8 text-right">{total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : ''}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex-shrink-0" style={{ width: 150, height: 150 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} labelLine={false} fontSize={10}>
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                        </Pie><Tooltip formatter={(v: number) => fmt(v)} /></PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ===== 5. Payment Methods + Table Turnover ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Payment Methods */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm font-bold text-gray-700 mb-3">Payment Methods</div>
              {(() => {
                const pay = data.paymentBreakdown || [];
                const payTotal = pay.reduce((a, p) => a + (p.net_amount || 0), 0);
                const chart = pay.map(p => ({ name: p.payment_method, value: p.net_amount || 0, pct: payTotal > 0 ? Math.round(p.net_amount / payTotal * 100) : 0 }));
                if (chart.length === 0) return <div className="text-xs text-gray-400 py-4 text-center">No payment data</div>;
                return (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart><Pie data={chart} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                        {chart.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie></PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5">
                      {chart.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                            <span className="font-medium text-gray-700">{p.name}</span>
                          </div>
                          <span className="font-bold text-gray-900">{fmt(p.value)} ({p.pct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* Table Turnover */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm font-bold text-gray-700 mb-3">Table Turnover</div>
              {(!data.tableTurnover || data.tableTurnover.length === 0) ? (
                <div className="text-xs text-gray-400 py-4 text-center">No table data</div>
              ) : (
                <div className="max-h-[160px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500 border-b">
                      <th className="text-left py-1 font-semibold">Table</th>
                      <th className="text-right py-1 font-semibold">Orders</th>
                      <th className="text-right py-1 font-semibold">Avg Min</th>
                    </tr></thead>
                    <tbody>
                      {data.tableTurnover.map((t, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-1 font-medium text-gray-800">{t.table_name}</td>
                          <td className="py-1 text-right text-gray-700">{t.order_count}</td>
                          <td className="py-1 text-right text-gray-700">{Math.round(t.avg_duration_min)}m</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ===== 6. Employee Sales ===== */}
          {data.employeeSales && data.employeeSales.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm font-bold text-gray-700 mb-2">Employee Sales</div>
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b">
                  <th className="text-left py-1">Employee</th>
                  <th className="text-right py-1">Orders</th>
                  <th className="text-right py-1">Revenue</th>
                  <th className="text-right py-1">Avg Check</th>
                </tr></thead>
                <tbody>
                  {data.employeeSales.map((e, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 font-medium text-gray-800">{e.employee}</td>
                      <td className="py-1.5 text-right text-gray-700">{e.order_count}</td>
                      <td className="py-1.5 text-right font-bold text-gray-900">{fmt(e.revenue)}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmt(e.avg_check)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ===== 7. Refunds & Voids ===== */}
          {data.refundsVoids && (() => {
            const refund = data.refundsVoids!.find(r => r.type === 'refund') || { count: 0, total: 0 };
            const voidD = data.refundsVoids!.find(r => r.type === 'void') || { count: 0, total: 0 };
            if (refund.count === 0 && voidD.count === 0) return null;
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm font-bold text-gray-700 mb-2">Cancellations & Refunds</div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-500">Refunds:</span> <span className="font-bold text-red-600">{refund.count} ({fmt(refund.total)})</span></div>
                  <div><span className="text-gray-500">Voids:</span> <span className="font-bold text-red-600">{voidD.count} ({fmt(voidD.total)})</span></div>
                </div>
              </div>
            );
          })()}

          {/* ===== 8. Top Items Bar Chart ===== */}
          {data.topItems && data.topItems.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="text-sm font-bold text-gray-700 mb-2 flex items-center justify-between">
                <span>Top 30 Items
                  <span className="ml-2 text-xs font-normal text-gray-400">(Total: {data.totalItems.uniqueItems} items, {data.totalItems.totalQuantity} qty)</span>
                </span>
                <span className="inline-flex items-center gap-3 text-xs font-normal">
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#3b82f6' }} />Revenue</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f59e0b' }} />Qty</span>
                </span>
              </div>
              {(() => {
                const top30 = data.topItems.slice(0, 30);
                const bottomNames = new Set((data.bottomItems || []).map(b => b.name));
                const topData = top30.map(item => ({ ...item, overlap: bottomNames.has(item.name) }));
                return (
                  <ResponsiveContainer width="100%" height={topData.length * 38 + 30}>
                    <BarChart data={topData} layout="vertical" margin={{ left: 0, right: 15, top: 5, bottom: 5 }}>
                      <XAxis type="number" fontSize={10} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`} />
                      <YAxis type="category" dataKey="name" width={170} fontSize={14} tick={{ fill: '#1f2937', fontWeight: 600 }} interval={0} />
                      <Tooltip formatter={(v: number, name: string) => name === 'Revenue' ? fmt(v) : `${v} qty`} />
                      <Bar dataKey="revenue" name="Revenue" barSize={18} radius={[0, 3, 3, 0]}>
                        {topData.map((entry, i) => <Cell key={i} fill={entry.overlap ? '#a78bfa' : '#3b82f6'} />)}
                      </Bar>
                      <Bar dataKey="quantity" name="Qty" barSize={18} radius={[0, 3, 3, 0]}>
                        {topData.map((entry, i) => <Cell key={i} fill={entry.overlap ? '#c4b5fd' : '#f59e0b'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          )}

          {/* Items #31+ */}
          {data.topItems && data.topItems.length > 30 && (
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="text-sm font-bold text-gray-700 mb-2">Items #31 ~ #{data.topItems.length} <span className="ml-2 text-xs font-normal text-gray-400">(by revenue)</span></div>
              {(() => {
                const rest = data.topItems.slice(30);
                return (
                  <ResponsiveContainer width="100%" height={rest.length * 38 + 30}>
                    <BarChart data={rest} layout="vertical" margin={{ left: 0, right: 15, top: 5, bottom: 5 }}>
                      <XAxis type="number" fontSize={10} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`} />
                      <YAxis type="category" dataKey="name" width={170} fontSize={14} tick={{ fill: '#4b5563', fontWeight: 600 }} interval={0} />
                      <Tooltip formatter={(v: number, name: string) => name === 'Revenue' ? fmt(v) : `${v} qty`} />
                      <Bar dataKey="revenue" name="Revenue" barSize={18} radius={[0, 3, 3, 0]} fill="#93c5fd" />
                      <Bar dataKey="quantity" name="Qty" barSize={18} radius={[0, 3, 3, 0]} fill="#fcd34d" />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          )}

          {/* Least Sold Items */}
          {data.bottomItems && data.bottomItems.length > 0 && (
            <div className="bg-white rounded-xl border border-red-200 p-3">
              <div className="text-sm font-bold text-red-700 mb-2">Least Sold 20 Items</div>
              {(() => {
                const items = [...data.bottomItems!].reverse();
                return (
                  <ResponsiveContainer width="100%" height={items.length * 38 + 30}>
                    <BarChart data={items} layout="vertical" margin={{ left: 0, right: 15, top: 5, bottom: 5 }}>
                      <XAxis type="number" fontSize={10} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`} />
                      <YAxis type="category" dataKey="name" width={170} fontSize={14} tick={{ fill: '#991b1b', fontWeight: 600 }} interval={0} />
                      <Tooltip formatter={(v: number, name: string) => name === 'Revenue' ? fmt(v) : `${v} qty`} />
                      <Bar dataKey="revenue" name="Revenue" barSize={18} radius={[0, 3, 3, 0]} fill="#fca5a5" />
                      <Bar dataKey="quantity" name="Qty" barSize={18} radius={[0, 3, 3, 0]} fill="#fdba74" />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OperationalReportsPanel;
