import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Users, ChefHat, Send, ShoppingCart, Plus, Minus, X, 
  Utensils, Settings, RefreshCw, Wifi, WifiOff, Clock, Bell,
  ChevronRight, Check, Trash2, Edit3, MessageSquare, AlertCircle,
  Volume2
} from 'lucide-react';
import { usePosSocket, CallServerRequest } from '../hooks/usePosSocket';

// ==================== Types ====================
interface TableElement {
  element_id: string;
  name: string;
  type: string;
  status: string;
  guests?: number;
  current_order_id?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MenuItem {
  item_id: number;
  name: string;
  short_name?: string;
  price: number;
  description?: string;
  image_url?: string;
  category_id: number;
}

interface Category {
  category_id: number;
  name: string;
  items: MenuItem[];
}

interface Modifier {
  modifier_id: number;
  name: string;
  price_adjustment: number;
}

interface ModifierGroup {
  modifier_group_id: number;
  name: string;
  selection_type: 'SINGLE' | 'MULTIPLE';
  min_selection: number;
  max_selection: number;
  modifiers: Modifier[];
}

interface SelectedModifier {
  group_id: number;
  group_name: string;
  modifier_id: number;
  name: string;
  price_adjustment: number;
}

interface CartItem extends MenuItem {
  quantity: number;
  cartId: string;
  modifiers: SelectedModifier[];
  specialInstruction?: string;
  guestNumber: number;
}

interface OrderItem {
  id: number;
  name: string;
  quantity: number;
  price: number;
  guest_number: number;
  modifiers_json?: string;
  item_source?: string;
  status?: string;
}

interface SetupConfig {
  posHost: string;
  serverName: string;
  serverPin: string;
  configured: boolean;
}

const STORAGE_KEY = 'handheld-pos-setup';

// ==================== Main Component ====================
const HandheldPage: React.FC = () => {
  const navigate = useNavigate();
  
  // Config
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  
  // View State
  const [view, setView] = useState<'tables' | 'order'>('tables');
  const [selectedTable, setSelectedTable] = useState<TableElement | null>(null);
  const [selectedFloor, setSelectedFloor] = useState('1F');
  
  // Data
  const [tables, setTables] = useState<TableElement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [existingOrderItems, setExistingOrderItems] = useState<OrderItem[]>([]);
  
  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [currentGuest, setCurrentGuest] = useState(1);
  const [totalGuests, setTotalGuests] = useState(1);
  
  // Modifiers
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>([]);
  const [loadingModifiers, setLoadingModifiers] = useState(false);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [specialInstruction, setSpecialInstruction] = useState('');
  
  // UI States
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCallAlerts, setShowCallAlerts] = useState(false);
  
  // Floors
  const floors = ['1F', '2F', '3F', 'Patio'];
  
