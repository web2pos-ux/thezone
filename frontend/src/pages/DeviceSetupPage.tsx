import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAPI_URL } from '../config/constants';

type DeviceStatus = 'pending' | 'active' | 'inactive';
type DeviceType = 'sub_pos' | 'handheld';

const DEVICE_ID_KEY = 'pos_device_id';
const DEVICE_NAME_KEY = 'pos_device_name';
const DEVICE_TYPE_KEY = 'pos_device_type';

const generateDeviceId = (type: DeviceType) => {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const prefix = type === 'handheld' ? 'HHD' : 'SUB';
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand}`;
};

const safeGetOriginLabel = () => {
  try {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  } catch {
    return '';
  }
};

const DeviceSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const from = (location?.state?.from as string) || '/intro';
  const suggestedType = (location?.state?.suggestedType as DeviceType) || 'sub_pos';

  const originLabel = useMemo(() => safeGetOriginLabel(), []);
  const apiUrl = useMemo(() => getAPI_URL(), []);

  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceName, setDeviceName] = useState<string>('');
  const [deviceType, setDeviceType] = useState<DeviceType>('sub_pos');
  const [status, setStatus] = useState<DeviceStatus>('pending');
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let id = '';
    let name = '';
    let type: DeviceType = suggestedType;
    try {
      id = localStorage.getItem(DEVICE_ID_KEY) || '';
      name = localStorage.getItem(DEVICE_NAME_KEY) || '';
      const storedType = (localStorage.getItem(DEVICE_TYPE_KEY) as DeviceType) || '';
      if (storedType === 'sub_pos' || storedType === 'handheld') type = storedType;
    } catch {}
    setDeviceType(type);
    if (!id) {
      id = generateDeviceId(type);
      try {
        localStorage.setItem(DEVICE_ID_KEY, id);
        localStorage.setItem(DEVICE_TYPE_KEY, type);
      } catch {}
    }
    setDeviceId(id);
    setDeviceName(name);
  }, [suggestedType]);

  const fetchStatus = async (id: string) => {
    const res = await fetch(`${apiUrl}/devices/${encodeURIComponent(id)}`, { cache: 'no-store' as any });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.success || !json?.device) return null;
    return json.device as { status?: DeviceStatus; device_type?: string; device_name?: string };
  };

  const sendHeartbeat = async (id: string) => {
    try {
      let nameForSend = deviceName || undefined;
      let typeForSend: DeviceType = deviceType;
      try {
        const storedName = localStorage.getItem(DEVICE_NAME_KEY) || '';
        const storedType = (localStorage.getItem(DEVICE_TYPE_KEY) as DeviceType) || '';
        if (storedName && !nameForSend) nameForSend = storedName;
        if (storedType === 'sub_pos' || storedType === 'handheld') typeForSend = storedType;
      } catch {}
      await fetch(`${apiUrl}/devices/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: id,
          device_name: nameForSend,
          device_type: typeForSend,
          os_version: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
    } catch {}
  };

  const startPolling = (id: string) => {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(async () => {
      const dev = await fetchStatus(id);
      if (!dev) return;
      if (dev.device_name && !deviceName) {
        setDeviceName(String(dev.device_name));
      }
      if (dev.status) setStatus(dev.status);
      if (dev.status === 'active') {
        setRegistered(true);
      }
    }, 2500);
  };

  const startHeartbeat = (id: string) => {
    if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = window.setInterval(() => {
      sendHeartbeat(id);
    }, 30000);
  };

  useEffect(() => {
    if (!deviceId) return;
    // If already registered earlier, try to load status and start polling.
    (async () => {
      const dev = await fetchStatus(deviceId);
      if (dev?.status) setStatus(dev.status);
      if (dev?.status === 'active') setRegistered(true);
    })();
    startPolling(deviceId);
    startHeartbeat(deviceId);
    // initial heartbeat
    sendHeartbeat(deviceId);
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]); // deviceType changes handled in register/heartbeat

  const handleRegister = async () => {
    if (!deviceId) return;
    if (!deviceName.trim()) {
      setError('디바이스 이름을 입력해주세요. (예: Counter2, Bar POS, Patio)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(DEVICE_NAME_KEY, deviceName.trim());
        localStorage.setItem(DEVICE_TYPE_KEY, deviceType);
      } catch {}
      const res = await fetch(`${apiUrl}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          device_name: deviceName.trim(),
          device_type: deviceType,
          os_version: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || '등록에 실패했습니다.');
      }
      const nextStatus = (json?.device?.status as DeviceStatus) || 'pending';
      setStatus(nextStatus);
      setRegistered(nextStatus === 'active');
      // kick polling immediately
      startPolling(deviceId);
      sendHeartbeat(deviceId);
    } catch (e: any) {
      setError(e?.message || '등록에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const canContinue = registered && status === 'active';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
          <div className="text-xl font-bold">서브POS 기기 등록</div>
          <div className="text-sm text-white/80 mt-1">
            승인된 기기만 주문/결제를 사용할 수 있습니다.
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <div className="text-slate-500">접속 주소</div>
              <div className="font-mono break-all text-right">{originLabel || '-'}</div>
            </div>
            <div className="flex justify-between gap-3 mt-2">
              <div className="text-slate-500">Device ID</div>
              <div className="font-mono break-all text-right">{deviceId || '-'}</div>
            </div>
            <div className="flex justify-between gap-3 mt-2">
              <div className="text-slate-500">상태</div>
              <div className={`font-semibold ${status === 'active' ? 'text-green-700' : status === 'inactive' ? 'text-red-700' : 'text-amber-700'}`}>
                {status === 'active' ? '승인됨(Active)' : status === 'inactive' ? '차단됨(Inactive)' : '대기중(Pending)'}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="text-sm font-semibold text-slate-700 mb-2">기기 종류</div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                disabled={busy || status === 'active'}
                onClick={() => {
                  if (status === 'active') return;
                  const next: DeviceType = 'sub_pos';
                  setDeviceType(next);
                  try { localStorage.setItem(DEVICE_TYPE_KEY, next); } catch {}
                  // If not yet approved, allow switching type (refresh device id)
                  if (status === 'pending') {
                    const nextId = generateDeviceId(next);
                    setDeviceId(nextId);
                    try { localStorage.setItem(DEVICE_ID_KEY, nextId); } catch {}
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  deviceType === 'sub_pos' ? 'bg-white shadow text-blue-700' : 'text-slate-600 hover:text-slate-800'
                } ${busy || status === 'active' ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                Sub POS
              </button>
              <button
                type="button"
                disabled={busy || status === 'active'}
                onClick={() => {
                  if (status === 'active') return;
                  const next: DeviceType = 'handheld';
                  setDeviceType(next);
                  try { localStorage.setItem(DEVICE_TYPE_KEY, next); } catch {}
                  if (status === 'pending') {
                    const nextId = generateDeviceId(next);
                    setDeviceId(nextId);
                    try { localStorage.setItem(DEVICE_ID_KEY, nextId); } catch {}
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  deviceType === 'handheld' ? 'bg-white shadow text-blue-700' : 'text-slate-600 hover:text-slate-800'
                } ${busy || status === 'active' ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                Handheld
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-2">
              * 승인(Active)된 이후에는 타입 변경을 막습니다.
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">디바이스 이름</label>
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="예: Counter2, Bar POS, Patio POS"
              className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="text-xs text-slate-500 mt-1">
              등록 후, 메인POS의 Back Office에서 승인(Active)해야 사용 가능합니다.
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRegister}
              disabled={busy || !deviceId}
              className="flex-1 px-4 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '등록 중...' : '등록 요청'}
            </button>
            <button
              onClick={() => {
                // allow retry / force refresh status
                if (!deviceId) return;
                setError(null);
                (async () => {
                  const dev = await fetchStatus(deviceId);
                  if (dev?.status) setStatus(dev.status);
                  if (dev?.status === 'active') setRegistered(true);
                  sendHeartbeat(deviceId);
                })();
              }}
              disabled={!deviceId}
              className="px-4 py-3 rounded-lg bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200"
              title="상태 새로고침"
            >
              새로고침
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            <div className="font-semibold mb-1">메인POS에서 승인하는 방법</div>
            <div className="text-slate-600">
              Back Office → <span className="font-mono">Table Devices</span> → <b>Sub POS</b> 탭에서 이 디바이스를 찾아 <b>승인(Active)</b>하세요.
            </div>
          </div>

          <button
            onClick={() => navigate(from, { replace: true })}
            disabled={!canContinue}
            className="w-full px-4 py-3 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-40"
          >
            {canContinue ? '계속 진행 (주문/결제 화면으로)' : '승인 대기 중 (Active 후 진행 가능)'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeviceSetupPage;

