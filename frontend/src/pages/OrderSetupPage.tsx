import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
  createdAt: string;
}

const API_URL = 'http://localhost:3177/api';

const orderTypes = [
  { id: 'pos', label: 'Dine-in Order' },
  { id: 'togo', label: 'Togo Order' },
  { id: 'online', label: 'Online Order' },
  { id: 'delivery', label: 'Delivery Order' },
  { id: 'table-qr', label: 'Table QR Order' },
  { id: 'kiosk', label: 'Kiosk Order' }
];

const OrderSetupPage = () => {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedOrderType, setSelectedOrderType] = useState<string>('');
  const [selectedMenu, setSelectedMenu] = useState<number | null>(null);
  const [selectedPriceType, setSelectedPriceType] = useState<'price' | 'price1' | 'price2'>('price');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedSetups, setSavedSetups] = useState<OrderPageSetup[]>([]);
  const navigate = useNavigate();

  // Fetch menu list
  useEffect(() => {
    const fetchMenus = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${API_URL}/menus`);
        if (!response.ok) throw new Error('Failed to fetch menus');
        const data = await response.json();
        setMenus(data);
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

  // 채널 클릭 핸들러 - 저장된 설정이 있으면 자동으로 불러오기
  const handleChannelClick = (channelId: string) => {
    setSelectedOrderType(channelId);
    
    // 해당 채널에 저장된 설정이 있으면 자동으로 메뉴와 가격 타입 선택
    const setup = savedSetups.find(s => s.orderType === channelId);
    if (setup) {
      setSelectedMenu(setup.menuId);
      setSelectedPriceType(setup.priceType === 'price1' ? 'price' : (setup.priceType || 'price'));
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
        createdAt: new Date().toISOString()
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

  const canContinue = selectedOrderType && selectedMenu;
  const canSave = selectedOrderType && selectedMenu;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Screen Setup</h1>
          <p className="text-gray-600">Select order channel and menu to configure the order screen</p>
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
                {/* Dropdown selector */}
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

                {/* Selected menu info display */}
                {selectedMenu && (
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

                {/* Price Type Selection */}
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
      </div>
    </div>
  );
};

export default OrderSetupPage;