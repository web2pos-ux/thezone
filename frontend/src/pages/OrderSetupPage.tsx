import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';
import { getLocalDatetimeString } from '../utils/datetimeUtils';
import {
  TABLE_MAP_TOGO_PANEL_SPLIT_KEY,
  TABLE_MAP_TOGO_PANEL_SPLIT_OPTIONS,
  readTableMapTogoPanelSplitFromStorage,
  notifyTableMapTogoPanelSplitChanged,
  type TableMapTogoPanelSplitPreset,
} from '../utils/tableMapTogoPanelSplit';

interface Menu {
  menu_id: number;
  name: string;
  description: string;
}

interface OrderPageSetup {
  id?: number;
  orderType: string;
  menuId: number;
  menuName: string;
  priceType: 'price' | 'price1' | 'price2';  // price1 for backward compatibility
  togoInfoTiming?: 'before' | 'after';
  createdAt: string;
}

const orderTypes = [
  { id: 'pos', label: 'Dine-in Order (QSR Mode)' },
  { id: 'togo', label: 'Togo Order' },
  { id: 'online', label: 'Online Order' },
  { id: 'delivery', label: 'Delivery Order' },
  { id: 'table-qr', label: 'Table QR Order' },
  { id: 'kiosk', label: 'Kiosk Order' }
];

type SetupSection = 'order-channel' | 'closing';

const OrderSetupPage = () => {
  const [activeSection, setActiveSection] = useState<SetupSection>('order-channel');
  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedOrderType, setSelectedOrderType] = useState<string>('');
  const [selectedMenu, setSelectedMenu] = useState<number | null>(null);
  const [selectedPriceType, setSelectedPriceType] = useState<'price' | 'price1' | 'price2'>('price');
  const [selectedTogoInfoTiming, setSelectedTogoInfoTiming] = useState<'before' | 'after'>('before');
  const [togoPanelEnabled, setTogoPanelEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('tableMapChannelVisibility');
      if (raw) { const parsed = JSON.parse(raw); return parsed?.togo !== false; }
    } catch {}
    return true;
  });
  const [togoPanelSplitPreset, setTogoPanelSplitPreset] = useState<TableMapTogoPanelSplitPreset>(() =>
    readTableMapTogoPanelSplitFromStorage()
  );
  const [fsrTogoButtonVisible, setFsrTogoButtonVisible] = useState<boolean>(() => {
    try { return localStorage.getItem('fsrTogoButtonVisible') !== 'false'; } catch {} return true;
  });
  const [shiftServerSelection, setShiftServerSelection] = useState<boolean>(() => {
    try { return localStorage.getItem('closingShiftServerSelection') !== 'false'; } catch { return true; }
  });
  const [selectServerOnEntry, setSelectServerOnEntry] = useState<boolean>(false);
  const [closingSettingsLoaded, setClosingSettingsLoaded] = useState(false);

  const loadClosingSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/layout-settings`);
      if (res.ok) {
        const result = await res.json();
        if (result?.success && result?.data) {
          setSelectServerOnEntry(result.data.selectServerOnEntry ?? false);
        }
      }
    } catch { /* ignore */ }
    setClosingSettingsLoaded(true);
  }, []);

  const saveSelectServerOnEntry = useCallback(async (value: boolean) => {
    setSelectServerOnEntry(value);
    try {
      let existing: Record<string, any> = {};
      const cur = await fetch(`${API_URL}/layout-settings`);
      if (cur.ok) {
        const r = await cur.json();
        if (r?.success && r?.data) existing = r.data;
      }
      await fetch(`${API_URL}/layout-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...existing, selectServerOnEntry: value }),
      });
    } catch (e) {
      console.error('Failed to save selectServerOnEntry:', e);
    }
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedSetups, setSavedSetups] = useState<OrderPageSetup[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (activeSection === 'closing' && !closingSettingsLoaded) {
      loadClosingSettings();
    }
  }, [activeSection, closingSettingsLoaded, loadClosingSettings]);

  // Fetch menu list
  useEffect(() => {
    const fetchMenus = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${API_URL}/menus`);
        if (!response.ok) throw new Error('Failed to fetch menus');
        const data = await response.json();
        const list = Array.isArray((data as any)?.value) ? (data as any).value : data;
        setMenus(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error('Failed to fetch menus:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMenus();
  }, []);

  // Load saved setups
  useEffect(() => {
    const loadSavedSetups = async () => {
      try {
        const response = await fetch(`${API_URL}/order-page-setups`);
        if (response.ok) {
          const result = await response.json();
          // API가 {success, data} 형식으로 반환
          const data = result.data || result;
          setSavedSetups(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error('Failed to load saved setups:', error);
      }
    };

    loadSavedSetups();
  }, []);

  // 각 채널에 연결된 메뉴 찾기
  const getChannelMenu = (channelId: string) => {
    const setup = savedSetups.find(s => s.orderType === channelId);
    return setup ? setup.menuName : null;
  };

  // 각 채널에 연결된 가격 타입 찾기
  const getChannelPriceType = (channelId: string) => {
    const setup = savedSetups.find(s => s.orderType === channelId);
    return setup ? setup.priceType : null;
  };

  const getChannelTogoInfoTiming = (channelId: string) => {
    const setup = savedSetups.find(s => s.orderType === channelId);
    return setup?.togoInfoTiming || 'before';
  };

  useEffect(() => {
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === 'tableMapChannelVisibility' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setTogoPanelEnabled(parsed?.togo !== false);
        } catch {}
      }
      if (e.key === 'fsrTogoButtonVisible') {
        setFsrTogoButtonVisible(e.newValue !== 'false');
      }
      if (e.key === TABLE_MAP_TOGO_PANEL_SPLIT_KEY) {
        setTogoPanelSplitPreset(readTableMapTogoPanelSplitFromStorage());
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, []);

  // 채널 클릭 핸들러 - 저장된 설정이 있으면 자동으로 불러오기
  const handleChannelClick = (channelId: string) => {
    setSelectedOrderType(channelId);
    
    // 해당 채널에 저장된 설정이 있으면 자동으로 메뉴와 가격 타입 선택
    const setup = savedSetups.find(s => s.orderType === channelId);
    if (setup) {
      setSelectedMenu(setup.menuId);
      setSelectedPriceType(setup.priceType === 'price1' ? 'price' : (setup.priceType || 'price'));
      setSelectedTogoInfoTiming(setup.togoInfoTiming || 'before');
    }
  };

  const handleTogoSave = async () => {
    try {
      setIsSaving(true);
      const existingSetup = savedSetups.find(s => s.orderType === 'togo');
      const setupData = {
        orderType: 'togo',
        menuId: existingSetup?.menuId || menus[0]?.menu_id || 0,
        menuName: existingSetup?.menuName || menus[0]?.name || '',
        priceType: existingSetup?.priceType || 'price',
        togoInfoTiming: selectedTogoInfoTiming,
        createdAt: getLocalDatetimeString()
      };
      let response;
      if (existingSetup && existingSetup.id) {
        response = await fetch(`${API_URL}/order-page-setups/${existingSetup.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(setupData),
        });
      } else {
        response = await fetch(`${API_URL}/order-page-setups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(setupData),
        });
      }
      if (response.ok) {
        setSaveMessage({ type: 'success', text: 'Togo settings saved!' });
        localStorage.setItem('togo_info_timing', selectedTogoInfoTiming);
        const listRes = await fetch(`${API_URL}/order-page-setups`);
        if (listRes.ok) {
          const listData = await listRes.json();
          const rows = Array.isArray(listData.setups) ? listData.setups : Array.isArray(listData) ? listData : [];
          setSavedSetups(rows.map((r: any) => ({
            id: r.id,
            orderType: r.orderType || r.order_type,
            menuId: r.menuId || r.menu_id,
            menuName: r.menuName || r.menu_name || '',
            priceType: r.priceType || r.price_type || 'price',
            togoInfoTiming: r.togoInfoTiming || r.togo_info_timing || 'before',
            createdAt: r.createdAt || r.created_at || '',
          })));
        }
      } else {
        setSaveMessage({ type: 'error', text: 'Failed to save.' });
      }
    } catch (e) {
      setSaveMessage({ type: 'error', text: 'Save error.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  const handleSave = async () => {
    if (!selectedOrderType || !selectedMenu) {
      setSaveMessage({ type: 'error', text: '주문 채널과 메뉴를 모두 선택해주세요.' });
      return;
    }

    try {
      setIsSaving(true);
      const setupData = {
        orderType: selectedOrderType,
        menuId: selectedMenu,
        menuName: menus.find(m => m.menu_id === selectedMenu)?.name || '',
        priceType: selectedPriceType,
        togoInfoTiming: selectedOrderType === 'togo' ? selectedTogoInfoTiming : 'before',
        createdAt: getLocalDatetimeString()
      };
      console.log('💾 Saving setup data:', setupData);

      // 이미 해당 채널에 설정이 있는지 확인
      const existingSetup = savedSetups.find(s => s.orderType === selectedOrderType);
      
      let response;
      if (existingSetup && existingSetup.id) {
        // 기존 설정 업데이트
        response = await fetch(`${API_URL}/order-page-setups/${existingSetup.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(setupData),
        });
      } else {
        // 새로 추가
        response = await fetch(`${API_URL}/order-page-setups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(setupData),
        });
      }

      if (response.ok) {
        const saveResult = await response.json();
        console.log('✅ Save response:', saveResult);
        setSaveMessage({ type: 'success', text: '설정이 성공적으로 저장되었습니다!' });
        // 저장된 설정 목록 새로고침
        const updatedResponse = await fetch(`${API_URL}/order-page-setups`);
        if (updatedResponse.ok) {
          const result = await updatedResponse.json();
          const data = result.data || result;
          console.log('📋 Loaded setups:', data);
          setSavedSetups(Array.isArray(data) ? data : []);
        }
        // 3초 후 메시지 제거
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        throw new Error('Failed to save setup');
      }
    } catch (error) {
      console.error('Failed to save setup:', error);
      setSaveMessage({ type: 'error', text: '설정 저장에 실패했습니다. 다시 시도해주세요.' });
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleContinue = () => {
    if (selectedOrderType && selectedMenu) {
      // Navigate to order page with selected order type and menu info
      navigate('/order', {
        state: {
          orderType: selectedOrderType,
          menuId: selectedMenu,
          menuName: menus.find(m => m.menu_id === selectedMenu)?.name,
          priceType: selectedPriceType
        }
      });
    }
  };

  const handleOpenOrderScreenManager = () => {
    navigate('/backoffice/orders');
  };

  const canContinue = selectedOrderType && selectedMenu;
  const canSave = selectedOrderType && selectedMenu;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Screen Setup</h1>
          <p className="text-gray-600">Select order channel and menu to configure the order screen</p>
        </div>

        {/* Section Tab Bar */}
        <div className="flex gap-2 mb-6">
          <button type="button" onClick={() => setActiveSection('order-channel')}
            className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
              activeSection === 'order-channel'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}>
            Order Channel
          </button>
          <button type="button" onClick={() => setActiveSection('closing')}
            className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
              activeSection === 'closing'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}>
            Closing
          </button>
        </div>

        {/* Save Message */}
        {saveMessage && (
          <div className={`mb-6 p-4 rounded-lg ${
            saveMessage.type === 'success' 
              ? 'bg-green-100 border border-green-400 text-green-700' 
              : 'bg-red-100 border border-red-400 text-red-700'
          }`}>
            {saveMessage.text}
          </div>
        )}

        {/* ===== ORDER CHANNEL SECTION ===== */}
        {activeSection === 'order-channel' && (<>
        <div className="grid md:grid-cols-2 gap-8">
          {/* Order Channel Selection */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Channel Selection</h2>
            <div className="space-y-2">
              {orderTypes.map((type) => {
                const connectedMenu = getChannelMenu(type.id);
                return (
                  <button
                    key={type.id}
                    onClick={() => handleChannelClick(type.id)}
                    className={`w-full p-3 text-left rounded-lg border-2 transition-all duration-200 ${
                      selectedOrderType === type.id
                        ? 'border-blue-500 bg-blue-50'
                        : connectedMenu 
                          ? 'border-green-300 bg-green-50 hover:border-green-400' 
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 text-sm">{type.label}</h3>
                        {/* 연결된 메뉴 표시 */}
                        {connectedMenu && (
                          <p className="text-sm font-medium text-green-600 mt-1 flex items-center">
                            <span className="mr-1">🔗</span>
                            {connectedMenu}
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                              getChannelPriceType(type.id) === 'price2' 
                                ? 'bg-orange-100 text-orange-700' 
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {getChannelPriceType(type.id) === 'price2' ? 'Price 2' : 'Price 1'}
                            </span>
                            {type.id === 'togo' && (
                              <span className={`ml-1 px-2 py-0.5 rounded text-xs ${
                                getChannelTogoInfoTiming(type.id) === 'after'
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {getChannelTogoInfoTiming(type.id) === 'after' ? 'Info After' : 'Info Before'}
                              </span>
                            )}
                            {type.id === 'togo' && (
                              <span className={`ml-1 px-2 py-0.5 rounded text-xs ${
                                togoPanelEnabled
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}>
                                {togoPanelEnabled ? 'Panel ON' : 'Panel OFF'}
                              </span>
                            )}
                            {type.id === 'togo' && (
                              <span className={`ml-1 px-2 py-0.5 rounded text-xs ${
                                fsrTogoButtonVisible
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>
                                {fsrTogoButtonVisible ? 'Btns ON' : 'Btns OFF'}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      {/* 선택됨 표시 */}
                      {selectedOrderType === type.id && (
                        <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                      {/* 이미 연결된 메뉴가 있는 경우 체크 표시 */}
                      {connectedMenu && selectedOrderType !== type.id && (
                        <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Menu Selection */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Menu Selection</h2>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <span className="ml-2 text-gray-600">Loading menus...</span>
              </div>
            ) : menus.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No menus registered.</p>
                <p className="text-sm">Please create a menu in Menu Manager first.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Dropdown selector (hide for togo) */}
                {selectedOrderType !== 'togo' && (
                <div className="relative">
                  <label htmlFor="menu-select" className="block text-sm font-medium text-gray-700 mb-2">
                    Select a menu
                  </label>
                  <select
                    id="menu-select"
                    value={selectedMenu || ''}
                    onChange={(e) => setSelectedMenu(e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select a menu</option>
                    {menus.map((menu) => (
                      <option key={menu.menu_id} value={menu.menu_id}>
                        {menu.name}
                      </option>
                    ))}
                  </select>
                </div>
                )}

                {/* Selected menu info display (hide for togo) */}
                {selectedOrderType !== 'togo' && selectedMenu && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 font-semibold">🍽️</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium text-blue-900">
                          {menus.find(m => m.menu_id === selectedMenu)?.name}
                        </h3>
                        {menus.find(m => m.menu_id === selectedMenu)?.description && (
                          <p className="text-sm text-blue-700">
                            {menus.find(m => m.menu_id === selectedMenu)?.description}
                          </p>
                        )}
                      </div>
                      <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                {/* Price Type Selection (hide for togo) */}
                {selectedOrderType !== 'togo' && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    💰 Price Selection <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedPriceType('price')}
                      className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                        selectedPriceType === 'price'
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-gray-900">Price</h4>
                        {selectedPriceType === 'price' && (
                          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPriceType('price2')}
                      className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                        selectedPriceType === 'price2'
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-gray-900">Price 2</h4>
                        {selectedPriceType === 'price2' && (
                          <div className="w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </button>
                  </div>
                </div>
                )}

                {/* Togo Settings (only for Togo channel) */}
                {selectedOrderType === 'togo' && (
                  <div className="space-y-4">
                    {/* Customer Info Timing */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Customer Info Timing</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setSelectedTogoInfoTiming('before')} className={`py-2 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${selectedTogoInfoTiming === 'before' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>Before Order</button>
                        <button type="button" onClick={() => setSelectedTogoInfoTiming('after')} className={`py-2 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${selectedTogoInfoTiming === 'after' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>After Order</button>
                      </div>
                    </div>

                    {/* TOGO Panel + screen ratio (accordion: expands when ON) */}
                    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                      <div className="p-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">TOGO Panel (Right Side)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => { try { const raw = localStorage.getItem('tableMapChannelVisibility'); const current = raw ? JSON.parse(raw) : { togo: true, delivery: true }; const updated = { ...current, togo: true }; localStorage.setItem('tableMapChannelVisibility', JSON.stringify(updated)); window.dispatchEvent(new StorageEvent('storage', { key: 'tableMapChannelVisibility', newValue: JSON.stringify(updated) })); setTogoPanelEnabled(true); } catch {} }} className={`py-2 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${togoPanelEnabled ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>ON</button>
                          <button type="button" onClick={() => { try { const raw = localStorage.getItem('tableMapChannelVisibility'); const current = raw ? JSON.parse(raw) : { togo: true, delivery: true }; const updated = { ...current, togo: false }; localStorage.setItem('tableMapChannelVisibility', JSON.stringify(updated)); window.dispatchEvent(new StorageEvent('storage', { key: 'tableMapChannelVisibility', newValue: JSON.stringify(updated) })); setTogoPanelEnabled(false); } catch {} }} className={`py-2 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${!togoPanelEnabled ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>OFF</button>
                        </div>
                      </div>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
                          togoPanelEnabled ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
                        }`}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="border-t border-gray-100 bg-gray-50/60 px-3 pb-3 pt-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Table map / TOGO panel width
                            </label>
                            <p className="text-xs text-gray-500 mb-2">Table map (left) : TOGO panel (right).</p>
                            <div className="grid grid-cols-3 gap-2">
                              {TABLE_MAP_TOGO_PANEL_SPLIT_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => {
                                    try {
                                      localStorage.setItem(TABLE_MAP_TOGO_PANEL_SPLIT_KEY, opt.value);
                                      setTogoPanelSplitPreset(opt.value);
                                      window.dispatchEvent(
                                        new StorageEvent('storage', {
                                          key: TABLE_MAP_TOGO_PANEL_SPLIT_KEY,
                                          newValue: opt.value,
                                          url: window.location.href,
                                        } as StorageEventInit)
                                      );
                                      notifyTableMapTogoPanelSplitChanged();
                                    } catch {}
                                  }}
                                  className={`py-2 px-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                                    togoPanelSplitPreset === opt.value
                                      ? 'border-violet-500 bg-violet-50 text-violet-800'
                                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* TOGO Button */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Pickup Order Buttons (Header)</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => { localStorage.setItem('fsrTogoButtonVisible', 'true'); window.dispatchEvent(new StorageEvent('storage', { key: 'fsrTogoButtonVisible', newValue: 'true' })); setFsrTogoButtonVisible(true); }} className={`py-2 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${fsrTogoButtonVisible ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>ON</button>
                        <button type="button" onClick={() => { localStorage.setItem('fsrTogoButtonVisible', 'false'); window.dispatchEvent(new StorageEvent('storage', { key: 'fsrTogoButtonVisible', newValue: 'false' })); setFsrTogoButtonVisible(false); }} className={`py-2 px-3 rounded-lg border-2 text-sm font-semibold transition-all ${!fsrTogoButtonVisible ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>OFF</button>
                      </div>
                    </div>

                    {/* Save Button for Togo */}
                    <div className="pt-2">
                      <button
                        onClick={handleTogoSave}
                        disabled={isSaving}
                        className={`w-full py-3 rounded-lg font-semibold text-base transition-all ${isSaving ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700 shadow-lg'}`}
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Save Button */}
                    <button
                      onClick={handleSave}
                      disabled={!canSave || isSaving}
                      className={`px-6 py-3 rounded-lg font-medium text-lg transition-all duration-200 ${
                        canSave && !isSaving
                          ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {isSaving ? (
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          <span>저장 중...</span>
                        </div>
                      ) : (
                        'Save Configuration'
                      )}
                    </button>

                    {/* Continue button */}
                    <button
                      onClick={handleContinue}
                      disabled={!canContinue}
                      className={`px-6 py-3 rounded-lg font-medium text-lg transition-all duration-200 ${
                        canContinue
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {canContinue ? 'Go to Order Screen' : 'Please select order channel and menu'}
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenOrderScreenManager}
                      className="w-full mt-3 px-4 py-3 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100 transition-colors"
                    >
                      Open Order Screen Manager (Reorder via Drag & Drop)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Selected items display */}
        {canContinue && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-center space-x-4 text-blue-800 flex-wrap gap-2">
              <span className="text-sm">
                Channel: <strong>{orderTypes.find(t => t.id === selectedOrderType)?.label}</strong>
              </span>
              <span className="text-blue-400">|</span>
              <span className="text-sm">
                Menu: <strong>{menus.find(m => m.menu_id === selectedMenu)?.name}</strong>
              </span>
              <span className="text-blue-400">|</span>
              <span className="text-sm">
                Price: <strong className={selectedPriceType === 'price2' ? 'text-orange-600' : 'text-green-600'}>
                  {selectedPriceType === 'price2' ? 'Price 2 (Delivery)' : 'Price 1 (Standard)'}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* Saved Setups Display */}
        {savedSetups.length > 0 && (
          <div className="mt-8 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Saved Configurations</h2>
            <div className="space-y-3">
              {savedSetups.map((setup, index) => (
                <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 font-semibold">⚙️</span>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900 flex items-center gap-2">
                          {orderTypes.find(t => t.id === setup.orderType)?.label} - {setup.menuName}
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            setup.priceType === 'price2' 
                              ? 'bg-orange-100 text-orange-700' 
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {setup.priceType === 'price2' ? 'Price 2' : 'Price'}
                          </span>
                        </h3>
                        <p className="text-sm text-gray-500">
                          Created: {new Date(setup.createdAt).toLocaleDateString('ko-KR')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedOrderType(setup.orderType);
                        setSelectedMenu(setup.menuId);
                        setSelectedPriceType(setup.priceType === 'price1' ? 'price' : (setup.priceType || 'price'));
                        setSelectedTogoInfoTiming(setup.togoInfoTiming || 'before');
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Load
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* END: Order Channel Section */}
        </>
        )}

        {/* ===== CLOSING SECTION ===== */}
        {activeSection === 'closing' && (
          <div className="bg-white rounded-lg shadow-md p-6 max-w-2xl">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Closing Settings</h2>
            <p className="text-sm text-gray-500 mb-6">Configure settings for Shift Close and Day Close</p>

            {/* Order Entry Settings */}
            <div className="space-y-5">
              <h3 className="text-base font-semibold text-gray-800 border-b border-gray-200 pb-2">Order Entry</h3>

              {/* Select Server on Entry Toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex-1 mr-4">
                  <p className="font-medium text-gray-900 text-sm">Select Server</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Show server selection modal when entering Table / ToGo orders
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => saveSelectServerOnEntry(!selectServerOnEntry)}
                  className={`relative w-14 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
                    selectServerOnEntry ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                    selectServerOnEntry ? 'translate-x-7' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            {/* Shift Close Settings */}
            <div className="space-y-5 mt-8">
              <h3 className="text-base font-semibold text-gray-800 border-b border-gray-200 pb-2">Shift Close</h3>

              {/* Require server before Shift Close */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex-1 mr-4">
                  <p className="font-medium text-gray-900 text-sm">Require server before Shift Close</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {shiftServerSelection
                      ? 'Server must be selected before Shift Close. Transfer of unpaid orders is available.'
                      : 'Shift Close starts immediately without server selection. Transfer is disabled.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !shiftServerSelection;
                    setShiftServerSelection(next);
                    localStorage.setItem('closingShiftServerSelection', String(next));
                  }}
                  className={`relative w-14 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
                    shiftServerSelection ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                    shiftServerSelection ? 'translate-x-7' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Transfer auto-disabled notice */}
              {!shiftServerSelection && (
                <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="text-amber-500 text-sm mt-0.5">&#9888;</span>
                  <p className="text-xs text-amber-700">
                    Transfer feature is automatically disabled when this option is turned off.
                    Unpaid orders will remain assigned to the current server.
                  </p>
                </div>
              )}

              {/* Transfer behavior when required */}
              {shiftServerSelection && (
                <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Unpaid order transfer</p>
                  <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside pl-0.5">
                    <li>Until you transfer, open orders belong to the closing server (server A).</li>
                    <li>When you confirm transfer to another clocked-in server (server B), ownership updates in one step: orders, payments, and tip rows tied to those orders move to B.</li>
                    <li>After transfer, sales and tips for those orders count only toward B, not A.</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderSetupPage;
