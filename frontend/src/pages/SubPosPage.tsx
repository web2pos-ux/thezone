import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Monitor, Settings, Wifi, WifiOff, RefreshCw, LogOut,
  ChevronRight, Clock, Users, DollarSign, ShoppingBag,
  ArrowLeft, Plus, Minus, Send, X, ShoppingCart, Bell,
  Check, AlertCircle, Utensils, ChefHat, Trash2
} from 'lucide-react';
import { usePosSocket, CallServerRequest } from '../hooks/usePosSocket';

// ==================== Types ====================
interface SetupConfig {
  posHost: string;
  deviceName: string;
  deviceId: string;
  printerEnabled: boolean;
  configured: boolean;
}

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

interface OrderSummary {
  total_orders: number;
  pending_orders: number;
  total_revenue: number;
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
  status?: string;
}

const STORAGE_KEY = 'sub-pos-setup';

// ==================== Main Component ====================
const SubPosPage: React.FC = () => {
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
  const [orderSummary, setOrderSummary] = useState<OrderSummary>({ total_orders: 0, pending_orders: 0, total_revenue: 0 });
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
  const [showCallAlerts, setShowCallAlerts] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const floors = ['1F', '2F', '3F', 'Patio'];
  
  // ==================== Socket.io ====================
  const {
    isConnected: socketConnected,
    activeCalls,
    acknowledgeCall,
    dismissCall
  } = usePosSocket({
    serverUrl: config?.posHost || '',
    deviceType: 'sub_pos',
    deviceName: config?.deviceName || 'Sub POS',
    onCallServerRequest: (call) => {
      setNotification({ type: 'success', message: `🔔 ${call.table_label}: ${call.message}` });
    },
    onTableStatusChanged: () => {
      loadTables();
    },
    onOrderReceived: (data) => {
      setNotification({ type: 'success', message: `📦 New order: Table ${data.table_id}` });
      loadTables();
      loadOrderSummary();
    }
  });
  
  // ==================== Effects ====================
  
  // Update time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  
  // Auto-hide notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  
  // Load config
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (!savedConfig) {
      navigate('/sub-pos-setup');
      return;
    }
    
    try {
      const parsed = JSON.parse(savedConfig);
      if (!parsed.configured) {
        navigate('/sub-pos-setup');
        return;
      }
      setConfig(parsed);
    } catch (e) {
      navigate('/sub-pos-setup');
    }
  }, [navigate]);
  
  // Load tables
  const loadTables = useCallback(async () => {
    if (!config) return;
    
    try {
      const res = await fetch(`${config.posHost}/api/table-map/elements?floor=${selectedFloor}`);
      if (res.ok) {
        const data = await res.json();
        const tableTypes = ['rounded-rectangle', 'circle', 'rectangle'];
        const filteredTables = data.filter((el: TableElement) => 
          tableTypes.includes(el.type) && el.name
        );
        setTables(filteredTables);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Failed to load tables:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [config, selectedFloor]);
  
  // Load order summary
  const loadOrderSummary = useCallback(async () => {
    if (!config) return;
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(`${config.posHost}/api/orders?date=${today}`);
      if (res.ok) {
        const orders = await res.json();
        const pending = orders.filter((o: any) => o.status === 'PENDING').length;
        const revenue = orders
          .filter((o: any) => o.status === 'COMPLETED')
          .reduce((sum: number, o: any) => sum + (o.total || 0), 0);
        
        setOrderSummary({
          total_orders: orders.length,
          pending_orders: pending,
          total_revenue: revenue
        });
      }
    } catch (error) {
      console.error('Failed to load order summary:', error);
    }
  }, [config]);
  
  // Load menu
  const loadMenu = useCallback(async () => {
    if (!config) return;
    
    try {
      const res = await fetch(`${config.posHost}/api/menus/with-items`);
      if (res.ok) {
        const menus = await res.json();
        if (menus.length > 0) {
          const menuData = menus[0];
          const cats: Category[] = menuData.categories.map((cat: any) => ({
            category_id: cat.category_id,
            name: cat.name,
            items: cat.items || []
          }));
          setCategories(cats);
          if (cats.length > 0) {
            setSelectedCategory(cats[0].category_id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error);
    }
  }, [config]);
  
  // Load existing order items
  const loadExistingOrder = useCallback(async (orderId: number) => {
    if (!config) return;
    
    try {
      const res = await fetch(`${config.posHost}/api/orders/${orderId}/items`);
      if (res.ok) {
        const items = await res.json();
        setExistingOrderItems(items);
        
        // Get guest count from items
        const maxGuest = Math.max(...items.map((i: OrderItem) => i.guest_number || 1), 1);
        setTotalGuests(maxGuest);
      }
    } catch (error) {
      console.error('Failed to load order items:', error);
    }
  }, [config]);
  
  useEffect(() => {
    if (config) {
      loadTables();
      loadOrderSummary();
      
      const interval = setInterval(() => {
        loadTables();
        loadOrderSummary();
      }, 30000);
      
      return () => clearInterval(interval);
    }
  }, [config, selectedFloor, loadTables, loadOrderSummary]);
  
  useEffect(() => {
    if (view === 'order' && config) {
      loadMenu();
    }
  }, [view, config, loadMenu]);
  
  // ==================== Handlers ====================
  
  const handleTableSelect = (table: TableElement) => {
    setSelectedTable(table);
    
    if (table.current_order_id) {
      // Existing order
      setTotalGuests(table.guests || 1);
      loadExistingOrder(table.current_order_id);
      setView('order');
    } else {
      // New order - show guest modal
      setTotalGuests(1);
      setShowGuestModal(true);
    }
  };
  
  const handleGuestConfirm = () => {
    setShowGuestModal(false);
    setView('order');
    setCart([]);
    setExistingOrderItems([]);
    setCurrentGuest(1);
  };
  
  const handleBackToTables = () => {
    if (cart.length > 0) {
      if (!window.confirm('You have items in cart. Discard them?')) {
        return;
      }
    }
    setView('tables');
    setSelectedTable(null);
    setCart([]);
    setExistingOrderItems([]);
    loadTables();
  };
  
  // Modifier handling
  const handleItemClick = async (item: MenuItem) => {
    if (!config) return;
    
    setSelectedItem(item);
    setItemQuantity(1);
    setSelectedModifiers([]);
    setSpecialInstruction('');
    setLoadingModifiers(true);
    setShowModifierModal(true);
    
    try {
      const res = await fetch(`${config.posHost}/api/item-modifier-groups/${item.item_id}/modifier-groups`);
      if (res.ok) {
        const groups = await res.json();
        setModifierGroups(groups);
      } else {
        setModifierGroups([]);
      }
    } catch (error) {
      setModifierGroups([]);
    } finally {
      setLoadingModifiers(false);
    }
  };
  
  const handleModifierSelect = (group: ModifierGroup, modifier: Modifier) => {
    setSelectedModifiers(prev => {
      if (group.selection_type === 'SINGLE') {
        const filtered = prev.filter(m => m.group_id !== group.modifier_group_id);
        return [...filtered, {
          group_id: group.modifier_group_id,
          group_name: group.name,
          modifier_id: modifier.modifier_id,
          name: modifier.name,
          price_adjustment: modifier.price_adjustment
        }];
      } else {
        const exists = prev.find(m => m.modifier_id === modifier.modifier_id);
        if (exists) {
          return prev.filter(m => m.modifier_id !== modifier.modifier_id);
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
  
  const handleAddToCart = () => {
    if (!selectedItem) return;
    
    const modifiersTotal = selectedModifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
    
    const cartItem: CartItem = {
      ...selectedItem,
      quantity: itemQuantity,
      cartId: `${selectedItem.item_id}-${Date.now()}`,
      modifiers: selectedModifiers,
      specialInstruction: specialInstruction || undefined,
      guestNumber: currentGuest,
      price: selectedItem.price + modifiersTotal
    };
    
    setCart(prev => [...prev, cartItem]);
    setShowModifierModal(false);
    setSelectedItem(null);
    setModifierGroups([]);
    setSelectedModifiers([]);
  };
  
  const handleRemoveFromCart = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };
  
  const handleUpdateQuantity = (cartId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartId === cartId) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };
  
  // Submit order
  const handleSubmitOrder = async () => {
    if (!config || !selectedTable || cart.length === 0) return;
    
    setIsSubmitting(true);
    
    try {
      const items = cart.map(item => ({
        item_id: item.item_id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        guest_number: item.guestNumber,
        modifiers: item.modifiers,
        special_instruction: item.specialInstruction
      }));
      
      const res = await fetch(`${config.posHost}/api/table-orders/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: selectedTable.name,
          element_id: selectedTable.element_id,
          items,
          guests: totalGuests,
          server_name: config.deviceName,
          source: 'SUB_POS',
          existing_order_id: selectedTable.current_order_id
        })
      });
      
      if (res.ok) {
        setNotification({ type: 'success', message: 'Order sent to kitchen!' });
        setCart([]);
        
        // Reload order if existing
        if (selectedTable.current_order_id) {
          loadExistingOrder(selectedTable.current_order_id);
        } else {
          // Go back to tables for new orders
          setTimeout(() => {
            setView('tables');
            setSelectedTable(null);
            loadTables();
          }, 1500);
        }
      } else {
        const error = await res.json();
        setNotification({ type: 'error', message: error.error || 'Failed to send order' });
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // ==================== Computed Values ====================
  
  const currentItems = useMemo(() => {
    const cat = categories.find(c => c.category_id === selectedCategory);
    return cat?.items || [];
  }, [categories, selectedCategory]);
  
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }, [cart]);
  
  const getTableStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'occupied': return 'bg-blue-500 text-white border-blue-600';
      case 'reserved': return 'bg-amber-500 text-white border-amber-600';
      case 'dirty': return 'bg-red-400 text-white border-red-500';
      case 'payment pending': return 'bg-purple-500 text-white border-purple-600';
      default: return 'bg-emerald-500 text-white border-emerald-600';
    }
  };
  
  // ==================== Loading State ====================
  
  if (!config) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    );
  }
  
  // ==================== Tables View ====================
  
  if (view === 'tables') {
    return (
      <div className="h-screen bg-slate-900 flex flex-col">
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
        <header className="bg-slate-800 px-4 py-3 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
              <Monitor className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold">{config.deviceName}</h1>
              <p className="text-slate-400 text-xs flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Call Alerts */}
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
              <div className="flex items-center gap-1 text-green-400 text-xs">
                <Wifi className="w-4 h-4" />
                <span>Connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-red-400 text-xs">
                <WifiOff className="w-4 h-4" />
                <span>Disconnected</span>
              </div>
            )}
            <button 
              onClick={() => navigate('/sub-pos-setup')}
              className="p-2 hover:bg-slate-700 rounded-lg transition"
            >
              <Settings className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </header>
        
        {/* Stats Bar */}
        <div className="bg-slate-800/50 px-4 py-2 flex items-center gap-4 border-b border-slate-700">
          <div className="flex items-center gap-2 text-sm">
            <ShoppingBag className="w-4 h-4 text-blue-400" />
            <span className="text-slate-400">Orders:</span>
            <span className="text-white font-bold">{orderSummary.total_orders}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className="text-slate-400">Pending:</span>
            <span className="text-amber-400 font-bold">{orderSummary.pending_orders}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">Revenue:</span>
            <span className="text-emerald-400 font-bold">${orderSummary.total_revenue.toFixed(2)}</span>
          </div>
        </div>
        
        {/* Floor Tabs */}
        <div className="flex bg-slate-800 border-b border-slate-700">
          {floors.map(floor => (
            <button
              key={floor}
              onClick={() => setSelectedFloor(floor)}
              className={`flex-1 py-3 text-sm font-bold transition ${
                selectedFloor === floor 
                  ? 'bg-emerald-600 text-white' 
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
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
            </div>
          ) : tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Monitor className="w-16 h-16 mb-4 opacity-30" />
              <p>No tables on this floor</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {tables.map(table => (
                <button
                  key={table.element_id}
                  onClick={() => handleTableSelect(table)}
                  className={`aspect-square rounded-xl flex flex-col items-center justify-center p-2 transition-all active:scale-95 shadow-lg border-2 ${getTableStatusColor(table.status)}`}
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
                  {table.current_order_id && (
                    <div className="mt-1 text-xs opacity-80">
                      #{table.current_order_id}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Bottom Actions */}
        <div className="bg-slate-800 border-t border-slate-700 p-4 grid grid-cols-2 gap-3">
          <button
            onClick={loadTables}
            className="py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh
          </button>
          <button
            onClick={() => {
              if (window.confirm('Switch to a different POS station?')) {
                localStorage.removeItem(STORAGE_KEY);
                navigate('/sub-pos-setup');
              }
            }}
            className="py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-5 h-5" />
            Switch Device
          </button>
        </div>
        
        {/* Guest Modal */}
        {showGuestModal && selectedTable && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
              <div className="bg-emerald-600 p-4 text-white">
                <h3 className="text-lg font-bold">Table {selectedTable.name}</h3>
                <p className="text-emerald-100 text-sm">How many guests?</p>
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
                    className="w-14 h-14 bg-emerald-500 text-white rounded-full flex items-center justify-center text-2xl font-bold hover:bg-emerald-600 transition"
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
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition"
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
                            onClick={() => acknowledgeCall(call.id, config.deviceName)}
                            className="flex-1 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition flex items-center justify-center gap-2"
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
    <div className="h-screen bg-slate-100 flex">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 left-4 right-4 z-50 p-4 rounded-xl shadow-lg flex items-center gap-3 animate-[slideIn_0.3s_ease-out] ${
          notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {notification.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
      
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
        <header className="bg-slate-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToTables}
              className="p-2 hover:bg-slate-700 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <h1 className="text-white font-bold text-lg">Table {selectedTable?.name}</h1>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">{config.deviceName}</span>
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
                    ? 'bg-emerald-500 text-white' 
                    : 'text-slate-400 hover:bg-slate-600'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </header>
        
        {/* Categories */}
        <div className="flex overflow-x-auto bg-slate-100 p-2 gap-2">
          {categories.map(cat => (
            <button
              key={cat.category_id}
              onClick={() => setSelectedCategory(cat.category_id)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap font-medium transition ${
                selectedCategory === cat.category_id
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
        
        {/* Menu Items */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3 content-start">
          {currentItems.map(item => (
            <button
              key={item.item_id}
              onClick={() => handleItemClick(item)}
              className="bg-white rounded-xl p-4 shadow hover:shadow-lg transition-all active:scale-95 text-left"
            >
              <h3 className="font-bold text-slate-800 text-sm line-clamp-2">{item.name}</h3>
              <p className="text-emerald-600 font-bold mt-2">${item.price.toFixed(2)}</p>
            </button>
          ))}
        </div>
      </div>
      
      {/* Right Panel - Cart */}
      <div className="w-80 bg-slate-800 flex flex-col">
        {/* Cart Header */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-400" />
              <h2 className="text-white font-bold">Order</h2>
            </div>
            <span className="text-slate-400 text-sm">{cart.length} items</span>
          </div>
        </div>
        
        {/* Existing Order Items */}
        {existingOrderItems.length > 0 && (
          <div className="p-3 bg-slate-700/50">
            <h3 className="text-slate-400 text-xs font-medium mb-2">EXISTING ORDER</h3>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {existingOrderItems.map(item => (
                <div key={item.id} className="flex justify-between text-sm text-slate-300">
                  <span>{item.quantity}x {item.name}</span>
                  <span>${(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* New Cart Items */}
        <div className="flex-1 overflow-y-auto p-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Utensils className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">Add items to order</p>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-emerald-400 text-xs font-medium mb-2">NEW ITEMS</h3>
              {cart.map(item => (
                <div key={item.cartId} className="bg-slate-700 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-white font-medium text-sm">{item.name}</p>
                      {item.modifiers.length > 0 && (
                        <p className="text-slate-400 text-xs mt-1">
                          {item.modifiers.map(m => m.name).join(', ')}
                        </p>
                      )}
                      <p className="text-slate-500 text-xs mt-1">Guest {item.guestNumber}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveFromCart(item.cartId)}
                      className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity(item.cartId, -1)}
                        className="w-7 h-7 bg-slate-600 rounded text-white hover:bg-slate-500 transition"
                      >
                        <Minus className="w-4 h-4 mx-auto" />
                      </button>
                      <span className="text-white font-bold w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity(item.cartId, 1)}
                        className="w-7 h-7 bg-slate-600 rounded text-white hover:bg-slate-500 transition"
                      >
                        <Plus className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                    <span className="text-emerald-400 font-bold">
                      ${(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Cart Footer */}
        <div className="p-4 border-t border-slate-700 space-y-3">
          <div className="flex justify-between text-lg">
            <span className="text-slate-400">New Items Total</span>
            <span className="text-white font-bold">${cartTotal.toFixed(2)}</span>
          </div>
          
          <button
            onClick={handleSubmitOrder}
            disabled={cart.length === 0 || isSubmitting}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-xl text-white font-bold flex items-center justify-center gap-2 transition"
          >
            {isSubmitting ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <ChefHat className="w-5 h-5" />
                Send to Kitchen
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Modifier Modal */}
      {showModifierModal && selectedItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-emerald-600 p-4 text-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">{selectedItem.name}</h3>
                <p className="text-emerald-100">${selectedItem.price.toFixed(2)}</p>
              </div>
              <button
                onClick={() => setShowModifierModal(false)}
                className="p-2 hover:bg-emerald-700 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingModifiers ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-emerald-500 animate-spin" />
                </div>
              ) : modifierGroups.length === 0 ? (
                <p className="text-slate-500 text-center py-4">No customization options</p>
              ) : (
                <div className="space-y-4">
                  {modifierGroups.map(group => (
                    <div key={group.modifier_group_id}>
                      <h4 className="font-bold text-slate-800 mb-2">
                        {group.name}
                        {group.min_selection > 0 && (
                          <span className="text-red-500 text-sm ml-1">*</span>
                        )}
                      </h4>
                      <div className="space-y-2">
                        {group.modifiers.map(mod => {
                          const isSelected = selectedModifiers.some(m => m.modifier_id === mod.modifier_id);
                          return (
                            <button
                              key={mod.modifier_id}
                              onClick={() => handleModifierSelect(group, mod)}
                              className={`w-full p-3 rounded-lg border-2 flex items-center justify-between transition ${
                                isSelected 
                                  ? 'border-emerald-500 bg-emerald-50' 
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <span className="font-medium">{mod.name}</span>
                              <div className="flex items-center gap-2">
                                {mod.price_adjustment > 0 && (
                                  <span className="text-slate-500 text-sm">
                                    +${mod.price_adjustment.toFixed(2)}
                                  </span>
                                )}
                                {isSelected && (
                                  <Check className="w-5 h-5 text-emerald-500" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Quantity */}
              <div className="mt-6 pt-4 border-t">
                <h4 className="font-bold text-slate-800 mb-3">Quantity</h4>
                <div className="flex items-center justify-center gap-6">
                  <button
                    onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                    className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center text-xl font-bold hover:bg-slate-300 transition"
                  >
                    -
                  </button>
                  <span className="text-3xl font-bold text-slate-800 w-12 text-center">{itemQuantity}</span>
                  <button
                    onClick={() => setItemQuantity(itemQuantity + 1)}
                    className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xl font-bold hover:bg-emerald-600 transition"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t">
              <button
                onClick={handleAddToCart}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition"
              >
                <Plus className="w-5 h-5" />
                Add ${((selectedItem.price + selectedModifiers.reduce((s, m) => s + m.price_adjustment, 0)) * itemQuantity).toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubPosPage;
