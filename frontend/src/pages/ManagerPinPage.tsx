import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Plus, Trash2, Save } from 'lucide-react';
import Header from '../components/Header';

import { API_URL } from '../config/constants';

interface ManagerPinConfig {
  pins: string[];
  approval_limit: number;
  note_limit: number;
}

const ManagerPinPage = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ManagerPinConfig>({
    pins: [],
    approval_limit: 50000,
    note_limit: 10000
  });
  const [newPin, setNewPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/menu/manager-pins`);
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const addPin = () => {
    if (newPin.trim() && !config.pins.includes(newPin.trim())) {
      setConfig(prev => ({
        ...prev,
        pins: [...prev.pins, newPin.trim()]
      }));
      setNewPin('');
    }
  };

  const removePin = (pinToRemove: string) => {
    setConfig(prev => ({
      ...prev,
      pins: prev.pins.filter(pin => pin !== pinToRemove)
    }));
  };

  const saveConfig = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/menu/manager-pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (response.ok) {
        setMessage('설정이 저장되었습니다.');
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await response.json();
        setMessage(`오류: ${error.error}`);
      }
    } catch (error) {
      setMessage('저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <Settings className="w-6 h-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">Manager PIN 관리</h1>
            </div>
            <p className="text-gray-600 mt-2">Open Price 승인을 위한 Manager PIN과 임계값을 설정합니다.</p>
          </div>

          <div className="p-6 space-y-6">
            {/* Manager PINs */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Manager PIN 목록</h3>
              
              <div className="space-y-3">
                {config.pins.map((pin, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                    <span className="font-mono text-lg">{pin}</span>
                    <button
                      onClick={() => removePin(pin)}
                      className="text-red-600 hover:text-red-800 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex space-x-2 mt-4">
                <input
                  type="text"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                  placeholder="새 PIN 입력 (숫자만)"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={addPin}
                  disabled={!newPin.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>추가</span>
                </button>
              </div>
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  승인 필요 금액 (원)
                </label>
                <input
                  type="number"
                  value={config.approval_limit}
                  onChange={(e) => setConfig(prev => ({ ...prev, approval_limit: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
                <p className="text-xs text-gray-500 mt-1">이 금액 이상일 때 Manager PIN이 필요합니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  메모 필요 금액 (원)
                </label>
                <input
                  type="number"
                  value={config.note_limit}
                  onChange={(e) => setConfig(prev => ({ ...prev, note_limit: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
                <p className="text-xs text-gray-500 mt-1">이 금액 이상일 때 메모 입력이 필요합니다.</p>
              </div>
            </div>

            {/* Message */}
            {message && (
              <div className={`p-3 rounded-md ${message.includes('오류') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {message}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => navigate('/backoffice/menu')}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={saveConfig}
                disabled={loading || config.pins.length === 0}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 flex items-center space-x-2"
              >
                <Save className="w-4 h-4" />
                <span>{loading ? '저장 중...' : '저장'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManagerPinPage;