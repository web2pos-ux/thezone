import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, PieChart, Pie, Cell, CartesianGrid, Area, AreaChart
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
const fmt = (n: number) => `$${(n || 0).toFixed(2)}`;
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmt(n);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n || 0).toFixed(1)}%`;

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS: Record<string, string> = {
  '06': '6a', '07': '7a', '08': '8a', '09': '9a', '10': '10a', '11': '11a',
  '12': '12p', '13': '1p', '14': '2p', '15': '3p', '16': '4p', '17': '5p',
  '18': '6p', '19': '7p', '20': '8p', '21': '9p', '22': '10p', '23': '11p', '00': '12a'
};

type ReportTab = 'daily' | 'weekly' | 'monthly' | 'trend';

interface KpiCardProps { label: string; value: string; sub?: string; trend?: number; }
const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, trend }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col">
    <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="text-2xl font-extrabold text-gray-900 mt-1">{value}</div>
    {(sub || trend !== undefined) && (
      <div className="flex items-center gap-2 mt-1">
        {trend !== undefined && (
          <span className={`text-xs font-bold ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {pct(trend)}
          </span>
        )}
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
    )}
  </div>
);

const Spinner = () => (
  <div className="flex items-center justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
  </div>
);

const NoData = () => (
  <div className="text-center py-16 text-gray-400 text-sm">No data available for this period.</div>
);

