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
  Settings,
  Video,
  Plus,
  X,
  Calendar,
  Edit2,
  Save,
  Cloud,
  CloudDownload,
  CloudUpload
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

interface SeasonalVideo {
  id?: number;
  name: string;
  video_url: string;
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
  is_active: number;
  firebase_url?: string;
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
  
  // 탭 상태 (devices | videos | firebase)
  const [activeTab, setActiveTab] = useState<'devices' | 'videos' | 'firebase'>('devices');
  
  // 시즌 영상 상태
  const [seasonalVideos, setSeasonalVideos] = useState<SeasonalVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [editingVideo, setEditingVideo] = useState<SeasonalVideo | null>(null);
  const [videoForm, setVideoForm] = useState<SeasonalVideo>({
    name: '',
    video_url: '',
    start_month: 1,
    start_day: 1,
    end_month: 12,
    end_day: 31,
    is_active: 1
  });
  
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
  
  // 시즌 영상 로드
  const fetchSeasonalVideos = useCallback(async () => {
    try {
      setLoadingVideos(true);
      const res = await fetch(`${API_URL}/table-orders/seasonal-videos`);
      if (res.ok) {
        const data = await res.json();
        setSeasonalVideos(data.videos || []);
      }
    } catch (err) {
      console.error('Failed to load seasonal videos:', err);
    } finally {
      setLoadingVideos(false);
    }
  }, []);
  
  useEffect(() => {
    fetchData();
    fetchSeasonalVideos();
    fetchFirebaseVideos();
    
    // 5초마다 자동 갱신
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData, fetchSeasonalVideos]);
  
  // 시즌 영상 저장
  const handleSaveVideo = async () => {
    try {
      if (!videoForm.name) {
        alert('Please enter a season name');
        return;
      }
      
      if (editingVideo?.id) {
        // 수정
        const res = await fetch(`${API_URL}/table-orders/seasonal-videos/${editingVideo.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(videoForm)
        });
        if (!res.ok) throw new Error('Failed to update video');
      } else {
        // 추가
        const res = await fetch(`${API_URL}/table-orders/seasonal-videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(videoForm)
        });
        if (!res.ok) throw new Error('Failed to add video');
      }
      
      setShowVideoModal(false);
      setEditingVideo(null);
      setVideoForm({
        name: '',
        video_url: '',
        start_month: 1,
        start_day: 1,
        end_month: 12,
        end_day: 31,
        is_active: 1
      });
      fetchSeasonalVideos();
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // 시즌 영상 삭제
  const handleDeleteVideo = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this video?')) return;
    
    try {
      const res = await fetch(`${API_URL}/table-orders/seasonal-videos/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete video');
      fetchSeasonalVideos();
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // 시즌 영상 편집 시작
  const startEditVideo = (video: SeasonalVideo) => {
    setEditingVideo(video);
    setVideoForm({ ...video });
    setShowVideoModal(true);
  };
  
  // 새 영상 추가 시작
  const startAddVideo = () => {
    setEditingVideo(null);
    setVideoForm({
      name: '',
      video_url: '',
      start_month: 1,
      start_day: 1,
      end_month: 12,
      end_day: 31,
      is_active: 1
    });
    setShowVideoModal(true);
  };
  
  // 월 이름 배열
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Firebase 동기화 상태
  const [syncingFromFirebase, setSyncingFromFirebase] = useState(false);
  const [syncingToFirebase, setSyncingToFirebase] = useState(false);
  
  // 비디오 업로드 상태
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingToFirebaseStorage, setUploadingToFirebaseStorage] = useState(false);
  
  // Firebase Storage 비디오 상태
  const [firebaseVideos, setFirebaseVideos] = useState<any[]>([]);
  const [loadingFirebaseVideos, setLoadingFirebaseVideos] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState<string | null>(null);
  
  // Firebase에서 시즌 영상 가져오기
  const handleSyncFromFirebase = async () => {
    const restaurantId = prompt('Enter Firebase Restaurant ID:');
    if (!restaurantId) return;
    
    setSyncingFromFirebase(true);
    try {
      const res = await fetch(`${API_URL}/table-orders/seasonal-videos/sync-from-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Sync failed');
      }
      
      const data = await res.json();
      alert(`Successfully synced ${data.synced_count} videos from Firebase`);
      fetchSeasonalVideos();
    } catch (err: any) {
      alert('Sync failed: ' + err.message);
    } finally {
      setSyncingFromFirebase(false);
    }
  };
  
