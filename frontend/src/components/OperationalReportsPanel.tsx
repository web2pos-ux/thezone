import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
const fmt = (n: number) => `$${(n || 0).toFixed(2)}`;
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmt(n);

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const DELIVERY_COLORS = ['#f97316', '#a855f7', '#14b8a6', '#e11d48', '#6366f1'];
const TIP_PM_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const TIP_CH_COLORS = ['#f97316', '#14b8a6', '#6366f1', '#e11d48', '#a855f7'];
const TIP_SV_COLORS = ['#0ea5e9', '#d946ef', '#84cc16', '#f43f5e', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4'];
const HOUR_LABELS: Record<string, string> = {
  '06': '6a', '07': '7a', '08': '8a', '09': '9a', '10': '10a', '11': '11a',
  '12': '12p', '13': '1p', '14': '2p', '15': '3p', '16': '4p', '17': '5p',
  '18': '6p', '19': '7p', '20': '8p', '21': '9p', '22': '10p', '23': '11p', '00': '12a'
};

type PeriodKey = 'today' | 'lastWeek' | '7days' | '30days' | 'lastMonth' | 'thisMonth' | 'custom';

interface TaxDetail { name: string; rate: number; amount: number }
interface ReportData {
  success?: boolean;
  period: { startDate: string; endDate: string };
  overall: { orderCount: number; subtotal: number; taxTotal: number; totalSales: number; totalTip?: number; serviceCharge?: number };
  taxDetails?: TaxDetail[];
  channels: Record<string, { count: number; subtotal: number; tax: number; sales: number; tips: number }>;
  channelTaxDetails?: Record<string, TaxDetail[]>;
  dineInTableStats: { tableOrderCount: number; avgPerTable: number };
  deliveryPlatforms: Record<string, { count: number; sales: number }>;
  topItems: Array<{ rank: number; name: string; quantity: number; revenue: number }>;
  bottomItems?: Array<{ rank: number; name: string; quantity: number; revenue: number }>;
  totalItems: { totalQuantity: number; uniqueItems: number };
  categorySales?: Array<{ category: string; quantity: number; revenue: number }>;
  unpaid?: { orderCount: number; totalAmount: number; subtotal?: number; taxTotal?: number; taxDetails?: TaxDetail[]; channels: Record<string, { count: number; amount: number }> };
  hourlySales?: Array<{ hour: string; order_count: number; revenue: number }>;
  paymentBreakdown?: Array<{ payment_method: string; count: number; net_amount: number; tips: number }>;
  tableTurnover?: Array<{ table_name: string; order_count: number; avg_duration_min: number }>;
  employeeSales?: Array<{ employee: string; order_count: number; revenue: number; avg_check: number }>;
  refundsVoids?: Array<{ type: string; count: number; total: number }>;
  tipBreakdown?: {
    total: number;
    byServer: Array<{ server: string; tips: number; orderCount: number }>;
    byChannel: Array<{ channel: string; tips: number; orderCount: number }>;
    byPaymentMethod: Array<{ method: string; tips: number; count: number }>;
  };
  /** 단일 달력일 응답: 멀티데이 세션 포함 시 잠정 */
  calendarDayProvisional?: boolean;
  /** 해당 달력일과 겹치는 각 데이오프닝~클로징 세션 전체 리포트 */
  sessionsOnDay?: Array<{
    session_id: string;
    business_date?: string;
    opened_at: string;
    closed_at: string | null;
    status: string;
    report: Omit<ReportData, 'period' | 'calendarDayProvisional' | 'sessionsOnDay' | 'success'>;
  }>;
}

const PAYMENT_ORDER = ['Cash', 'Debit', 'Visa', 'MC', 'Other Card', 'From Delivery', 'Gift Card', 'Coupon'];
const paymentSortIdx = (name: string) => {
  const idx = PAYMENT_ORDER.findIndex(p => p.toUpperCase() === name.toUpperCase());
  return idx >= 0 ? idx : PAYMENT_ORDER.length;
};

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
    default: {
      const d = new Date(today);
      return { s: f(d), e: f(today) };
    }
  }
}

