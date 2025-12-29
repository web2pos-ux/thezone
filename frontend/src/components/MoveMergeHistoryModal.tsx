import React, { useEffect, useMemo, useState } from 'react';

type MoveMergeAction = 'MOVE' | 'MERGE';

interface MoveMergeHistoryEntry {
  id: number;
  fromTableId: string;
  toTableId: string;
  actionType: MoveMergeAction;
  orderId: number | null;
  fromOrderId: number | null;
  floor: string;
  performedAt: string;
  performedBy: string | null;
}

interface MoveMergeHistoryModalProps {
  open: boolean;
  onClose: () => void;
  API_URL: string;
}

interface QueryFilters {
  actionType: 'all' | MoveMergeAction;
  floor: 'all' | string;
  limit: number;
}

const ACTION_COLORS: Record<MoveMergeAction, string> = {
  MOVE: 'bg-sky-100 text-sky-800 border border-sky-200',
  MERGE: 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200',
};

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return value;
  }
};

const normalizeEntry = (row: any): MoveMergeHistoryEntry | null => {
  const normalizeNumber = (val: any) => {
    if (val === null || val === undefined) return null;
    const parsed = Number(val);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const normalizeString = (val: any, fallback = '') => {
    if (typeof val === 'string') return val;
    if (val === null || val === undefined) return fallback;
    return String(val);
  };

  const action = normalizeString(row?.action_type ?? row?.actionType).toUpperCase();
  if (action !== 'MOVE' && action !== 'MERGE') return null;

  const id = normalizeNumber(row?.id);
  if (id == null) return null;

  const fromTable = normalizeString(row?.from_table_id ?? row?.fromTableId).trim();
  const toTable = normalizeString(row?.to_table_id ?? row?.toTableId).trim();
  if (!fromTable || !toTable) return null;

  const performedAt = normalizeString(row?.performed_at ?? row?.performedAt);
  if (!performedAt) return null;

  return {
    id,
    fromTableId: fromTable,
    toTableId: toTable,
    actionType: action as MoveMergeAction,
    orderId: normalizeNumber(row?.order_id ?? row?.orderId),
    fromOrderId: normalizeNumber(row?.from_order_id ?? row?.fromOrderId),
    floor: normalizeString(row?.floor, '1F') || '1F',
    performedAt,
    performedBy: normalizeString(row?.performed_by ?? row?.performedBy ?? '') || null,
  };
};

const buildSearchTarget = (entry: MoveMergeHistoryEntry) =>
  [
    entry.fromTableId,
    entry.toTableId,
    entry.orderId ? `#${entry.orderId}` : '',
    entry.fromOrderId ? `#${entry.fromOrderId}` : '',
    entry.floor,
    entry.actionType,
  ]
    .join(' ')
    .toLowerCase();

export const MoveMergeHistoryModal: React.FC<MoveMergeHistoryModalProps> = ({
  open,
  onClose,
  API_URL,
}) => {
  const [history, setHistory] = useState<MoveMergeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<QueryFilters>({
    actionType: 'all',
    floor: 'all',
    limit: 50,
  });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!open) return undefined;

    const controller = new AbortController();
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('limit', String(filters.limit));
        if (filters.actionType !== 'all') {
          params.set('actionType', filters.actionType);
        }
        if (filters.floor !== 'all' && filters.floor.trim()) {
          params.set('floor', filters.floor.trim());
        }

        const res = await fetch(`${API_URL}/table-operations/history?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error('히스토리를 불러오지 못했습니다.');
        }
        const json = await res.json();
        const rows: any[] = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json)
          ? json
          : [];

        const parsed = rows
          .map((row) => normalizeEntry(row))
          .filter((row): row is MoveMergeHistoryEntry => Boolean(row));
        setHistory(parsed);
      } catch (fetchError: any) {
        if (controller.signal.aborted) return;
        setError(fetchError?.message || '히스토리를 불러오지 못했습니다.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchHistory();
    return () => controller.abort();
  }, [API_URL, filters.actionType, filters.floor, filters.limit, open, refreshTick]);

  const availableFloors = useMemo(() => {
    const unique = new Set<string>();
    history.forEach((entry) => unique.add(entry.floor));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [history]);

  const filteredHistory = useMemo(() => {
    if (!search.trim()) return history;
    const keyword = search.trim().toLowerCase();
    return history.filter((entry) => buildSearchTarget(entry).includes(keyword));
  }, [history, search]);

  const stats = useMemo(() => {
    return history.reduce(
      (acc, entry) => {
        if (entry.actionType === 'MOVE') acc.move += 1;
        if (entry.actionType === 'MERGE') acc.merge += 1;
        acc.floors.add(entry.floor);
        return acc;
      },
      { move: 0, merge: 0, floors: new Set<string>() }
    );
  }, [history]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <header className="px-6 py-4 border-b flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-700 text-white">
          <div>
            <h2 className="text-2xl font-semibold">Move/Merge History</h2>
            <p className="text-sm text-white/80">
              최근 {history.length}건 · Move {stats.move} · Merge {stats.merge} · Floors{' '}
              {stats.floors.size}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRefreshTick((prev) => prev + 1)}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-white/15 border border-white/40 hover:bg-white/25 transition text-sm font-semibold disabled:opacity-50"
            >
              {loading ? '불러오는 중...' : '새로고침'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white text-slate-900 font-semibold hover:bg-slate-100 transition"
            >
              닫기
            </button>
          </div>
        </header>

        <div className="px-6 py-4 border-b bg-slate-50 flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex flex-col text-xs font-semibold text-slate-600 gap-1">
            검색
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="테이블, 주문번호, 플로어 등"
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 gap-1">
            유형
            <select
              value={filters.actionType}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  actionType: e.target.value as QueryFilters['actionType'],
                }))
              }
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">전체</option>
              <option value="MOVE">Move</option>
              <option value="MERGE">Merge</option>
            </select>
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 gap-1">
            플로어
            <select
              value={filters.floor}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  floor: e.target.value as QueryFilters['floor'],
                }))
              }
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">전체</option>
              {availableFloors.map((floor) => (
                <option key={floor} value={floor}>
                  {floor}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 gap-1">
            표시 개수
            <select
              value={filters.limit}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  limit: Math.max(10, Math.min(200, Number(e.target.value) || prev.limit)),
                }))
              }
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {[25, 50, 100, 150, 200].map((size) => (
                <option key={size} value={size}>
                  {size}개
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="p-6 text-center text-red-600 text-sm">{error}</div>
          ) : loading && history.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-sm">히스토리를 불러오는 중...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">시간</th>
                  <th className="px-4 py-3 text-left font-semibold">유형</th>
                  <th className="px-4 py-3 text-left font-semibold">플로어</th>
                  <th className="px-4 py-3 text-left font-semibold">From</th>
                  <th className="px-4 py-3 text-left font-semibold">To</th>
                  <th className="px-4 py-3 text-left font-semibold">Order</th>
                  <th className="px-4 py-3 text-left font-semibold">By</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      기록이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((entry) => (
                    <tr key={entry.id} className="even:bg-slate-50/60">
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {formatDateTime(entry.performedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${ACTION_COLORS[entry.actionType]}`}
                        >
                          {entry.actionType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{entry.floor}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {entry.fromTableId}
                        {entry.fromOrderId ? (
                          <span className="block text-xs text-slate-500">#{entry.fromOrderId}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {entry.toTableId}
                        {entry.orderId ? (
                          <span className="block text-xs text-slate-500">#{entry.orderId}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {entry.orderId ? `#${entry.orderId}` : entry.fromOrderId ? `#${entry.fromOrderId}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {entry.performedBy?.trim() || '시스템'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default MoveMergeHistoryModal;