  // Firebase로 시즌 영상 업로드
  const handleSyncToFirebase = async () => {
    const restaurantId = prompt('Enter Firebase Restaurant ID:');
    if (!restaurantId) return;
    
    setSyncingToFirebase(true);
    try {
      const res = await fetch(`${API_URL}/table-orders/seasonal-videos/sync-to-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: restaurantId })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }
      
      const data = await res.json();
      alert(`Successfully uploaded ${data.uploaded_count} videos to Firebase`);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setSyncingToFirebase(false);
    }
  };
  
  // 비디오 파일 업로드 (로컬)
  const handleVideoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingVideo(true);
    try {
      const formData = new FormData();
      formData.append('video', file);
      
      const res = await fetch(`${API_URL}/table-orders/upload-video`, {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }
      
      const data = await res.json();
      setVideoForm({ ...videoForm, video_url: data.video_url });
      alert('Video uploaded successfully!');
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingVideo(false);
      e.target.value = '';
    }
  };
  
  // 로컬 비디오를 Firebase Storage에 업로드
  const handleUploadToFirebaseStorage = async (filename: string) => {
    setUploadingToFirebaseStorage(true);
    try {
      const res = await fetch(`${API_URL}/table-orders/firebase-storage/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload to Firebase failed');
      }
      
      const data = await res.json();
      setVideoForm({ ...videoForm, firebase_url: data.firebase_url });
      alert('Uploaded to Firebase Storage successfully!');
      fetchFirebaseVideos();
    } catch (err: any) {
      alert('Firebase upload failed: ' + err.message);
    } finally {
      setUploadingToFirebaseStorage(false);
    }
  };
  
  // Firebase Storage 비디오 목록 로드
  const fetchFirebaseVideos = async () => {
    setLoadingFirebaseVideos(true);
    try {
      const res = await fetch(`${API_URL}/table-orders/firebase-storage/list`);
      if (res.ok) {
        const data = await res.json();
        setFirebaseVideos(data.videos || []);
      }
    } catch (err) {
      console.error('Failed to load Firebase videos:', err);
    } finally {
      setLoadingFirebaseVideos(false);
    }
  };
  
