import React, { useEffect, useState } from 'react';
import { getAPI_URL } from '../config/constants';

type DlqRow = {
  id: number;
  queue_id: number | null;
  type: string;
  order_id: number | null;
  error_message: string | null;
  created_at: string;
  payload: string;
};

const API_FETCH_TIMEOUT_MS = 12000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = API_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function payloadPreview(raw: string, max = 160) {
  if (!raw) return '—';
  const s = raw.length > max ? `${raw.slice(0, max)}…` : raw;
  return s;
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** DLQ 건이 줄어들었을 때 상단 배너 등 새로고침용 */
  onRetried?: () => void;
};

export const DlqSyncModal: React.FC<Props> = ({ isOpen, onClose, onRetried }) => {
  const [rows, setRows] = useState<DlqRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [retryingId, setRetryingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const apiUrl = getAPI_URL();
        const res = await fetchWithTimeout(`${apiUrl}/firebase-sync/dlq`, { cache: 'no-store' as RequestCache });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && json.ok) {
          setRows(Array.isArray(json.rows) ? json.rows : []);
        } else if (!cancelled) {
          setErr(json.error || '목록을 불러오지 못했습니다.');
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      const apiUrl = getAPI_URL();
      const res = await fetchWithTimeout(`${apiUrl}/firebase-sync/dlq/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          json.error === 'network_offline'
            ? '오프라인입니다. 인터넷 연결 후 다시 시도하세요.'
            : json.error || `재전송 실패 (${res.status})`;
        throw new Error(msg);
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      onRetried?.();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : '재전송 실패');
    } finally {
      setRetryingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dlq-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[88vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center gap-2">
          <h2 id="dlq-modal-title" className="text-lg font-bold text-gray-900">
            Firebase 동기화 실패 (DLQ)
          </h2>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
        <div className="px-4 pt-2 pb-3 text-sm text-gray-600 border-b border-gray-100">
          로컬 DB에 이미 반영된 건을 <strong className="text-gray-800">Firebase에만</strong> 다시 보냅니다. 새 주문·새 결제를
          만들지 않습니다. Void·마감·결제 동기화 등은 저장된 payload 그대로 재전송합니다.
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading && <div className="text-gray-500 text-sm">불러오는 중…</div>}
          {err && !loading && <div className="text-red-600 text-sm font-medium">{err}</div>}
          {!loading && !err && rows.length === 0 && (
            <div className="text-gray-500 text-sm">DLQ에 보관된 항목이 없습니다.</div>
          )}
          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600">
                    <th className="py-2 pr-2">ID</th>
                    <th className="py-2 pr-2">type</th>
                    <th className="py-2 pr-2">order_id</th>
                    <th className="py-2 pr-2">실패 사유</th>
                    <th className="py-2 pr-2">시각</th>
                    <th className="py-2 pr-2">payload 요약</th>
                    <th className="py-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2 font-mono">{r.id}</td>
                      <td className="py-2 pr-2 font-mono text-xs">{r.type}</td>
                      <td className="py-2 pr-2">{r.order_id != null ? r.order_id : '—'}</td>
                      <td className="py-2 pr-2 max-w-[200px] text-xs text-red-700 break-words">
                        {r.error_message || '—'}
                      </td>
                      <td className="py-2 pr-2 text-xs whitespace-nowrap">{r.created_at || '—'}</td>
                      <td className="py-2 pr-2 text-xs text-gray-600 max-w-[240px] break-all font-mono">
                        {payloadPreview(r.payload || '')}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          disabled={retryingId === r.id}
                          className="px-2 py-1 rounded bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"
                          onClick={() => handleRetry(r.id)}
                        >
                          {retryingId === r.id ? '처리 중…' : '재전송'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
