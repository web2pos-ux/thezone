import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, DragEndEvent, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import '../styles/scrollbar.css';
import ReservationCreateModal from '../components/reservations/ReservationCreateModal';
import VirtualKeyboard from '../components/order/VirtualKeyboard';
import { API_URL } from '../config/constants';
import { formatNameForDisplay, parseCustomerName } from '../utils/nameParser';
import { getLocalDateString, getLocalDatetimeString } from '../utils/datetimeUtils';
import { assignDailySequenceNumbers } from '../utils/orderSequence';


// 슬라이더 스타일
const sliderStyles = `
  .slider::-webkit-slider-thumb {
    appearance: none;
    height: 44px;
    width: 44px;
    border-radius: 50%;
    background: #3B82F6;
    cursor: pointer;
    border: 4px solid #ffffff;
    box-shadow: 0 6px 16px rgba(0,0,0,0.4);
  }
  
  .slider::-moz-range-thumb {
    height: 44px;
    width: 44px;
    border-radius: 50%;
    background: #3B82F6;
    cursor: pointer;
    border: 4px solid #ffffff;
    box-shadow: 0 6px 16px rgba(0,0,0,0.4);
  }
  
  .slider::-webkit-slider-track {
    background: transparent;
  }
  
  .slider::-moz-range-track {
    background: transparent;
  }
`;

interface TableElement {
  id: number;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number; // 회전 각도 (도 단위)
  text?: string; // 텍스트 내용
  fontSize?: number; // 폰트 크기 (px)
  color?: string; // 색상
  status?: string; // 테이블 상태 (Available, Occupied, Preparing, Reserved)
}

interface HistoryState {
  tableElements: TableElement[];
  timestamp: number;
}

interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  isActive: boolean;
}

interface CallNotification {
  id: string;
  tableNumber: string;
  channel: 'table-map' | 'togo' | 'delivery' | 'online';
  timestamp: Date;
  message: string;
}

interface OrderNotification {
  id: string;
  tableNumber: string;
  channel: 'table-map' | 'togo' | 'delivery' | 'online';
  timestamp: Date;
  message: string;
  orderItems?: string[];
}

