import React, { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config/constants';

const BackofficeSalesSummaryPage: React.FC = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [channel, setChannel] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [summary, setSummary] = useState<{orders:number; total:number; discounts:number; bag_fees:number} | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [refundSummary, setRefundSummary] = useState<{totalRefunds:number; totalAmount:number}>({totalRefunds:0, totalAmount:0});

  const fetchData = async () => {
    try {
      setLoading(true); setError(null);
      const params = new URLSearchParams();
      params.set('start_date', startDate);
      params.set('end_date', endDate);
      if (channel && channel !== 'ALL') params.set('channel', channel);
      const res = await fetch(`${API_URL}/admin-settings/reports/sales-summary?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setSummary(json.summary || null);
      setOrders(Array.isArray(json.orders) ? json.orders : []);
      
      // Fetch refund data
      const refundRes = await fetch(`${API_URL}/refunds/report/summary?startDate=${startDate}&endDate=${endDate}`);
      const refundJson = await refundRes.json();
      if (refundJson.success && refundJson.summary) {
        setRefundSummary({
          totalRefunds: refundJson.summary.total_refunds || 0,
          totalAmount: refundJson.summary.total_amount || 0
        });
      }
    } catch (e:any) {
      setError(e?.message||'Failed');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

  const csv = useMemo(() => {
    const head = ['id','order_type','status','created_at','total'];
    const lines = [head.join(',')];
    orders.forEach((o:any) => {
      lines.push([o.id, o.order_type, o.status, o.created_at, o.total].map(v => JSON.stringify(v ?? '')).join(','));
    });
    return lines.join('\n');
  }, [orders]);

  const downloadCSV = () => {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `sales_summary_${startDate}_${endDate}_${channel||'ALL'}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sales Summary</h1>
      <div className="flex items-center gap-2 mb-4">
        <label className="text-sm">Start</label>
        <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="px-2 py-1 border rounded" />
        <label className="text-sm">End</label>
        <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="px-2 py-1 border rounded" />
        <select value={channel} onChange={e=>setChannel(e.target.value)} className="px-2 py-1 border rounded">
          <option value="ALL">All Channels</option>
          <option value="TOGO">TOGO</option>
          <option value="TABLE">TABLE</option>
        </select>
        <button onClick={fetchData} className="px-3 py-1 bg-blue-600 text-white rounded">Refresh</button>
        <button onClick={downloadCSV} className="px-3 py-1 bg-green-600 text-white rounded">Export CSV</button>
      </div>
      {error && <div className="p-2 bg-red-100 border border-red-300 text-red-700 rounded mb-3">{error}</div>}
      {loading ? (<div>Loading...</div>) : (
        <>
          <div className="grid grid-cols-6 gap-3 mb-4">
            <div className="p-3 rounded border bg-white"><div className="text-xs text-gray-500">Orders</div><div className="text-xl font-bold">{summary?.orders ?? 0}</div></div>
            <div className="p-3 rounded border bg-white"><div className="text-xs text-gray-500">Gross Total</div><div className="text-xl font-bold">${(summary?.total ?? 0).toFixed(2)}</div></div>
            <div className="p-3 rounded border bg-white"><div className="text-xs text-gray-500">Discounts</div><div className="text-xl font-bold text-orange-600">-${(summary?.discounts ?? 0).toFixed(2)}</div></div>
            <div className="p-3 rounded border bg-white border-l-4 border-l-red-500"><div className="text-xs text-gray-500">Refunds</div><div className="text-xl font-bold text-red-600">-${refundSummary.totalAmount.toFixed(2)}</div><div className="text-xs text-gray-400">{refundSummary.totalRefunds} refunds</div></div>
            <div className="p-3 rounded border bg-white"><div className="text-xs text-gray-500">Bag Fees</div><div className="text-xl font-bold">${(summary?.bag_fees ?? 0).toFixed(2)}</div></div>
            <div className="p-3 rounded border bg-green-50 border-l-4 border-l-green-500"><div className="text-xs text-gray-500">Net Sales</div><div className="text-xl font-bold text-green-700">${((summary?.total ?? 0) - (summary?.discounts ?? 0) - refundSummary.totalAmount + (summary?.bag_fees ?? 0)).toFixed(2)}</div></div>
          </div>
          <div className="overflow-auto border rounded bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left p-2 border-b">ID</th>
                  <th className="text-left p-2 border-b">Channel</th>
                  <th className="text-left p-2 border-b">Status</th>
                  <th className="text-left p-2 border-b">Created</th>
                  <th className="text-right p-2 border-b">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o:any) => (
                  <tr key={o.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border-b">{o.id}</td>
                    <td className="p-2 border-b">{o.order_type}</td>
                    <td className="p-2 border-b">{o.status}</td>
                    <td className="p-2 border-b">{o.created_at}</td>
                    <td className="p-2 border-b text-right">${Number(o.total||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default BackofficeSalesSummaryPage; 