  // ==================== Socket.io 연결 ====================
  const {
    isConnected: socketConnected,
    activeCalls,
    acknowledgeCall,
    dismissCall
  } = usePosSocket({
    serverUrl: config?.posHost || '',
    deviceType: 'handheld',
    deviceName: config?.serverName || 'Handheld',
    onCallServerRequest: (call) => {
      // 새 Call 요청 시 알림
      setNotification({ type: 'success', message: `🔔 ${call.table_label}: ${call.message}` });
      // 진동 (지원되는 경우)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    },
    onTableStatusChanged: (data) => {
      // 테이블 상태 변경 시 목록 새로고침
      loadTables();
    },
    onOrderReceived: (data) => {
      // 다른 디바이스에서 주문 접수 시
      if (data.source === 'TABLE_QR') {
        setNotification({ type: 'success', message: `📦 Table ${data.table_id}: New order from QR` });
      }
      loadTables();
    }
  });
  
  // ==================== Effects ====================
  
  // Load config
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (!savedConfig) {
      navigate('/handheld-setup');
      return;
    }
    
    try {
      const parsed = JSON.parse(savedConfig);
      if (!parsed.configured) {
        navigate('/handheld-setup');
        return;
      }
      setConfig(parsed);
    } catch (e) {
      navigate('/handheld-setup');
    }
  }, [navigate]);
  
  // Load tables
  useEffect(() => {
    if (!config) return;
    loadTables();
  }, [config, selectedFloor]);
  
  // Load menu when entering order view
  useEffect(() => {
    if (view === 'order' && config) {
      loadMenu();
    }
  }, [view, config]);
  
  // Load existing order when table selected
  useEffect(() => {
    if (selectedTable?.current_order_id && config) {
      loadExistingOrder(selectedTable.current_order_id);
    } else {
      setExistingOrderItems([]);
    }
  }, [selectedTable, config]);
  
  // Auto-hide notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  
  // ==================== API Functions ====================
  
  const loadTables = async () => {
    if (!config) return;
    
    try {
      const res = await fetch(`${config.posHost}/api/table-map/elements?floor=${selectedFloor}`);
      if (res.ok) {
        const data = await res.json();
        // Filter only table types
        const tableTypes = ['rounded-rectangle', 'circle', 'rectangle'];
        const filteredTables = data.filter((el: TableElement) => 
          tableTypes.includes(el.type) && el.name
        );
        setTables(filteredTables);
        setIsConnected(true);
      } else {
        throw new Error('Failed to load tables');
      }
    } catch (error) {
      console.error('Failed to load tables:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };
  
  const loadMenu = async () => {
    if (!config) return;
    
    try {
      // Get default menu from order-page-setups
      const setupRes = await fetch(`${config.posHost}/api/order-page-setups`);
      let menuId = null;
      
      if (setupRes.ok) {
        const setups = await setupRes.json();
        const posSetup = setups.find((s: any) => s.order_type === 'pos');
        menuId = posSetup?.menu_id;
      }
      
      if (!menuId) {
        // Fallback to first menu
        const menusRes = await fetch(`${config.posHost}/api/menus`);
        if (menusRes.ok) {
          const menus = await menusRes.json();
          menuId = menus[0]?.menu_id;
        }
      }
      
      if (menuId) {
        const menuRes = await fetch(`${config.posHost}/api/table-orders/menu/${menuId}`);
        if (menuRes.ok) {
          const menuData = await menuRes.json();
          setCategories(menuData.categories || []);
          if (menuData.categories?.length > 0 && !selectedCategory) {
            setSelectedCategory(menuData.categories[0].category_id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error);
    }
  };
  
  const loadExistingOrder = async (orderId: number) => {
    if (!config) return;
    
    try {
      const res = await fetch(`${config.posHost}/api/orders/${orderId}`);
      if (res.ok) {
        const order = await res.json();
        setExistingOrderItems(order.items || []);
        if (order.guest_count) {
          setTotalGuests(order.guest_count);
        }
      }
    } catch (error) {
      console.error('Failed to load existing order:', error);
    }
  };
  
  // ==================== Handlers ====================
  
  const handleTableSelect = (table: TableElement) => {
    setSelectedTable(table);
    setCart([]);
    setCurrentGuest(1);
    
    // Show guest count modal for new orders (no current_order_id)
    if (!table.current_order_id) {
      setShowGuestModal(true);
    } else {
      setView('order');
    }
  };
  
  const handleGuestConfirm = () => {
    setShowGuestModal(false);
    setView('order');
  };
  
  const handleBackToTables = () => {
    setView('tables');
    setSelectedTable(null);
    setCart([]);
    setExistingOrderItems([]);
    setSelectedCategory(categories[0]?.category_id || null);
  };
  
  // Item click - load modifiers
  const handleItemClick = async (item: MenuItem) => {
    if (!config) return;
    
    setSelectedItem(item);
    setItemQuantity(1);
    setSelectedModifiers([]);
    setSpecialInstruction('');
    setLoadingModifiers(true);
    setShowModifierModal(true);
    
    try {
      const res = await fetch(`${config.posHost}/api/menu/items/${item.item_id}/options`);
      if (res.ok) {
        const data = await res.json();
        const groups = (data.modifier_groups || [])
          .filter((g: any) => !g.is_invalid && g.modifier_group_id)
          .map((g: any) => ({
            modifier_group_id: g.modifier_group_id,
            name: g.name || 'Options',
            selection_type: g.selection_type || 'MULTIPLE',
            min_selection: g.min_selection || 0,
            max_selection: g.max_selection || 10,
            modifiers: (g.modifiers || []).map((m: any) => ({
              modifier_id: m.modifier_id,
              name: m.name,
              price_adjustment: m.price_adjustment || 0
            }))
          }));
        setModifierGroups(groups);
      } else {
        setModifierGroups([]);
      }
    } catch (err) {
      console.error('Failed to load modifiers:', err);
      setModifierGroups([]);
    } finally {
      setLoadingModifiers(false);
    }
  };
  
  // Toggle modifier
  const toggleModifier = (group: ModifierGroup, modifier: Modifier) => {
    setSelectedModifiers(prev => {
      const existing = prev.find(m => m.modifier_id === modifier.modifier_id);
      
      if (group.selection_type === 'SINGLE') {
        const filtered = prev.filter(m => m.group_id !== group.modifier_group_id);
        if (existing) return filtered;
        return [...filtered, {
          group_id: group.modifier_group_id,
          group_name: group.name,
          modifier_id: modifier.modifier_id,
          name: modifier.name,
          price_adjustment: modifier.price_adjustment
        }];
      } else {
        if (existing) {
          return prev.filter(m => m.modifier_id !== modifier.modifier_id);
        }
        const groupCount = prev.filter(m => m.group_id === group.modifier_group_id).length;
        if (group.max_selection > 0 && groupCount >= group.max_selection) {
          return prev;
        }
        return [...prev, {
          group_id: group.modifier_group_id,
          group_name: group.name,
          modifier_id: modifier.modifier_id,
          name: modifier.name,
          price_adjustment: modifier.price_adjustment
        }];
      }
    });
  };
  
  // Check modifier selection validity
  const isModifierSelectionValid = () => {
    for (const group of modifierGroups) {
      const selectedCount = selectedModifiers.filter(m => m.group_id === group.modifier_group_id).length;
      if (group.min_selection > 0 && selectedCount < group.min_selection) {
        return false;
      }
    }
    return true;
  };
  
  // Add to cart
  const addToCart = () => {
    if (!selectedItem) return;
    
    setCart(prev => [...prev, {
      ...selectedItem,
      quantity: itemQuantity,
      cartId: `${selectedItem.item_id}_${Date.now()}`,
      modifiers: selectedModifiers,
      specialInstruction: specialInstruction || undefined,
      guestNumber: currentGuest
    }]);
    
    setShowModifierModal(false);
    setSelectedItem(null);
    setModifierGroups([]);
    setSelectedModifiers([]);
    setSpecialInstruction('');
  };
  
  // Remove from cart
  const removeFromCart = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };
  
  // Update quantity in cart
  const updateCartQuantity = (cartId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartId === cartId) {
        const newQty = item.quantity + delta;
        if (newQty <= 0) return null as any;
        return { ...item, quantity: newQty };
      }
      return item;
    }).filter(Boolean));
  };
  
  // Submit order
  const handleSubmitOrder = async () => {
    if (!config || !selectedTable || cart.length === 0) return;
    
    setIsSubmitting(true);
    
    try {
      const orderData = {
        store_id: 'default',
        table_id: selectedTable.name,
        table_label: selectedTable.name,
        items: cart.map(item => ({
          item_id: item.item_id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          guest_number: item.guestNumber,
          modifiers: item.modifiers || [],
          special_instruction: item.specialInstruction
        })),
        customer_note: '',
        server_name: config.serverName,
        guest_count: totalGuests,
        source: 'HANDHELD'
      };
      
      const res = await fetch(`${config.posHost}/api/table-orders/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
      
      if (!res.ok) throw new Error('Failed to submit order');
      
      const result = await res.json();
      
      setNotification({ type: 'success', message: `Order sent! #${result.order_id}` });
      setCart([]);
      
      // Reload existing order items
      if (result.pos_order_id) {
        loadExistingOrder(result.pos_order_id);
        // Update selected table with new order_id
        setSelectedTable(prev => prev ? { ...prev, current_order_id: result.pos_order_id, status: 'Occupied' } : null);
      }
      
      // Reload tables to update status
      loadTables();
      
    } catch (error) {
      console.error('Failed to submit order:', error);
      setNotification({ type: 'error', message: 'Failed to send order. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // ==================== Computed Values ====================
  
  const currentItems = useMemo(() => {
    if (!selectedCategory) return [];
    const cat = categories.find(c => c.category_id === selectedCategory);
    return cat?.items || [];
  }, [categories, selectedCategory]);
  
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const modTotal = item.modifiers.reduce((ms, m) => ms + m.price_adjustment, 0);
      return sum + (item.price + modTotal) * item.quantity;
    }, 0);
  }, [cart]);
  
  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);
  
  const getItemTotal = () => {
    if (!selectedItem) return 0;
    const modTotal = selectedModifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
    return (selectedItem.price + modTotal) * itemQuantity;
  };
  
  const getTableStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'occupied': return 'bg-blue-500 text-white';
      case 'reserved': return 'bg-amber-500 text-white';
      case 'dirty': return 'bg-red-400 text-white';
      default: return 'bg-green-500 text-white';
    }
  };
  
  // ==================== Loading State ====================
  
  if (!config) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }
  
  // ==================== Table View ====================
  
  if (view === 'tables') {
    return (
      <div className="h-screen bg-slate-900 flex flex-col">
        {/* Header */}
        <header className="bg-slate-800 px-4 py-3 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Utensils className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold">Handheld POS</h1>
              <p className="text-slate-400 text-xs">{config.serverName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Call 알림 버튼 */}
            {activeCalls.length > 0 && (
              <button
                onClick={() => setShowCallAlerts(true)}
                className="relative p-2 bg-red-500 hover:bg-red-600 rounded-lg transition animate-pulse"
              >
                <Bell className="w-5 h-5 text-white" />
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-red-500 text-xs font-bold rounded-full flex items-center justify-center">
                  {activeCalls.length}
                </span>
              </button>
            )}
            {socketConnected ? (
              <Wifi className="w-5 h-5 text-green-400" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-400" />
            )}
            <button 
              onClick={() => navigate('/handheld-setup')}
              className="p-2 hover:bg-slate-700 rounded-lg transition"
            >
              <Settings className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </header>
        
        {/* Floor Tabs */}
        <div className="flex bg-slate-800 border-b border-slate-700">
          {floors.map(floor => (
            <button
              key={floor}
              onClick={() => setSelectedFloor(floor)}
              className={`flex-1 py-3 text-sm font-bold transition ${
                selectedFloor === floor 
                  ? 'bg-blue-600 text-white' 
                  : 'text-slate-400 hover:bg-slate-700'
              }`}
            >
              {floor}
            </button>
          ))}
        </div>
        
        {/* Tables Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Utensils className="w-16 h-16 mb-4 opacity-30" />
              <p>No tables on this floor</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {tables.map(table => (
                <button
                  key={table.element_id}
                  onClick={() => handleTableSelect(table)}
                  className={`aspect-square rounded-xl flex flex-col items-center justify-center p-2 transition-all active:scale-95 shadow-lg ${getTableStatusColor(table.status)}`}
                >
                  <span className="text-2xl font-bold">{table.name}</span>
                  {table.guests && table.guests > 0 && (
                    <div className="flex items-center gap-1 mt-1 text-sm opacity-80">
                      <Users className="w-3 h-3" />
                      <span>{table.guests}</span>
                    </div>
                  )}
                  <span className="text-xs mt-1 opacity-70 capitalize">
                    {table.status || 'Available'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Refresh Button */}
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={loadTables}
            className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh Tables
          </button>
        </div>
        
        {/* Guest Count Modal */}
        {showGuestModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
              <div className="bg-blue-600 p-4 text-white">
                <h3 className="text-lg font-bold">Table {selectedTable?.name}</h3>
                <p className="text-blue-100 text-sm">How many guests?</p>
              </div>
              
              <div className="p-6">
                <div className="flex items-center justify-center gap-6">
                  <button
                    onClick={() => setTotalGuests(Math.max(1, totalGuests - 1))}
                    className="w-14 h-14 bg-slate-200 rounded-full flex items-center justify-center text-2xl font-bold hover:bg-slate-300 transition"
                  >
                    -
                  </button>
                  <span className="text-5xl font-bold text-slate-800 w-20 text-center">{totalGuests}</span>
                  <button
                    onClick={() => setTotalGuests(totalGuests + 1)}
                    className="w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center text-2xl font-bold hover:bg-blue-600 transition"
                  >
                    +
                  </button>
                </div>
                
                <div className="flex gap-3 mt-8">
                  <button
                    onClick={() => {
                      setShowGuestModal(false);
                      setSelectedTable(null);
                    }}
                    className="flex-1 py-3 bg-slate-200 rounded-xl font-medium hover:bg-slate-300 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGuestConfirm}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition"
                  >
                    Start Order
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Call Alerts Modal */}
        {showCallAlerts && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden max-h-[80vh] flex flex-col">
              <div className="bg-red-500 p-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="w-6 h-6" />
                  <h3 className="text-lg font-bold">Call Requests ({activeCalls.length})</h3>
                </div>
                <button
                  onClick={() => setShowCallAlerts(false)}
                  className="p-1 hover:bg-red-600 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeCalls.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Bell className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>No active calls</p>
                  </div>
                ) : (
                  activeCalls.map(call => (
                    <div 
                      key={call.id} 
                      className={`p-4 rounded-xl border-2 ${
                        call.status === 'acknowledged' 
                          ? 'bg-green-50 border-green-200' 
                          : 'bg-amber-50 border-amber-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl font-bold text-slate-800">{call.table_label}</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                          call.status === 'acknowledged'
                            ? 'bg-green-500 text-white'
                            : 'bg-amber-500 text-white'
                        }`}>
                          {call.status === 'acknowledged' ? 'Acknowledged' : 'Pending'}
                        </span>
                      </div>
                      <p className="text-slate-600 mb-3">{call.message}</p>
                      <div className="flex gap-2">
                        {call.status !== 'acknowledged' && (
                          <button
                            onClick={() => acknowledgeCall(call.id, config.serverName)}
                            className="flex-1 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition flex items-center justify-center gap-2"
                          >
                            <Check className="w-4 h-4" />
                            On My Way
                          </button>
                        )}
                        <button
                          onClick={() => dismissCall(call.id)}
                          className="py-2 px-4 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 transition"
                        >
                          Done
                        </button>
                      </div>
                      {call.acknowledged_by && (
                        <p className="text-xs text-green-600 mt-2">
                          ✓ {call.acknowledged_by} is handling this
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // ==================== Order View ====================
  
  return (
    <div className="h-screen bg-slate-100 flex flex-col">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 left-4 right-4 z-50 p-4 rounded-xl shadow-lg flex items-center gap-3 animate-[slideIn_0.3s_ease-out] ${
          notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {notification.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
      
      {/* Header */}
      <header className="bg-slate-800 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBackToTables}
            className="p-2 hover:bg-slate-700 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <h1 className="text-white font-bold text-lg">Table {selectedTable?.name}</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">{config.serverName}</span>
              <span className="text-slate-600">•</span>
              <div className="flex items-center gap-1 text-slate-400">
                <Users className="w-3 h-3" />
                <span>{totalGuests} guests</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Guest Selector */}
        <div className="flex items-center bg-slate-700 rounded-lg p-1">
          {Array.from({ length: Math.min(totalGuests, 6) }, (_, i) => i + 1).map(g => (
            <button
              key={g}
              onClick={() => setCurrentGuest(g)}
              className={`w-8 h-8 rounded-md text-sm font-bold transition ${
                currentGuest === g 
                  ? 'bg-blue-500 text-white' 
                  : 'text-slate-400 hover:bg-slate-600'
              }`}
            >
              {g}
            </button>
          ))}
          {totalGuests > 6 && (
            <span className="px-2 text-slate-500 text-xs">+{totalGuests - 6}</span>
          )}
        </div>
      </header>
      
      {/* Existing Order Items (if any) */}
      {existingOrderItems.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-200 px-3 py-2">
          <div className="flex items-center gap-2 text-blue-700 text-sm font-medium mb-1">
            <Clock className="w-4 h-4" />
            <span>Current Order ({existingOrderItems.length} items)</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {existingOrderItems.slice(0, 5).map((item, idx) => (
              <span key={idx} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">
                {item.quantity}x {item.name}
              </span>
            ))}
            {existingOrderItems.length > 5 && (
              <span className="text-blue-500 text-xs">+{existingOrderItems.length - 5} more</span>
            )}
          </div>
        </div>
      )}
      
      {/* Category Tabs */}
      <div className="bg-white shadow-sm overflow-x-auto flex-shrink-0">
        <div className="flex">
          {categories.map(cat => (
            <button
              key={cat.category_id}
              onClick={() => setSelectedCategory(cat.category_id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition border-b-2 ${
                selectedCategory === cat.category_id
                  ? 'text-blue-600 border-blue-600 bg-blue-50'
                  : 'text-slate-600 border-transparent hover:bg-slate-50'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>
      
      {/* Menu Items Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-3 gap-2">
          {currentItems.map(item => (
            <button
              key={item.item_id}
              onClick={() => handleItemClick(item)}
              className="bg-white rounded-xl p-2 shadow-sm hover:shadow-md transition active:scale-95 text-left"
            >
              <h3 className="font-bold text-slate-800 text-sm leading-tight line-clamp-2 min-h-[2rem]">
                {item.short_name || item.name}
              </h3>
              <p className="text-blue-600 font-bold text-sm mt-1">${item.price.toFixed(2)}</p>
            </button>
          ))}
        </div>
        
        {currentItems.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <Utensils className="w-12 h-12 mb-2 opacity-30" />
            <p>No items in this category</p>
          </div>
        )}
      </div>
      
      {/* Cart Panel */}
      {cart.length > 0 && (
        <div className="bg-white border-t shadow-lg">
          {/* Cart Items */}
          <div className="max-h-32 overflow-y-auto p-2 space-y-1">
            {cart.map(item => (
              <div key={item.cartId} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs font-bold">
                      G{item.guestNumber}
                    </span>
                    <span className="font-medium text-sm truncate">{item.name}</span>
                  </div>
                  {item.modifiers.length > 0 && (
                    <p className="text-xs text-slate-500 truncate">
                      {item.modifiers.map(m => m.name).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateCartQuantity(item.cartId, -1)}
                    className="w-7 h-7 bg-slate-200 rounded flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                  <button
                    onClick={() => updateCartQuantity(item.cartId, 1)}
                    className="w-7 h-7 bg-blue-500 text-white rounded flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeFromCart(item.cartId)}
                    className="w-7 h-7 bg-red-100 text-red-500 rounded flex items-center justify-center ml-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {/* Submit Button */}
          <div className="p-3 border-t">
            <button
              onClick={handleSubmitOrder}
              disabled={isSubmitting || cart.length === 0}
              className="w-full py-4 bg-green-500 hover:bg-green-600 disabled:bg-slate-300 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition shadow-lg"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send to Kitchen ({cartCount}) - ${cartTotal.toFixed(2)}
                </>
              )}
            </button>
          </div>
        </div>
      )}
      
      {/* Empty Cart - Show Send Button Placeholder */}
      {cart.length === 0 && (
        <div className="bg-white border-t p-3">
          <div className="py-4 bg-slate-100 rounded-xl text-slate-400 text-center flex items-center justify-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            <span>Tap items to add to order</span>
          </div>
        </div>
      )}
      
      {/* Modifier Modal */}
      {showModifierModal && selectedItem && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-h-[85vh] flex flex-col animate-[slideUp_0.3s_ease-out]">
            {/* Header */}
            <div className="bg-blue-600 px-4 py-3 rounded-t-3xl flex items-center justify-between">
              <div className="flex-1">
                <h2 className="text-white font-bold text-lg">{selectedItem.name}</h2>
                <p className="text-blue-100 text-sm">${selectedItem.price.toFixed(2)}</p>
              </div>
              <button
                onClick={() => setShowModifierModal(false)}
                className="p-2 hover:bg-blue-500 rounded-lg transition"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Modifiers */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingModifiers ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              ) : modifierGroups.length === 0 ? (
                <p className="text-center text-slate-500 py-4">No options available</p>
              ) : (
                modifierGroups.map(group => (
                  <div key={group.modifier_group_id} className="border rounded-xl overflow-hidden">
                    <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
                      <span className="font-bold text-sm">{group.name}</span>
                      {group.min_selection > 0 && (
                        <span className="text-xs text-red-500 font-medium">Required</span>
                      )}
                    </div>
                    <div className="divide-y">
                      {group.modifiers?.map(mod => {
                        const isSelected = selectedModifiers.some(m => m.modifier_id === mod.modifier_id);
                        return (
                          <button
                            key={mod.modifier_id}
                            onClick={() => toggleModifier(group, mod)}
                            className={`w-full px-3 py-3 flex items-center justify-between transition ${
                              isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
                              }`}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                                {mod.name}
                              </span>
                            </div>
                            {mod.price_adjustment > 0 && (
                              <span className="text-slate-500 text-sm">+${mod.price_adjustment.toFixed(2)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              
              {/* Special Instruction */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-slate-100 px-3 py-2 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-slate-500" />
                  <span className="font-bold text-sm">Special Instructions</span>
                </div>
                <textarea
                  value={specialInstruction}
                  onChange={(e) => setSpecialInstruction(e.target.value)}
                  placeholder="No onions, extra sauce, etc."
                  rows={2}
                  className="w-full px-3 py-2 text-sm resize-none focus:outline-none"
                />
              </div>
            </div>
            
            {/* Footer */}
            <div className="border-t p-4 bg-white">
              {/* Quantity */}
              <div className="flex items-center justify-between mb-4">
                <span className="font-medium">Quantity</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                    className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <span className="text-xl font-bold w-8 text-center">{itemQuantity}</span>
                  <button
                    onClick={() => setItemQuantity(itemQuantity + 1)}
                    className="w-10 h-10 bg-blue-500 text-white rounded-lg flex items-center justify-center"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <button
                onClick={addToCart}
                disabled={!isModifierSelectionValid()}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition ${
                  isModifierSelectionValid()
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Plus className="w-5 h-5" />
                Add to Order - ${getItemTotal().toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* CSS Animations */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes slideIn {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default HandheldPage;