  // Firebase Storage에서 로컬로 다운로드
  const handleDownloadFromFirebase = async (firebasePath: string) => {
    setDownloadingVideo(firebasePath);
    try {
      const res = await fetch(`${API_URL}/table-orders/firebase-storage/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebase_path: firebasePath })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Download failed');
      }
      
      const data = await res.json();
      alert(`Downloaded successfully!\nLocal URL: ${data.local_url}`);
    } catch (err: any) {
      alert('Download failed: ' + err.message);
    } finally {
      setDownloadingVideo(null);
    }
  };
  
  // Firebase Storage 비디오 삭제
  const handleDeleteFirebaseVideo = async (firebasePath: string) => {
    if (!window.confirm('Are you sure you want to delete this video from Firebase?')) return;
    
    try {
      const res = await fetch(`${API_URL}/table-orders/firebase-storage/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebase_path: firebasePath })
      });
      
      if (!res.ok) throw new Error('Delete failed');
      
      fetchFirebaseVideos();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };
  
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
            onClick={() => activeTab === 'videos' ? fetchSeasonalVideos() : fetchData()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            <RefreshCw className="w-4 h-4" />
            새로고침
          </button>
        </div>
        
        {/* 탭 */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveTab('devices')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === 'devices'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Tablet className="w-4 h-4 inline mr-2" />
            Devices
          </button>
          <button
            onClick={() => setActiveTab('videos')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === 'videos'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Video className="w-4 h-4 inline mr-2" />
            Seasonal Videos
          </button>
          <button
            onClick={() => {
              setActiveTab('firebase');
              fetchFirebaseVideos();
            }}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === 'firebase'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Cloud className="w-4 h-4 inline mr-2" />
            Firebase Storage
          </button>
        </div>
      </div>
      
      {/* 탭 콘텐츠: Devices */}
      {activeTab === 'devices' && (
        <>
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
        </>
      )}
      
      {/* 탭 콘텐츠: Seasonal Videos */}
      {activeTab === 'videos' && (
        <div className="flex-1 overflow-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-800">Seasonal Videos</h2>
              <p className="text-sm text-gray-500">테이블오더에서 주문 완료 후 표시할 시즌 영상을 설정합니다</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncFromFirebase}
                disabled={syncingFromFirebase}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-gray-300 transition"
                title="Firebase에서 영상 설정 가져오기"
              >
                <CloudDownload className={`w-4 h-4 ${syncingFromFirebase ? 'animate-spin' : ''}`} />
                {syncingFromFirebase ? 'Syncing...' : 'From Firebase'}
              </button>
              <button
                onClick={handleSyncToFirebase}
                disabled={syncingToFirebase}
                className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:bg-gray-300 transition"
                title="Firebase로 영상 설정 업로드"
              >
                <CloudUpload className={`w-4 h-4 ${syncingToFirebase ? 'animate-spin' : ''}`} />
                {syncingToFirebase ? 'Uploading...' : 'To Firebase'}
              </button>
              <button
                onClick={startAddVideo}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
              >
                <Plus className="w-4 h-4" />
                Add Video
              </button>
            </div>
          </div>
          
          {loadingVideos ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Loading...</p>
            </div>
          ) : seasonalVideos.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border-2 border-dashed border-gray-200">
              <Video className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">No seasonal videos</h3>
              <p className="text-gray-400 text-sm mb-6">시즌별 영상을 추가하여 주문 완료 화면을 꾸며보세요</p>
              <button
                onClick={startAddVideo}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
              >
                <Plus className="w-4 h-4 inline mr-2" />
                Add First Video
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {seasonalVideos.map((video) => (
                <div
                  key={video.id}
                  className={`bg-white rounded-xl shadow-sm border-2 ${
                    video.is_active ? 'border-green-200' : 'border-gray-200 opacity-60'
                  }`}
                >
                  {/* 영상 미리보기 */}
                  <div className="aspect-video bg-gray-100 rounded-t-xl overflow-hidden relative">
                    {video.video_url || video.firebase_url ? (
                      <video
                        src={video.video_url || video.firebase_url}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="w-12 h-12 text-gray-300" />
                      </div>
                    )}
                    {!video.is_active && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="text-white font-medium px-3 py-1 bg-red-500 rounded">Disabled</span>
                      </div>
                    )}
                  </div>
                  
                  {/* 정보 */}
                  <div className="p-4">
                    <h3 className="font-bold text-gray-800 mb-2">{video.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                      <Calendar className="w-4 h-4" />
                      <span>
                        {months[video.start_month - 1]} {video.start_day} ~ {months[video.end_month - 1]} {video.end_day}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 truncate mb-4">
                      {video.video_url || video.firebase_url || 'No video URL'}
                    </div>
                    
                    {/* 액션 버튼 */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditVideo(video)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => video.id && handleDeleteVideo(video.id)}
                        className="px-3 py-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* 탭 콘텐츠: Firebase Storage */}
      {activeTab === 'firebase' && (
        <div className="flex-1 overflow-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-800">Firebase Storage Videos</h2>
              <p className="text-sm text-gray-500">Firebase Storage에 저장된 비디오를 관리합니다</p>
            </div>
            <button
              onClick={fetchFirebaseVideos}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFirebaseVideos ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          
          {loadingFirebaseVideos ? (
            <div className="text-center py-12">
              <RefreshCw className="w-8 h-8 text-orange-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Loading Firebase Storage...</p>
            </div>
          ) : firebaseVideos.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border-2 border-dashed border-gray-200">
              <Cloud className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">No videos in Firebase Storage</h3>
              <p className="text-gray-400 text-sm">Seasonal Videos 탭에서 영상을 업로드한 후 Firebase에 업로드하세요</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {firebaseVideos.map((video) => (
                <div key={video.name} className="bg-white rounded-xl shadow-sm border-2 border-orange-200">
                  {/* 영상 미리보기 */}
                  <div className="aspect-video bg-gray-100 rounded-t-xl overflow-hidden relative">
                    <video
                      src={video.url}
                      className="w-full h-full object-cover"
                      muted
                    />
                    <div className="absolute top-2 right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded">
                      Firebase
                    </div>
                  </div>
                  
                  {/* 정보 */}
                  <div className="p-4">
                    <h3 className="font-bold text-gray-800 mb-2 truncate" title={video.name}>
                      {video.name.split('/').pop()}
                    </h3>
                    <div className="text-xs text-gray-500 mb-2">
                      Size: {(video.size / (1024 * 1024)).toFixed(2)} MB
                    </div>
                    <div className="text-xs text-gray-400 truncate mb-4" title={video.url}>
                      {video.url}
                    </div>
                    
                    {/* 액션 버튼 */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownloadFromFirebase(video.name)}
                        disabled={downloadingVideo === video.name}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition disabled:opacity-50"
                      >
                        <CloudDownload className={`w-4 h-4 ${downloadingVideo === video.name ? 'animate-spin' : ''}`} />
                        {downloadingVideo === video.name ? 'Downloading...' : 'Download'}
                      </button>
                      <button
                        onClick={() => handleDeleteFirebaseVideo(video.name)}
                        className="px-3 py-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {/* URL 복사 버튼 */}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(video.url);
                        alert('URL copied to clipboard!');
                      }}
                      className="w-full mt-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition text-sm"
                    >
                      📋 Copy URL
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* 영상 추가/수정 모달 */}
      {showVideoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800">
                  {editingVideo ? 'Edit Video' : 'Add Seasonal Video'}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  시즌별로 표시할 영상과 기간을 설정하세요
                </p>
              </div>
              <button
                onClick={() => setShowVideoModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {/* 시즌 이름 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Season Name</label>
                <input
                  type="text"
                  value={videoForm.name}
                  onChange={(e) => setVideoForm({ ...videoForm, name: e.target.value })}
                  placeholder="예: Summer, Winter, Holiday"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
              
              {/* 영상 URL + 업로드 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Video URL (Local or Firebase)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={videoForm.video_url}
                    onChange={(e) => setVideoForm({ ...videoForm, video_url: e.target.value })}
                    placeholder="예: /uploads/videos/xxx.mp4 또는 https://..."
                    className="flex-1 px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                  <label className="px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 cursor-pointer transition flex items-center gap-2">
                    <CloudUpload className="w-4 h-4" />
                    Upload
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={handleVideoFileUpload}
                    />
                  </label>
                </div>
                {uploadingVideo && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Uploading video...
                  </div>
                )}
                {videoForm.video_url && videoForm.video_url.startsWith('/uploads/videos/') && (
                  <button
                    type="button"
                    onClick={() => {
                      const filename = videoForm.video_url.split('/').pop();
                      if (filename) handleUploadToFirebaseStorage(filename);
                    }}
                    disabled={uploadingToFirebaseStorage}
                    className="mt-2 flex items-center gap-2 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition text-sm"
                  >
                    <Cloud className="w-4 h-4" />
                    {uploadingToFirebaseStorage ? 'Uploading to Firebase...' : 'Upload to Firebase Storage'}
                  </button>
                )}
              </div>
              
              {/* 기간 설정 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <div className="flex gap-2">
                    <select
                      value={videoForm.start_month}
                      onChange={(e) => setVideoForm({ ...videoForm, start_month: parseInt(e.target.value) })}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                    >
                      {months.map((m, i) => (
                        <option key={i} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={videoForm.start_day}
                      onChange={(e) => setVideoForm({ ...videoForm, start_day: parseInt(e.target.value) || 1 })}
                      className="w-16 px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-center"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <div className="flex gap-2">
                    <select
                      value={videoForm.end_month}
                      onChange={(e) => setVideoForm({ ...videoForm, end_month: parseInt(e.target.value) })}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                    >
                      {months.map((m, i) => (
                        <option key={i} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={videoForm.end_day}
                      onChange={(e) => setVideoForm({ ...videoForm, end_day: parseInt(e.target.value) || 1 })}
                      className="w-16 px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none text-center"
                    />
                  </div>
                </div>
              </div>
              
              {/* 활성화 */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={videoForm.is_active === 1}
                  onChange={(e) => setVideoForm({ ...videoForm, is_active: e.target.checked ? 1 : 0 })}
                  className="w-5 h-5 rounded border-gray-300"
                />
                <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
                  Enable this seasonal video
                </label>
              </div>
            </div>
            
            <div className="p-6 bg-gray-50 rounded-b-2xl flex gap-3">
              <button
                onClick={() => setShowVideoModal(false)}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVideo}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition font-medium"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableDevicesPage;