// ======================== DAILY DASHBOARD ========================
const DailyDashboard: React.FC = () => {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/reports-v2/operational/daily?date=${d}`);
      const j = await r.json();
      if (j.success) setData(j.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(date); }, [date, fetch_]);

  if (loading) return <Spinner />;
  if (!data) return <NoData />;

  const s = data.summary || {};
  const ys = data.yesterdaySummary || {};
  const salesGrowth = ys.total_sales > 0 ? ((s.total_sales - ys.total_sales) / ys.total_sales * 100) : 0;
  const orderGrowth = ys.order_count > 0 ? ((s.order_count - ys.order_count) / ys.order_count * 100) : 0;

  const allHours = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
  const hourlyMap = Object.fromEntries((data.hourlySales || []).map((h: any) => [h.hour, h]));
  const yHourlyMap = Object.fromEntries((data.yesterdayHourly || []).map((h: any) => [h.hour, h]));
  const hourlyChart = allHours.map(h => ({
    hour: HOUR_LABELS[h] || h,
    today: hourlyMap[h]?.revenue || 0,
    yesterday: yHourlyMap[h]?.revenue || 0,
  }));

  const payTotal = (data.paymentBreakdown || []).reduce((a: number, p: any) => a + p.net_amount, 0);
  const payChart = (data.paymentBreakdown || []).map((p: any) => ({
    name: p.payment_method,
    value: p.net_amount,
    pct: payTotal > 0 ? Math.round(p.net_amount / payTotal * 100) : 0,
  }));

  const refund = (data.refundsVoids || []).find((r: any) => r.type === 'refund') || { count: 0, total: 0 };
  const voidD = (data.refundsVoids || []).find((r: any) => r.type === 'void') || { count: 0, total: 0 };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-extrabold text-gray-800">Daily Operations</h3>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Sales" value={fmt(s.total_sales)} trend={salesGrowth} sub="vs yesterday" />
        <KpiCard label="Orders" value={String(s.order_count || 0)} trend={orderGrowth} sub="vs yesterday" />
        <KpiCard label="Avg Check" value={fmt(s.avg_check)} sub={`Yesterday: ${fmt(ys.avg_check)}`} />
        <KpiCard label="Guests" value={String(s.guest_count || 0)} />
      </div>

      {/* Hourly Sales Heatmap */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-3">Hourly Sales — Today vs Yesterday</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hourlyChart} barGap={0} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="today" fill="#3b82f6" name="Today" radius={[3, 3, 0, 0]} />
            <Bar dataKey="yesterday" fill="#d1d5db" name="Yesterday" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Payment Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-3">Payment Methods</div>
          {payChart.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={payChart} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                    {payChart.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {payChart.map((p: any, i: number) => (
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
          ) : <div className="text-xs text-gray-400 py-4 text-center">No payments</div>}
        </div>

        {/* Table Turnover */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-3">Table Turnover</div>
          {(data.tableTurnover || []).length > 0 ? (
            <div className="max-h-[160px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b">
                    <th className="text-left py-1 font-semibold">Table</th>
                    <th className="text-right py-1 font-semibold">Orders</th>
                    <th className="text-right py-1 font-semibold">Avg Min</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.tableTurnover || []).map((t: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1 font-medium text-gray-800">{t.table_name}</td>
                      <td className="py-1 text-right text-gray-700">{t.order_count}</td>
                      <td className="py-1 text-right text-gray-700">{Math.round(t.avg_duration_min)}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-xs text-gray-400 py-4 text-center">No table data</div>}
        </div>
      </div>

      {/* Refunds & Voids */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-2">Cancellations & Refunds</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Refunds:</span>{' '}
            <span className="font-bold text-red-600">{refund.count} ({fmt(refund.total)})</span>
          </div>
          <div>
            <span className="text-gray-500">Voids:</span>{' '}
            <span className="font-bold text-red-600">{voidD.count} ({fmt(voidD.total)})</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ======================== WEEKLY REPORT ========================
const WeeklyReport: React.FC = () => {
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/reports-v2/operational/weekly?endDate=${d}`);
      const j = await r.json();
      if (j.success) setData(j.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(endDate); }, [endDate, fetch_]);

  if (loading) return <Spinner />;
  if (!data) return <NoData />;

  const dailyChart = (data.dailySales || []).map((d: any) => ({
    day: DAY_NAMES[parseInt(d.day_of_week)] || d.date.slice(5),
    date: d.date,
    revenue: d.revenue,
    orders: d.order_count,
    avgCheck: d.avg_check,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-extrabold text-gray-800">Weekly Performance</h3>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>Week ending</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Weekly Revenue" value={fmt(data.totalRevenue)} trend={data.growthRate} sub="vs prev week" />
        <KpiCard label="Total Orders" value={String(data.totalOrders)} />
        <KpiCard label="Avg Check" value={fmt(data.avgCheck)} />
        <KpiCard label="Prev Week" value={fmt(data.prevWeekRevenue)} />
      </div>

      {/* Daily Sales Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-3">Daily Sales Pattern</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
            <Tooltip formatter={(v: number, name: string) => name === 'orders' ? v : fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Best Sellers */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-green-700 mb-2">Best Sellers (Top 10)</div>
          <div className="max-h-[220px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b">
                <th className="text-left py-1">#</th><th className="text-left py-1">Item</th>
                <th className="text-right py-1">Qty</th><th className="text-right py-1">Revenue</th>
              </tr></thead>
              <tbody>
                {(data.topItems || []).map((it: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1 text-gray-400">{i + 1}</td>
                    <td className="py-1 font-medium text-gray-800 truncate max-w-[140px]">{it.name}</td>
                    <td className="py-1 text-right text-gray-700">{it.qty}</td>
                    <td className="py-1 text-right font-bold text-gray-900">{fmt(it.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Worst Sellers */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-red-700 mb-2">Worst Sellers (Bottom 10)</div>
          <div className="max-h-[220px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 border-b">
                <th className="text-left py-1">#</th><th className="text-left py-1">Item</th>
                <th className="text-right py-1">Qty</th><th className="text-right py-1">Revenue</th>
              </tr></thead>
              <tbody>
                {(data.worstItems || []).map((it: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1 text-gray-400">{i + 1}</td>
                    <td className="py-1 font-medium text-gray-800 truncate max-w-[140px]">{it.name}</td>
                    <td className="py-1 text-right text-gray-700">{it.qty}</td>
                    <td className="py-1 text-right font-bold text-gray-900">{fmt(it.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Employee Sales */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-2">Employee Sales</div>
        {(data.employeeSales || []).length > 0 ? (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 border-b">
              <th className="text-left py-1">Employee</th>
              <th className="text-right py-1">Orders</th>
              <th className="text-right py-1">Revenue</th>
              <th className="text-right py-1">Avg Check</th>
            </tr></thead>
            <tbody>
              {(data.employeeSales || []).map((e: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 font-medium text-gray-800">{e.employee}</td>
                  <td className="py-1.5 text-right text-gray-700">{e.order_count}</td>
                  <td className="py-1.5 text-right font-bold text-gray-900">{fmt(e.revenue)}</td>
                  <td className="py-1.5 text-right text-gray-600">{fmt(e.avg_check)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-xs text-gray-400 py-4 text-center">No employee data</div>}
      </div>
    </div>
  );
};

// ======================== MONTHLY REPORT ========================
const MonthlyReport: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/reports-v2/operational/monthly?month=${m}`);
      const j = await r.json();
      if (j.success) setData(j.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(month); }, [month, fetch_]);

  if (loading) return <Spinner />;
  if (!data) return <NoData />;

  const catTotal = (data.categorySales || []).reduce((a: number, c: any) => a + c.revenue, 0);
  const catChart = (data.categorySales || []).map((c: any) => ({
    name: c.category,
    value: c.revenue,
    pct: catTotal > 0 ? Math.round(c.revenue / catTotal * 100) : 0,
  }));

  const allHours = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
  const hourMap = Object.fromEntries((data.hourlySales || []).map((h: any) => [h.hour, h]));
  const peakData = allHours.map(h => ({
    hour: HOUR_LABELS[h] || h,
    revenue: hourMap[h]?.revenue || 0,
    orders: hourMap[h]?.order_count || 0,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-extrabold text-gray-800">Monthly Report</h3>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Monthly Revenue" value={fmt(data.totalRevenue)} trend={data.prevMonthGrowth} sub="vs prev month" />
        <KpiCard label="Orders" value={String(data.totalOrders)} />
        <KpiCard label="Avg Check" value={fmt(data.avgCheck)} />
        <KpiCard label="YoY Growth" value={pct(data.yoyGrowth)} sub={`Last year: ${fmt(data.prevYearRevenue)}`} />
      </div>

      {/* Daily Revenue Line */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-3">Daily Revenue</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.dailySales || []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(8)} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
            <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(l: string) => l} />
            <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="#dbeafe" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-3">Category Sales</div>
          {catChart.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={catChart} dataKey="value" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                    {catChart.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1 max-h-[140px] overflow-y-auto">
                {catChart.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="font-medium text-gray-700 truncate max-w-[100px]">{c.name}</span>
                    </div>
                    <span className="font-bold text-gray-900">{fmt(c.value)} ({c.pct}%)</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="text-xs text-gray-400 py-4 text-center">No data</div>}
        </div>

        {/* Channel Sales */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-3">Sales by Channel</div>
          {(data.channelSales || []).length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={data.channelSales} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                <YAxis type="category" dataKey="channel" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="revenue" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-xs text-gray-400 py-4 text-center">No data</div>}
        </div>
      </div>

      {/* Peak/Off-Peak */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-3">Peak / Off-Peak Hours</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={peakData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
            <Tooltip formatter={(v: number, name: string) => name === 'orders' ? v : fmt(v)} />
            <Bar dataKey="revenue" fill="#f59e0b" name="Revenue" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Discounts */}
      {(data.discountSummary || []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-2">Discounts & Promotions</div>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 border-b">
              <th className="text-left py-1">Type</th>
              <th className="text-right py-1">Count</th>
              <th className="text-right py-1">Amount</th>
            </tr></thead>
            <tbody>
              {(data.discountSummary || []).map((d: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1 font-medium text-gray-800">{d.discount_type}</td>
                  <td className="py-1 text-right text-gray-700">{d.count}</td>
                  <td className="py-1 text-right font-bold text-red-600">-{fmt(d.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ======================== TREND REPORT ========================
const TrendReport: React.FC = () => {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async (m: number) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/reports-v2/operational/trend?months=${m}`);
      const j = await r.json();
      if (j.success) setData(j.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(months); }, [months, fetch_]);

  if (loading) return <Spinner />;
  if (!data) return <NoData />;

  const revenueChart = (data.monthlySales || []).map((m: any) => ({
    month: m.month.slice(2),
    revenue: m.revenue,
    orders: m.order_count,
    avgCheck: m.avg_check,
  }));

  const forecastChart = [
    ...revenueChart,
    ...(data.forecast || []).map((f: any) => ({
      month: f.month.slice(2),
      forecast: f.predicted,
    })),
  ];

  const yoyChart = (data.yoyData || []).filter((y: any) => y.growth !== null).map((y: any) => ({
    month: y.month.slice(2),
    growth: y.growth,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h3 className="text-base font-extrabold text-gray-800">Trend Analysis</h3>
        <div className="flex gap-1">
          {[{ v: 3, l: '3M' }, { v: 6, l: '6M' }, { v: 12, l: '1Y' }, { v: 24, l: '2Y' }].map(opt => (
            <button key={opt.v} onClick={() => setMonths(opt.v)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                months === opt.v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue Trend + Forecast */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-3">Revenue Trend & Forecast</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={forecastChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Revenue" />
            <Line type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} name="Forecast" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* YoY Growth */}
      {yoyChart.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-bold text-gray-700 mb-3">Year-over-Year Growth</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={yoyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="growth" name="YoY Growth" radius={[4, 4, 0, 0]}>
                {yoyChart.map((entry: any, i: number) => (
                  <Cell key={i} fill={entry.growth >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Summary Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-700 mb-2">Monthly Summary</div>
        <div className="max-h-[240px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 border-b sticky top-0 bg-white">
              <th className="text-left py-1.5">Month</th>
              <th className="text-right py-1.5">Revenue</th>
              <th className="text-right py-1.5">Orders</th>
              <th className="text-right py-1.5">Avg Check</th>
            </tr></thead>
            <tbody>
              {(data.monthlySales || []).slice().reverse().map((m: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 font-medium text-gray-800">{m.month}</td>
                  <td className="py-1.5 text-right font-bold text-gray-900">{fmt(m.revenue)}</td>
                  <td className="py-1.5 text-right text-gray-700">{m.order_count}</td>
                  <td className="py-1.5 text-right text-gray-600">{fmt(m.avg_check)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ======================== MAIN PANEL ========================
const OperationalReportsPanel: React.FC = () => {
  const [tab, setTab] = useState<ReportTab>('daily');

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'trend', label: 'Trend' },
  ];

  return (
    <div className="p-5 flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 mb-5">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
              tab === t.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'daily' && <DailyDashboard />}
      {tab === 'weekly' && <WeeklyReport />}
      {tab === 'monthly' && <MonthlyReport />}
      {tab === 'trend' && <TrendReport />}
    </div>
  );
};

export default OperationalReportsPanel;