const LabelPie: React.FC<{ data: Array<{ name: string; value: number }>; colors?: string[]; size?: number; title?: string }> = ({ data, colors = COLORS, size = 160, title }) => {
  if (data.length === 0) return <div className="text-xs text-gray-400 text-center py-4">No data</div>;
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-col items-center">
      {title && <div className="text-[11px] font-bold text-gray-600 mb-1">{title}</div>}
      <div style={{ width: size, height: size }}>
        <PieChart width={size} height={size}>
          <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={size / 2 - 12} innerRadius={size / 4} strokeWidth={1} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => fmt(v)} />
        </PieChart>
      </div>
      <div className="space-y-0.5 mt-1 w-full max-w-[200px]">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colors[i % colors.length] }} />
            <span className="text-gray-600 truncate flex-1">{d.name}</span>
            <span className="font-bold text-gray-800">{fmt(d.value)}</span>
            <span className="text-gray-400 text-[10px] w-8 text-right">{total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const MiniDonut: React.FC<{ data: Array<{ name: string; value: number }>; colors?: string[]; size?: number }> = ({ data, colors = COLORS, size = 70 }) => {
  if (data.length === 0) return null;
  return (
    <div style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={size / 2 - 4} innerRadius={size / 4} strokeWidth={1} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmt(v)} />
      </PieChart>
    </div>
  );
};

