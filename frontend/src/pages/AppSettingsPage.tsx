import React, { useEffect, useState, useCallback } from 'react';
import { API_URL, API_BASE } from '../config/constants';
import { clearSettingsCache, loadSettings } from '../config/settings';

interface AppSetting {
  key: string;
  value: string;
  description?: string;
  editable?: boolean;
}

const DEFAULT_SETTINGS: AppSetting[] = [
  { key: 'api_url', value: 'http://localhost:3177/api', description: 'API 서버 URL', editable: true },
  { key: 'api_base', value: 'http://localhost:3177', description: 'API Base URL (이미지 등)', editable: true },
  { key: 'backend_port', value: '3177', description: '백엔드 서버 포트', editable: true },
];

const AppSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // 설정 로드
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/app-settings`);
      if (!response.ok) throw new Error('설정을 불러오는데 실패했습니다.');
      
      const data = await response.json();
      
      // API 응답을 배열로 변환
      const settingsArray: AppSetting[] = Object.entries(data).map(([key, value]) => ({
        key,
        value: value as string,
        description: DEFAULT_SETTINGS.find(s => s.key === key)?.description || '',
        editable: true,
      }));

      // 기본 설정이 없으면 추가
      DEFAULT_SETTINGS.forEach(def => {
        if (!settingsArray.find(s => s.key === def.key)) {
          settingsArray.push(def);
        }
      });

      setSettings(settingsArray.sort((a, b) => a.key.localeCompare(b.key)));
    } catch (err: any) {
      setError(err.message);
      // 오류 시 기본값 표시
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // 설정 저장
  const handleSave = async (key: string, value: string) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`${API_URL}/app-settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });

      if (!response.ok) throw new Error('설정 저장에 실패했습니다.');

      // 캐시 초기화 및 재로드
      clearSettingsCache();
      await loadSettings();
      
      setSuccess(`"${key}" 설정이 저장되었습니다.`);
      setEditingKey(null);
      await fetchSettings();

      // 3초 후 성공 메시지 제거
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 새 설정 추가
  const handleAddSetting = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      setError('키와 값을 모두 입력해주세요.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/app-settings/${newKey.trim()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newValue.trim(), description: newDesc.trim() || undefined }),
      });

      if (!response.ok) throw new Error('설정 추가에 실패했습니다.');

      clearSettingsCache();
      await loadSettings();
      
      setSuccess(`"${newKey}" 설정이 추가되었습니다.`);
      setNewKey('');
      setNewValue('');
      setNewDesc('');
      setShowAddForm(false);
      await fetchSettings();

      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 편집 시작
  const startEdit = (setting: AppSetting) => {
    setEditingKey(setting.key);
    setEditValue(setting.value);
  };

  // 편집 취소
  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  // 현재 활성 설정 표시
  const CurrentSettings = () => (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-medium text-blue-800 mb-2">📡 현재 활성 설정</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-gray-500">API_URL:</span>
          <span className="ml-2 font-mono text-blue-700">{API_URL}</span>
        </div>
        <div>
          <span className="text-gray-500">API_BASE:</span>
          <span className="ml-2 font-mono text-blue-700">{API_BASE}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        * 설정 변경 후 페이지 새로고침 시 적용됩니다.
      </p>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">⚙️ 시스템 설정</h1>
        <p className="text-gray-500 mt-1">
          API URL, 포트 등 시스템 설정을 관리합니다. 설정은 데이터베이스에 저장됩니다.
        </p>
      </div>

      {/* 알림 메시지 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-center">
          <span className="text-red-600">❌ {error}</span>
          <button 
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 flex items-center">
          <span className="text-green-600">✅ {success}</span>
        </div>
      )}

      {/* 현재 활성 설정 */}
      <CurrentSettings />

      {/* 설정 목록 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-700">📋 저장된 설정</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1.5 bg-blue-500 text-white rounded-md text-sm hover:bg-blue-600 transition-colors"
          >
            {showAddForm ? '취소' : '+ 새 설정 추가'}
          </button>
        </div>

        {/* 새 설정 추가 폼 */}
        {showAddForm && (
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">키 (영문)</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="setting_key"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">값</label>
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="설정값"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">설명 (선택)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="설명"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleAddSetting}
                    disabled={saving}
                    className="px-4 py-2 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 disabled:opacity-50 transition-colors"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 로딩 */}
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
            설정 로딩 중...
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">
                  키
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  값
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">
                  설명
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                  작업
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {settings.map((setting) => (
                <tr key={setting.key} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <code className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-800">
                      {setting.key}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    {editingKey === setting.key ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full px-3 py-2 border border-blue-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave(setting.key, editValue);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                    ) : (
                      <span className="text-sm font-mono text-gray-700 break-all">
                        {setting.value}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {setting.description || '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingKey === setting.key ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleSave(setting.key, editValue)}
                          disabled={saving}
                          className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 disabled:opacity-50"
                        >
                          저장
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(setting)}
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                      >
                        편집
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {settings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                    저장된 설정이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 도움말 */}
      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-yellow-800 mb-2">💡 도움말</h3>
        <ul className="text-sm text-yellow-700 space-y-1">
          <li>• <strong>api_url</strong>: 프론트엔드에서 API 호출 시 사용되는 기본 URL</li>
          <li>• <strong>api_base</strong>: 이미지 URL 등에 사용되는 Base URL (api 없이)</li>
          <li>• <strong>backend_port</strong>: 백엔드 서버 포트 번호</li>
          <li className="mt-2 text-yellow-600">
            ⚠️ 설정 변경 후 <strong>페이지 새로고침</strong> 또는 <strong>앱 재시작</strong>이 필요합니다.
          </li>
        </ul>
      </div>

      {/* 새로고침 버튼 */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
        >
          🔄 페이지 새로고침
        </button>
      </div>
    </div>
  );
};

export default AppSettingsPage;
