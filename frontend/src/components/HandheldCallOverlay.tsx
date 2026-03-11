/**
 * 핸드헬드 모드에서 Call Server 알림을 항상 표시하는 전역 오버레이
 * 핸드헬드 모드가 활성화되어 있으면 SalesPage, OrderPage 등 어디서든 표시됨
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X, Check, Clock } from 'lucide-react';
import { usePosSocket } from '../hooks/usePosSocket';

const HANDHELD_MODE_KEY = 'handheld-mode-active';

interface HandheldConfig {
  active: boolean;
  posHost: string;
}

const HandheldCallOverlay: React.FC = () => {
  const [config, setConfig] = useState<HandheldConfig | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    const check = () => {
      try {
        const raw = localStorage.getItem(HANDHELD_MODE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.active) {
            setConfig(parsed);
            return;
          }
        }
      } catch {}
      setConfig(null);
    };

    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const {
    activeCalls,
    acknowledgeCall,
    dismissCall
  } = usePosSocket({
    serverUrl: config?.posHost || '',
    deviceType: 'handheld',
    deviceName: 'Handheld',
    onCallServerRequest: (call) => {
      setNotification(`🔔 ${call.table_label}: ${call.message}`);
      setShowPanel(true);
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    },
  });

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  if (!config) return null;

  return (
    <>
      {/* 알림 배지 */}
      {activeCalls.length > 0 && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed top-3 right-3 z-[9999] flex items-center gap-2 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-lg transition animate-pulse"
        >
          <Bell className="w-5 h-5" />
          <span className="font-bold text-sm">{activeCalls.length}</span>
        </button>
      )}

      {/* 토스트 알림 */}
      {notification && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 bg-green-600 text-white rounded-xl shadow-xl text-sm font-medium max-w-md text-center">
          {notification}
        </div>
      )}

      {/* Call 패널 */}
      {showPanel && (
        <div className="fixed inset-0 z-[9998] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowPanel(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="bg-red-500 p-4 text-white flex items-center justify-between rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Bell className="w-6 h-6" />
                <h3 className="text-lg font-bold">Call Requests ({activeCalls.length})</h3>
              </div>
              <button onClick={() => setShowPanel(false)} className="p-1 hover:bg-red-600 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeCalls.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Bell className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>No active calls</p>
                </div>
              ) : (
                activeCalls.map(call => (
                  <div
                    key={call.id}
                    className={`p-4 rounded-xl border-2 ${
                      call.status === 'acknowledged'
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl font-bold text-gray-800 dark:text-white">{call.table_label}</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        call.status === 'acknowledged' ? 'bg-green-500 text-white' : 'bg-amber-500 text-white'
                      }`}>
                        {call.status === 'acknowledged' ? 'Done' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-300 mb-3">{call.message}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(call.created_at).toLocaleTimeString()}
                      </span>
                      <div className="flex gap-2">
                        {call.status !== 'acknowledged' && (
                          <button
                            onClick={() => acknowledgeCall(call.id, 'Handheld')}
                            className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 flex items-center gap-1"
                          >
                            <Check className="w-4 h-4" /> Ack
                          </button>
                        )}
                        <button
                          onClick={() => dismissCall(call.id)}
                          className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HandheldCallOverlay;