const OperationalReportsPanel: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const salesReportAbortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    salesReportAbortRef.current?.abort();
    const ac = new AbortController();
    salesReportAbortRef.current = ac;
    setLoading(true);
    try {
      const { s, e } = getDateRange(period, customStart, customEnd);
      const qs = new URLSearchParams({
        startDate: s,
        endDate: e,
        _t: String(Date.now()),
      });
      const r = await fetch(`${API_URL}/daily-closings/sales-report?${qs.toString()}`, {
        cache: 'no-store',
        signal: ac.signal,
        headers: { Accept: 'application/json' },
      });
      const j = await r.json();
      if (j.success) {
        const { success: _ok, ...rest } = j;
        setData(rest as ReportData);
      }
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
      if (name === 'AbortError') return;
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [period, customStart, customEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const printSalesReport = useCallback(async () => {
    if (!data) return;
    setIsPrinting(true);
    try {
      const res = await fetch(`${API_URL}/daily-closings/print-sales-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportData: data, copies: 1 }),
      });
      const json = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Print failed');
    } catch (err: unknown) {
      console.error('Report Dashboard print error:', err instanceof Error ? err.message : err);
    } finally {
      setIsPrinting(false);
    }
  }, [data]);

  const periods: { key: PeriodKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'lastWeek', label: 'Last Week' },
    { key: '7days', label: 'Last 7 Days' },
    { key: '30days', label: 'Last 30 Days' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'custom', label: 'Custom' },
  ];

  const TH = 'text-[11px] text-gray-500 font-semibold py-1 px-1';
  const TD = 'text-xs py-1 px-1';

  return (
    <div className="p-5 flex-1 overflow-y-auto">
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
            <button onClick={() => fetchData()} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">Search</button>
          </div>
        )}
        {data && (
          <button
            type="button"
            onClick={printSalesReport}
            disabled={isPrinting}
            className="ml-auto px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isPrinting ? 'Printing...' : '🖨 Print'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>
      ) : !data ? (
        <div className="text-center py-16 text-gray-400 text-sm">No data available for this period.</div>
      ) : (
        <div className="space-y-5">
          <div className="text-xs text-gray-500">{data.period.startDate} ~ {data.period.endDate}</div>
          {data.calendarDayProvisional && (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              이 구간의 <b>달력일 요약</b>은 여러 날에 걸친 영업 세션이 섞일 수 있어 <b>잠정</b>입니다. 확정 매출·건수는 아래 <b>Day session (오프닝~클로징)</b>별 표를 사용하세요.
            </div>
          )}
          {data.sessionsOnDay && data.sessionsOnDay.length > 0 && data.period.startDate === data.period.endDate && (
            <div className="text-xs text-slate-600 font-semibold">
              상단 표 = 달력일 <code className="bg-slate-100 px-1 rounded">{data.period.startDate}</code> 자정 기준 같은 날짜 주문 합계 · 아래 = 각 세션 전체(오프닝~클로징)
            </div>
          )}

          {/* ===== 1. All Orders ===== */}
          <div>
            <div className="text-xs text-slate-500 font-bold mb-1.5">All Orders</div>
            {(() => {
              const up = data.unpaid;
              const hasUnpaid = up && up.orderCount > 0;
              const taxList = data.taxDetails && data.taxDetails.length > 0 ? data.taxDetails : [];
              const unpaidTaxList = (up as any)?.taxDetails || [];
              const items: Array<{ label: string; paid: string; unpaid: string; combined: string; isBold?: boolean }> = [
                { label: 'Orders', paid: data.overall.orderCount.toString(), unpaid: hasUnpaid ? `+${up!.orderCount}` : '', combined: hasUnpaid ? (data.overall.orderCount + up!.orderCount).toString() : '' },
                { label: 'Subtotal', paid: fmt(data.overall.subtotal), unpaid: hasUnpaid ? `+${fmt(up!.subtotal || 0)}` : '', combined: hasUnpaid ? fmt(data.overall.subtotal + (up!.subtotal || 0)) : '' },
              ];
              if (taxList.length > 0) {
                taxList.forEach(t => {
                  const unpaidMatch = unpaidTaxList.find((ut: TaxDetail) => ut.name === t.name);
                  const unpaidAmt = unpaidMatch ? unpaidMatch.amount : 0;
                  items.push({
                    label: t.rate > 0 ? `${t.name} ${t.rate}%` : t.name,
                    paid: fmt(t.amount),
                    unpaid: hasUnpaid && unpaidAmt > 0 ? `+${fmt(unpaidAmt)}` : '',
                    combined: hasUnpaid && unpaidAmt > 0 ? fmt(t.amount + unpaidAmt) : ''
                  });
                });
                unpaidTaxList.forEach((ut: TaxDetail) => {
                  if (!taxList.find(t => t.name === ut.name) && ut.amount > 0) {
                    items.push({
                      label: ut.rate > 0 ? `${ut.name} ${ut.rate}%` : ut.name,
                      paid: fmt(0),
                      unpaid: `+${fmt(ut.amount)}`,
                      combined: fmt(ut.amount)
                    });
                  }
                });
              } else if (data.overall.taxTotal > 0) {
                items.push({
                  label: 'Tax',
                  paid: fmt(data.overall.taxTotal),
                  unpaid: hasUnpaid ? `+${fmt(up!.taxTotal || 0)}` : '',
                  combined: hasUnpaid ? fmt(data.overall.taxTotal + (up!.taxTotal || 0)) : ''
                });
              }
              items.push({ label: 'Total', paid: fmt(data.overall.totalSales), unpaid: hasUnpaid ? `+${fmt(up!.totalAmount || 0)}` : '', combined: hasUnpaid ? fmt(data.overall.totalSales + (up!.totalAmount || 0)) : '', isBold: true });
              const paidTip = Number(data.overall.totalTip || 0);
              items.push({ label: 'Tips', paid: paidTip > 0 ? fmt(paidTip) : '-', unpaid: '', combined: '' });
              const grandTotal = data.overall.totalSales + paidTip;
              const unpaidGrand = hasUnpaid ? (up!.totalAmount || 0) : 0;
              items.push({ label: 'Grand Total', paid: fmt(grandTotal), unpaid: hasUnpaid && unpaidGrand > 0 ? `+${fmt(unpaidGrand)}` : '', combined: hasUnpaid && unpaidGrand > 0 ? fmt(grandTotal + unpaidGrand) : '', isBold: true });
              return (
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/80">
                        <th className="text-left py-2 px-4 text-xs text-slate-500 font-semibold">Item</th>
                        <th className="text-right py-2 px-4 text-xs text-slate-500 font-semibold">Paid</th>
                        {hasUnpaid && <th className="text-right py-2 px-4 text-xs text-amber-500 font-semibold">Unpaid</th>}
                        {hasUnpaid && <th className="text-right py-2 px-4 text-xs text-slate-400 font-semibold">Combined</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((s, i) => (
                        <tr key={s.label} className={`${s.isBold ? 'border-t border-slate-300 bg-slate-100/50' : ''} ${i > 0 && !s.isBold ? 'border-t border-slate-100' : ''}`}>
                          <td className={`py-1.5 px-4 text-slate-600 ${s.isBold ? 'font-bold text-slate-800' : 'font-medium'}`}>{s.label}</td>
                          <td className={`py-1.5 px-4 text-right ${s.isBold ? 'font-extrabold text-slate-900 text-base' : 'font-bold text-slate-800'}`}>{s.paid}</td>
                          {hasUnpaid && <td className="py-1.5 px-4 text-right text-amber-600 font-medium">{s.unpaid || ''}</td>}
                          {hasUnpaid && <td className="py-1.5 px-4 text-right text-slate-400">{s.combined || ''}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            {data.unpaid && data.unpaid.orderCount > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                  Unpaid: {fmt(data.unpaid.totalAmount)} ({data.unpaid.orderCount} orders)
                </div>
                {(['DINE-IN', 'TOGO', 'ONLINE', 'DELIVERY'] as const).map(ch => {
                  const d = data.unpaid?.channels?.[ch];
                  if (!d || d.count === 0) return null;
                  return <div key={ch} className="text-xs text-amber-600 bg-amber-50/60 border border-amber-100 rounded px-2 py-0.5">{ch}: {fmt(d.amount)} ({d.count})</div>;
                })}
              </div>
            )}
          </div>

          {/* ===== 2. Channel Breakdown (incl. Unpaid) ===== */}
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <div className="text-xs text-blue-800 font-bold mb-2">Channel Breakdown <span className="font-normal text-blue-400">(incl. Unpaid)</span></div>
            {/* Table */}
            {(() => {
              const chList = [
                { label: 'Dine-In', key: 'DINE-IN' }, { label: 'Togo', key: 'TOGO' },
                { label: 'Online', key: 'ONLINE' }, { label: 'Delivery', key: 'DELIVERY' },
              ];
              const allCh = chList.map(p => ({ ...p, ...(data.channels[p.key] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 }) }));
              const totalSales = allCh.reduce((a, c) => a + c.sales, 0);
              const totalSub = allCh.reduce((a, c) => a + c.subtotal, 0);
              const totalTax = allCh.reduce((a, c) => a + c.tax, 0);
              const totalTip = allCh.reduce((a, c) => a + c.tips, 0);
              const totalCount = allCh.reduce((a, c) => a + c.count, 0);
              const taxNames = data.taxDetails?.map(t => t.name) || [];
              const totalGrand = totalSales + totalTip;
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-blue-200">
                      <th className={`${TH} text-left`}>Channel</th>
                      <th className={`${TH} text-right`}>Orders</th>
                      <th className={`${TH} text-right`}>Ord%</th>
                      <th className={`${TH} text-right`}>Amount</th>
                      <th className={`${TH} text-right`}>Amt%</th>
                      <th className={`${TH} text-right`}>Tax</th>
                      <th className={`${TH} text-right`}>Avg</th>
                      <th className={`${TH} text-right`}>Tip</th>
                      <th className={`${TH} text-right`}>Grand</th>
                    </tr></thead>
                    <tbody>
                      {allCh.map(ch => {
                        const amtPct = totalSales > 0 ? ((ch.sales / totalSales) * 100).toFixed(1) : '0';
                        const ordPct = totalCount > 0 ? ((ch.count / totalCount) * 100).toFixed(1) : '0';
                        const chGrand = ch.sales + ch.tips;
                        return (
                          <tr key={ch.key} className="border-b border-blue-50 hover:bg-blue-100/40">
                            <td className={`${TD} font-bold text-blue-800`}>{ch.label}</td>
                            <td className={`${TD} text-right text-blue-700`}>{ch.count}</td>
                            <td className={`${TD} text-right text-blue-400`}>{ordPct}%</td>
                            <td className={`${TD} text-right font-extrabold text-blue-900`}>{fmt(ch.sales)}</td>
                            <td className={`${TD} text-right text-blue-500`}>{amtPct}%</td>
                            <td className={`${TD} text-right text-gray-500`}>{ch.tax > 0 ? fmt(ch.tax) : '-'}</td>
                            <td className={`${TD} text-right text-gray-500`}>{ch.count > 0 ? fmt(ch.sales / ch.count) : '-'}</td>
                            <td className={`${TD} text-right text-amber-600`}>{ch.tips > 0 ? fmt(ch.tips) : '-'}</td>
                            <td className={`${TD} text-right font-bold text-indigo-700`}>{chGrand > 0 ? fmt(chGrand) : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot><tr className="border-t-2 border-blue-300 font-extrabold">
                      <td className={`${TD} text-blue-800`}>TOTAL</td>
                      <td className={`${TD} text-right text-blue-700`}>{totalCount}</td>
                      <td className={`${TD} text-right text-blue-400`}>100%</td>
                      <td className={`${TD} text-right text-blue-900`}>{fmt(totalSales)}</td>
                      <td className={`${TD} text-right text-blue-500`}>100%</td>
                      <td className={`${TD} text-right text-gray-500`}>{totalTax > 0 ? fmt(totalTax) : '-'}</td>
                      <td className={`${TD} text-right text-gray-500`}>{totalCount > 0 ? fmt(totalSales / totalCount) : '-'}</td>
                      <td className={`${TD} text-right text-amber-600`}>{totalTip > 0 ? fmt(totalTip) : '-'}</td>
                      <td className={`${TD} text-right font-bold text-indigo-700`}>{fmt(totalGrand)}</td>
                    </tr></tfoot>
                  </table>
                  {data.dineInTableStats && data.dineInTableStats.tableOrderCount > 0 && (
                    <div className="text-[11px] text-blue-500 mt-1.5">Dine-In: {data.dineInTableStats.tableOrderCount} tables | Avg/Table: {fmt(data.dineInTableStats.avgPerTable)}</div>
                  )}
                </div>
              );
            })()}
            {/* Two pie charts below the table */}
            <div className="flex gap-6 mt-4 justify-center">
              <LabelPie
                title="Sales by Channel"
                data={Object.entries(data.channels).filter(([, v]) => v.sales > 0).map(([k, v]) => ({ name: k, value: v.sales }))}
                colors={COLORS} size={150}
              />
              <LabelPie
                title="Delivery by Platform"
                data={Object.entries(data.deliveryPlatforms || {}).filter(([, v]) => v.sales > 0).map(([k, v]) => ({ name: k, value: v.sales }))}
                colors={DELIVERY_COLORS} size={150}
              />
            </div>
          </div>

          {data.sessionsOnDay && data.sessionsOnDay.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-2">
              <div className="text-xs font-bold text-violet-900">Day sessions (opening ~ closing)</div>
              {data.sessionsOnDay.map((s, idx) => (
                <details key={s.session_id || String(idx)} className="bg-white rounded-lg border border-violet-100">
                  <summary className="px-3 py-2 cursor-pointer text-sm font-semibold text-violet-900">
                    #{idx + 1} {(s.opened_at || '').slice(0, 16)} → {s.closed_at ? s.closed_at.slice(0, 16) : 'OPEN'}{' '}
                    <span className="text-violet-500 font-normal text-xs ml-1">{s.session_id}</span>
                  </summary>
                  <div className="px-3 pb-3 pt-0 text-xs space-y-1 text-slate-700">
                    <div>Paid orders: <b>{s.report.overall.orderCount}</b> · Sales <b>{fmt(s.report.overall.totalSales)}</b> · Tips <b>{fmt(s.report.overall.totalTip || 0)}</b></div>
                    <div>Unpaid: <b>{s.report.unpaid?.orderCount || 0}</b> orders · <b>{fmt(s.report.unpaid?.totalAmount || 0)}</b></div>
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* ===== 3. Payments by Method ===== */}
          {data.paymentBreakdown && data.paymentBreakdown.length > 0 && (() => {
            const sorted = [...data.paymentBreakdown!].sort((a, b) => paymentSortIdx(a.payment_method) - paymentSortIdx(b.payment_method));
            const payTotal = sorted.reduce((a, p) => a + (p.net_amount || 0), 0);
            const tipTotal = sorted.reduce((a, p) => a + (p.tips || 0), 0);
            const countTotal = sorted.reduce((a, p) => a + p.count, 0);
            const grandTotal = payTotal + tipTotal;
            const overallTax = Number(data.overall.taxTotal || 0);
            const overallSub = Number(data.overall.subtotal || 0);
            const taxRatio = (overallSub + overallTax) > 0 ? overallTax / (overallSub + overallTax) : 0;
            const pieData = sorted.filter(p => p.net_amount > 0).map(p => ({ name: p.payment_method, value: p.net_amount }));
            return (
              <div className="bg-green-50 rounded-xl border border-green-200 p-4">
                <div className="text-xs text-green-800 font-bold mb-2">Payments by Method</div>
                <div className="flex gap-4">
                  {/* Left: compact data table */}
                  <div className="min-w-0" style={{ flex: '0 0 65%' }}>
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-green-200">
                        <th className={`${TH} text-left`}>Method</th>
                        <th className={`${TH} text-right`}>Amount</th>
                        <th className={`${TH} text-right`}>Tax</th>
                        <th className={`${TH} text-right`}>%</th>
                        <th className={`${TH} text-right`}>Txn</th>
                        <th className={`${TH} text-right`}>Tip</th>
                        <th className={`${TH} text-right`}>Grand</th>
                      </tr></thead>
                      <tbody>
                        {sorted.map(p => {
                          const pct = payTotal > 0 ? ((p.net_amount / payTotal) * 100).toFixed(1) : '0';
                          const estTax = Number((p.net_amount * taxRatio).toFixed(2));
                          const rowGrand = p.net_amount + p.tips;
                          return (
                            <tr key={p.payment_method} className="border-b border-green-50 hover:bg-green-100/40">
                              <td className={`${TD} font-bold text-green-800`}>{p.payment_method}</td>
                              <td className={`${TD} text-right font-extrabold text-green-900`}>{fmt(p.net_amount)}</td>
                              <td className={`${TD} text-right text-gray-500`}>{estTax > 0 ? fmt(estTax) : '-'}</td>
                              <td className={`${TD} text-right text-green-500`}>{pct}%</td>
                              <td className={`${TD} text-right text-green-700`}>{p.count}</td>
                              <td className={`${TD} text-right text-amber-600`}>{p.tips > 0 ? fmt(p.tips) : '-'}</td>
                              <td className={`${TD} text-right font-bold text-indigo-700`}>{fmt(rowGrand)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot><tr className="border-t-2 border-green-300 font-extrabold">
                        <td className={`${TD} text-green-800`}>TOTAL</td>
                        <td className={`${TD} text-right text-green-900`}>{fmt(payTotal)}</td>
                        <td className={`${TD} text-right text-gray-500`}>{overallTax > 0 ? fmt(overallTax) : '-'}</td>
                        <td className={`${TD} text-right text-green-500`}>100%</td>
                        <td className={`${TD} text-right text-green-700`}>{countTotal}</td>
                        <td className={`${TD} text-right text-amber-600`}>{tipTotal > 0 ? fmt(tipTotal) : '-'}</td>
                        <td className={`${TD} text-right font-bold text-indigo-700`}>{fmt(grandTotal)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                  {/* Right: pie chart */}
                  <div className="flex-1 flex items-center justify-center">
                    <LabelPie data={pieData} colors={COLORS} size={180} />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== 4. Tips ===== */}
          {(() => {
            const tb = data.tipBreakdown;
            const totalTip = data.overall.totalTip || 0;
            const byPM = tb?.byPaymentMethod || [];
            const byCh = tb?.byChannel || [];
            const bySv = tb?.byServer || [];
            const pmPie = byPM.map(m => ({ name: m.method, value: m.tips }));
            const chPie = byCh.map(c => ({ name: c.channel, value: c.tips }));
            const svPie = bySv.map(s => ({ name: s.server, value: s.tips }));
            return (
              <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-xl border border-amber-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-bold text-amber-800">Tips</span>
                  <span className="text-xl font-extrabold text-amber-700">{fmt(totalTip)}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { title: 'By Payment Method', items: byPM.map(m => ({ name: m.method, value: m.tips, sub: `${m.count} txn` })), pie: pmPie, colors: TIP_PM_COLORS },
                    { title: 'By Channel', items: byCh.map(c => ({ name: c.channel, value: c.tips, sub: `${c.orderCount} orders` })), pie: chPie, colors: TIP_CH_COLORS },
                    { title: 'By Server', items: bySv.map(s => ({ name: s.server, value: s.tips, sub: `${s.orderCount} orders` })), pie: svPie, colors: TIP_SV_COLORS },
                  ].map(sec => (
                    <div key={sec.title} className="bg-white/60 rounded-lg p-3 border border-amber-100">
                      <div className="text-xs font-bold text-amber-800 mb-2 border-b border-amber-200 pb-1">{sec.title}</div>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          {sec.items.length > 0 ? sec.items.map((it, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-gray-700 font-medium truncate">{it.name}</span>
                              <span className="font-extrabold text-amber-800 ml-1">{fmt(it.value)}</span>
                            </div>
                          )) : <div className="text-xs text-gray-400">No data</div>}
                        </div>
                        {sec.pie.length > 0 && (
                          <div className="flex-shrink-0"><MiniDonut data={sec.pie} colors={sec.colors} size={70} /></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ===== 5. Hourly Sales ===== */}
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

          {/* ===== 6. Table Turnover ===== */}
          {data.tableTurnover && data.tableTurnover.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm font-bold text-gray-700 mb-3">Table Turnover</div>
              <div className="max-h-[180px] overflow-y-auto">
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
        </div>
      )}
    </div>
  );
};

export default OperationalReportsPanel;