// Manager Panel for Basic Info & Business Hours
const ManagerPanel: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [profile, setProfile] = useState<any>({
    business_name: '',
    tax_number: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip: '',
    logo_url: ''
  });
  const [hours, setHours] = useState<Array<{ day_of_week: number; open_time: string; close_time: string; is_open: number }>>([]);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [p, h] = await Promise.all([
          fetch(`${API_URL}/admin-settings/business-profile`).then(r=>r.json()).catch(()=>null),
          fetch(`${API_URL}/admin-settings/business-hours`).then(r=>r.json()).catch(()=>[])
        ]);
        if (p) setProfile(p);
        if (Array.isArray(h)) setHours(h);
      } finally {
        setLoading(false);
      }
    })();
  }, []);


  const updateHour = (idx: number, field: 'is_open'|'open_time'|'close_time', value: any) => {
    setHours(prev => {
      const copy = [...prev];
      if (!copy[idx]) copy[idx] = { day_of_week: idx, open_time: '11:00', close_time: '21:00', is_open: 1 } as any;
      copy[idx] = { ...copy[idx], [field]: field==='is_open' ? (value ? 1 : 0) : value } as any;
      return copy;
    });
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/admin-settings/business-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify(profile)
      });
      alert('기본 정보가 저장되었습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    const res = await fetch(`${API_URL}/admin-settings/business-profile/logo`, { method:'POST', headers: { 'X-Role': 'MANAGER' as any }, body: fd as any });
    const data = await res.json();
    if (data?.imageUrl) setProfile((p:any)=>({ ...p, logo_url: data.imageUrl }));
  };

  const handleSaveHours = async () => {
    const payload = (hours && hours.length ? hours : Array.from({length:7}).map((_,i)=>({ day_of_week:i, open_time:'11:00', close_time:'21:00', is_open:1 })));
    await fetch(`${API_URL}/admin-settings/business-hours`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ businessHours: payload }) });
    alert('영업 시간이 저장되었습니다.');
  };

  return (
    <div className="w-full h-full overflow-y-auto p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <h2 className="text-xl font-bold">Business Info</h2>
        <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="col-span-1 md:col-span-3">
            <label className="block text-sm text-gray-600 mb-1">비즈니스 이름</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.business_name||''} onChange={e=>setProfile({...profile, business_name:e.target.value})} placeholder="상호명" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">세금번호</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.tax_number||''} onChange={e=>setProfile({...profile, tax_number:e.target.value})} placeholder="Tax ID" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">전화번호</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.phone||''} onChange={e=>setProfile({...profile, phone:e.target.value})} placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">우편번호</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.zip||''} onChange={e=>setProfile({...profile, zip:e.target.value})} placeholder="우편번호" />
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm text-gray-600 mb-1">주소 1</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.address_line1||''} onChange={e=>setProfile({...profile, address_line1:e.target.value})} placeholder="도로명/지번" />
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm text-gray-600 mb-1">주소 2</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.address_line2||''} onChange={e=>setProfile({...profile, address_line2:e.target.value})} placeholder="상세주소" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">City</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.city||''} onChange={e=>setProfile({...profile, city:e.target.value})} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">State</label>
            <input className="w-full px-3 py-2 border rounded" value={profile.state||''} onChange={e=>setProfile({...profile, state:e.target.value})} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Logo</label>
            <div className="flex items-center gap-3">
              {profile.logo_url ? (
                <img src={profile.logo_url} alt="logo" className="w-16 h-16 object-contain border" />
              ) : (
                <div className="w-16 h-16 border flex items-center justify-center text-xs text-gray-400">No Logo</div>
              )}
              <input type="file" accept="image/*" onChange={e=>{ const f=e.target.files?.[0]; if (f) handleUploadLogo(f); }} />
            </div>
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50" onClick={handleSaveProfile}>저장</button>
          </div>
        </div>

        <h2 className="text-xl font-bold">Business Hours</h2>
        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          {Array.from({length:7}).map((_, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-2 text-sm font-medium text-gray-700">{days[i]}</div>
              <div className="col-span-2">
                <label className="mr-2 text-sm text-gray-600">Open</label>
                <input type="checkbox" checked={(hours.find(h=>h.day_of_week===i)?.is_open||0)===1} onChange={e=>updateHour(i,'is_open',e.target.checked)} />
              </div>
              <div className="col-span-4 flex items-center gap-2">
                <input type="time" className="px-2 py-1 border rounded" value={hours.find(h=>h.day_of_week===i)?.open_time||'11:00'} onChange={e=>updateHour(i,'open_time',e.target.value)} />
                <span className="text-gray-500">~</span>
                <input type="time" className="px-2 py-1 border rounded" value={hours.find(h=>h.day_of_week===i)?.close_time||'21:00'} onChange={e=>updateHour(i,'close_time',e.target.value)} />
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={handleSaveHours}>영업시간 저장</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const TableMapManagerPage = () => {
  const navigate = useNavigate();
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [mapLocked, setMapLocked] = useState<boolean>(() => {
    try { return (localStorage.getItem('table_map_locked') || '0') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('table_map_locked', mapLocked ? '1' : '0'); } catch {} }, [mapLocked]);
  

  
  // localStorage에서 저장된 화면 크기 불러오기
  const getSavedScreenSize = () => {
    const savedWidth = localStorage.getItem('tableMapScreenWidth');
    const savedHeight = localStorage.getItem('tableMapScreenHeight');
    return {
      width: savedWidth || '1920',
      height: savedHeight || '1080'
    };
  };

  // localStorage에서 저장된 Floor 불러오기
  const getSavedFloor = () => {
    const savedFloor = localStorage.getItem('tableMapSelectedFloor');
    return savedFloor || '1F';
  };

  // localStorage에서 저장된 Floor 목록 불러오기
  const getSavedFloorList = () => {
    const savedFloorList = localStorage.getItem('tableMapFloorList');
    if (savedFloorList) {
      try {
        return JSON.parse(savedFloorList);
      } catch (error) {
        console.error('Error parsing saved floor list:', error);
        return ['1F', '2F', '3F', 'Patio'];
      }
    }
    return ['1F', '2F', '3F', 'Patio'];
  };

  // 백엔드 API에서 테이블 요소들 불러오기
  const getSavedTableElements = async (floor: string) => {
    try {
      const response = await fetch(`${API_URL}/table-map/elements?floor=${floor}`);
      if (response.ok) {
        const elements = await response.json();
        // 기존 요소들에 rotation 속성 추가 (없는 경우 0으로 설정)
        return elements.map((element: any) => ({
          ...element,
          rotation: element.rotation !== undefined ? element.rotation : 0,
          // 백오피스 편집 화면에서는 DB의 name(text)을 그대로 사용
          text: element.text || '',
          fontSize: element.fontSize || 20,
          color: element.color || '#3B82F6',
          status: element.status || undefined
        }));
      } else {
        console.warn(`Failed to fetch elements for floor ${floor}:`, response.status);
        return [];
      }
    } catch (error) {
      console.error('Error fetching table elements:', error);
      return [];
    }
  };

  // localStorage에서 저장된 색상 정보 불러오기
  const getSavedColorInfo = (floor: string) => {
    const savedCounts = localStorage.getItem(`tableMapElementCounts_${floor}`);
    const savedColors = localStorage.getItem(`tableMapFirstColors_${floor}`);
    const savedStatusIndex = localStorage.getItem(`tableMapStatusIndex_${floor}`);
    
    return {
      elementTypeCounts: savedCounts ? JSON.parse(savedCounts) : {},
      firstElementColors: savedColors ? JSON.parse(savedColors) : {},
      tableStatusIndex: savedStatusIndex ? parseInt(savedStatusIndex) : 0
    };
  };

  // localStorage에서 저장된 채널 탭 표시/숨김 설정 불러오기
  const getSavedChannelVisibility = () => {
    const savedVisibility = localStorage.getItem('tableMapChannelVisibility');
    if (savedVisibility) {
      try {
        return JSON.parse(savedVisibility);
      } catch (error) {
        console.error('Error parsing saved channel visibility:', error);
        return {
          'table-map': true,
          'togo': true,
          'delivery': true,
          'online': true
        };
      }
    }
    return {
      'table-map': true,
      'togo': true,
      'delivery': true,
      'online': true
    };
  };

  const savedSize = getSavedScreenSize();
  const savedFloor = getSavedFloor();
  const savedColorInfo = getSavedColorInfo(savedFloor);
  const savedFloorList = getSavedFloorList();
  const savedChannelVisibility = getSavedChannelVisibility();
  
  const [selectedFloor, setSelectedFloor] = useState(savedFloor);
  const [floorList, setFloorList] = useState<string[]>(savedFloorList);
  const [newFloorName, setNewFloorName] = useState('');
  const [showTogoOrderModal, setShowTogoOrderModal] = useState(false);
  const [togoKeyboardTarget, setTogoKeyboardTarget] = useState<'phone' | 'name' | 'address' | 'note' | 'zip' | 'search'>('phone');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerZip, setCustomerZip] = useState('');
  const [togoNote, setTogoNote] = useState('');
  const [togoOrderMode, setTogoOrderMode] = useState<'togo' | 'delivery'>('togo');
  const [prepButtonsLocked, setPrepButtonsLocked] = useState(false);
  const [showAddFloorModal, setShowAddFloorModal] = useState(false);
  const [showDeleteFloorModal, setShowDeleteFloorModal] = useState(false);
  const [floorToDelete, setFloorToDelete] = useState<string>('');
  const [pickupTime, setPickupTime] = useState(15); // 15분 후 픽업
  const [customerName, setCustomerName] = useState('');
  const parsedCustomerName = useMemo(() => parseCustomerName(customerName), [customerName]);
  const {
    firstName: customerFirstName,
    lastName: customerLastName,
    order: customerNameOrder,
  } = parsedCustomerName;
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  // 전역 편집 상태: 저장 완료 전까지 유지되도록 상위에서 관리
  const [editingElementId, setEditingElementId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingFontSize, setEditingFontSize] = useState<number>(20);

  const handleSaveLayout = async () => {
    try {
      // 편집 중이면 현재 값 반영
      let elementsToSave = tableElements;
      if (editingElementId !== null) {
        elementsToSave = tableElements.map(el => (
          el.id === editingElementId
            ? { ...el, text: editingText.trim(), fontSize: editingFontSize }
            : el
        ));
      }
      // 1) 정규화
      const normalized = elementsToSave.map(el => ({
        ...el,
        text: (el.text ?? '').toString(),
        fontSize: Number(el.fontSize || 20),
        rotation: Number(el.rotation || 0),
        position: { x: Number(el.position.x), y: Number(el.position.y) },
        size: { width: Number(el.size.width), height: Number(el.size.height) }
      }));

      // 2) 저장
      await saveToHistory(normalized);

      // 3) 재조회로 확정값 동기화
      const reloaded = await getSavedTableElements(selectedFloor);
      setTableElements(reloaded);
      setEditingElementId(null);
      // 4) FOH 반영 신호: localStorage 브로드캐스트 (floor 포함)
      try { localStorage.setItem('tableMapUpdated', JSON.stringify({ floor: selectedFloor, ts: Date.now() })); } catch {}
      // 성공 알림 제거 (요청에 따라 사용자 팝업 표시 안 함)
    } catch (e: any) {
      console.error('Save layout failed:', e);
      const errMsg = e?.message || '';
      if (errMsg.includes('SQLITE_BUSY') || errMsg.includes('database is locked')) {
        alert('데이터베이스가 사용 중입니다. 잠시 후 다시 시도해주세요.');
      } else if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
        alert('서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해주세요.');
      } else {
        alert('레이아웃 저장 중 오류가 발생했습니다.\n' + (errMsg ? `상세: ${errMsg}` : ''));
      }
    }
  };
  
  // 가격 변경 확인 팝업 상태
  const [showPriceChangePopup, setShowPriceChangePopup] = useState(false);
  const [priceChangeData, setPriceChangeData] = useState<{
    order: any;
    updatedItems: any[];
    totalPriceChange: number;
    priceChangeDetails: string;
  } | null>(null);
  
  // 재주문 완료 토스트 알림 상태
  const [showReorderToast, setShowReorderToast] = useState(false);
  
  // 메뉴주문창 상태
  const [showMenuOrderModal, setShowMenuOrderModal] = useState(false);
  
  // 결제페이지 상태
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  // 검색 입력 및 가상 키보드
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [softKbOpen, setSoftKbOpen] = useState(false);
  const [kbLang, setKbLang] = useState<string>('EN');
  // 검색 상태 (Togo/Online 공용 검색어)
  const [togoSearch, setTogoSearch] = useState<string>('');
  
  // Togo 주문 목록 상태
  const [togoOrders, setTogoOrders] = useState<any[]>([]);
  
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [selectedTableType, setSelectedTableType] = useState('rounded-rectangle');
  
  // 기존 고객 데이터 (실제로는 데이터베이스에서 가져올 수 있음)
  const existingCustomers = [
    { phone: '010-1234-5678', name: '김철수' },
    { phone: '010-9876-5432', name: '이영희' },
    { phone: '010-5555-1234', name: '박민수' },
    { phone: '010-7777-8888', name: '최지영' },
    { phone: '010-1111-2222', name: '정수진' },
    { phone: '010-3333-4444', name: '한미영' },
    { phone: '010-6666-7777', name: '송태호' },
    { phone: '010-8888-9999', name: '윤서연' },
    { phone: '0101234567', name: '테스트고객' }
  ];
  
  const normalizePhoneDigits = useCallback((value: string) => (value || '').replace(/\D/g, '').slice(0, 11), []);
  const formatTogoPhone = useCallback((input: string) => {
    const digits = normalizePhoneDigits(input).slice(0, 11);
    if (!digits) return '';
    if (digits.length < 3) return `(${digits}`;
    if (digits.length === 3) return `(${digits})`;

    const area = digits.slice(0, 3);
    const rest = digits.slice(3);
    let formatted = `(${area})`;

    if (!rest) return formatted;
    if (rest.length <= 3) return `${formatted}${rest}`;

    const middleLength = digits.length > 10 ? 4 : 3;
    const middle = rest.slice(0, middleLength);
    const remaining = rest.slice(middleLength);
    const hyphenSection = remaining ? `-${remaining}` : '';
    return `${formatted}${middle}${hyphenSection}`;
  }, [normalizePhoneDigits]);
  const formatOrderPhoneDisplay = useCallback((input?: string | null) => {
    const digits = (input || '').replace(/\D/g, '');
    if (!digits) return input || '';
    const len = digits.length;
    if (len <= 4) return digits;
    if (len === 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
    if (len === 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (len === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    if (len === 8) return `(${digits.slice(0, 1)})${digits.slice(1, 4)}-${digits.slice(4)}`;
    if (len === 9) return `(${digits.slice(0, 2)})${digits.slice(2, 5)}-${digits.slice(5)}`;
    if (len === 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (len === 11) return `(${digits.slice(0, 3)})${digits.slice(3, 7)}-${digits.slice(7)}`;
    return digits;
  }, []);

  // 전화번호로 고객 찾기
  const findCustomerByPhone = (phone: string) => {
    console.log('findCustomerByPhone called with:', phone);
    console.log('existingCustomers:', existingCustomers);
    const normalized = normalizePhoneDigits(phone);
    const customer = existingCustomers.find(customer => normalizePhoneDigits(customer.phone) === normalized);
    console.log('Found customer in findCustomerByPhone:', customer);
    return customer;
  };

  // 초기 데이터 로딩 (백엔드 API 사용)
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const elements = await getSavedTableElements(selectedFloor);
        setTableElements(elements);
        console.log(`Initial data loaded for ${selectedFloor}:`, elements.length, 'elements');
        
        // 기존 Occupied 테이블들의 시간 초기화 (현재 시간으로 설정)
        const now = Date.now();
        const occupiedTimes: Record<string, number> = {};
        elements.forEach((element: any) => {
          if (element.status === 'Occupied') {
            occupiedTimes[String(element.id)] = now;
          }
        });
        setTableOccupiedTimes(occupiedTimes);
      } catch (error) {
        console.error('Error loading initial data:', error);
      }
    };
    
    loadInitialData();
  }, [selectedFloor]);

  useEffect(() => {
    let cancelled = false;
    const loadTogoOrders = async () => {
      try {
        const res = await fetch(`${API_URL}/orders?type=TOGO&status=PENDING&limit=50`);
        if (!res.ok) return;
        const json = await res.json();
        const orders = Array.isArray(json.orders) ? json.orders : [];
        if (cancelled) return;
        const mapped = orders.map((o: any, idx: number) => {
          const parsedId = Number(o.id);
          const fallbackId = Number(o.order_number || o.orderId);
          const safeId = Number.isFinite(parsedId)
            ? parsedId
            : (Number.isFinite(fallbackId) ? Number(fallbackId) : Date.now() + idx);
          const phoneValue = o.customer_phone || o.customerPhone || o.phone || '';
          const nameValue = o.customer_name || o.customerName || o.name || '';
          const createdRaw = o.created_at || o.createdAt || null;
          const createdDate = createdRaw ? new Date(createdRaw) : null;
          const pickupMinutesRaw = Number(o.pickup_minutes ?? o.pickupMinutes ?? o.ready_in_minutes ?? o.readyMinutes ?? 0);
          let readyTimeLabel = '';
          if (createdDate && !Number.isNaN(createdDate.getTime()) && Number.isFinite(pickupMinutesRaw) && pickupMinutesRaw > 0) {
            const readyDate = new Date(createdDate.getTime() + pickupMinutesRaw * 60000);
            readyTimeLabel = readyDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          } else if (o.ready_time || o.pickup_time) {
            readyTimeLabel = String(o.ready_time || o.pickup_time);
          }
          const fulfillmentRaw = (o.fulfillment_mode ?? o.fulfillmentMode ?? o.fulfillment ?? o.togoFulfillment ?? '').toString().trim().toLowerCase();
          const fulfillment = fulfillmentRaw === 'delivery'
            ? 'delivery'
            : (fulfillmentRaw === 'togo' || fulfillmentRaw === 'pickup' ? 'togo' : null);
          return {
            id: safeId,
            type: fulfillment === 'delivery' ? 'Delivery' : 'Togo',
            number: o.order_number || o.id,
            time: new Date(createdRaw || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            createdAt: createdRaw,
            phone: phoneValue,
            phoneRaw: normalizePhoneDigits(phoneValue),
            name: nameValue,
            status: o.status?.toLowerCase() || 'pending',
            serverId: o.server_id || o.serverId || null,
            serverName: o.server_name || o.serverName || '',
            fulfillment,
            readyTimeLabel,
            total: Number(o.total || 0),
          };
        });
        setTogoOrders(assignDailySequenceNumbers(mapped, 'TOGO'));
      } catch {
        // ignore
      }
    };
    loadTogoOrders();
    const interval = setInterval(loadTogoOrders, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [normalizePhoneDigits]);

  // 전화번호 입력 시 고객명 자동완성 및 주문 히스토리 업데이트
  const handlePhoneChange = (phone: string) => {
    console.log('handlePhoneChange called with:', phone);
    const formatted = formatTogoPhone(phone);
    setCustomerPhone(formatted);
    
    const customer = findCustomerByPhone(formatted);
    console.log('Found customer:', customer);
    
    if (customer) {
      const formattedName = formatNameForDisplay(customer.name);
      console.log('Formatted name:', formattedName);
      setCustomerName(formattedName);
      
      // 주문 히스토리 자동 업데이트
      const orders = getCustomerOrderHistory(formatted);
      console.log('Found orders:', orders);
      setCustomerOrders(orders);
    } else {
      console.log('No customer found, clearing name and orders');
      setCustomerName('');
      setCustomerOrders([]);
    }
  };
  
  // 주문 내역 데이터 (실제로는 데이터베이스에서 가져올 수 있음)
  const orderHistory = [
    {
      id: 1,
      phone: '010-1234-5678',
      date: '2024-01-15',
      time: '18:30',
      items: [
        { name: '불고기', quantity: 2, price: 15000 },
        { name: '김치찌개', quantity: 1, price: 12000 },
        { name: '공기밥', quantity: 2, price: 2000 },
        { name: '콜라', quantity: 1, price: 2000 }
      ],
      total: 48000
    },
    {
      id: 2,
      phone: '010-1234-5678',
      date: '2024-01-10',
      time: '19:15',
      items: [
        { name: '제육볶음', quantity: 1, price: 14000 },
        { name: '된장찌개', quantity: 1, price: 11000 },
        { name: '공기밥', quantity: 2, price: 2000 },
        { name: '맥주', quantity: 2, price: 4000 }
      ],
      total: 37000
    },
    {
      id: 3,
      phone: '010-1234-5678',
      date: '2024-01-08',
      time: '20:30',
      items: [
        { name: '삼겹살', quantity: 2, price: 18000 },
        { name: '상추', quantity: 1, price: 3000 },
        { name: '소주', quantity: 3, price: 5000 },
        { name: '공기밥', quantity: 2, price: 2000 }
      ],
      total: 52000
    },
    {
      id: 4,
      phone: '010-9876-5432',
      date: '2024-01-14',
      time: '20:00',
      items: [
        { name: '삼겹살', quantity: 2, price: 18000 },
        { name: '소주', quantity: 2, price: 5000 },
        { name: '상추', quantity: 1, price: 3000 }
      ],
      total: 46000
    },
    {
      id: 5,
      phone: '010-9876-5432',
      date: '2024-01-12',
      time: '19:45',
      items: [
        { name: '치킨', quantity: 1, price: 20000 },
        { name: '콜라', quantity: 1, price: 2000 },
        { name: '감자튀김', quantity: 1, price: 5000 }
      ],
      total: 27000
    },
    {
      id: 6,
      phone: '010-5555-1234',
      date: '2024-01-12',
      time: '17:45',
      items: [
        { name: '치킨', quantity: 1, price: 20000 },
        { name: '콜라', quantity: 1, price: 2000 }
      ],
      total: 22000
    },
    {
      id: 7,
      phone: '010-5555-1234',
      date: '2024-01-10',
      time: '18:20',
      items: [
        { name: '피자', quantity: 1, price: 25000 },
        { name: '치킨', quantity: 1, price: 20000 },
        { name: '콜라', quantity: 2, price: 2000 },
        { name: '감자튀김', quantity: 1, price: 5000 }
      ],
      total: 54000
    },
    {
      id: 8,
      phone: '010-7777-8888',
      date: '2024-01-15',
      time: '19:00',
      items: [
        { name: '불고기', quantity: 1, price: 15000 },
        { name: '김치찌개', quantity: 1, price: 12000 },
        { name: '공기밥', quantity: 1, price: 2000 },
        { name: '맥주', quantity: 1, price: 4000 }
      ],
      total: 33000
    },
    {
      id: 9,
      phone: '010-7777-8888',
      date: '2024-01-13',
      time: '20:15',
      items: [
        { name: '삼겹살', quantity: 1, price: 18000 },
        { name: '소주', quantity: 2, price: 5000 },
        { name: '상추', quantity: 1, price: 3000 }
      ],
      total: 31000
    },
    {
      id: 10,
      phone: '010-1111-2222',
      date: '2024-01-15',
      time: '17:30',
      items: [
        { name: '치킨', quantity: 2, price: 20000 },
        { name: '콜라', quantity: 2, price: 2000 },
        { name: '감자튀김', quantity: 2, price: 5000 }
      ],
      total: 54000
    },
    {
      id: 11,
      phone: '010-1111-2222',
      date: '2024-01-11',
      time: '19:45',
      items: [
        { name: '피자', quantity: 1, price: 25000 },
        { name: '콜라', quantity: 1, price: 2000 }
      ],
      total: 27000
    },
    {
      id: 12,
      phone: '010-3333-4444',
      date: '2024-01-14',
      time: '18:00',
      items: [
        { name: '불고기', quantity: 1, price: 15000 },
        { name: '김치찌개', quantity: 1, price: 12000 },
        { name: '공기밥', quantity: 1, price: 2000 },
        { name: '맥주', quantity: 1, price: 4000 }
      ],
      total: 33000
    },
    {
      id: 13,
      phone: '010-3333-4444',
      date: '2024-01-12',
      time: '20:30',
      items: [
        { name: '삼겹살', quantity: 1, price: 18000 },
        { name: '소주', quantity: 1, price: 5000 },
        { name: '상추', quantity: 1, price: 3000 }
      ],
      total: 26000
    },
    {
      id: 14,
      phone: '010-6666-7777',
      date: '2024-01-15',
      time: '19:30',
      items: [
        { name: '치킨', quantity: 1, price: 20000 },
        { name: '피자', quantity: 1, price: 25000 },
        { name: '콜라', quantity: 2, price: 2000 },
        { name: '감자튀김', quantity: 1, price: 5000 }
      ],
      total: 54000
    },
    {
      id: 15,
      phone: '010-8888-9999',
      date: '2024-01-14',
      time: '18:45',
      items: [
        { name: '불고기', quantity: 2, price: 15000 },
        { name: '김치찌개', quantity: 1, price: 12000 },
        { name: '공기밥', quantity: 2, price: 2000 },
        { name: '맥주', quantity: 2, price: 4000 }
      ],
      total: 50000
    },
    {
      id: 16,
      phone: '0101234567',
      date: '2024-01-15',
      time: '19:30',
      items: [
        { name: '치킨', quantity: 1, price: 20000 },
        { name: '콜라', quantity: 1, price: 2000 },
        { name: '감자튀김', quantity: 1, price: 5000 }
      ],
      total: 27000
    },
    {
      id: 17,
      phone: '0101234567',
      date: '2024-01-12',
      time: '18:15',
      items: [
        { name: '피자', quantity: 1, price: 25000 },
        { name: '맥주', quantity: 2, price: 4000 }
      ],
      total: 33000
    }
  ];
  
  // 고객의 주문 내역 가져오기
  const getCustomerOrderHistory = (phone: string) => {
    console.log('getCustomerOrderHistory called with:', phone);
    console.log('orderHistory:', orderHistory);
    const normalized = normalizePhoneDigits(phone);
    const orders = orderHistory.filter(order => normalizePhoneDigits(order.phone) === normalized);
    console.log('Filtered orders:', orders);
    return orders;
  };

  // 주문 펼침/접힘 토글
  const toggleOrderExpansion = (orderId: number) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  // 현재 메뉴 가격 정보 (실제로는 데이터베이스에서 조회)
  const currentMenuPrices: { [key: string]: number } = {
    '치킨': 22000,      // 이전: 20000 → 현재: 22000 (+2000)
    '콜라': 2500,       // 이전: 2000 → 현재: 2500 (+500)
    '감자튀김': 6000,   // 이전: 5000 → 현재: 6000 (+1000)
    '피자': 28000,      // 이전: 25000 → 현재: 28000 (+3000)
    '맥주': 4500        // 이전: 4000 → 현재: 4500 (+500)
  };

  // 재주문 처리
  const handleReorder = (order: any) => {
    console.log('재주문:', order);
    
    // 가격 변경 확인 및 처리
    let hasPriceChange = false;
    let priceChangeDetails = '';
    let totalPriceChange = 0;
    
    const updatedOrderItems = order.items.map((item: any) => {
      const currentPrice = currentMenuPrices[item.name] || item.price;
      const priceDiff = currentPrice - item.price;
      
      if (priceDiff !== 0) {
        hasPriceChange = true;
        totalPriceChange += priceDiff * item.quantity;
        priceChangeDetails += `${item.name}: ${item.price.toLocaleString()}원 → ${currentPrice.toLocaleString()}원 (+${priceDiff.toLocaleString()}원)\n`;
      }
      
      return {
        name: item.name,
        quantity: item.quantity,
        price: currentPrice,
        previousPrice: item.price
      };
    });
    
    // 가격 변경이 있는 경우 팝업으로 확인
    if (hasPriceChange) {
      setPriceChangeData({
        order,
        updatedItems: updatedOrderItems,
        totalPriceChange,
        priceChangeDetails
      });
      setShowPriceChangePopup(true);
      return;
    }
    
    // 가격 변경이 없는 경우 바로 재주문 처리
    processReorder(updatedOrderItems, hasPriceChange, totalPriceChange);
  };

  // 실제 재주문 처리 함수
  useEffect(() => {
    let cancelled = false;
    const loadTogoOrders = async () => {
      try {
        const res = await fetch(`${API_URL}/orders?type=TOGO&status=PENDING&limit=50`);
        if (!res.ok) return;
        const json = await res.json();
        const orders = Array.isArray(json.orders) ? json.orders : [];
        if (cancelled) return;
        const mapped = orders.map((o: any, idx: number) => {
          const parsedId = Number(o.id);
          const fallbackId = Number(o.order_number || o.orderId);
          const safeId = Number.isFinite(parsedId)
            ? parsedId
            : (Number.isFinite(fallbackId) ? Number(fallbackId) : Date.now() + idx);
          const phoneValue = o.customer_phone || o.customerPhone || o.phone || '';
          const nameValue = o.customer_name || o.customerName || o.name || '';
          const createdRaw = o.created_at || o.createdAt || null;
          const createdDate = createdRaw ? new Date(createdRaw) : null;
          const pickupMinutesRaw = Number(o.pickup_minutes ?? o.pickupMinutes ?? o.ready_in_minutes ?? o.readyMinutes ?? 0);
          let readyTimeLabel = '';
          if (createdDate && !Number.isNaN(createdDate.getTime()) && Number.isFinite(pickupMinutesRaw) && pickupMinutesRaw > 0) {
            const readyDate = new Date(createdDate.getTime() + pickupMinutesRaw * 60000);
            readyTimeLabel = readyDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          } else if (o.ready_time || o.pickup_time) {
            readyTimeLabel = String(o.ready_time || o.pickup_time);
          }
          const fulfillmentRaw = (o.fulfillment_mode ?? o.fulfillmentMode ?? o.fulfillment ?? o.togoFulfillment ?? '').toString().trim().toLowerCase();
          const fulfillment = fulfillmentRaw === 'delivery'
            ? 'delivery'
            : (fulfillmentRaw === 'togo' || fulfillmentRaw === 'pickup' ? 'togo' : null);
          return {
            id: safeId,
            type: fulfillment === 'delivery' ? 'Delivery' : 'Togo',
            number: o.order_number || o.id,
            time: new Date(createdRaw || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            createdAt: createdRaw,
            phone: phoneValue,
            phoneRaw: normalizePhoneDigits(phoneValue),
            name: nameValue,
            status: o.status?.toLowerCase() || 'pending',
            serverId: o.server_id || o.serverId || null,
            serverName: o.server_name || o.serverName || '',
            fulfillment,
            readyTimeLabel,
            total: Number(o.total || 0),
          };
        });
        setTogoOrders(assignDailySequenceNumbers(mapped, 'TOGO'));
      } catch {
        // ignore
      }
    };
    loadTogoOrders();
    const interval = setInterval(loadTogoOrders, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [normalizePhoneDigits]);

  const processReorder = (updatedItems: any[], hasPriceChange: boolean, totalPriceChange: number) => {
    // 주문 항목들을 새 주문에 추가
    const orderItems = updatedItems.map((item: any) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      previousPrice: item.previousPrice
    }));
    
    // 기본 픽업타임 설정 (현재 시간 + 30분)
    const pickupTime = new Date(Date.now() + 30 * 60 * 1000);
    const pickupTimeString = pickupTime.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Togo 주문 목록에 새로운 주문 추가
    const readyTimeLabel = pickupTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const createdLocal = getLocalDatetimeString();
    const newTogoOrder = {
      id: Date.now(),
      type: 'Togo',
      time: pickupTimeString,
      fulfillment: 'togo',
      createdAt: createdLocal,
      phone: customerPhone,
      phoneRaw: normalizePhoneDigits(customerPhone),
      name: customerName,
      firstName: customerFirstName,
      lastName: customerLastName,
      nameOrder: customerNameOrder,
      status: 'pending',
      orderItems: orderItems,
      pickupTime: pickupTimeString,
      readyTimeLabel,
      hasPriceChange: hasPriceChange,
      totalPriceChange: totalPriceChange
    };
    
    setTogoOrders(prev => assignDailySequenceNumbers([...prev, newTogoOrder], 'TOGO'));
    
    // 실제 재주문 처리 로직 (현재는 시뮬레이션)
    // TODO: 주문 목록에 추가, 장바구니에 담기 등
    console.log('재주문 처리:', {
      orderItems,
      pickupTime: pickupTimeString,
      hasPriceChange,
      totalPriceChange,
      newTogoOrder
    });
    
    // 재주문 완료 토스트 알림 표시
    console.log('토스트 알림 표시 시작');
    setShowReorderToast(true);
    console.log('showReorderToast 상태:', true);
    
    // 2초 후 자동으로 숨기기
    setTimeout(() => {
      console.log('토스트 알림 자동 숨김');
      setShowReorderToast(false);
    }, 2000);
    
    // 재주문 완료 후 모달 닫기
    setShowTogoOrderModal(false);
  };
  
  // 주문 내역을 날짜별로 그룹화
  const groupOrdersByDate = (orders: any[]) => {
    const grouped = orders.reduce((acc: { [key: string]: any[] }, order) => {
      const date = order.date;
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(order);
      return acc;
    }, {});
    
    return Object.entries(grouped).sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime());
  };

  // 슬라이더 스타일 적용
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = sliderStyles;
    document.head.appendChild(styleElement);
    
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // 모달이 열릴 때 전화번호 입력란에 자동 포커스
  useEffect(() => {
    if (showTogoOrderModal && phoneInputRef.current) {
      phoneInputRef.current.focus();
    }
  }, [showTogoOrderModal]);
  
  // 채널 탭 표시/숨김 설정
  const [channelVisibility, setChannelVisibility] = useState(savedChannelVisibility);
  const [screenWidth, setScreenWidth] = useState(savedSize.width);
  const [screenHeight, setScreenHeight] = useState(savedSize.height);
  const [canvasStyle, setCanvasStyle] = useState<{ width?: string; height?: string; maxWidth?: string; maxHeight?: string }>({});
  // Canvas zoom (responsive fit like SalesPage)
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | 'custom'>('fit');
  const [customZoom, setCustomZoom] = useState<number>(1);
  const [fitZoom, setFitZoom] = useState<number>(1);
  const canvasWidthPx = useMemo(() => parseInt(canvasStyle.width?.replace('px', '') || '800'), [canvasStyle.width]);
  const canvasHeightPx = useMemo(() => parseInt(canvasStyle.height?.replace('px', '') || '600'), [canvasStyle.height]);
  const editorScale = useMemo(() => {
    const z = zoomMode === 'fit' ? fitZoom : customZoom;
    const safe = Number.isFinite(z) && z > 0 ? z : 1;
    return Math.max(0.1, Math.min(2, safe));
  }, [zoomMode, fitZoom, customZoom]);

  useEffect(() => {
    if (zoomMode !== 'fit') return;
    const el = canvasViewportRef.current;
    if (!el) return;

    const computeFit = () => {
      const rect = el.getBoundingClientRect();
      const vw = rect.width;
      const vh = rect.height;
      const cw = canvasWidthPx || 800;
      const ch = canvasHeightPx || 600;
      if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) return;

      const padding = 24; // keep small breathing room
      const scale = Math.min(1, (vw - padding) / cw, (vh - padding) / ch);
      if (Number.isFinite(scale) && scale > 0) setFitZoom(scale);
    };

    computeFit();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => computeFit());
      ro.observe(el);
    }
    window.addEventListener('resize', computeFit);
    return () => {
      try { ro?.disconnect(); } catch {}
      window.removeEventListener('resize', computeFit);
    };
  }, [zoomMode, canvasWidthPx, canvasHeightPx]);
  const [tableElements, setTableElements] = useState<TableElement[]>([]);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedElement, setSelectedElement] = useState<TableElement | null>(null);
  const [tableOccupiedTimes, setTableOccupiedTimes] = useState<Record<string, number>>({});
  const [tableReservationNames, setTableReservationNames] = useState<Record<string, string>>({});
  const [tableCounter, setTableCounter] = useState(1); // 테이블 카운터 추가
  
  // 오늘의 예약 현황 상태
  const [todayReservations, setTodayReservations] = useState<any[]>([]);
  
  // 오늘의 예약 현황 로드
  useEffect(() => {
    const loadTodayReservations = async () => {
      try {
        const today = getLocalDateString();
        const res = await fetch(`${API_URL}/reservations?date=${today}`);
        if (!res.ok) return;
        const data = await res.json();
        const reservations = Array.isArray(data) ? data : (data.reservations || []);
        // 시간순 정렬
        reservations.sort((a: any, b: any) => {
          const timeA = a.reservation_time || a.time || '';
          const timeB = b.reservation_time || b.time || '';
          return timeA.localeCompare(timeB);
        });
        setTodayReservations(reservations);
      } catch (err) {
        console.error('Failed to load reservations:', err);
      }
    };
    
    // 앱 실행/새로고침 시 로드
    loadTodayReservations();
    
    // 오후 2시 업데이트 체크 (1분마다 확인)
    const checkScheduledUpdate = () => {
      const now = new Date();
      if (now.getHours() === 14 && now.getMinutes() === 0) {
        loadTodayReservations();
      }
    };
    const interval = setInterval(checkScheduledUpdate, 60000);
    return () => clearInterval(interval);
  }, []);

  // Occupied 테이블의 시간 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      setTableOccupiedTimes(prev => {
        const now = Date.now();
        const updated = { ...prev };
        
        // Occupied 상태인 테이블들의 시간 업데이트
        tableElements.forEach((table: TableElement) => {
          if (table.status === 'Occupied' && updated[String(table.id)]) {
            const elapsed = Math.floor((now - updated[String(table.id)]) / 1000 / 60); // 분 단위
            // 시간은 그대로 유지 (업데이트하지 않음)
          }
        });
        
        return updated;
      });
    }, 1000); // 1초마다 업데이트

    return () => clearInterval(interval);
  }, [tableElements]);
  const [selectedTab, setSelectedTab] = useState('table-map'); // 탭 상태 추가
  const [selectedColor, setSelectedColor] = useState('#3B82F6'); // 선택된 색상
  const [showColorModal, setShowColorModal] = useState(false); // 색상 모달 표시 여부
  const [isColorModalForExisting, setIsColorModalForExisting] = useState(false); // 기존 요소 색상 변경 모드
  
  // 요소별 카운터와 색상 관리 (저장된 정보로 초기화)
  const [elementTypeCounts, setElementTypeCounts] = useState<{[key: string]: number}>(savedColorInfo.elementTypeCounts);
  const [firstElementColors, setFirstElementColors] = useState<{[key: string]: string}>(savedColorInfo.firstElementColors);
  const [tableStatusIndex, setTableStatusIndex] = useState(savedColorInfo.tableStatusIndex); // Circle/Square 상태 색상 순서 (0: Available, 1: Occupied, 2: Preparing, 3: Reserved)
  
  // 알람 시스템 상태
  const [callNotifications, setCallNotifications] = useState<CallNotification[]>([]);
  const [orderNotifications, setOrderNotifications] = useState<OrderNotification[]>([]);
  const [swipeStates, setSwipeStates] = useState<{[key: string]: { startX: number; currentX: number; isSwiping: boolean }}>({});
  const [orderSwipeStates, setOrderSwipeStates] = useState<{[key: string]: { startX: number; currentX: number; isSwiping: boolean }}>({});

  // 알람 추가 함수
  const addCallNotification = (tableNumber: string, channel: 'table-map' | 'togo' | 'delivery' | 'online') => {
    const newNotification: CallNotification = {
      id: `call-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      tableNumber,
      channel,
      timestamp: new Date(),
      message: `Call from Table ${tableNumber}`
    };
    
    setCallNotifications(prev => [...prev, newNotification]);
    
    // 프린터 비퍼 알림 (3번 울림)
    triggerPrinterBeep();
    
    // 3분 후 자동으로 알람 제거
    setTimeout(() => {
      removeCallNotification(newNotification.id);
    }, 180000); // 3분 = 180,000ms
  };

  // 주문 알람 추가 함수
  const addOrderNotification = (tableNumber: string, channel: 'table-map' | 'togo' | 'delivery' | 'online', orderItems?: string[]) => {
    const newNotification: OrderNotification = {
      id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      tableNumber,
      channel,
      timestamp: new Date(),
      message: `Order from Table ${tableNumber}`,
      orderItems
    };
    
    setOrderNotifications(prev => [...prev, newNotification]);
    
    // 20초 후 자동으로 알람 제거
    setTimeout(() => {
      removeOrderNotification(newNotification.id);
    }, 20000); // 20초 = 20,000ms
  };

  // 알람 제거 함수
  const removeCallNotification = (id: string) => {
    setCallNotifications(prev => prev.filter(notification => notification.id !== id));
    // swipe 상태도 제거
    setSwipeStates(prev => {
      const newStates = { ...prev };
      delete newStates[id];
      return newStates;
    });
  };

  // 주문 알람 제거 함수
  const removeOrderNotification = (id: string) => {
    setOrderNotifications(prev => prev.filter(notification => notification.id !== id));
    // swipe 상태도 제거
    setOrderSwipeStates(prev => {
      const newStates = { ...prev };
      delete newStates[id];
      return newStates;
    });
  };

  // 프린터 비퍼 알림 함수
  const triggerPrinterBeep = async () => {
    try {
      // ESC/POS 명령어로 비퍼 제어 (3번 울림)
      const beepCommands = [
        '\x1B\x42\x03\x03', // ESC B n m (비퍼 울림: n=3회, m=3/10초 간격)
        '\x07', // BEL 문자 (추가 비퍼)
        '\x1B\x42\x02\x02', // 두 번째 비퍼
        '\x1B\x42\x02\x02'  // 세 번째 비퍼
      ];

      // 서버로 프린터 비퍼 명령 전송
      for (let i = 0; i < 3; i++) {
        await fetch('/api/printer/beep', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            beepCommand: beepCommands[i] || '\x07',
            printerType: 'server' // 서버용 프린터 지정
          })
        });
        
        // 0.5초 간격으로 비퍼 울림
        if (i < 2) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log('Printer beep notification sent (3 times)');
    } catch (error) {
      console.error('Failed to send printer beep:', error);
      
      // 프린터 비퍼가 실패하면 브라우저 알림음으로 대체
      playBrowserBeep();
    }
  };

  // 브라우저 알림음 (프린터 비퍼 실패 시 대체)
  const playBrowserBeep = () => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(1000, audioContext.currentTime); // 1kHz 주파수
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
      }, i * 500); // 0.5초 간격
    }
  };

  // Swipe 시작
  const handleSwipeStart = (id: string, startX: number) => {
    setSwipeStates(prev => ({
      ...prev,
      [id]: { startX, currentX: startX, isSwiping: true }
    }));
  };

  // Swipe 중
  const handleSwipeMove = (id: string, currentX: number) => {
    setSwipeStates(prev => {
      if (prev[id] && prev[id].isSwiping) {
        return {
          ...prev,
          [id]: { ...prev[id], currentX }
        };
      }
      return prev;
    });
  };

  // Swipe 종료
  const handleSwipeEnd = (id: string) => {
    setSwipeStates(prev => {
      if (prev[id]) {
        const swipeDistance = Math.abs(prev[id].currentX - prev[id].startX);
        if (swipeDistance > 100) { // 100px 이상 swipe하면 제거
          removeCallNotification(id);
          return prev;
        }
        return {
          ...prev,
          [id]: { ...prev[id], isSwiping: false, currentX: prev[id].startX }
        };
      }
      return prev;
    });
  };

  // 주문 알람 Swipe 시작
  const handleOrderSwipeStart = (id: string, startX: number) => {
    setOrderSwipeStates(prev => ({
      ...prev,
      [id]: { startX, currentX: startX, isSwiping: true }
    }));
  };

  // 주문 알람 Swipe 중
  const handleOrderSwipeMove = (id: string, currentX: number) => {
    setOrderSwipeStates(prev => {
      if (prev[id] && prev[id].isSwiping) {
        return {
          ...prev,
          [id]: { ...prev[id], currentX }
        };
      }
      return prev;
    });
  };

  // 주문 알람 Swipe 종료
  const handleOrderSwipeEnd = (id: string) => {
    setOrderSwipeStates(prev => {
      if (prev[id]) {
        const swipeDistance = Math.abs(prev[id].currentX - prev[id].startX);
        if (swipeDistance > 100) { // 100px 이상 swipe하면 제거
          removeOrderNotification(id);
          return prev;
        }
        return {
          ...prev,
          [id]: { ...prev[id], isSwiping: false, currentX: prev[id].startX }
        };
      }
      return prev;
    });
  };

  // 테이블 오더 디바이스에서 호출할 함수 (실제 구현 시 사용)
  const handleTableCall = (tableNumber: string, channel: 'table-map' | 'togo' | 'delivery' | 'online') => {
    addCallNotification(tableNumber, channel);
  };

  // 테스트용 알람 추가 함수 (개발 중에만 사용)
  const addTestCall = () => {
    // 중복되지 않는 테이블 번호 생성
    const usedNumbers = new Set<number>();
    const testTableNumbers: string[] = [];
    
    while (testTableNumbers.length < 3) {
      const randomNum = Math.floor(Math.random() * 20) + 1;
      if (!usedNumbers.has(randomNum)) {
        usedNumbers.add(randomNum);
        testTableNumbers.push(`T${randomNum}`);
      }
    }
    
    const channels: ('table-map' | 'togo' | 'delivery' | 'online')[] = ['table-map', 'togo', 'delivery', 'online'];
    
    // 1초 간격으로 3개의 알람 추가
    testTableNumbers.forEach((tableNumber, index) => {
      setTimeout(() => {
        const randomChannel = channels[Math.floor(Math.random() * channels.length)];
        addCallNotification(tableNumber, randomChannel);
      }, index * 1000); // 1초 간격
    });
  };

  // 테스트용 주문 알람 추가 함수
  const addTestOrder = () => {
    const testTableNumber = `T${Math.floor(Math.random() * 20) + 1}`;
    const channels: ('table-map' | 'togo' | 'delivery' | 'online')[] = ['table-map', 'togo', 'delivery', 'online'];
    const randomChannel = channels[Math.floor(Math.random() * channels.length)];
    
    const sampleItems = ['Burger', 'Pizza', 'Pasta', 'Salad', 'Drink'];
    const orderItems = [sampleItems[Math.floor(Math.random() * sampleItems.length)]];
    
    addOrderNotification(testTableNumber, randomChannel, orderItems);
  };

  // 통합 테스트 함수 (콜 알람 3개 + 주문 알람 3개)
  const addMixedTestNotifications = () => {
    // 중복되지 않는 테이블 번호 생성 (총 6개)
    const usedNumbers = new Set<number>();
    const testTableNumbers: string[] = [];
    
    while (testTableNumbers.length < 6) {
      const randomNum = Math.floor(Math.random() * 20) + 1;
      if (!usedNumbers.has(randomNum)) {
        usedNumbers.add(randomNum);
        testTableNumbers.push(`T${randomNum}`);
      }
    }
    
    const channels: ('table-map' | 'togo' | 'delivery' | 'online')[] = ['table-map', 'togo', 'delivery', 'online'];
    const sampleItems = ['Burger', 'Pizza', 'Pasta', 'Salad', 'Drink', 'Steak'];
    
    // 알람 타입 배열 (콜 3개 + 주문 3개)
    const notificationTypes = ['call', 'call', 'call', 'order', 'order', 'order'];
    
    // 배열을 섞어서 랜덤하게 배치
    const shuffledTypes = [...notificationTypes].sort(() => Math.random() - 0.5);
    
    // 0.8초 간격으로 6개의 알람 추가 (콜과 주문이 섞여서)
    shuffledTypes.forEach((type, index) => {
      setTimeout(() => {
        const tableNumber = testTableNumbers[index];
        const randomChannel = channels[Math.floor(Math.random() * channels.length)];
        
        if (type === 'call') {
          addCallNotification(tableNumber, randomChannel);
        } else {
          const orderItems = [sampleItems[Math.floor(Math.random() * sampleItems.length)]];
          addOrderNotification(tableNumber, randomChannel, orderItems);
        }
      }, index * 800); // 0.8초 간격
    });
  };

  // 캔바스용 Call 알람 컴포넌트
  const CallNotificationCanvasComponent = () => {
    if (callNotifications.length === 0) return null;

    return (
      <>
        {callNotifications.map((notification, index) => {
          const swipeState = swipeStates[notification.id];
          const swipeDistance = swipeState ? swipeState.currentX - swipeState.startX : 0;
          const opacity = swipeState && swipeState.isSwiping ? Math.max(0.3, 1 - Math.abs(swipeDistance) / 200) : 1;
          
          return (
            <div
              key={notification.id}
              className="absolute z-50"
              style={{ 
                top: `${16 + (index * 60)}px`, // 16px(top-4) + 각 알람마다 60px 간격
                right: '16px' // right-4
              }}
            >
              <div
                className="bg-red-500 text-white px-3 py-2 rounded-lg shadow-lg border-l-4 border-red-600 animate-pulse cursor-grab active:cursor-grabbing"
                style={{ 
                  minWidth: '180px',
                  transform: `translateX(${swipeDistance}px)`,
                  opacity: opacity,
                  transition: swipeState && swipeState.isSwiping ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out'
                }}
                onMouseDown={(e) => handleSwipeStart(notification.id, e.clientX)}
                onMouseMove={(e) => {
                  if (swipeState && swipeState.isSwiping) {
                    handleSwipeMove(notification.id, e.clientX);
                  }
                }}
                onMouseUp={() => handleSwipeEnd(notification.id)}
                onMouseLeave={() => handleSwipeEnd(notification.id)}
                onTouchStart={(e) => handleSwipeStart(notification.id, e.touches[0].clientX)}
                onTouchMove={(e) => {
                  if (swipeState && swipeState.isSwiping) {
                    handleSwipeMove(notification.id, e.touches[0].clientX);
                  }
                }}
                onTouchEnd={() => handleSwipeEnd(notification.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-bold text-sm">
                      {notification.message}
                    </div>
                    <div className="text-xs opacity-75 mt-1">
                      {notification.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  // 캔바스용 Order 알람 컴포넌트
  const OrderNotificationCanvasComponent = () => {
    if (orderNotifications.length === 0) return null;

    return (
      <>
        {orderNotifications.map((notification, index) => {
          const swipeState = orderSwipeStates[notification.id];
          const swipeDistance = swipeState ? swipeState.currentX - swipeState.startX : 0;
          const opacity = swipeState && swipeState.isSwiping ? Math.max(0.3, 1 - Math.abs(swipeDistance) / 200) : 1;
          
          return (
            <div
              key={notification.id}
              className="absolute z-50"
              style={{ 
                top: `${16 + (callNotifications.length * 60) + (index * 60)}px`, // Call 알람들 아래에 배치
                right: '16px' // right-4
              }}
            >
              <div
                className="bg-yellow-500 text-black px-3 py-2 rounded-lg shadow-lg border-l-4 border-yellow-600 animate-pulse cursor-grab active:cursor-grabbing"
                style={{ 
                  minWidth: '180px',
                  transform: `translateX(${swipeDistance}px)`,
                  opacity: opacity,
                  transition: swipeState && swipeState.isSwiping ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out'
                }}
                onMouseDown={(e) => handleOrderSwipeStart(notification.id, e.clientX)}
                onMouseMove={(e) => {
                  if (swipeState && swipeState.isSwiping) {
                    handleOrderSwipeMove(notification.id, e.clientX);
                  }
                }}
                onMouseUp={() => handleOrderSwipeEnd(notification.id)}
                onMouseLeave={() => handleOrderSwipeEnd(notification.id)}
                onTouchStart={(e) => handleOrderSwipeStart(notification.id, e.touches[0].clientX)}
                onTouchMove={(e) => {
                  if (swipeState && swipeState.isSwiping) {
                    handleOrderSwipeMove(notification.id, e.touches[0].clientX);
                  }
                }}
                onTouchEnd={() => handleOrderSwipeEnd(notification.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-bold text-sm">
                      {notification.message}
                    </div>
                    <div className="text-xs opacity-75 mt-1">
                      {notification.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  // 알람 컴포넌트 (기존 - 사용하지 않음)
  const CallNotificationComponent = () => {
    return null; // 캔바스용으로 대체
  };

  // 주문 알람 컴포넌트 (기존 - 사용하지 않음)  
  const OrderNotificationComponent = () => {
    return null; // 캔바스용으로 대체
  };

  // 테이블 요소들의 좌표 디버깅
  useEffect(() => {
    console.log('=== 현재 테이블 요소들의 좌표 ===');
    tableElements.forEach((element, index) => {
      console.log(`${index + 1}. ${getElementDisplayName(element)}:`);
      console.log(`   - ID: ${element.id}`);
      console.log(`   - Type: ${element.type}`);
      console.log(`   - Position: (${element.position.x}, ${element.position.y})`);
      console.log(`   - Size: ${element.size.width} × ${element.size.height}`);
      console.log(`   - Rotation: ${element.rotation || 0}°`);
      console.log('---');
    });
  }, [tableElements]);

  // Restroom 이미지
  const restroomImage = '/images/restroom.png';
  
  // Counter 이미지
  const counterImage = '/images/pos.png';

  // Undo/Redo 이미지
  const undoImage = '/images/undo.png?v=' + Date.now();
  const redoImage = '/images/redo.png?v=' + Date.now();

  // Reset 이미지
  const resetImage = '/images/reset.png?v=' + Date.now();

  // Delete 이미지 (휴지통)
  const deleteImage = '/images/delete.png?v=' + Date.now();

  // Floor 변경 시 테이블 요소들 저장 및 불러오기
  const handleFloorChange = async (floor: string) => {
    console.log('handleFloorChange called with floor:', floor);
    console.log('Current selectedFloor:', selectedFloor);
    console.log('Current tableElements:', tableElements);
    
    try {
      // 현재 Floor의 테이블 요소들 저장
      localStorage.setItem(`tableMapElements_${selectedFloor}`, JSON.stringify(tableElements));
      
      // 현재 Floor의 색상 정보 저장
      localStorage.setItem(`tableMapElementCounts_${selectedFloor}`, JSON.stringify(elementTypeCounts));
      localStorage.setItem(`tableMapFirstColors_${selectedFloor}`, JSON.stringify(firstElementColors));
      localStorage.setItem(`tableMapStatusIndex_${selectedFloor}`, JSON.stringify(tableStatusIndex));
      
      // 새 Floor 선택
      setSelectedFloor(floor);
      localStorage.setItem('tableMapSelectedFloor', floor);
      
      // 새 Floor의 테이블 요소들 불러오기 (백엔드 API 사용)
      const newTableElements = await getSavedTableElements(floor);
      console.log('Loaded table elements for new floor:', newTableElements);
      setTableElements(newTableElements);
      
      // 새 Floor의 색상 정보 불러오기
      const newColorInfo = getSavedColorInfo(floor);
      console.log('Loaded color info for new floor:', newColorInfo);
      setElementTypeCounts(newColorInfo.elementTypeCounts);
      setFirstElementColors(newColorInfo.firstElementColors);
      setTableStatusIndex(newColorInfo.tableStatusIndex);
      
      // 히스토리 초기화
      setHistory([{ tableElements: newTableElements, timestamp: Date.now() }]);
      setHistoryIndex(0);
      
      console.log(`Floor changed to ${floor}, loaded ${newTableElements.length} elements`);
    } catch (error) {
      console.error('Error in handleFloorChange:', error);
    }
  };

  // 새로운 Floor 추가
  const handleAddNewFloor = () => {
    console.log('handleAddNewFloor called with:', { newFloorName, floorList });
    
    try {
      if (newFloorName.trim() && !floorList.includes(newFloorName.trim())) {
        const newFloor = newFloorName.trim();
        console.log('Adding new floor:', newFloor);
        
        const updatedFloorList = [...floorList, newFloor];
        console.log('Updated floor list:', updatedFloorList);
        
        setFloorList(updatedFloorList);
        localStorage.setItem('tableMapFloorList', JSON.stringify(updatedFloorList));
        
        // 새 Floor의 기본 요소들을 저장 (빈 배열로 시작)
        localStorage.setItem(`tableMapElements_${newFloor}`, JSON.stringify([]));
        
        // 새 Floor의 색상 정보 초기화
        localStorage.setItem(`tableMapElementCounts_${newFloor}`, JSON.stringify({}));
        localStorage.setItem(`tableMapFirstColors_${newFloor}`, JSON.stringify({}));
        localStorage.setItem(`tableMapStatusIndex_${newFloor}`, JSON.stringify({}));
        
        // 새 Floor로 자동 전환
        console.log('Calling handleFloorChange with:', newFloor);
        handleFloorChange(newFloor);
        
        // 모달 닫기 및 입력 필드 초기화
        setShowAddFloorModal(false);
        setNewFloorName('');
        
        console.log(`New floor "${newFloor}" added successfully to channel tabs`);
      } else {
        console.log('Validation failed:', { 
          hasName: !!newFloorName.trim(), 
          alreadyExists: floorList.includes(newFloorName.trim()) 
        });
      }
    } catch (error) {
      console.error('Error in handleAddNewFloor:', error);
    }
  };

  // Floor 삭제 확인 모달 표시
  const showDeleteFloorConfirm = (floor: string) => {
    setFloorToDelete(floor);
    setShowDeleteFloorModal(true);
  };

  // Floor 삭제 실행
  const handleDeleteFloor = (floorToDelete: string) => {
    if (floorList.length > 1) {
      const updatedFloorList = floorList.filter(floor => floor !== floorToDelete);
      
      setFloorList(updatedFloorList);
      localStorage.setItem('tableMapFloorList', JSON.stringify(updatedFloorList));
      
      // 삭제된 Floor의 데이터도 제거
      localStorage.removeItem(`tableMapElements_${floorToDelete}`);
      localStorage.removeItem(`tableMapElementCounts_${floorToDelete}`);
      localStorage.removeItem(`tableMapFirstColors_${floorToDelete}`);
      localStorage.removeItem(`tableMapStatusIndex_${floorToDelete}`);
      
      // 삭제된 Floor가 현재 선택된 Floor인 경우, 첫 번째 Floor로 전환
      if (floorToDelete === selectedFloor) {
        const firstFloor = updatedFloorList[0];
        handleFloorChange(firstFloor);
      }
      
      console.log(`Floor "${floorToDelete}" deleted successfully from channel tabs`);
      
      // 모달 닫기
      setShowDeleteFloorModal(false);
      setFloorToDelete('');
    }
  };

  // 채널 탭 표시/숨김 토글
  const toggleChannelVisibility = (channel: string) => {
    const newVisibility = {
      ...channelVisibility,
      [channel]: !channelVisibility[channel as keyof typeof channelVisibility]
    };
    setChannelVisibility(newVisibility);
    localStorage.setItem('tableMapChannelVisibility', JSON.stringify(newVisibility));
    
    // 숨겨진 채널이 현재 선택된 탭인 경우, 첫 번째 보이는 채널로 전환
    if (!newVisibility[channel as keyof typeof channelVisibility] && selectedTab === channel) {
      const firstVisibleChannel = Object.keys(newVisibility).find(key => newVisibility[key as keyof typeof newVisibility]);
      if (firstVisibleChannel) {
        setSelectedTab(firstVisibleChannel);
      }
    }
  };

  // 페이지 로딩 시 저장된 화면 크기 적용
  useEffect(() => {
    const savedSize = getSavedScreenSize();
    setScreenWidth(savedSize.width);
    setScreenHeight(savedSize.height);
    
    // 캔버스 스타일 업데이트
    handleApplyScreenSize();
    
    console.log(`Loaded saved screen size: ${savedSize.width} × ${savedSize.height}`);
  }, []);

  // 브라우저 창 크기 변경 감지 및 캔버스 조정
  useEffect(() => {
    const handleResize = () => {
      handleApplyScreenSize();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [screenWidth, screenHeight]);

  const saveToHistory = async (newTableElements: TableElement[]) => {
    // 디버깅 로그 추가
    console.log('🔍 saveToHistory 호출됨');
    console.log('newTableElements:', newTableElements);
    console.log('newTableElements type:', typeof newTableElements);
    console.log('newTableElements isArray:', Array.isArray(newTableElements));
    
    const newHistoryState: HistoryState = {
      tableElements: [...newTableElements],
      timestamp: Date.now()
    };
    
    // 현재 인덱스 이후의 히스토리를 제거하고 새로운 상태 추가
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newHistoryState);
    
    // 최대 10개까지만 유지
    if (newHistory.length > 10) {
      newHistory.shift();
    }
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    // localStorage에 현재 Floor의 테이블 요소들 저장
    localStorage.setItem(`tableMapElements_${selectedFloor}`, JSON.stringify(newTableElements));
    
    // 백엔드 API에 데이터 저장
    try {
      const allowedStatuses = ['Available', 'Occupied', 'Preparing', 'Reserved', 'Hold'];
      const requestBody = {
        elements: newTableElements.map(element => ({
          id: element.id,
          floor: selectedFloor,
          type: element.type,
          position: element.position,
          size: element.size,
          rotation: element.rotation || 0,
          text: element.text || '',
          fontSize: element.fontSize || 20,
          color: element.color || '#3B82F6',
          status: allowedStatuses.includes(String(element.status || '')) ? String(element.status) : 'Available'
        })),
        floor: selectedFloor
      };
      
      console.log('🔍 백엔드로 전송할 데이터:', requestBody);
      console.log('🔍 requestBody.elements:', requestBody.elements);
      console.log('🔍 requestBody.elements isArray:', Array.isArray(requestBody.elements));
      
      const response = await fetch(`${API_URL}/table-map/elements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const msg = await response.text().catch(() => '');
        throw new Error(`Save failed (${response.status}) ${msg}`);
      }
      console.log(`✅ Backend API: Saved ${newTableElements.length} elements for floor ${selectedFloor}`);
    } catch (error) {
      console.error('❌ Backend API: Error saving elements:', error);
      throw error;
    }
    
    console.log(`Saved ${newTableElements.length} elements for floor ${selectedFloor}`);
    return true;
  };

  const handleGoBack = () => {
    if (historyIndex > 0) {
      const previousState = history[historyIndex - 1];
      setTableElements(previousState.tableElements);
      setHistoryIndex(historyIndex - 1);
      setSelectedElement(null); // 선택 해제
      console.log(`Undo: Reverted to state ${historyIndex - 1} (${previousState.tableElements.length} elements)`);
    } else {
      console.log('No more history to undo');
    }
  };

  // Redo 기능 추가
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setTableElements(nextState.tableElements);
      setHistoryIndex(historyIndex + 1);
      setSelectedElement(null); // 선택 해제
      console.log(`Redo: Advanced to state ${historyIndex + 1} (${nextState.tableElements.length} elements)`);
    } else {
      console.log('No more history to redo');
    }
  };

  // Reset 기능 추가
  const handleReset = async () => {
    // 1. 현재 Floor의 모든 요소 삭제
    setTableElements([]);
    
    // 2. 선택된 요소 해제
    setSelectedElement(null);
    
    // 3. 히스토리 초기화
    setHistory([{
      tableElements: [],
      timestamp: Date.now()
    }]);
    setHistoryIndex(0);
    
    // 4. 색상 관련 상태 초기화
    setElementTypeCounts({});
    setFirstElementColors({});
    setTableStatusIndex(0);
    setSelectedColor('#3B82F6');
    
    // 5. localStorage에서 현재 Floor 데이터 삭제
    localStorage.removeItem(`tableMapElements_${selectedFloor}`);
    
    // 6. 백엔드 API에서 현재 Floor의 모든 요소 삭제
    try {
      const response = await fetch(`${API_URL}/table-map/elements/floor/${selectedFloor}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        console.log(`✅ Backend API: All elements deleted for floor ${selectedFloor}`);
      } else {
        console.warn(`⚠️ Backend API: Failed to delete elements for floor ${selectedFloor}`);
      }
    } catch (error) {
      console.error('❌ Backend API: Error deleting elements:', error);
    }
    
    console.log(`Reset: Cleared all elements and color states for floor ${selectedFloor}`);
  };

  // 키보드 단축키 처리
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 편집 모드일 때는 백스페이스와 딜리트 키를 허용
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      console.log('Key pressed:', e.key, 'Selected element:', selectedElement?.id, 'Is input field:', isInputField);
      
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+Z 또는 Cmd+Shift+Z: Redo
          handleRedo();
        } else {
          // Ctrl+Z 또는 Cmd+Z: Undo
          handleGoBack();
        }
      } else if (e.key === 'Delete' && !isInputField && selectedElement) {
        // Delete 키로 선택된 요소 삭제
        console.log('Delete key pressed - deleting element:', selectedElement.id);
        e.preventDefault();
        handleDeleteElement();
      } else if (e.key === 'Backspace' && !isInputField && selectedElement) {
        // Backspace 키로도 선택된 요소 삭제
        console.log('Backspace key pressed - deleting element:', selectedElement.id);
        e.preventDefault();
        handleDeleteElement();
      } else if (e.key === 'Escape') {
        // Escape 키로 선택 해제
        console.log('Escape key pressed - clearing selection');
        setSelectedElement(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, selectedElement]);

  const handleApplyScreenSize = async () => {
    const width = parseInt(screenWidth);
    const height = parseInt(screenHeight);
    
    // localStorage에 저장
    localStorage.setItem('tableMapScreenWidth', width.toString());
    localStorage.setItem('tableMapScreenHeight', height.toString());
    
    // 백엔드 API에 화면 크기 설정 저장
    try {
      const response = await fetch(`${API_URL}/table-map/screen-size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          width: width,
          height: height,
          scale: 1,
          floor: selectedFloor
        })
      });
      
      if (response.ok) {
        console.log(`✅ Backend API: Screen size saved for floor ${selectedFloor}`);
      } else {
        console.warn(`⚠️ Backend API: Failed to save screen size for floor ${selectedFloor}`);
      }
    } catch (error) {
      console.error('❌ Backend API: Error saving screen size:', error);
    }
    
    // Fixed Resolution Layout: 항상 설정된 크기 사용 (동적 조정 없음)
    setCanvasStyle({
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: 'none',
      maxHeight: 'none'
    });
    
    console.log(`✅ Fixed Resolution Layout applied: ${width} × ${height}px`);
  };

  // 테이블 요소인지 확인하는 함수
  const isTableElement = (element: TableElement) => {
    return ['circle', 'rounded-rectangle', 'bar', 'room'].includes(element.type);
  };

  // 테이블 요소들만 필터링하는 함수
  const getTableElements = () => {
    return tableElements.filter(isTableElement);
  };

  // 색상 선택이 비활성화되어야 하는지 확인
  const isColorSelectionDisabled = (elementType: string) => {
    // 요소가 선택되었으면 색상 선택 활성화
    if (selectedElement) {
      return false; // 선택된 요소가 있으면 색상 선택 활성화
    }
    
    // floor-label은 색상 선택 비활성화
    if (elementType === 'floor-label') {
      return true;
    }
    
    const count = elementTypeCounts[elementType] || 0;
    
    // 주문 가능한 요소(테이블/바/룸)는 특별 처리
    if (['circle', 'rounded-rectangle', 'bar', 'room'].includes(elementType)) {
      return count > 0; // 첫 번째 이후부터 비활성화
    }
    
    // 다른 요소들도 첫 번째 이후부터 비활성화
    return count > 0;
  };

  // 현재 선택된 색상 가져오기
  const getCurrentSelectedColor = () => {
    // 선택된 요소가 있으면 해당 요소의 색상 반환
    if (selectedElement) {
      return selectedElement.color || '#3B82F6';
    }
    
    const elementType = selectedTableType;
    
    // 주문 가능한 요소(테이블/바/룸)는 Available 상태의 색상 반환
    if (['circle', 'rounded-rectangle', 'bar', 'room'].includes(elementType)) {
      // Available 상태의 색상을 반환
      const statusKey = `table_Available`; // 'table_' 접두사로 통합 관리
      return firstElementColors[statusKey] || selectedColor;
    }
    
    // 다른 요소들은 첫 번째 색상 반환
    return firstElementColors[elementType] || selectedColor;
  };

  const handleAddTableElement = async () => {
    const currentCount = elementTypeCounts[selectedTableType] || 0;
    const isFirstElement = currentCount === 0;
    
    let elementColor = selectedColor;
    let elementStatus = 'Available'; // 항상 Available로 고정
    
    // 주문 가능한 요소(테이블/바/룸) 특별 처리
    if (['circle', 'rounded-rectangle', 'bar', 'room'].includes(selectedTableType)) {
      // 항상 Available 상태로 고정
      elementStatus = 'Available';
      
      // 주문 가능한 요소들의 총 개수 확인 (Circle + Square + Bar + Room)
      const totalTableCount =
        (elementTypeCounts['circle'] || 0) +
        (elementTypeCounts['rounded-rectangle'] || 0) +
        (elementTypeCounts['bar'] || 0) +
        (elementTypeCounts['room'] || 0);
      const isFirstTableElement = totalTableCount === 0;
      
      if (isFirstTableElement) {
        // 첫 번째 테이블 요소인 경우 현재 선택된 색상을 Available 상태에 저장
        setFirstElementColors(prev => ({ ...prev, table_Available: selectedColor }));
        elementColor = selectedColor;
      } else {
        // 두 번째 이후: Available 상태의 저장된 색상 사용
        elementColor = firstElementColors['table_Available'] || selectedColor;
      }
    } else {
      // 다른 요소들
      if (isFirstElement) {
        // 첫 번째 요소: 선택된 색상 사용하고 저장
        setFirstElementColors(prev => ({ ...prev, [selectedTableType]: selectedColor }));
        elementColor = selectedColor;
      } else {
        // 두 번째 이후: 첫 번째 색상 사용
        elementColor = firstElementColors[selectedTableType] || selectedColor;
      }
    }

    const newId = await generateElementNumber(selectedTableType);
    
    // 주문 가능한 요소 표시 번호 계산 (T/B/R1,2...) - Table/Bar/Room에 적용
    let displayText = '';
    if (selectedTableType === 'rounded-rectangle' || selectedTableType === 'circle') {
      const tableElements_ = tableElements.filter(el => el.type === 'rounded-rectangle' || el.type === 'circle');
      const existingNumbers = tableElements_.map(el => {
        const match = el.text?.match(/^T(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
      displayText = `T${maxNumber + 1}`;
    } else if (selectedTableType === 'bar') {
      const barElements_ = tableElements.filter(el => el.type === 'bar');
      const existingNumbers = barElements_.map(el => {
        const match = el.text?.match(/^B(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
      displayText = `B${maxNumber + 1}`;
    } else if (selectedTableType === 'room') {
      const roomElements_ = tableElements.filter(el => el.type === 'room');
      const existingNumbers = roomElements_.map(el => {
        const match = el.text?.match(/^R(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
      displayText = `R${maxNumber + 1}`;
    }
    
    const newElement: TableElement = {
      id: newId,
      type: selectedTableType,
      position: { x: 50, y: 50 },
      size: getElementSize(selectedTableType),
      rotation: 0,
      text: displayText,
      fontSize: 20,
      color: elementColor,
      status: elementStatus // 항상 'Available'
    };

    const updatedElements = [...tableElements, newElement];
    setTableElements(updatedElements);
    saveToHistory(updatedElements);
    
    // 카운터 업데이트
    setElementTypeCounts(prev => ({ ...prev, [selectedTableType]: currentCount + 1 }));
    
    // 상태 인덱스 업데이트 제거 - 더 이상 순환하지 않음
    
    console.log(`Added new ${selectedTableType} element with ID ${newElement.id} and color ${elementColor} with status ${elementStatus}`);
  };

  const getElementSize = (type: string) => {
    switch (type) {
      case 'rounded-rectangle':
        return { width: 80, height: 60 };
      case 'circle':
        return { width: 60, height: 60 };
      case 'bar':
      case 'room':
        return { width: 80, height: 60 };
      case 'entrance':
        return { width: 100, height: 40 };
      case 'counter':
        return { width: 120, height: 30 };
      case 'washroom':
        return { width: 80, height: 50 };
      case 'restroom':
        return { width: 80, height: 50 };
      case 'divider':
        return { width: 10, height: 80 };
      case 'wall':
        return { width: 15, height: 100 };
      case 'cook-area':
        return { width: 100, height: 80 };
      case 'other':
        return { width: 60, height: 60 };
      case 'floor-label':
        return { width: 120, height: 40 };
      default:
        return { width: 60, height: 60 };
    }
  };

  const getElementStyle = (element: TableElement) => {
    // Restroom과 Counter는 입체효과 없음
    if (['restroom', 'counter'].includes(element.type)) {
      let shapeClass = '';
      switch (element.type) {
        case 'restroom':
        case 'counter':
          shapeClass = 'rounded-xl';
          break;
        default:
          shapeClass = 'rounded-xl';
      }
      return `${shapeClass}`;
    }
    
    // 다른 요소들은 입체효과 적용
    const baseStyle = 'shadow-[inset_3px_3px_8px_rgba(255,255,255,0.3),inset_-3px_-3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:shadow-[inset_-3px_-3px_8px_rgba(255,255,255,0.3),inset_3px_3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:scale-105 active:scale-95 active:shadow-[inset_4px_4px_10px_rgba(255,255,255,0.2),inset_-4px_-4px_10px_rgba(0,0,0,0.4),0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-300';
    
    let shapeClass = '';
    switch (element.type) {
      case 'rounded-rectangle':
        shapeClass = 'rounded-2xl';
        break;
      case 'circle':
        shapeClass = 'rounded-full';
        break;
      case 'bar':
      case 'room':
        shapeClass = 'rounded-2xl';
        break;
      case 'entrance':
      case 'wall':
      case 'cook-area':
      case 'other':
        shapeClass = 'rounded-xl';
        break;
      case 'divider':
        shapeClass = 'rounded-full';
        break;
      case 'floor-label':
        shapeClass = 'rounded-lg';
        break;
      default:
        shapeClass = 'rounded-xl';
    }
    
    return `${shapeClass} ${baseStyle}`;
  };

  // 드래그 가능한 테이블 요소 컴포넌트
  const DraggableTableElement = ({ element, onSelect }: { element: TableElement; onSelect: (element: TableElement) => void }) => {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
      id: `table-${element.id}`,
      data: element
    });

    // 리사이즈 중인지 추적하는 상태
    const [isResizing, setIsResizing] = useState(false);
    const [isRotating, setIsRotating] = useState(false);
    
    // 텍스트 편집 상태 (전역 상태와 동기화)
    const isEditing = editingElementId === element.id;
    const [localInit] = useState(() => {
      if (editingElementId === null && (element.text || '')) {
        // 초기 렌더 시 전역값 미설정이면 요소값을 기본값으로 세팅
        setEditingText(element.text || '');
        setEditingFontSize(element.fontSize || 20);
      }
      return true;
    });

    // 편집 가능한 요소 타입들
    const editableTypes = ['rounded-rectangle', 'circle', 'bar', 'room', 'entrance', 'cook-area', 'other'];
    const isEditable = editableTypes.includes(element.type);

    // 선택 상태 확인
    const isSelected = selectedElement?.id === element.id;

    const style = {
      left: `${element.position.x}px`,
      top: `${element.position.y}px`,
      width: `${element.size.width}px`,
      height: `${element.size.height}px`,
      // 회전 적용 (요소 중심 기준)
      transformOrigin: 'center center',
      transform: isResizing
        ? 'none' 
        : `${CSS.Transform.toString(transform) || ''} rotate(${element.rotation || 0}deg)`
    };
    
    // transform 값 디버깅
    console.log(`Transform 값: CSS.Transform.toString(transform)="${CSS.Transform.toString(transform)}", rotation=${element.rotation || 0}`);

    // 드래그 중 실시간 위치 업데이트
    const handleDragStart = (e: any) => {
      if (mapLocked) return;
      console.log(`Started dragging table ${element.id}`);
    };

    // 클릭 감지 (드래그와 구분)
    const handleMouseDown = (e: React.MouseEvent) => {
      if (mapLocked) { e.preventDefault(); e.stopPropagation(); return; }
      if (isEditing) { e.preventDefault(); e.stopPropagation(); return; }
      // 리사이즈 핸들에서 클릭된 경우 리사이즈 처리
      if (e.target && (e.target as HTMLElement).closest('.resize-handle')) {
        return; // 리사이즈 핸들의 onMouseDown이 처리
      }
      
      // 회전 핸들에서 클릭된 경우 회전 처리
      if (e.target && (e.target as HTMLElement).closest('.rotate-handle')) {
        return; // 회전 핸들의 onMouseDown이 처리
      }
      
      // 리사이즈 중이면 드래그 차단
      if (isResizing) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      const startX = e.clientX;
      const startY = e.clientY;
      const startPosX = element.position.x;
      const startPosY = element.position.y;
      let hasMoved = false;
      let isDragging = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = Math.abs(moveEvent.clientX - startX);
        const deltaY = Math.abs(moveEvent.clientY - startY);
        
        // 5px 이상 움직였으면 드래그로 간주
        if (deltaX > 5 || deltaY > 5) {
          hasMoved = true;
          isDragging = true;
          
          // 드래그 중 실시간 위치 업데이트 (10픽셀 단위로 스냅)
          const rawDeltaX = moveEvent.clientX - startX;
          const rawDeltaY = moveEvent.clientY - startY;
          
          // 10픽셀 단위로 그룹화 (내림 처리)
          const scaledDeltaX = rawDeltaX / editorScale;
          const scaledDeltaY = rawDeltaY / editorScale;
          const moveSnap = 10;
          const groupedDeltaX = Math.floor(scaledDeltaX / moveSnap) * moveSnap;
          const groupedDeltaY = Math.floor(scaledDeltaY / moveSnap) * moveSnap;
          
          const newX = startPosX + groupedDeltaX;
          const newY = startPosY + groupedDeltaY;
          
          // 캔버스 경계 제한
          const canvasWidth = parseInt(canvasStyle.width?.replace('px', '') || '800');
          const canvasHeight = parseInt(canvasStyle.height?.replace('px', '') || '600');
          
          const clampedX = Math.max(0, Math.min(newX, canvasWidth - element.size.width));
          const clampedY = Math.max(0, Math.min(newY, canvasHeight - element.size.height));
          
          // 즉시 업데이트
          const updatedElements = tableElements.map(el => 
            el.id === element.id 
              ? { ...el, position: { x: clampedX, y: clampedY } }
              : el
          );
          
          setTableElements(updatedElements);
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        if (isDragging) {
          // 드래그 완료 시 히스토리 저장
          saveToHistory(tableElements);
          console.log(`Dragged element ${element.id} to position (${element.position.x}, ${element.position.y})`);
        } else if (!hasMoved) {
          // 움직이지 않았으면 클릭으로 간주
          e.stopPropagation();
          onSelect(element);
          console.log(`Selected element: ${element.id} (${element.type})`);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    // 더블클릭으로 텍스트 편집 모드 활성화
    const handleDoubleClick = (e: React.MouseEvent) => {
      if (isEditable) {
        e.stopPropagation();
        setEditingElementId(element.id);
        setEditingText(element.text || '');
        setEditingFontSize(element.fontSize || 20);
      }
    };

    // 텍스트 편집 완료
    const handleTextEditComplete = () => {
      const updatedElements = tableElements.map(el => 
        el.id === element.id 
          ? { ...el, text: editingText.trim(), fontSize: editingFontSize }
          : el
      );
      setTableElements(updatedElements);
      saveToHistory(updatedElements);
      setEditingElementId(null);
    };

    // 폰트 크기 증가
    const increaseFontSize = () => {
      const newSize = Math.min(60, editingFontSize + 2);
      setEditingFontSize(newSize);
    };

    // 폰트 크기 감소
    const decreaseFontSize = () => {
      const newSize = Math.max(8, editingFontSize - 2);
      setEditingFontSize(newSize);
    };

    // 자동 폰트 크기 증가 (버튼 누르고 있을 때)
    const startAutoIncrease = () => {
      const interval = setInterval(() => {
        setEditingFontSize(prev => {
          const newSize = Math.min(60, prev + 2);
          if (newSize >= 60) {
            clearInterval(interval);
          }
          return newSize;
        });
      }, 100); // 100ms마다 증가
      
      // 마우스 떼면 정지
      const stopAutoIncrease = () => {
        clearInterval(interval);
        document.removeEventListener('mouseup', stopAutoIncrease);
        document.removeEventListener('mouseleave', stopAutoIncrease);
      };
      
      document.addEventListener('mouseup', stopAutoIncrease);
      document.addEventListener('mouseleave', stopAutoIncrease);
    };

    // 자동 폰트 크기 감소 (버튼 누르고 있을 때)
    const startAutoDecrease = () => {
      const interval = setInterval(() => {
        setEditingFontSize(prev => {
          const newSize = Math.max(8, prev - 2);
          if (newSize <= 8) {
            clearInterval(interval);
          }
          return newSize;
        });
      }, 100); // 100ms마다 감소
      
      // 마우스 떼면 정지
      const stopAutoDecrease = () => {
        clearInterval(interval);
        document.removeEventListener('mouseup', stopAutoDecrease);
        document.removeEventListener('mouseleave', stopAutoDecrease);
      };
      
      document.addEventListener('mouseup', stopAutoDecrease);
      document.addEventListener('mouseleave', stopAutoDecrease);
    };

    // 회전 핸들러
    const handleRotate = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      
      console.log('회전 시작!', element.id);
      
      // 회전 상태 설정
      setIsRotating(true);
      
      const startX = e.clientX;
      const startY = e.clientY;
      const startRotation = (element.rotation !== undefined) ? element.rotation : 0;
      
      console.log('시작 회전값:', startRotation);
      
      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        
        // 마우스 움직임을 각도로 변환 (간단한 방식)
        const angleChange = (deltaX + deltaY) * 0.3; // 감도 조정
        const newRotation = startRotation + angleChange;
        
        // 15도 단위로 반올림
        const snappedRotation = Math.round(newRotation / 15) * 15;
        
        console.log(`회전 계산: deltaX=${deltaX}, deltaY=${deltaY}, angleChange=${angleChange.toFixed(1)}, newRotation=${newRotation.toFixed(1)}, snapped=${snappedRotation}`);
        
        // 즉시 업데이트
        const updatedElements = tableElements.map(el => 
          el.id === element.id 
            ? { ...el, rotation: snappedRotation }
            : el
        );
        
        setTableElements(updatedElements);
        console.log(`요소 업데이트: ID=${element.id}, rotation=${snappedRotation}`);
        
        // 실제 스타일 확인을 위한 로그
        setTimeout(() => {
          const elementEl = document.getElementById(`table-element-${element.id}`);
          if (elementEl) {
            const computedStyle = window.getComputedStyle(elementEl);
            console.log(`실제 transform: ${computedStyle.transform}`);
            console.log(`실제 transform-origin: ${computedStyle.transformOrigin}`);
            console.log(`isResizing: ${isResizing}, isRotating: ${isRotating}`);
          }
        }, 100);
      };
      
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        setIsRotating(false);
        saveToHistory(tableElements);
        console.log('회전 완료!');
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };



    const handleResize = (direction: 'nw' | 'ne' | 'sw' | 'se', e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      
      // 리사이즈 시작 - 드래그 변환 비활성화
      setIsResizing(true);
      
      // 절대적으로 고정된 좌측 상단 위치 - 변경 불가
      const fixedPosX = element.position.x;
      const fixedPosY = element.position.y;
      
      console.log(`리사이즈 시작 - 고정 위치: (${fixedPosX}, ${fixedPosY})`);
      
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = element.size.width;
      const startHeight = element.size.height;
      
      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        
        // 마우스 움직임 계산
        const currentX = moveEvent.clientX;
        const currentY = moveEvent.clientY;
        const deltaX = (currentX - startX) / editorScale;
        const deltaY = (currentY - startY) / editorScale;
        
        // 5픽셀 단위로 그룹화 (내림 처리하여 5픽셀 이상 움직여야 반응)
        const resizeSnap = 5;
        const groupedDeltaX = Math.floor(deltaX / resizeSnap) * resizeSnap;
        const groupedDeltaY = Math.floor(deltaY / resizeSnap) * resizeSnap;
        
        // 절대적으로 좌측 상단 모서리 고정 - 위치는 절대 변경되지 않음
        let newWidth = startWidth;
        let newHeight = startHeight;
        
        // 캔버스 경계 제한
        const canvasWidth = parseInt(canvasStyle.width?.replace('px', '') || '800');
        const canvasHeight = parseInt(canvasStyle.height?.replace('px', '') || '600');
        
        // 최소 크기 제한
        const minSize = 30;
        
        // Divider와 Wall에 대한 특별한 크기 제한
        let minWidth = minSize;
        let minHeight = minSize;
        let maxWidth = canvasWidth - fixedPosX;
        let maxHeight = canvasHeight - fixedPosY;
        
        if (element.type === 'divider') {
          minWidth = 5;  // Divider 최소 너비
          maxWidth = 20; // Divider 최대 너비
          minHeight = 20; // Divider 최소 높이
        } else if (element.type === 'wall') {
          minWidth = 10;  // Wall 최소 너비
          maxWidth = 30;  // Wall 최대 너비
          minHeight = 20; // Wall 최소 높이
        }
        
        // 원형인 경우 항상 정사각형 유지
        if (element.type === 'circle') {
          // 마우스 움직임 중 더 큰 방향을 기준으로 정사각형 유지 (5픽셀 단위)
          const maxDelta = Math.max(groupedDeltaX, groupedDeltaY);
          const newSize = Math.max(minSize, startWidth + maxDelta);
          newWidth = newSize;
          newHeight = newSize;
        } else {
          // 사각형인 경우 마우스 움직임을 5픽셀 단위로 그룹화
          newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + groupedDeltaX));
          newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + groupedDeltaY));
        }
        
        // 캔버스 경계 제한
        if (fixedPosX + newWidth > canvasWidth) {
          newWidth = canvasWidth - fixedPosX;
          if (element.type === 'circle') {
            newHeight = newWidth; // 원형 유지
          }
        }
        if (fixedPosY + newHeight > canvasHeight) {
          newHeight = canvasHeight - fixedPosY;
          if (element.type === 'circle') {
            newWidth = newHeight; // 원형 유지
          }
        }
        
        // 즉시 업데이트 - 위치는 절대 변경되지 않음
        const updatedElements = tableElements.map(el => 
          el.id === element.id 
            ? { 
                ...el, 
                position: { x: fixedPosX, y: fixedPosY }, // 절대 고정된 위치 - 변경 불가
                size: { width: newWidth, height: newHeight }
              }
            : el
        );
        
        setTableElements(updatedElements);
        
        // 디버깅용 로그 - 위치 고정 확인
        console.log(`✅ 고정 위치 유지: (${fixedPosX}, ${fixedPosY}), 크기 변경: (${newWidth}, ${newHeight}), 마우스 델타: (${deltaX}, ${deltaY}), 그룹화 델타: (${groupedDeltaX}, ${groupedDeltaY})`);
      };
      
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        // 리사이즈 종료 - 드래그 변환 다시 활성화
        setIsResizing(false);
        saveToHistory(tableElements);
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    return (
      <div
        ref={setNodeRef}
        {...(isResizing || isRotating || isEditing ? {} : attributes)}
        {...(isResizing || isRotating || isEditing ? {} : listeners)}
        className={`absolute ${isEditing ? 'cursor-text' : 'cursor-move'} flex items-center justify-center text-white font-bold text-xs ${
          (isResizing || isRotating) ? '' : ''
        } ${
          isSelected 
            ? 'border-2 border-yellow-500 shadow-lg ring-1 ring-yellow-300' 
            : ''
        } ${getElementStyle(element)}`}
        style={{
          ...style,
          backgroundColor: ['restroom', 'counter'].includes(element.type) ? 'transparent' : (element.color || '#3B82F6'),
          background: ['restroom', 'counter'].includes(element.type) ? 'transparent' : 
            (element.status === 'Hold') ? 
              getTableStatusGradient(element.status || 'Available') : 
              (element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? 6 : undefined
        }}
        id={`table-element-${element.id}`}
        data-resizing={isResizing ? 'true' : 'false'}
        onDragStart={(isResizing || isRotating || isEditing) ? undefined : handleDragStart}
        onMouseDown={handleMouseDown}
        onDoubleClick={(e) => {
          if (mapLocked) { e.preventDefault(); e.stopPropagation(); return; }
          setEditingElementId(element.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (mapLocked) return;
          if (isEditable) {
            setEditingElementId(element.id);
            setEditingText(element.text || '');
            setEditingFontSize(element.fontSize || 20);
          }
        }}
        // 편집/리사이즈 중에는 상위 포인터 이벤트 차단
        onPointerDown={(isResizing || isEditing) ? (e) => {
          if (isEditing) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // 리사이즈 핸들이 아닌 경우에만 차단
          if (!e.target || !(e.target as HTMLElement).closest('.resize-handle')) {
            e.preventDefault();
            e.stopPropagation();
          }
        } : undefined}
        onPointerMove={(isResizing || isEditing) ? (e) => {
          if (isEditing) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // 리사이즈 핸들이 아닌 경우에만 차단
          if (!e.target || !(e.target as HTMLElement).closest('.resize-handle')) {
            e.preventDefault();
            e.stopPropagation();
          }
        } : undefined}

      >
        {element.type === 'restroom' ? (
          <img 
            src={restroomImage} 
            alt="Restroom"
            className="w-full h-full object-contain"
            draggable="false"
            onDragStart={(e) => {
              e.preventDefault();
            }}
          />
        ) : element.type === 'counter' ? (
          <img 
            src={counterImage} 
            alt="Counter"
            className="w-full h-full object-contain"
            draggable="false"
            onDragStart={(e) => {
              e.preventDefault();
            }}
          />
        ) : isEditing ? (
          // 편집 모드 - 텍스트는 역회전하여 수평 유지
          <div 
            className="w-full h-full flex flex-col items-center justify-center p-2 pointer-events-auto"
            style={{ 
              transform: `rotate(${-(element.rotation || 0)}deg)`,
              transformOrigin: 'center center'
            }}
          >
            <div className="flex gap-1 mb-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  decreaseFontSize();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  startAutoDecrease();
                }}
                className="w-6 h-6 bg-gray-100 text-gray-700 text-sm rounded flex items-center justify-center hover:scale-110 active:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.2)] pointer-events-auto font-bold transition-all duration-200"
                style={{
                  boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(0,0,0,0.15)'
                }}
                title="폰트 크기 감소"
              >
                -
              </button>
              <span className="text-gray-700 text-xs px-2 py-1 bg-gray-100 rounded flex items-center justify-center" style={{ 
                boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(0,0,0,0.15)'
              }}>{editingFontSize}px</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  increaseFontSize();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  startAutoIncrease();
                }}
                className="w-6 h-6 bg-gray-100 text-gray-700 text-sm rounded flex items-center justify-center hover:scale-110 active:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.2)] pointer-events-auto font-bold transition-all duration-200"
                style={{
                  boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.8), inset -2px -2px 4px rgba(0,0,0,0.15)'
                }}
                title="폰트 크기 증가"
              >
                +
              </button>
            </div>
            <input
              type="text"
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
            // onBlur 시 자동 종료를 막아 편집을 유지
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); }}
            onDoubleClick={(e) => { e.stopPropagation(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleTextEditComplete();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                setEditingElementId(null);
                }
                // 스페이스 키는 기본 동작 허용
                if (e.key === ' ') {
                  e.stopPropagation();
                }
              }}
              className="w-full text-center bg-transparent border-none outline-none text-white font-bold pointer-events-auto"
              style={{ fontSize: `${editingFontSize}px` }}
              autoFocus
            />
          </div>
        ) : (
          // 일반 모드 - 텍스트는 역회전하여 수평 유지
          <div 
            className="w-full h-full flex items-center justify-center text-white font-bold"
            style={{ 
              fontSize: `${element.fontSize || 12}px`,
              transform: `rotate(${-(element.rotation || 0)}deg)`,
              transformOrigin: 'center center'
            }}
          >
            {element.text || getElementDisplayName(element)}
          </div>
        )}
        
        
                 {/* 리사이즈 영역 - 우하단 투명 영역 (선택된 요소에만 표시) */}
         {isSelected && !mapLocked && (
           <div 
             className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize resize-handle z-10"
             style={{ 
               transform: 'translate(25%, 25%)'
             }}
             onMouseDown={(e) => {
               e.stopPropagation();
               e.preventDefault();
               handleResize('se', e);
             }}
           />
         )}
         
         {/* 회전 영역 - 우상단 투명 영역 (선택된 요소에만 표시) */}
         {isSelected && !mapLocked && (
           <div 
             className="absolute top-0 right-0 w-6 h-6 cursor-grab rotate-handle z-10"
             style={{ 
               transform: 'translate(50%, -50%)'
             }}
             onMouseDown={(e) => {
               console.log('회전 핸들 클릭됨!');
               e.stopPropagation();
               e.preventDefault();
               handleRotate(e);
             }}
           />
         )}
         
         
      </div>
    );
  };

  // 드래그 종료 이벤트 핸들러
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    
    // 리사이즈 중인지 확인 (모든 요소에서 확인)
    const isAnyResizing = tableElements.some(el => {
      const elementComponent = document.getElementById(`table-element-${el.id}`);
      return elementComponent?.getAttribute('data-resizing') === 'true';
    });
    
    // 리사이즈 중이면 드래그 종료 무시
    if (isAnyResizing) {
      console.log('Ignoring drag end during resize');
      return;
    }
    
    if (active.id.toString().startsWith('table-')) {
      const elementId = parseInt(active.id.toString().replace('table-', ''));
      const element = tableElements.find(el => el.id === elementId);
      
              if (element) {
          // delta 값을 직접 사용하여 정확한 위치 계산
          const scaledDx = delta.x / editorScale;
          const scaledDy = delta.y / editorScale;
          const newX = element.position.x + scaledDx;
          const newY = element.position.y + scaledDy;
          
          // 캔버스 경계 내에서만 이동 가능하도록 제한
          const canvasWidth = parseInt(canvasStyle.width?.replace('px', '') || '800');
          const canvasHeight = parseInt(canvasStyle.height?.replace('px', '') || '600');
          
          const clampedX = Math.max(0, Math.min(newX, canvasWidth - element.size.width));
          const clampedY = Math.max(0, Math.min(newY, canvasHeight - element.size.height));
          
          const updatedElements = tableElements.map(el => 
            el.id === elementId 
              ? { ...el, position: { x: clampedX, y: clampedY } }
              : el
          );
          
          setTableElements(updatedElements);
          saveToHistory(updatedElements);
          
          console.log(`Moved table ${elementId} to position (${Math.round(clampedX)}, ${Math.round(clampedY)})`);
          console.log(`Delta: (${delta.x}, ${delta.y}) scale=${editorScale.toFixed(3)} -> (${scaledDx.toFixed(2)}, ${scaledDy.toFixed(2)})`);
        }
    }
  };

  // 선택된 요소 삭제 함수
  const handleDeleteElement = () => {
    if (selectedElement) {
      const updatedElements = tableElements.filter(el => el.id !== selectedElement.id);
      setTableElements(updatedElements);
      setSelectedElement(null);
      saveToHistory(updatedElements); // 삭제 후 즉시 저장
      console.log(`Element ${selectedElement.id} deleted successfully`);
    } else {
      console.log('No element selected for deletion');
    }
  };

  // 요소 선택 함수
  const handleElementClick = (element: TableElement) => {
    setSelectedElement(element);
    console.log(`Selected element: ${element.id} (${element.type})`);
  };

  // 선택 해제 함수
  const handleCanvasClick = (e: React.MouseEvent) => {
    // 캔버스 배경이나 여백을 클릭했을 때만 선택 해제
    if (e.target === e.currentTarget || 
        (e.target as HTMLElement).classList.contains('bg-gray-100') ||
        (e.target as HTMLElement).classList.contains('bg-grid-pattern')) {
      setSelectedElement(null);
      console.log('Selection cleared - clicked on background');
    }
  };

  // 테이블 번호 생성 함수 - timestamp 기반으로 절대 충돌하지 않는 고유 ID 생성
  const generateElementNumber = async (type: string) => {
    // timestamp + random으로 절대 충돌하지 않는 ID 생성
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const newId = timestamp * 1000 + random;
    
    console.log(`Generated unique ID: ${newId} for ${type} element (timestamp-based)`);
    return newId;
  };

  // 요소 표시 이름 결정 함수
  const getElementDisplayName = (element: TableElement) => {
    switch (element.type) {
      case 'rounded-rectangle':
      case 'circle':
      case 'bar':
      case 'room': {
        // 주문 가능한 요소(Table/Bar/Room): text 우선 사용 (T1/B1/R1 형식)
        const raw = (element.text && String(element.text).trim()) ? String(element.text).trim() : '';
        const prefix = element.type === 'bar' ? 'B' : (element.type === 'room' ? 'R' : 'T');
        let displayName = raw || `${prefix}${element.id}`;
        
        // Occupied 상태인 경우 시간 표시
        if (element.status === 'Occupied' && tableOccupiedTimes[String(element.id)]) {
          const now = Date.now();
          const elapsed = Math.floor((now - tableOccupiedTimes[String(element.id)]) / 1000 / 60); // 분 단위
          const hours = Math.floor(elapsed / 60);
          const minutes = elapsed % 60;
          displayName += `\n${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }
        // Hold 또는 Reserved 상태인 경우 예약자 이름 표시
        else if ((element.status === 'Hold' || element.status === 'Reserved') && tableReservationNames[String(element.id)]) {
          displayName += `\n${tableReservationNames[String(element.id)]}`;
        }
        
        return displayName;
      }
      // 나머지 요소들은 이름 표시 안함
      case 'entrance':
      case 'counter':
      case 'washroom':
      case 'restroom':
      case 'cook-area':
      case 'divider':
      case 'wall':
      case 'other':
      case 'floor-label':
      default:
        return ''; // 이름 표시 안함
    }
  };

  // 그라데이션 색상 계산 함수 추가
  const generateGradientColors = (count: number) => {
    const startColor = '#75A2BF';
    const endColor = '#2F5F8A';
    
    const colors = [];
    for (let i = 0; i < count; i++) {
      const ratio = i / (count - 1);
      const color = interpolateColor(startColor, endColor, ratio);
      colors.push(color);
    }
    return colors;
  };

  // 테두리 그라데이션 색상 계산 함수 추가
  const generateBorderGradientColors = (count: number) => {
    const startColor = '#2F5F8A'; // 어두운 색상으로 시작
    const endColor = '#75A2BF';   // 밝은 색상으로 끝
    
    const colors = [];
    for (let i = 0; i < count; i++) {
      const ratio = i / (count - 1);
      const color = interpolateColor(startColor, endColor, ratio);
      colors.push(color);
    }
    return colors;
  };

  // 테이블 상태별 색상 정의
  const getTableStatusColor = (status: string) => {
    switch (status) {
      case 'Available':
        return '#3B82F6'; // Blue (Restored)
      case 'Occupied':
        return '#EF4444'; // Red (Restored)
      case 'Payment Pending':
        return '#fb923c'; // Bright Orange (Orange-400)
      case 'Preparing':
        return '#9ca3af'; // Silver/Gray (Gray-400)
      case 'Reserved':
        return '#c2410c'; // Darker Orange
      case 'Hold':
        return '#9ca3af'; // Silver/Gray
      default:
        return '#3B82F6'; // 기본값 (Available)
    }
  };

  // 테이블 상태별 그라데이션 배경 정의 (Hold 상태만)
  const getTableStatusGradient = (status: string) => {
    switch (status) {
      case 'Hold':
        // Hold: 내부 Reserved(노랑) 단색
        return '#EAB308';
      default:
        return getTableStatusColor(status); // 기본 색상 (다른 상태는 단색)
    }
  };


  // 스크린샷 기반 색상 팔레트 생성 함수
  const generateRainbowPalette = () => {
    const colors = [];
    
    // Column 1: Greens (8개)
    const greens = [
      '#90EE90', '#7CFC00', '#32CD32', '#228B22', '#006400', '#008000', '#228B22', '#2E8B57'
    ];
    colors.push(...greens);
    
    // Column 2: Teals/Aqua (8개)
    const teals = [
      '#40E0D0', '#00CED1', '#20B2AA', '#008B8B', '#008080', '#006666', '#004D4D', '#003333'
    ];
    colors.push(...teals);
    
    // Column 3: Blues (8개)
    const blues = [
      '#87CEEB', '#4682B4', '#4169E1', '#0000CD', '#000080', '#00008B', '#0000FF', '#000033'
    ];
    colors.push(...blues);
    
    // Column 4: Purples/Lavenders (8개)
    const purples = [
      '#E6E6FA', '#DDA0DD', '#9370DB', '#8A2BE2', '#800080', '#4B0082', '#663399', '#2E0854'
    ];
    colors.push(...purples);
    
    // Column 5: Pinks/Magentas (8개)
    const pinks = [
      '#FFB6C1', '#FF69B4', '#FF1493', '#DC143C', '#C71585', '#8B0000', '#800020', '#4B0014'
    ];
    colors.push(...pinks);
    
    // Column 6: Reds (8개)
    const reds = [
      '#FFA07A', '#FF6347', '#FF4500', '#FF0000', '#DC143C', '#B22222', '#8B0000', '#660000'
    ];
    colors.push(...reds);
    
    // Column 7: Oranges/Browns (8개)
    const oranges = [
      '#FFE4B5', '#FFA500', '#FF8C00', '#FF7F50', '#CD853F', '#A0522D', '#8B4513', '#654321'
    ];
    colors.push(...oranges);
    
    // Column 8: Yellows (8개)
    const yellows = [
      '#FFFFE0', '#FFFF00', '#FFD700', '#FFA500', '#FF8C00', '#DAA520', '#B8860B', '#8B6914'
    ];
    colors.push(...yellows);
    
    // Column 9: Muted/Earthy Tones (8개)
    const earths = [
      '#B0C4DE', '#A9A9A9', '#8FBC8F', '#6B8E23', '#556B2F', '#2F4F4F', '#1C1C1C', '#0F0F0F'
    ];
    colors.push(...earths);
    
    // Column 10: Pastels/Light Tones (8개)
    const pastels = [
      '#F0F8FF', '#F5F5DC', '#F0E68C', '#FFE4E1', '#E6E6FA', '#F0F8FF', '#F5F5F5', '#E0E0E0'
    ];
    colors.push(...pastels);
    
    return colors;
  };

  // 색상 보간 함수
  const interpolateColor = (color1: string, color2: string, ratio: number) => {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);
    
    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);
    
    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // 버튼 클릭 핸들러
  const handleButtonClick = (buttonName: string) => {
    console.log(`버튼 클릭: ${buttonName}`);
    switch (buttonName) {
      case 'Reservation':
      try { setDefaultReservationTable(selectedElement?.text || null); } catch {}
      setShowReservationModal(true);
        break;
      default:
        console.log(`${buttonName} 버튼이 클릭되었습니다.`);
        break;
    }
  };

  // 버튼 데이터
  const buttonData = [
    'Open Till',
    'Receipt', 
    'Last Print',
    'Refund',
    'Order List',
    'Move/Merge Table',
    'Reservation',
    'Waiting List',
    'Clock In/Out'
  ];

  const gradientColors = generateGradientColors(buttonData.length);
  const borderGradientColors = generateBorderGradientColors(buttonData.length);
  const colorPalette = generateRainbowPalette();

  // Reservation modal state (reuse Order page modal)
  const [showReservationModal, setShowReservationModal] = useState<boolean>(false);
  const [defaultReservationTable, setDefaultReservationTable] = useState<string | null>(null);

  // 색상 모달 컴포넌트
  const ColorModal = () => {
    // 현재 선택된 색상 (미리보기용)
    const [previewColor, setPreviewColor] = useState<string | null>(null);
    
    if (!showColorModal) return null;

    // Circle과 Square인 경우 현재 상태 표시
    const isTableElement = ['circle', 'rounded-rectangle', 'bar', 'room'].includes(selectedTableType);
    const statusOrder = ['Available', 'Occupied', 'Payment Pending', 'Preparing', 'Reserved'];
    const currentStatus = statusOrder[tableStatusIndex];
    
    // 모든 요소가 전체 컬러 팔레트 사용
    const displayColors = colorPalette;
    const modalTitle = isTableElement 
      ? `Select Table Color (${currentStatus})`
      : (isColorModalForExisting ? 'Change Element Color' : 'Select New Element Color');

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-1 max-w-xs w-full mx-4 h-[534px] max-h-[534px] flex flex-col">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-semibold text-gray-900">
              {modalTitle}
            </h3>
            <button
              onClick={() => {
                setShowColorModal(false);
                setIsColorModalForExisting(false);
                setPreviewColor(null);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Circle과 Square인 경우 상태별 색상 미리보기 */}
          {isTableElement && (
            <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="text-sm font-bold text-yellow-800 mb-3 text-center">📋 Selected Color Preview</div>
              <div className="grid grid-cols-4 gap-3">
                {statusOrder.map((status, index) => {
                  const statusKey = `table_${status}`; // 'table_' 접두사로 통합 관리
                  const savedColor = firstElementColors[statusKey];
                  const isCurrentStatus = status === currentStatus;
                  
                  // 현재 상태이고 미리보기 색상이 있으면 미리보기 색상 사용, 없으면 저장된 색상 사용
                  // 또는 현재 상태이고 색상이 방금 선택되었다면 선택된 색상 사용
                  let displayColor = savedColor;
                  if (isCurrentStatus) {
                    if (previewColor) {
                      displayColor = previewColor;
                    } else if (savedColor) {
                      displayColor = savedColor;
                    }
                  }
                  
                  return (
                    <div key={status} className="flex flex-col items-center">
                      <div 
                        className={`w-10 h-10 rounded-lg border-2 ${isCurrentStatus ? 'border-blue-500 shadow-lg' : 'border-gray-300'} flex items-center justify-center transition-all duration-200`}
                        style={{ backgroundColor: displayColor || '#E5E7EB' }}
                        title={displayColor || 'Not selected'}
                      >
                        {!displayColor && (
                          <span className="text-sm text-gray-400 font-bold">?</span>
                        )}
                        {displayColor && isCurrentStatus && (
                          <span className="text-white text-xs font-bold">✓</span>
                        )}
                      </div>
                      <div className={`text-xs mt-2 font-medium ${isCurrentStatus ? 'font-bold text-blue-600' : 'text-gray-600'}`}>
                        {status}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-yellow-700 mt-2 text-center">
                Select color for status: {currentStatus}
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-8 gap-x-0.5 gap-y-0 overflow-y-auto flex-1 p-0">
            {displayColors.map((color, index) => (
              <button
                key={index}
                onMouseEnter={() => {
                  if (isTableElement) {
                    setPreviewColor(color);
                  }
                }}
                onMouseLeave={() => {
                  if (isTableElement) {
                    setPreviewColor(null);
                  }
                }}
                onClick={() => {
                  if (isColorModalForExisting && selectedElement) {
                    // 기존 요소 색상 변경 - 바로 적용
                    const updatedElements = tableElements.map(element => 
                      element.id === selectedElement.id 
                        ? { ...element, color: color }
                        : element
                    );
                    setTableElements(updatedElements);
                    saveToHistory(updatedElements);
                    setShowColorModal(false);
                    setIsColorModalForExisting(false);
                  } else {
                    // 새 요소 색상 선택
                    setSelectedColor(color);
                    
                    // Circle과 Square인 경우 현재 상태 색상 저장 후 다음 상태로 자동 이동
                    if (isTableElement) {
                      const statusKey = `table_${currentStatus}`; // 'table_' 접두사로 통합 관리
                      setFirstElementColors(prev => ({ ...prev, [statusKey]: color }));
                      
                      // 미리보기 색상도 즉시 업데이트
                      setPreviewColor(color);
                      
                      // 다음 상태로 자동 이동 (0-3 범위에서 순환)
                      const nextStatusIndex = (tableStatusIndex + 1) % 4;
                      setTableStatusIndex(nextStatusIndex);
                      
                      // 모든 상태가 완료되면 모달 닫기
                      if (nextStatusIndex === 0) {
                        setShowColorModal(false);
                        setPreviewColor(null);
                      }
                    } else {
                      setShowColorModal(false);
                    }
                  }
                }}
                className="w-8 h-8 rounded border border-gray-300 hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tablemap-scope h-screen flex flex-col">
      {/* 색상 모달 */}
      <ColorModal />
      
      {/* 상단 툴바 */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-3 py-1.5 flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Screen Size Input */}
          <div className="flex items-center space-x-1 bg-blue-50 p-1 rounded-lg border border-blue-200">
            <label className="text-xs font-medium text-gray-700 whitespace-nowrap">Size:</label>
            <div className="flex items-center space-x-1">
              <div className="flex space-x-0.5">
                <button
                  onClick={() => {
                    setScreenWidth('800');
                    setScreenHeight('600');
                    handleApplyScreenSize();
                  }}
                  className="px-1.5 py-0.5 bg-gray-500 text-white text-[10px] rounded hover:bg-gray-600 transition-colors"
                  title="4:3 Ratio - 800x600"
                >
                  4:3
                </button>
                <button
                  onClick={() => {
                    setScreenWidth('1920');
                    setScreenHeight('1080');
                    handleApplyScreenSize();
                  }}
                  className="px-1.5 py-0.5 bg-gray-600 text-white text-[10px] rounded hover:bg-gray-700 transition-colors"
                  title="16:9 Ratio - 1920x1080"
                >
                  16:9
                </button>
              </div>
              <input
                type="number"
                value={screenWidth}
                onChange={(e) => setScreenWidth(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleApplyScreenSize();
                  }
                }}
                className="w-14 px-1 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="W"
                min="1"
              />
              <span className="text-xs text-gray-400">×</span>
              <input
                type="number"
                value={screenHeight}
                onChange={(e) => setScreenHeight(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleApplyScreenSize();
                  }
                }}
                className="w-14 px-1 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="H"
                min="1"
              />
              <button 
                className="px-1.5 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-[10px]"
                onClick={handleApplyScreenSize}
              >
                OK
              </button>
            </div>
          </div>

          {/* Canvas Zoom (Fit / Custom) */}
          <div className="flex items-center space-x-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
            <label className="text-xs font-medium text-gray-700">View:</label>
            <button
              onClick={() => setZoomMode('fit')}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${zoomMode === 'fit' ? 'bg-slate-700 text-white' : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'}`}
              title="Fit to window"
            >
              Fit
            </button>
            <button
              onClick={() => { setZoomMode('custom'); setCustomZoom(1); }}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${zoomMode === 'custom' && Math.abs(customZoom - 1) < 0.0001 ? 'bg-slate-700 text-white' : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'}`}
              title="100%"
            >
              100%
            </button>
            <input
              type="range"
              min={25}
              max={150}
              value={Math.round((zoomMode === 'fit' ? fitZoom : customZoom) * 100)}
              onChange={(e) => {
                const next = Math.max(0.25, Math.min(1.5, parseInt(e.target.value, 10) / 100));
                setZoomMode('custom');
                setCustomZoom(next);
              }}
              className="w-16"
              title="Zoom"
            />
            <span className="px-1 py-0.5 text-[10px] bg-white border border-slate-200 rounded text-slate-700 tabular-nums">
              {Math.round(editorScale * 100)}%
            </span>
          </div>

          {/* Floor Section */}
          <div className="flex items-center space-x-1 bg-green-50 p-1 rounded-lg border border-green-200">
            <label className="text-xs font-medium text-gray-700">Floor:</label>
            <button
              onClick={() => setShowAddFloorModal(true)}
              className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors"
              title="새 Floor 추가"
            >
              +
            </button>
          </div>

          {/* Table Type Dropdown */}
          <div className="flex items-center space-x-1 bg-purple-50 p-1 rounded-lg border border-purple-200">
            <label className="text-xs font-medium text-gray-700 whitespace-nowrap">Type:</label>
            <select 
              value={selectedTableType}
              onChange={(e) => setSelectedTableType(e.target.value)}
              className="px-1 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="rounded-rectangle">Square</option>
              <option value="circle">Circle</option>
              <option value="bar">Bar</option>
              <option value="room">Room</option>
              <option value="entrance">Entrance</option>
              <option value="counter">Counter</option>
              <option value="restroom">Restroom</option>
              <option value="divider">Divider</option>
              <option value="wall">Wall</option>
              <option value="cook-area">Cook Area</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Colour Selection */}
          <div className="flex items-center space-x-1 bg-pink-50 p-1 rounded-lg border border-pink-200">
            <label className="text-xs font-medium text-gray-700">Colour:</label>
            <button
              onClick={() => {
                if (selectedElement) {
                  setIsColorModalForExisting(true);
                  setShowColorModal(true);
                } else {
                  setShowColorModal(true);
                }
              }}
              disabled={isColorSelectionDisabled(selectedTableType)}
              className={`w-6 h-6 rounded border transition-colors ${
                isColorSelectionDisabled(selectedTableType)
                  ? 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              style={{ 
                backgroundColor: isColorSelectionDisabled(selectedTableType) 
                  ? '#E5E7EB' 
                  : getCurrentSelectedColor()
              }}
              title={
                selectedElement 
                  ? "요소 색상 변경" 
                  : isColorSelectionDisabled(selectedTableType)
                    ? "첫 번째 요소만 색상 선택 가능"
                    : "새 요소 색상 선택"
              }
            />
            <button 
              className={`px-2 py-1 text-white rounded transition-colors text-xs ${
                selectedElement 
                  ? 'bg-blue-500 hover:bg-blue-600' 
                  : 'bg-green-500 hover:bg-green-600'
              }`}
              onClick={() => {
                if (selectedElement) {
                  setIsColorModalForExisting(true);
                  setShowColorModal(true);
                } else {
                  handleAddTableElement();
                }
              }}
            >
              {selectedElement ? 'Update' : 'Add'}
            </button>
          </div>

          {/* Channel Management */}
          <div className="flex items-center space-x-1 bg-yellow-50 p-1 rounded-lg border border-yellow-200">
            <label className="text-xs font-medium text-gray-700">Ch:</label>
            <div className="flex space-x-0.5">
              <button
                onClick={() => toggleChannelVisibility('table-map')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  channelVisibility['table-map']
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
                }`}
                title={channelVisibility['table-map'] ? 'Table Map 숨기기' : 'Table Map 보이기'}
              >
                TM
              </button>
              <button
                onClick={() => toggleChannelVisibility('togo')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  channelVisibility['togo']
                    ? 'bg-green-800 text-white hover:bg-green-900'
                    : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
                }`}
                title={channelVisibility['togo'] ? 'Togo 숨기기' : 'Togo 보이기'}
              >
                TG
              </button>
              <button
                onClick={() => toggleChannelVisibility('delivery')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  channelVisibility['delivery']
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
                }`}
                title={channelVisibility['delivery'] ? 'Delivery 숨기기' : 'Delivery 보이기'}
              >
                DL
              </button>
              <button
                onClick={() => toggleChannelVisibility('online')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  channelVisibility['online']
                    ? 'bg-purple-500 text-white hover:bg-purple-600'
                    : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
                }`}
                title={channelVisibility['online'] ? 'Online 숨기기' : 'Online 보이기'}
              >
                OL
              </button>
            </div>
          </div>
        </div>

        {/* 기능 버튼들 */}
        <div className="flex items-center bg-gray-50 p-1 rounded-lg border border-gray-200 ml-auto">
          <button 
            className="px-3 py-1 text-xs font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors"
            title="Save Table Layout"
            onClick={handleSaveLayout}
          >
            Save
          </button>
        </div>
      </div>

      {/* 하단 - 테이블맵 요소들을 배열하는 화면 */}
      <div className="flex-1 min-h-0 bg-gray-50 p-3">
        <div ref={canvasViewportRef} className="bg-white rounded-lg shadow-lg h-full relative overflow-auto flex items-start justify-start" onClick={handleCanvasClick}>
          {/* POS에 보여지는 메인 테이블맵 영역 (Fixed Resolution Canvas) */}
          <DndContext sensors={dndSensors} onDragEnd={(e) => { if (mapLocked) return; handleDragEnd(e); }}>
            <div className="relative mx-auto" style={{ width: `${canvasWidthPx * editorScale}px`, height: `${canvasHeightPx * editorScale}px` }}>
              <div 
                className="bg-gray-100 relative border-2 border-gray-300 transition-all duration-300 flex flex-col"
                style={{
                  ...canvasStyle,
                  transform: `scale(${editorScale})`,
                  transformOrigin: 'top left'
                }}
              >
              {/* 캔바스 내부 알람들 */}
              <CallNotificationCanvasComponent />
              <OrderNotificationCanvasComponent />
              
              {/* 1. 상단 헤더 - SalesPage와 동일한 56px 고정 */}
              <div className="bg-gradient-to-b from-blue-100 to-blue-50 border-b-2 border-blue-300 shadow-lg flex items-center justify-center" style={{ height: '56px', flexShrink: 0 }}>
                <div className="flex space-x-2 h-3/4">
                  {/* Floor 탭들 */}
                  {floorList.map((floor) => (
                    <div key={floor} className="relative group">
                      <button
                                                                                                                    className={`w-auto px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm ${
                          selectedFloor === floor
                            ? 'bg-indigo-500 text-white shadow-md transform scale-105'
                            : 'bg-white text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200'
                        }`}
                        onClick={() => handleFloorChange(floor)}
                        title={`Floor ${floor}로 전환`}
                      >
                        {floor}
                      </button>
                      {/* Floor 삭제 버튼 */}
                      {floorList.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showDeleteFloorConfirm(floor);
                          }}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center"
                          title={`Floor ${floor} 삭제`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  
                  {/* 구분선 */}
                  <div className="flex items-center justify-center px-16">
                    <div className="w-px h-full bg-gray-300"></div>
                  </div>
                  
                  {/* 기존 채널 탭들 */}
                  {channelVisibility['table-map'] && (
                    <button
                      className={`w-auto px-4 py-1 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm ${
                        selectedTab === 'table-map'
                          ? 'bg-blue-500 text-white shadow-md transform scale-105'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200'
                      }`}
                      onClick={() => setSelectedTab('table-map')}
                    >
                      Dine-in
                    </button>
                  )}
                  {channelVisibility['togo'] && (
                    <button
                      className={`w-auto px-4 py-1 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm ${
                        selectedTab === 'togo'
                          ? 'bg-green-500 text-white shadow-md transform scale-105'
                          : 'bg-white text-gray-700 hover:bg-green-50 hover:text-green-600 border border-gray-200'
                      }`}
                      onClick={() => setSelectedTab('togo')}
                    >
                      Togo
                    </button>
                  )}
                  {channelVisibility['delivery'] && (
                    <button
                      className={`w-auto px-4 py-1 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm ${
                        selectedTab === 'delivery'
                          ? 'bg-orange-500 text-white shadow-md transform scale-105'
                          : 'bg-white text-gray-700 hover:bg-orange-50 hover:text-orange-600 border border-gray-200'
                      }`}
                      onClick={() => setSelectedTab('delivery')}
                    >
                      Delivery
                    </button>
                  )}
                  {channelVisibility['online'] && (
                    <button
                      className={`w-auto px-4 py-1 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm ${
                        selectedTab === 'online'
                          ? 'bg-purple-500 text-white shadow-md transform scale-105'
                          : 'bg-white text-gray-700 hover:bg-purple-50 hover:text-purple-600 border border-gray-200'
                      }`}
                      onClick={() => setSelectedTab('online')}
                    >
                      Online
                    </button>
                  )}

              {/* Manager 탭 */}
              <button
                className={`w-auto px-4 py-1 rounded-lg text-sm font-semibold transition-all duration-200 shadow-sm ${
                  selectedTab === 'manager'
                    ? 'bg-gray-700 text-white shadow-md transform scale-105'
                    : 'bg-white text-gray-700 hover:bg-gray-100 hover:text-gray-900 border border-gray-200'
                }`}
                onClick={() => setSelectedTab('manager')}
              >
                Manager
              </button>
                </div>
              </div>

              {/* 2. 중앙 86% - 메인 컨텐츠 영역 */}
              <div className="flex-1 flex overflow-hidden">
                {selectedTab === 'manager' ? (
                  <ManagerPanel />
                ) : (
                  <>
                
                {/* 3. 좌측 - Table Map 영역 */}
                <div 
                  className={`${channelVisibility['togo'] ? 'w-[66%]' : 'w-full'} relative`}
                  onClick={handleCanvasClick}
                >
                  {/* 그리드 배경 */}
                  <div className="absolute inset-0 bg-grid-pattern opacity-20"></div>
                  
                  {/* 테이블 요소들 */}
                  {tableElements.map((element) => (
                    <DraggableTableElement 
                      key={element.id} 
                      element={element} 
                      onSelect={handleElementClick}
                    />
                  ))}
                </div>

                {/* 4. 우측 34% - Togo Order 현황판 */}
                {channelVisibility['togo'] && (
                <div className="w-[34%] bg-blue-50 border-l border-gray-300 p-2 relative" style={{ paddingBottom: '75px' }}>
                  {/* 상단 - 기존 투고 목록 */}
                  <div className="overflow-y-auto" style={{ height: 'calc(100% - 75px)' }}>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <button
                      onClick={() => {
                        setShowTogoOrderModal(true);
                        // 기본값을 15분으로 설정
                        setPickupTime(15);
                        setCustomerOrders([]);
                      }}
                      className="px-[13px] py-3 min-h-[44px] bg-green-800 text-white text-base font-medium rounded-lg hover:bg-green-900 transition-colors duration-200 shadow-sm hover:shadow-md"
                    >
                      New Togo
                    </button>
                    <div className="flex items-center gap-2 flex-1">
                      <div className="relative w-3/5">
                        <input
                          value={togoSearch}
                          onChange={e=>setTogoSearch(e.target.value)}
                          onKeyDown={(e)=>{ if(e.key==='Enter'){ /* no-op; reactive filter */ }}}
                          className="w-full px-3 py-2 text-base border rounded-md min-h-[44px]"
                          ref={searchInputRef}
                        />
                        <span className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                        </span>
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                          onClick={() => { setSoftKbOpen(true); try{ searchInputRef.current?.focus(); } catch{} }}
                          title="Virtual keyboard"
                          aria-label="Virtual keyboard"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
                            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"></path>
                          </svg>
                        </button>
                        {softKbOpen && (
                          <VirtualKeyboard
                            open={softKbOpen}
                            title={''}
                            bottomOffsetPx={0}
                            zIndex={2147483646}
                            languages={['EN']}
                            currentLanguage={kbLang}
                            onToggleLanguage={(next)=>setKbLang(next)}
                            displayText={
                              togoKeyboardTarget === 'phone' ? customerPhone :
                              togoKeyboardTarget === 'name' ? customerName :
                              togoKeyboardTarget === 'address' ? customerAddress :
                              togoKeyboardTarget === 'zip' ? customerZip :
                              togoKeyboardTarget === 'note' ? togoNote :
                              togoSearch
                            }
                            onRequestClose={() => setSoftKbOpen(false)}
                            onType={(k)=> {
                              if (togoKeyboardTarget === 'phone') {
                                handlePhoneChange(customerPhone + k);
                              } else if (togoKeyboardTarget === 'name') {
                                setCustomerName(formatNameForDisplay(customerName + k));
                              } else if (togoKeyboardTarget === 'address') {
                                setCustomerAddress(prev => prev + k);
                              } else if (togoKeyboardTarget === 'zip') {
                                setCustomerZip(prev => prev + k);
                              } else if (togoKeyboardTarget === 'note') {
                                setTogoNote(prev => prev + k);
                              } else {
                                setTogoSearch(prev => `${prev||''}${k}`);
                              }
                            }}
                            onBackspace={()=> {
                              if (togoKeyboardTarget === 'phone') {
                                handlePhoneChange(customerPhone.slice(0, -1));
                              } else if (togoKeyboardTarget === 'name') {
                                setCustomerName(formatNameForDisplay(customerName.slice(0, -1)));
                              } else if (togoKeyboardTarget === 'address') {
                                setCustomerAddress(prev => prev.slice(0, -1));
                              } else if (togoKeyboardTarget === 'zip') {
                                setCustomerZip(prev => prev.slice(0, -1));
                              } else if (togoKeyboardTarget === 'note') {
                                setTogoNote(prev => prev.slice(0, -1));
                              } else {
                                setTogoSearch(prev => prev ? prev.slice(0, -1) : '');
                              }
                            }}
                            onClear={()=> {
                              if (togoKeyboardTarget === 'phone') {
                                setCustomerPhone('');
                              } else if (togoKeyboardTarget === 'name') {
                                setCustomerName('');
                              } else if (togoKeyboardTarget === 'address') {
                                setCustomerAddress('');
                              } else if (togoKeyboardTarget === 'zip') {
                                setCustomerZip('');
                              } else if (togoKeyboardTarget === 'note') {
                                setTogoNote('');
                              } else {
                                setTogoSearch('');
                              }
                            }}
                          />
                        )}
                      </div>
                      <button
                        className="px-4 py-2 min-h-[44px] bg-gray-300 text-gray-800 text-base rounded-md hover:bg-gray-400"
                        onClick={()=>setTogoSearch('')}
                        title="Clear"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mb-3">
                    {/* 왼쪽: Online 주문리스트 */}
                    <div className="space-y-1">
                      {[
                        { id:'online-1', number:1, time:'18:45', phone:'010-5555-1234', name:'박민수', items:['Burger','Cola','Fries'] },
                        { id:'online-2', number:2, time:'19:15', phone:'010-7777-8888', name:'최지영', items:['Pizza','Salad','Drink'] }
                      ].map((card) => {
                        const q = togoSearch.trim().toLowerCase();
                        const inNumber = String(card.number).includes(q);
                        const inPhone = card.phone.toLowerCase().includes(q);
                        const inName = card.name.toLowerCase().includes(q);
                        const inItems = card.items.join(' ').toLowerCase().includes(q);
                        const matched = !q || inNumber || inPhone || inName || inItems;
                        const baseBg = '#B1C4DD';
                        const baseBorder = '#9BB3D1';
                        const style:any = { backgroundColor: baseBg, borderColor: matched && q ? '#B91C1C' : baseBorder, borderWidth: matched && q ? 2 : 1 };
                        const cls = `w-full rounded-lg p-1 shadow-inner border transition-all duration-300 text-left hover:shadow-lg ${q && !matched ? 'opacity-40 pointer-events-none' : ''}`;
                        return (
                          <button
                            key={card.id}
                            className={cls}
                            style={style}
                            onMouseEnter={(e) => { if(!q || matched){ e.currentTarget.style.backgroundColor = '#9BB3D1'; e.currentTarget.style.borderColor = matched && q ? '#B91C1C' : '#8AA2C0'; } }}
                            onMouseLeave={(e) => { if(!q || matched){ e.currentTarget.style.backgroundColor = baseBg; e.currentTarget.style.borderColor = matched && q ? '#B91C1C' : baseBorder; } }}
                            onClick={() => { setSelectedOrder({ id: card.id, type:'Online', number: card.number, time: card.time, phone: card.phone, name: card.name }); setShowPaymentModal(true); }}
                          >
                            <div className="text-[13px] font-medium text-gray-800 mb-0.5">Online #{card.number} • {card.time}</div>
                            <div className="text-[13px] text-gray-700"><span className="font-bold text-gray-900">{card.phone}</span> <span className="text-[12.5px]">{card.name}</span></div>
                          </button>
                        );
                      })}
                    </div>
                    
                    {/* 오른쪽: Togo 주문리스트 (검색 필터 반영) */}
                    <div className="space-y-1">
                      {togoOrders.map((order) => {
                        const q = togoSearch.trim().toLowerCase();
                        const sequenceValue = order.sequenceNumber != null ? String(order.sequenceNumber).toLowerCase() : '';
                        const rawOrderNumber = String(order.number || '').toLowerCase();
                        const inNumber = sequenceValue.includes(q) || rawOrderNumber.includes(q);
                        const inPhone = String(order.phone || '').toLowerCase().includes(q);
                        const inName = String(order.name || '').toLowerCase().includes(q);
                        const items = (order.items || order.orderItems || [])
                          .map((it: any) => String(it.name || '').toLowerCase())
                          .join(' ');
                        const inItems = items.includes(q);
                        const matched = !q || inNumber || inPhone || inName || inItems;
                        const baseBg = '#A8D5A8';
                        const baseBorder = '#95C295';
                        const style:any = { backgroundColor: baseBg, borderColor: matched && q ? '#B91C1C' : baseBorder, borderWidth: matched && q ? 2 : 1 };
                        const cls = `w-full rounded-lg p-1 shadow-inner border transition-all duration-300 text-left hover:shadow-lg ${q && !matched ? 'opacity-40 pointer-events-none' : ''}`;
                        return (
                          <button
                            key={order.id}
                            className={cls}
                            style={style}
                            onMouseEnter={(e) => { if(!q || matched){ e.currentTarget.style.backgroundColor = '#95C295'; e.currentTarget.style.borderColor = matched && q ? '#B91C1C' : '#82B882'; } }}
                            onMouseLeave={(e) => { if(!q || matched){ e.currentTarget.style.backgroundColor = baseBg; e.currentTarget.style.borderColor = matched && q ? '#B91C1C' : baseBorder; } }}
                            onClick={() => { setSelectedOrder(order); setShowPaymentModal(true); }}
                          >
                            <div className="text-[13px] font-semibold text-gray-900 mb-0.5 flex items-center gap-2">
                              <span>{`Togo #${order.sequenceNumber ?? '—'}`}</span>
                              <span className="text-xs text-gray-900 font-bold flex items-center gap-2 w-full">
                                <span>• {order.readyTimeLabel || '--:--'}</span>
                                {String(order.fulfillment || order.type).toLowerCase() === 'delivery' && (
                                  <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full bg-red-100 text-red-700 border border-red-300 ml-auto">
                                    DLV
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="text-[13px] text-gray-700 flex justify-between">
                              <span className="font-bold text-gray-900 truncate pr-2">{formatOrderPhoneDisplay(order.phone) || '—'}</span>
                              <span className="text-[13px] text-gray-800 truncate text-right">{order.name || ''}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  </div>
                  
                  {/* 하단 - Today's Reservations */}
                  <div className="absolute bottom-0 left-0 right-0 bg-amber-100 border-t-2 border-amber-400 px-3 py-1" style={{ height: '70px' }}>
                    <div className="text-amber-700 text-xs font-bold mb-1">📅 Today's Reservations ({todayReservations.length})</div>
                    {todayReservations.length === 0 ? (
                      <div className="text-xs text-gray-500 text-center py-2">No reservations today</div>
                    ) : (
                      <div className="space-y-0.5">
                        {todayReservations.slice(0, 3).map((res: any, idx: number) => (
                          <div key={res.id || idx} className="flex items-center text-xs">
                            <span className="font-bold text-amber-800 w-12">{res.reservation_time || res.time || '--:--'}</span>
                            <span className="text-gray-800 flex-1 truncate">{res.customer_name || res.name || '—'}</span>
                            <span className="text-gray-600 font-medium">#{res.party_size || res.guests || 0}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                )}
                  </>
                )}
              </div>

              {/* 5. 하단 기능버튼 영역 - SalesPage와 동일하게 */}
              <div className="bg-gray-200 border-t border-gray-300 py-1.5 pl-3" style={{ height: '70px', paddingRight: '0' }}>
                <div className="grid grid-cols-10 h-full" style={{ width: '110%', gap: '5px' }}>
                  {buttonData.map((buttonName, index) => (
                    <button
                      key={buttonName}
                      onClick={() => handleButtonClick(buttonName)}
                      className="w-full h-full rounded-lg text-white text-base font-semibold flex items-center justify-center text-center leading-tight transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
                      style={{ 
                        backgroundColor: gradientColors[index],
                      }}
                      onMouseEnter={(e) => {
                        // 호버 시 색상을 약간 어둡게
                        e.currentTarget.style.filter = 'brightness(0.9)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.filter = 'brightness(1)';
                      }}
                    >
                      {buttonName}
                    </button>
                  ))}
                </div>
              </div>
              </div>
            </div>
          </DndContext>
        </div>
      </div>
      {/* Add Floor Modal */}
      {/* Reservation Create Modal */}
      <ReservationCreateModal
        open={showReservationModal}
        onClose={() => setShowReservationModal(false)}
        onCreated={() => {
          try { setShowReservationModal(false); } catch {}
        }}
      />
      {showAddFloorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">새 Floor 추가</h3>
            <p className="text-sm text-gray-600 mb-4">
              새 Floor를 추가하면 채널 탭에 Floor 탭이 생성되고, 해당 Floor에서 테이블 맵을 관리할 수 있습니다.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Floor 이름
              </label>
              <input
                type="text"
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddNewFloor();
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="예: 4F, Basement, Rooftop"
                autoFocus
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowAddFloorModal(false);
                  setNewFloorName('');
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleAddNewFloor}
                disabled={!newFloorName.trim()}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                title={`Add button - newFloorName: "${newFloorName}", trimmed: "${newFloorName.trim()}", disabled: ${!newFloorName.trim()}`}
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Floor Confirmation Modal */}
      {showDeleteFloorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4 text-red-600">Floor 삭제 확인</h3>
            <p className="text-sm text-gray-600 mb-4">
              <strong>"{floorToDelete}"</strong> Floor를 삭제하시겠습니까?
            </p>
            <p className="text-xs text-red-500 mb-4">
              ⚠️ 이 Floor의 모든 테이블 맵 데이터가 영구적으로 삭제됩니다.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowDeleteFloorModal(false);
                  setFloorToDelete('');
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={() => handleDeleteFloor(floorToDelete)}
                className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Togo Order Modal */}
      {showTogoOrderModal && (() => {
        const hasContactInfo = Boolean((customerPhone || '').trim()) || Boolean((customerName || '').trim());
        const canSubmitOrder = hasContactInfo;

        // Ready time calculation (SalesPage와 동일 로직)
        const formatMinutesToTime = (mins: number) => {
          const hours = Math.floor(mins / 60);
          const m = mins % 60;
          return `${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const getReadyTime = (mins: number) => {
          const now = new Date();
          const ready = new Date(now.getTime() + mins * 60000);
          return {
            readyDisplay: ready.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            currentDisplay: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
          };
        };

        const pickupDisplay = formatMinutesToTime(pickupTime);
        const readyTime = getReadyTime(pickupTime);

        return (
          <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-b from-white to-slate-50 rounded-2xl shadow-2xl p-5 w-full max-w-[950px] border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-xl font-bold text-slate-800">New Togo</h3>
                <button 
                  onClick={() => setShowTogoOrderModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 flex-1 overflow-hidden">
                {/* Left Section */}
                <div className="space-y-4 overflow-y-auto pr-2">
                  <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1">
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => handlePhoneChange(e.target.value)}
                        onClick={() => { setTogoKeyboardTarget('phone'); setSoftKbOpen(true); }}
                        onFocus={() => { setTogoKeyboardTarget('phone'); setSoftKbOpen(true); }}
                        className="w-full h-12 px-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-lg"
                        placeholder="(000)000-0000"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(formatNameForDisplay(e.target.value))}
                        onClick={() => { setTogoKeyboardTarget('name'); setSoftKbOpen(true); }}
                        onFocus={() => { setTogoKeyboardTarget('name'); setSoftKbOpen(true); }}
                        className="w-full h-12 px-4 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-lg"
                        placeholder="Customer name"
                      />
                    </div>
                    <div className="flex rounded-xl border border-slate-300 overflow-hidden h-12 bg-white">
                      <button 
                        className={`flex-1 px-4 font-bold ${togoOrderMode === 'togo' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                        onClick={() => setTogoOrderMode('togo')}
                      >
                        TOGO
                      </button>
                      <button 
                        className={`flex-1 px-4 font-bold ${togoOrderMode === 'delivery' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                        onClick={() => setTogoOrderMode('delivery')}
                      >
                        DELIVERY
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500 font-bold">Prep Time</span>
                        <span className={`text-3xl font-mono font-bold ${prepButtonsLocked ? 'text-slate-400' : 'text-indigo-600'}`}>{pickupDisplay}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className={`px-3 py-1 rounded-full border text-sm font-bold ${prepButtonsLocked ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                          Ready {readyTime.readyDisplay}
                        </span>
                        <span className={`px-3 py-1 rounded-full border text-sm font-bold ${prepButtonsLocked ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          Current {readyTime.currentDisplay}
                        </span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-5 gap-2">
                      {[5, 10, 15, 20, 25, 30, 40, 50, 60].map((min) => (
                        <button
                          key={min}
                          onClick={() => setPickupTime(min)}
                          disabled={prepButtonsLocked}
                          className={`h-12 rounded-xl font-bold transition-colors ${prepButtonsLocked ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                        >
                          +{min}
                        </button>
                      ))}
                      <button 
                        onClick={() => setPrepButtonsLocked(!prepButtonsLocked)}
                        className={`h-12 rounded-xl font-bold transition-colors ${prepButtonsLocked ? 'bg-rose-500 text-white' : 'bg-rose-100 hover:bg-rose-200 text-rose-600'}`}
                      >
                        {prepButtonsLocked ? 'Prep On' : 'Prep Off'}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <input
                      className="flex-1 h-12 px-4 rounded-xl border border-slate-300 outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Address"
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      onClick={() => { setTogoKeyboardTarget('address'); setSoftKbOpen(true); }}
                      onFocus={() => { setTogoKeyboardTarget('address'); setSoftKbOpen(true); }}
                    />
                    <input
                      className="w-24 h-12 px-4 rounded-xl border border-slate-300 outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Zip"
                      value={customerZip}
                      onChange={(e) => setCustomerZip(e.target.value)}
                      onClick={() => { setTogoKeyboardTarget('zip'); setSoftKbOpen(true); }}
                      onFocus={() => { setTogoKeyboardTarget('zip'); setSoftKbOpen(true); }}
                    />
                  </div>
                  <input
                    className="w-full h-12 px-4 rounded-xl border border-slate-300 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Note"
                    value={togoNote}
                    onChange={(e) => setTogoNote(e.target.value)}
                    onClick={() => { setTogoKeyboardTarget('note'); setSoftKbOpen(true); }}
                    onFocus={() => { setTogoKeyboardTarget('note'); setSoftKbOpen(true); }}
                  />
                </div>

                {/* Right Section */}
                <div className="flex flex-col gap-4 overflow-hidden">
                  <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col min-h-0">
                    <h4 className="font-bold text-slate-800 mb-3 flex-shrink-0">Order History</h4>
                    <div className="flex-1 overflow-y-auto border border-dashed border-slate-200 rounded-xl flex items-center justify-center p-4">
                      <p className="text-slate-400 text-sm text-center">Select a customer to view history.</p>
                    </div>
                  </div>
                  <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col min-h-0">
                    <h4 className="font-bold text-slate-800 mb-3 flex-shrink-0">Order Details</h4>
                    <div className="flex-1 overflow-y-auto border border-dashed border-slate-200 rounded-xl flex items-center justify-center p-4">
                      <p className="text-slate-400 text-sm text-center">No data</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
                <button
                  onClick={() => setShowTogoOrderModal(false)}
                  className="px-8 py-3 rounded-xl bg-white border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button className="px-8 py-3 rounded-xl bg-slate-100 text-slate-400 font-bold cursor-not-allowed">
                  Reorder
                </button>
                <button
                  disabled={!canSubmitOrder}
                  onClick={() => {
                    setShowMenuOrderModal(true);
                    setShowTogoOrderModal(false);
                  }}
                  className="px-10 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <CallNotificationComponent />
      <OrderNotificationComponent />
      
      {/* Price Change Confirmation Popup */}
      {showPriceChangePopup && priceChangeData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center mb-4">
              <div className="text-2xl mr-3">⚠️</div>
              <h3 className="text-lg font-bold text-red-600">Price has changed</h3>
            </div>
            
            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-2">The following menu prices have changed:</div>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 max-h-40 overflow-y-auto">
                {priceChangeData.updatedItems.map((item: any, index: number) => {
                  const priceDiff = item.price - item.previousPrice;
                  if (priceDiff === 0) return null;
                  
                  return (
                    <div key={index} className="flex justify-between items-center mb-2 text-sm">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{item.name} x{item.quantity}</div>
                        <div className="text-xs text-gray-500">
                          {item.previousPrice.toLocaleString()}원 → {item.price.toLocaleString()}원
                        </div>
                      </div>
                      <div className={`text-sm font-bold ${priceDiff > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                        {priceDiff > 0 ? '+' : ''}{priceDiff.toLocaleString()}원
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-blue-800">Total Price Difference:</span>
                <span className="text-lg font-bold text-blue-900">
                  +{priceChangeData.totalPriceChange.toLocaleString()}원
                </span>
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowPriceChangePopup(false);
                  setPriceChangeData(null);
                }}
                className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowPriceChangePopup(false);
                  processReorder(
                    priceChangeData.updatedItems,
                    true,
                    priceChangeData.totalPriceChange
                  );
                  setPriceChangeData(null);
                }}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Reorder Completion Toast Notification */}
      {showReorderToast && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-40 animate-pulse">
          <div className="flex items-center">
            <span className="text-lg mr-2">✅</span>
            <span className="font-medium">Order has been processed</span>
          </div>
        </div>
      )}
      </div>
  );
};

export default TableMapManagerPage; 