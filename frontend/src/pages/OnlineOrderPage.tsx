/**
 * Online Order / Urban Piper 설정 페이지
 *
 * 설정 3가지를 한 화면에서 처리:
 *  1. Urban Piper API 자격증명 (api_key, api_secret, store_id, base_url)
 *  2. 웹훅 URL 확인 (Atlas에 등록할 URL 표시)
 *  3. Firebase 연결 상태 확인
 */

import React, { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../config/constants';

// ─── 타입 ──────────────────────────────────────────────────────────────────────
interface UpConfig {
  apiKey: string;
  apiSecret: string;
  storeId: string;
  merchantId: string;
  baseUrl: string;
  webhookUrl: string;
}

interface SaveStatus {
  type: 'idle' | 'saving' | 'success' | 'error';
  message: string;
}

interface TestStatus {
  type: 'idle' | 'testing' | 'success' | 'error';
  message: string;
}

interface FirebaseStatus {
  connected: boolean;
  restaurantId?: string;
  message?: string;
  loading: boolean;
}

const DEFAULT_BASE_URL = 'https://pos-int.urbanpiper.com/external/api/v1';

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
const OnlineOrderPage: React.FC = () => {
  const [config, setConfig] = useState<UpConfig>({
    apiKey: '',
    apiSecret: '',
    storeId: '',
    merchantId: '',
    baseUrl: DEFAULT_BASE_URL,
    webhookUrl: '',
  });

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ type: 'idle', message: '' });
  const [testStatus, setTestStatus] = useState<TestStatus>({ type: 'idle', message: '' });
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatus>({ connected: false, loading: true });
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(true);

  // 현재 서버의 베이스 URL (웹훅 URL 표시용)
  const serverBase = API_URL.replace('/api', '');
  const webhookEndpoint = `${serverBase}/api/urbanpiper/webhook`;

  // ─── 저장된 설정 불러오기 ─────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/delivery-channels`);
      if (!res.ok) return;
      const data = await res.json();
      const saved = (data.channels || []).find((c: any) => c.id === 'urbanpiper');
      if (saved) {
        setConfig(prev => ({
          ...prev,
          apiKey:     saved.api_key     || '',
          apiSecret:  saved.api_secret  || '',
          storeId:    saved.store_id    || '',
          merchantId: saved.merchant_id || '',
          baseUrl:    saved.api_endpoint || DEFAULT_BASE_URL,
          webhookUrl: saved.webhook_url || '',
        }));
      }
    } catch {
      // 무시 — 초기값 유지
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Firebase 연결 상태 확인 ──────────────────────────────────────────────────
  const checkFirebase = useCallback(async () => {
    setFirebaseStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`${API_URL}/firebase-setup/status`);
      if (res.ok) {
        const data = await res.json();
        setFirebaseStatus({
          connected: data.isConfigured === true,
          restaurantId: data.restaurantId || data.restaurant_id || '',
          message: data.isConfigured ? 'Firebase connected' : 'Firebase not configured',
          loading: false,
        });
      } else {
        setFirebaseStatus({ connected: false, message: 'Unable to check Firebase', loading: false });
      }
    } catch {
      setFirebaseStatus({ connected: false, message: 'Firebase check failed', loading: false });
    }
  }, []);

  useEffect(() => {
    loadConfig();
    checkFirebase();
  }, [loadConfig, checkFirebase]);

  // ─── 설정 저장 ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!config.apiKey.trim() || !config.apiSecret.trim()) {
      setSaveStatus({ type: 'error', message: 'API Key와 API Secret은 필수입니다.' });
      return;
    }
    setSaveStatus({ type: 'saving', message: 'Saving...' });
    try {
      const res = await fetch(`${API_URL}/delivery-channels/urbanpiper/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey:     config.apiKey.trim(),
          apiSecret:  config.apiSecret.trim(),
          storeId:    config.storeId.trim(),
          merchantId: config.merchantId.trim(),
          webhookUrl: webhookEndpoint,
          settings: {
            baseUrl: config.baseUrl.trim() || DEFAULT_BASE_URL,
            authMode: 'basic',
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        // enable도 자동으로 켜기
        await fetch(`${API_URL}/delivery-channels/urbanpiper/enable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        });
        setSaveStatus({ type: 'success', message: '✅ Urban Piper 설정이 저장되었습니다.' });
        setTimeout(() => setSaveStatus({ type: 'idle', message: '' }), 3000);
      } else {
        setSaveStatus({ type: 'error', message: data.error || 'Save failed' });
      }
    } catch (e: any) {
      setSaveStatus({ type: 'error', message: e.message || 'Network error' });
    }
  };

  // ─── 연결 테스트 ──────────────────────────────────────────────────────────────
  const handleTest = async () => {
    setTestStatus({ type: 'testing', message: 'Testing connection...' });
    try {
      const res = await fetch(`${API_URL}/delivery-channels/urbanpiper/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus({ type: 'success', message: '✅ Urban Piper 연결 성공!' });
      } else {
        setTestStatus({ type: 'error', message: `❌ ${data.error || data.message || 'Connection failed'}` });
      }
    } catch (e: any) {
      setTestStatus({ type: 'error', message: `❌ ${e.message}` });
    }
    setTimeout(() => setTestStatus({ type: 'idle', message: '' }), 5000);
  };

  // ─── 웹훅 URL 복사 ───────────────────────────────────────────────────────────
  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookEndpoint);
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // ─── 렌더링 ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Online Order Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Urban Piper 연동 및 딜리버리 채널 설정</p>
      </div>

      {/* ── 설정 1: Firebase 연결 상태 ── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700 text-sm">① Firebase 연결 상태</h2>
          <button
            onClick={checkFirebase}
            className="text-xs text-blue-600 hover:underline"
          >
            새로고침
          </button>
        </div>
        <div className="px-5 py-4">
          {firebaseStatus.loading ? (
            <p className="text-sm text-gray-400">확인 중...</p>
          ) : (
            <div className="flex items-center gap-3">
              <span className={`inline-block w-3 h-3 rounded-full ${firebaseStatus.connected ? 'bg-green-500' : 'bg-red-400'}`} />
              <div>
                <p className={`text-sm font-semibold ${firebaseStatus.connected ? 'text-green-700' : 'text-red-600'}`}>
                  {firebaseStatus.connected ? 'Connected' : 'Not Connected'}
                </p>
                {firebaseStatus.restaurantId && (
                  <p className="text-xs text-gray-500 mt-0.5">Restaurant ID: {firebaseStatus.restaurantId}</p>
                )}
                {!firebaseStatus.connected && (
                  <p className="text-xs text-gray-500 mt-1">
                    POS 앱 설정 → Firebase Setup에서 레스토랑 연결을 먼저 완료해주세요.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 설정 2: Urban Piper API 자격증명 ── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-sm">② Urban Piper API 자격증명</h2>
          <p className="text-xs text-gray-400 mt-0.5">Urban Piper (Atlas) 에서 발급받은 API 키를 입력하세요.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={config.apiKey}
              onChange={e => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="your-api-key"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* API Secret */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Secret <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={config.apiSecret}
                onChange={e => setConfig(prev => ({ ...prev, apiSecret: e.target.value }))}
                placeholder="your-api-secret"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
              >
                {showSecret ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Store ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Store ID (Biz ID)</label>
            <input
              type="text"
              value={config.storeId}
              onChange={e => setConfig(prev => ({ ...prev, storeId: e.target.value }))}
              placeholder="your-store-id"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-xs text-gray-400 mt-1">Atlas → My Account에서 확인</p>
          </div>

          {/* Merchant ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Merchant ID (선택)</label>
            <input
              type="text"
              value={config.merchantId}
              onChange={e => setConfig(prev => ({ ...prev, merchantId: e.target.value }))}
              placeholder="your-merchant-id"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={e => setConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <p className="text-xs text-gray-400 mt-1">기본값: {DEFAULT_BASE_URL}</p>
          </div>

          {/* 버튼 영역 */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saveStatus.type === 'saving'}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold py-2 transition-colors"
            >
              {saveStatus.type === 'saving' ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleTest}
              disabled={testStatus.type === 'testing'}
              className="flex-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold py-2 transition-colors"
            >
              {testStatus.type === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {/* 상태 메시지 */}
          {saveStatus.message && (
            <p className={`text-sm rounded-lg px-3 py-2 ${saveStatus.type === 'success' ? 'bg-green-50 text-green-700' : saveStatus.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'}`}>
              {saveStatus.message}
            </p>
          )}
          {testStatus.message && (
            <p className={`text-sm rounded-lg px-3 py-2 ${testStatus.type === 'success' ? 'bg-green-50 text-green-700' : testStatus.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'}`}>
              {testStatus.message}
            </p>
          )}
        </div>
      </section>

      {/* ── 설정 3: 웹훅 URL ── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-sm">③ Webhook URL (Atlas에 등록)</h2>
          <p className="text-xs text-gray-400 mt-0.5">Urban Piper 주문 상태 변경 시 이 주소로 알림이 옵니다.</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 break-all font-mono">
              {webhookEndpoint}
            </code>
            <button
              onClick={handleCopyWebhook}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {webhookCopied ? '✅ Copied' : 'Copy'}
            </button>
          </div>

          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800 space-y-1">
            <p className="font-semibold">Atlas 등록 방법:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-xs">
              <li>Atlas (<span className="font-mono">https://atlas.urbanpiper.com</span>) 로그인</li>
              <li>Settings → POS Integration 이동</li>
              <li>Webhook URL 항목에 위 URL 붙여넣기</li>
              <li>Save 클릭</li>
            </ol>
            <p className="text-xs mt-2 text-yellow-700">
              ⚠️ 로컬 테스트 환경이라면 ngrok 등으로 외부 접근 가능한 URL을 사용해야 합니다.
            </p>
          </div>
        </div>
      </section>

      {/* ── 설정 완료 체크리스트 ── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700 text-sm">설정 완료 체크리스트</h2>
        </div>
        <div className="px-5 py-4 space-y-2">
          {[
            {
              done: firebaseStatus.connected,
              label: 'Firebase 연결됨',
              hint: '설정 → Firebase Setup 완료 필요',
            },
            {
              done: Boolean(config.apiKey && config.apiSecret),
              label: 'Urban Piper API Key / Secret 입력됨',
              hint: 'Atlas → API Key 메뉴에서 발급',
            },
            {
              done: Boolean(config.storeId),
              label: 'Store ID 입력됨',
              hint: 'Atlas → My Account → Biz ID',
            },
            {
              done: false,  // 외부 설정이라 자동 확인 불가
              label: 'Atlas에 Webhook URL 등록됨',
              hint: '위 URL을 Atlas에 직접 등록해야 함',
            },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 text-base ${item.done ? 'text-green-500' : 'text-gray-300'}`}>
                {item.done ? '✅' : '⬜'}
              </span>
              <div>
                <p className={`text-sm font-medium ${item.done ? 'text-gray-800' : 'text-gray-500'}`}>
                  {item.label}
                </p>
                {!item.done && (
                  <p className="text-xs text-gray-400">{item.hint}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default OnlineOrderPage;
