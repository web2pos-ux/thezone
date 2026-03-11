import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ServerSelectionModal from '../components/ServerSelectionModal';
import clockInOutApi, { type ClockedInEmployee } from '../services/clockInOutApi';
import { getAPI_URL } from '../config/constants';

type PreviewResponse = {
  success: boolean;
  error?: string;
  businessDate?: string;
  shift?: any;
  data?: {
    salesSummary: {
      orderCount: number;
      grossSales: number;
      netSales: number;
      taxTotal: number;
      discountTotal: number;
      voidTotal: number;
      refundTotal: number;
    };
    paymentBreakdown: Array<{ paymentType: string; salesAmount: number; tipAmount: number }>;
    tipSummary: { cashTips: number; cardTips: number; totalTip: number };
    cash: { totalCashSales: number; cashRefundTotal: number; safeDropTotal: number; paidOutTotal: number; expectedCash: number };
  };
};

const fmtMoney = (n: number) => `$${(Number(n || 0)).toFixed(2)}`;

const ServerSettlementPage: React.FC = () => {
  const apiUrl = useMemo(() => getAPI_URL(), []);

  const [employees, setEmployees] = useState<ClockedInEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeError, setEmployeeError] = useState('');

  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState<ClockedInEmployee | null>(null);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [actualCash, setActualCash] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [serverSalesDate, setServerSalesDate] = useState<string>(() => {
    try {
      return new Date().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  });
  const [printingServerSales, setPrintingServerSales] = useState(false);

  const loadClockedIn = useCallback(async () => {
    setLoadingEmployees(true);
    setEmployeeError('');
    try {
      const list = await clockInOutApi.getClockedInEmployees();
      setEmployees(list);
    } catch (e: any) {
      setEmployeeError(e?.message || 'Failed to load clocked-in servers');
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  useEffect(() => {
    loadClockedIn();
    const t = window.setInterval(loadClockedIn, 8000);
    return () => window.clearInterval(t);
  }, [loadClockedIn]);

  const fetchPreview = useCallback(async () => {
    if (!selectedServer?.employee_id) return;
    setLoadingPreview(true);
    setPreviewError('');
    try {
      const res = await fetch(`${apiUrl}/server-settlements/preview?server_id=${encodeURIComponent(selectedServer.employee_id)}`, {
        cache: 'no-store' as any,
      });
      const json = (await res.json().catch(() => ({}))) as PreviewResponse;
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Preview failed');
      setPreview(json);
      setActualCash(String(json?.data?.cash?.expectedCash ?? ''));
    } catch (e: any) {
      setPreview(null);
      setPreviewError(e?.message || 'Preview failed');
    } finally {
      setLoadingPreview(false);
    }
  }, [apiUrl, selectedServer?.employee_id]);

  useEffect(() => {
    if (selectedServer) fetchPreview();
  }, [selectedServer, fetchPreview]);

  const difference = useMemo(() => {
    const expected = preview?.data?.cash?.expectedCash ?? 0;
    const actual = Number(actualCash || 0);
    if (!Number.isFinite(actual)) return 0;
    return Number((actual - expected).toFixed(2));
  }, [actualCash, preview?.data?.cash?.expectedCash]);

  const submitMidSettlement = useCallback(async () => {
    if (!selectedServer?.employee_id) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/server-settlements/mid-settlement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_id: selectedServer.employee_id,
          actual_cash: Number(actualCash || 0),
          comment: comment || null,
          initiated_by: 'server',
          initiated_by_id: selectedServer.employee_id,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Settlement failed');
      alert('Mid-Settlement created successfully.');
      await fetchPreview();
    } catch (e: any) {
      alert(e?.message || 'Settlement failed');
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, actualCash, comment, fetchPreview, selectedServer?.employee_id]);

  const printLatestSettlement = useCallback(async () => {
    if (!selectedServer?.employee_id) return;
    try {
      const res = await fetch(`${apiUrl}/server-settlements/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_id: selectedServer.employee_id,
          business_date: preview?.businessDate,
          copies: 1,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Print failed');
      alert('Printed successfully.');
    } catch (e: any) {
      alert(e?.message || 'Print failed');
    }
  }, [apiUrl, preview?.businessDate, selectedServer?.employee_id]);

  const printServerSalesSummary = useCallback(async () => {
    setPrintingServerSales(true);
    try {
      const res = await fetch(`${apiUrl}/server-settlements/print-server-sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_date: serverSalesDate || null,
          copies: 1,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Print failed');
      alert('Server sales printed successfully.');
    } catch (e: any) {
      alert(e?.message || 'Print failed');
    } finally {
      setPrintingServerSales(false);
    }
  }, [apiUrl, serverSalesDate]);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900">Server Mid-Shift Settlement</h1>
            <div className="text-sm text-gray-600 mt-1">
              서버 개인별 책임 정산(중간 정산) — 판매/팁/세이프드랍 기준 Expected Cash 계산
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-gray-600">Server Sales Print</span>
              <input
                type="date"
                value={serverSalesDate}
                onChange={(e) => setServerSalesDate(e.target.value)}
                className="px-2 py-1 rounded-md border border-gray-300 text-sm"
              />
              <button
                onClick={printServerSalesSummary}
                disabled={printingServerSales}
                className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-black text-white font-extrabold disabled:opacity-50"
              >
                {printingServerSales ? 'Printing...' : 'Print'}
              </button>
            </div>
            <button
              onClick={() => setServerModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              Select Server
            </button>
            <button
              onClick={loadClockedIn}
              className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold"
            >
              Refresh
            </button>
          </div>
        </div>

        {(employeeError || previewError) && (
          <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 font-semibold text-sm">
            {employeeError || previewError}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs text-gray-500 font-bold">Selected Server</div>
            <div className="mt-1 text-xl font-extrabold text-gray-900">
              {selectedServer ? selectedServer.employee_name : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {selectedServer ? `ID: ${selectedServer.employee_id} · Role: ${selectedServer.role}` : 'Clocked-in server를 선택하세요.'}
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Clocked-in: {loadingEmployees ? 'Loading...' : employees.length}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs text-gray-500 font-bold">Expected Cash</div>
            <div className="mt-1 text-3xl font-extrabold text-gray-900">
              {fmtMoney(preview?.data?.cash?.expectedCash ?? 0)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Cash Sales {fmtMoney(preview?.data?.cash?.totalCashSales ?? 0)} · Cash Tips {fmtMoney(preview?.data?.tipSummary?.cashTips ?? 0)} · Drops {fmtMoney(preview?.data?.cash?.safeDropTotal ?? 0)}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs text-gray-500 font-bold">Actual Cash (Counted)</div>
            <input
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              inputMode="decimal"
              className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-300 text-lg font-bold"
              placeholder="0.00"
            />
            <div className="mt-2 text-sm">
              <span className="text-gray-500 font-semibold">Over/Short:</span>{' '}
              <span className={`font-extrabold ${Math.abs(difference) > 0 ? (difference < 0 ? 'text-red-700' : 'text-emerald-700') : 'text-gray-800'}`}>
                {difference >= 0 ? '+' : ''}{fmtMoney(difference)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="text-sm font-extrabold text-gray-900">Settlement Preview</div>
          <div className="text-xs text-gray-500 mt-1">
            Business Date: {preview?.businessDate || '—'} · Shift: {preview?.shift?.shift_id ?? '—'}
          </div>

          {loadingPreview ? (
            <div className="py-10 text-center text-gray-500">Loading...</div>
          ) : !preview?.data ? (
            <div className="py-10 text-center text-gray-500">Select a server to preview.</div>
          ) : (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-gray-500 font-bold">Gross Sales</div>
                <div className="text-lg font-extrabold">{fmtMoney(preview.data.salesSummary.grossSales)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-gray-500 font-bold">Net Sales</div>
                <div className="text-lg font-extrabold">{fmtMoney(preview.data.salesSummary.netSales)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-gray-500 font-bold">Tax</div>
                <div className="text-lg font-extrabold">{fmtMoney(preview.data.salesSummary.taxTotal)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-gray-500 font-bold">Tips</div>
                <div className="text-lg font-extrabold">{fmtMoney(preview.data.tipSummary.totalTip)}</div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label className="block text-xs font-bold text-gray-600">Comment (required if over/short &gt; $20)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
              rows={2}
              placeholder="Reason / note..."
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={fetchPreview}
              disabled={!selectedServer || submitting}
              className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold disabled:opacity-50"
            >
              Recalculate
            </button>
            <button
              onClick={printLatestSettlement}
              disabled={!selectedServer || submitting}
              className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold disabled:opacity-50"
            >
              Print Latest
            </button>
            <button
              onClick={submitMidSettlement}
              disabled={!selectedServer || submitting}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-black text-white font-extrabold disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Create Mid-Settlement'}
            </button>
          </div>
        </div>
      </div>

      <ServerSelectionModal
        open={serverModalOpen}
        loading={loadingEmployees}
        error={employeeError || undefined}
        employees={employees}
        onClose={() => setServerModalOpen(false)}
        onSelect={(emp) => {
          setSelectedServer(emp);
          setServerModalOpen(false);
        }}
      />
    </div>
  );
};

export default ServerSettlementPage;

