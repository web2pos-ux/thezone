/**
 * 테이블 디바이스 관리 페이지
 * 테이블 오더 태블릿의 등록, 배정, 상태 모니터링
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Tablet, 
  Wifi, 
  WifiOff, 
  Battery, 
  BatteryCharging,
  BatteryLow,
  RefreshCw, 
  Trash2, 
  Link, 
  Unlink,
  AlertTriangle,
  CheckCircle,
  Clock,
  MapPin,
  MoreVertical,
  Search,
  Filter,
  Settings
} from 'lucide-react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface Device {
  id: number;
  device_id: string;
  device_name: string;
  device_type: string;
  assigned_table_id: string | null;
  assigned_table_label: string | null;
  store_id: string;
  status: 'pending' | 'active' | 'inactive';
  app_version: string | null;
  os_version: string | null;
  ip_address: string | null;
  battery_level: number | null;
  is_charging: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  is_online: boolean;
  seconds_since_seen: number;
}

interface TableElement {
  element_id: string;
  name: string;
  type: string;
}

interface DeviceStats {
  total: number;
  assigned: number;
  unassigned: number;
  pending: number;
  online: number;
  offline: number;
  low_battery: number;
}

const TableDevicesPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [unassignedTables, setUnassignedTables] = useState<TableElement[]>([]);
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 필터 상태
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // 모달 상태
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [selectedTableId, setSelectedTableId] = useState('');
  
  // 삭제 확인 모달
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<Device | null>(null);
  
  // 상세 정보 모달
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailDevice, setDetailDevice] = useState<Device | null>(null);
  
  // 데이터 로드
  const fetchData = useCallback(async () => {
    try {
      setError(null);
      
      const [devicesRes, tablesRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/devices`),
        fetch(`${API_URL}/devices/tables/unassigned`),
        fetch(`${API_URL}/devices/stats/summary`)
      ]);
      
      if (!devicesRes.ok) throw new Error('Failed to load devices');
      
      const devicesData = await devicesRes.json();
      setDevices(devicesData.devices || []);
      
      if (tablesRes.ok) {
        const tablesData = await tablesRes.json();
        setUnassignedTables(tablesData.tables || []);
      }
      
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
      }
      
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    fetchData();
    
    // 5초마다 자동 갱신
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);
  
  // 테이블 배정
  const handleAssignTable = async () => {
    if (!selectedDevice || !selectedTableId) return;
    
    try {
      const res = await fetch(`${API_URL}/devices/${selectedDevice.device_id}/assign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          table_id: selectedTableId,
          table_label: selectedTableId
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to assign table');
      }
      
      setShowAssignModal(false);
      setSelectedDevice(null);
      setSelectedTableId('');
      fetchData();
      
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // 테이블 배정 해제
  const handleUnassignTable = async (device: Device) => {
    if (!window.confirm(`Remove table assignment from "${device.device_name}"?`)) return;
    
    try {
      const res = await fetch(`${API_URL}/devices/${device.device_id}/assign`, {
        method: 'DELETE'
      });
      
      if (!res.ok) throw new Error('Failed to unassign table');
      
      fetchData();
      
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // 디바이스 삭제
  const handleDeleteDevice = async () => {
    if (!deviceToDelete) return;
    
    try {
      const res = await fetch(`${API_URL}/devices/${deviceToDelete.device_id}`, {
        method: 'DELETE'
      });
      
      if (!res.ok) throw new Error('Failed to delete device');
      
      setShowDeleteModal(false);
      setDeviceToDelete(null);
      fetchData();
      
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // 필터링된 디바이스 목록
  const filteredDevices = devices.filter(device => {
    // 상태 필터
    if (filterStatus === 'online' && !device.is_online) return false;
    if (filterStatus === 'offline' && device.is_online) return false;
    if (filterStatus === 'pending' && device.status !== 'pending') return false;
    
    // 검색어 필터
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = device.device_name?.toLowerCase().includes(query);
      const matchesId = device.device_id.toLowerCase().includes(query);
      const matchesTable = device.assigned_table_id?.toLowerCase().includes(query);
      if (!matchesName && !matchesId && !matchesTable) return false;
    }
    
    return true;
  });
  
  // 시간 포맷
  const formatLastSeen = (seconds: number) => {
    if (seconds < 60) return `${seconds}초 전`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
    return `${Math.floor(seconds / 86400)}일 전`;
  };
  
  // 배터리 아이콘
  const BatteryIcon = ({ level, charging }: { level: number | null; charging: boolean }) => {
    if (level === null) return <Battery className="w-4 h-4 text-gray-400" />;
    if (charging) return <BatteryCharging className="w-4 h-4 text-green-500" />;
    if (level < 20) return <BatteryLow className="w-4 h-4 text-red-500" />;
    return <Battery className="w-4 h-4 text-gray-600" />;
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">디바이스 목록 로딩중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* 헤더 */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
              <Tablet className="w-7 h-7 text-blue-600" />
              Table Devices
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              테이블 오더 디바이스 등록 및 관리
            </p>
          </div>
          
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            <RefreshCw className="w-4 h-4" />
            새로고침
          </button>
        </div>
      </div>
      
      {/* 통계 카드 */}
      {stats && (
        <div className="px-6 py-4 bg-white border-b">
          <div className="grid grid-cols-6 gap-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
              <p className="text-xs text-gray-500">전체</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{stats.online}</p>
              <p className="text-xs text-gray-500">온라인</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{stats.offline}</p>
              <p className="text-xs text-gray-500">오프라인</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.assigned}</p>
              <p className="text-xs text-gray-500">배정됨</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              <p className="text-xs text-gray-500">대기중</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{stats.low_battery}</p>
              <p className="text-xs text-gray-500">배터리 부족</p>
            </div>
          </div>
        </div>
      )}
      
      {/* 필터 바 */}
      <div className="px-6 py-3 bg-white border-b flex items-center gap-4">
        {/* 검색 */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="디바이스 이름, ID, 테이블 검색..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
          />
        </div>
        
        {/* 상태 필터 */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
          >
            <option value="all">전체 상태</option>
            <option value="online">🟢 온라인</option>
            <option value="offline">🔴 오프라인</option>
            <option value="pending">🟡 대기중</option>
          </select>
        </div>
      </div>
      
      {/* 디바이스 목록 */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error}</span>
          </div>
        )}
        
        {filteredDevices.length === 0 ? (
          <div className="text-center py-20">
            <Tablet className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">
              {searchQuery || filterStatus !== 'all' 
                ? '검색 결과가 없습니다' 
                : '등록된 디바이스가 없습니다'}
            </h3>
            <p className="text-gray-400 text-sm">
              테이블 오더 앱을 실행하면 자동으로 등록됩니다
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredDevices.map(device => (
              <div
                key={device.device_id}
                className={`bg-white rounded-xl shadow-sm border-2 transition-all hover:shadow-md ${
                  device.is_online 
                    ? 'border-green-200' 
                    : device.status === 'pending'
                    ? 'border-yellow-200'
                    : 'border-gray-200'
                }`}
              >
                {/* 카드 헤더 */}
                <div className="p-4 border-b flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      device.is_online ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <Tablet className={`w-5 h-5 ${
                        device.is_online ? 'text-green-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">
                        {device.device_name || device.device_id}
                      </h3>
                      <p className="text-xs text-gray-400 font-mono">
                        {device.device_id}
                      </p>
                    </div>
                  </div>
                  
                  {/* 상태 뱃지 */}
                  <div className="flex items-center gap-2">
                    {device.is_online ? (
                      <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        <Wifi className="w-3 h-3" />
                        온라인
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                        <WifiOff className="w-3 h-3" />
                        오프라인
                      </span>
                    )}
                  </div>
                </div>
                
                {/* 카드 본문 */}
                <div className="p-4 space-y-3">
                  {/* 테이블 배정 상태 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      테이블
                    </span>
                    {device.assigned_table_id ? (
                      <span className="font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                        {device.assigned_table_label || device.assigned_table_id}
                      </span>
                    ) : (
                      <span className="text-yellow-600 bg-yellow-50 px-3 py-1 rounded-lg text-sm">
                        미배정
                      </span>
                    )}
                  </div>
                  
                  {/* 배터리 */}
                  {device.battery_level !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500 flex items-center gap-2">
                        <BatteryIcon level={device.battery_level} charging={device.is_charging === 1} />
                        배터리
                      </span>
                      <span className={`font-medium ${
                        device.battery_level < 20 ? 'text-red-600' : 'text-gray-700'
                      }`}>
                        {device.battery_level}%
                        {device.is_charging === 1 && ' ⚡'}
                      </span>
                    </div>
                  )}
                  
                  {/* 마지막 접속 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      마지막 접속
                    </span>
                    <span className="text-sm text-gray-600">
                      {device.last_seen_at 
                        ? formatLastSeen(device.seconds_since_seen)
                        : '없음'}
                    </span>
                  </div>
                  
                  {/* IP 주소 */}
                  {device.ip_address && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">IP</span>
                      <span className="text-xs text-gray-500 font-mono">
                        {device.ip_address.replace('::ffff:', '')}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* 카드 푸터 - 액션 버튼 */}
                <div className="px-4 py-3 bg-gray-50 rounded-b-xl flex items-center gap-2">
                  {device.assigned_table_id ? (
                    <button
                      onClick={() => handleUnassignTable(device)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition text-sm"
                    >
                      <Unlink className="w-4 h-4" />
                      배정 해제
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setSelectedDevice(device);
                        setShowAssignModal(true);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm"
                    >
                      <Link className="w-4 h-4" />
                      테이블 배정
                    </button>
                  )}
                  
                  <button
                    onClick={() => {
                      setDetailDevice(device);
                      setShowDetailModal(true);
                    }}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition"
                    title="상세 정보"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={() => {
                      setDeviceToDelete(device);
                      setShowDeleteModal(true);
                    }}
                    className="px-3 py-2 bg-white border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition"
                    title="삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* 테이블 배정 모달 */}
      {showAssignModal && selectedDevice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold text-gray-800">테이블 배정</h3>
              <p className="text-sm text-gray-500 mt-1">
                "{selectedDevice.device_name}"에 테이블을 배정합니다
              </p>
            </div>
            
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                테이블 선택
              </label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="">테이블을 선택하세요</option>
                {/* 미배정 테이블 */}
                {unassignedTables.length > 0 && (
                  <optgroup label="미배정 테이블">
                    {unassignedTables.map(table => (
                      <option key={table.element_id} value={table.name || table.element_id}>
                        {table.name || table.element_id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* 직접 입력 안내 */}
                <optgroup label="직접 입력">
                  <option value="__custom__">직접 입력...</option>
                </optgroup>
              </select>
              
              {selectedTableId === '__custom__' && (
                <input
                  type="text"
                  placeholder="테이블 ID 입력 (예: T1, A1)"
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  className="w-full mt-3 px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
            
            <div className="p-6 bg-gray-50 rounded-b-2xl flex gap-3">
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedDevice(null);
                  setSelectedTableId('');
                }}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
              >
                취소
              </button>
              <button
                onClick={handleAssignTable}
                disabled={!selectedTableId || selectedTableId === '__custom__'}
                className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition font-medium"
              >
                배정하기
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 삭제 확인 모달 */}
      {showDeleteModal && deviceToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">디바이스 삭제</h3>
              <p className="text-gray-600">
                "{deviceToDelete.device_name}"을(를) 삭제하시겠습니까?
              </p>
              <p className="text-sm text-gray-400 mt-2">
                이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-b-2xl flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeviceToDelete(null);
                }}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
              >
                취소
              </button>
              <button
                onClick={handleDeleteDevice}
                className="flex-1 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-medium"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 상세 정보 모달 */}
      {showDetailModal && detailDevice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">디바이스 상세 정보</h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">디바이스 ID</p>
                  <p className="font-mono text-sm">{detailDevice.device_id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">디바이스 이름</p>
                  <p className="font-medium">{detailDevice.device_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">상태</p>
                  <p className={`font-medium ${
                    detailDevice.is_online ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {detailDevice.is_online ? '온라인' : '오프라인'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">배정된 테이블</p>
                  <p className="font-medium">
                    {detailDevice.assigned_table_id || '미배정'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">IP 주소</p>
                  <p className="font-mono text-sm">
                    {detailDevice.ip_address?.replace('::ffff:', '') || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">배터리</p>
                  <p className="font-medium">
                    {detailDevice.battery_level !== null 
                      ? `${detailDevice.battery_level}%${detailDevice.is_charging ? ' (충전중)' : ''}`
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">앱 버전</p>
                  <p className="font-mono text-sm">{detailDevice.app_version || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">OS 버전</p>
                  <p className="text-sm">{detailDevice.os_version || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">등록일</p>
                  <p className="text-sm">
                    {new Date(detailDevice.created_at).toLocaleString('ko-KR')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">마지막 접속</p>
                  <p className="text-sm">
                    {detailDevice.last_seen_at 
                      ? new Date(detailDevice.last_seen_at).toLocaleString('ko-KR')
                      : '-'}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setShowDetailModal(false)}
                className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableDevicesPage;
