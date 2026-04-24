import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, ShoppingCart, Plus, Minus, X, Settings, RefreshCw,
  Check, Trash2, MessageSquare, CreditCard, DollarSign, Printer,
  Coffee, ShoppingBag, Car, Clock, User, Hash, Wifi, WifiOff, Bell, BellOff,
  ChevronRight, Phone, MapPin, AlertCircle, Volume2, Globe
} from 'lucide-react';
import { API_URL } from '../config/constants';
import { getLocalDateString, getLocalDatetimeString } from '../utils/datetimeUtils';
import {
  PAY_NEO,
  PAY_NEO_CANVAS,
  PAY_NEO_PRIMARY_BLUE,
  NEO_MODAL_BTN_PRESS,
  NEO_PREP_TIME_BTN_PRESS,
  NEO_PREP_TIME_BTN_PRESS_SNAP,
  NEO_COLOR_BTN_PRESS_SNAP,
  NEO_COLOR_BTN_PRESS_NO_SHIFT,
} from '../utils/softNeumorphic';
import VirtualKeyboard from '../components/order/VirtualKeyboard';
import { useLayoutSettings } from '../hooks/useLayoutSettings';
import { quitToOsFromPos } from '../utils/quitToOs';

const QSR_PAGE_MODAL_PAD_PRESS = `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS} touch-manipulation`;

// ==================== Types ====================
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
  sort_order?: number;
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
  memo?: { text: string; price: number };
  discount?: { type: 'percent' | 'amount'; value: number };
  originalPrice?: number;
}

interface SetupConfig {
  deviceName: string;
  menuId: number;
  taxRate: number;
  configured: boolean;
}

type OrderType = 'forhere' | 'togo' | 'pickup' | 'delivery';

// Online Order Types
interface OnlineOrder {
  id: string;
  orderNumber: string;
  localOrderId?: number;
  customerName: string;
  customerPhone?: string;
  orderType: 'pickup' | 'delivery' | 'dine_in';
  status: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    subtotal: number;
    options?: Array<{
      optionName: string;
      choiceName: string;
      price: number;
    }>;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  createdAt: string;
  pickupTime?: string;
}

interface OnlineQueueCard {
  id: string;
  number: string | number;
  time: string;
  name: string;
  total: number;
  status: string;
  orderType: string;
  pickupTime?: string;
  fullOrder?: OnlineOrder;
}

const STORAGE_KEY = 'qsr-pos-setup';
const ONLINE_SETTINGS_KEY = 'qsr-online-settings';

// ==================== Main Component ====================
const QsrPage: React.FC = () => {
  const navigate = useNavigate();
  
  // Layout Settings from Back Office
  const { layoutSettings, loadLayoutSettings } = useLayoutSettings();
  
  // Config
  const [config, setConfig] = useState<SetupConfig | null>(null);
  
  // Order Type
  const [orderType, setOrderType] = useState<OrderType>('forhere');
  
  // Pickup Modal (for phone/pickup orders)
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pickupCustomerName, setPickupCustomerName] = useState('');
  const [pickupCustomerPhone, setPickupCustomerPhone] = useState('');
  const [pickupPrepTime, setPickupPrepTime] = useState(15);
  const [pickupActiveField, setPickupActiveField] = useState<'name' | 'phone'>('name');
  
  // Delivery Modal
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState('');
  const [deliveryOrderNumber, setDeliveryOrderNumber] = useState('');
  const [deliveryPrepTime, setDeliveryPrepTime] = useState(10);
  const [customerName, setCustomerName] = useState('');
  
  // Data
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedMergyGroupId, setSelectedMergyGroupId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<number>(0);
  
  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Modifiers
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>([]);
  const [loadingModifiers, setLoadingModifiers] = useState(false);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [specialInstruction, setSpecialInstruction] = useState('');
  
  // Payment
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('card');
  const [cashReceived, setCashReceived] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Order Complete
  const [showOrderComplete, setShowOrderComplete] = useState(false);
  const [completedOrderNumber, setCompletedOrderNumber] = useState<number>(0);
  
  // UI States
  const [isLoading, setIsLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  
  // Bottom Function Button States
  const [showOrderHistoryModal, setShowOrderHistoryModal] = useState(false);
  const [orderHistoryList, setOrderHistoryList] = useState<any[]>([]);
  const [orderHistoryDate, setOrderHistoryDate] = useState(getLocalDateString());
  const [showOpenPriceModal, setShowOpenPriceModal] = useState(false);
  const [openPriceName, setOpenPriceName] = useState('');
  const [openPriceAmount, setOpenPriceAmount] = useState('');
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [cartDiscount, setCartDiscount] = useState(0);
  const [showKitchenNoteModal, setShowKitchenNoteModal] = useState(false);
  const [kitchenNote, setKitchenNote] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MenuItem[]>([]);
  const [isDayClosed, setIsDayClosed] = useState(false);
  
  // Cart Item Action States (Memo, Item D/C, Edit Price)
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);
  const [showItemMemoModal, setShowItemMemoModal] = useState(false);
  const [itemMemo, setItemMemo] = useState('');
  const [itemMemoPrice, setItemMemoPrice] = useState('');
  const [showItemDiscountModal, setShowItemDiscountModal] = useState(false);
  const [itemDiscountType, setItemDiscountType] = useState<'percent' | 'amount'>('percent');
  const [itemDiscountValue, setItemDiscountValue] = useState('');
  const [showEditPriceModal, setShowEditPriceModal] = useState(false);
  const [editPriceValue, setEditPriceValue] = useState('');
  const [activeInputField, setActiveInputField] = useState<'memo' | 'memoPrice' | 'discount' | 'editPrice' | null>(null);
  
  // Online Order States
  const [onlineOrders, setOnlineOrders] = useState<OnlineQueueCard[]>([]);
  const [showOnlinePanel, setShowOnlinePanel] = useState(false);
  const [selectedOnlineOrder, setSelectedOnlineOrder] = useState<OnlineOrder | null>(null);
  const [showNewOrderAlert, setShowNewOrderAlert] = useState(false);
  const [newOrderAlertData, setNewOrderAlertData] = useState<OnlineOrder | null>(null);
  const [selectedPrepTime, setSelectedPrepTime] = useState(15);
  const [sseConnected, setSseConnected] = useState(false);
  const [onlineAcceptMode, setOnlineAcceptMode] = useState<'auto' | 'manual'>('manual');
  const [autoPrepTime, setAutoPrepTime] = useState('15m');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  
  // QSR Order Queue States (Pickup/Delivery from POS)
  const [pickupOrders, setPickupOrders] = useState<any[]>([]);
  const [deliveryOrders, setDeliveryOrders] = useState<any[]>([]);
  const [orderPanelTab, setOrderPanelTab] = useState<'online' | 'pickup' | 'delivery'>('online');
  
  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const previousOnlineOrdersRef = useRef<string[]>([]);
  
  // ==================== Effects ====================
  
  // Load config or redirect to setup
  useEffect(() => {
    const initConfig = async () => {
      const savedConfig = localStorage.getItem(STORAGE_KEY);
      if (!savedConfig) {
        // Fetch available menus to get a valid menu ID
        try {
          const menusRes = await fetch(`${API_URL}/menus`);
          if (menusRes.ok) {
            const menus = await menusRes.json();
            const firstMenuId = menus.length > 0 ? menus[0].menu_id : 200000;
            setConfig({
              deviceName: 'QSR Counter',
              menuId: firstMenuId,
              taxRate: 8.25,
              configured: true
            });
          } else {
            // Fallback to common menu ID
            setConfig({
              deviceName: 'QSR Counter',
              menuId: 200000,
              taxRate: 8.25,
              configured: true
            });
          }
        } catch (e) {
          setConfig({
            deviceName: 'QSR Counter',
            menuId: 200000,
            taxRate: 8.25,
            configured: true
          });
        }
      } else {
        try {
          const parsed = JSON.parse(savedConfig);
          // If menuId is 1 (old default), fetch the first valid menu
          if (parsed.menuId === 1) {
            try {
              const menusRes = await fetch(`${API_URL}/menus`);
              if (menusRes.ok) {
                const menus = await menusRes.json();
                parsed.menuId = menus.length > 0 ? menus[0].menu_id : 200000;
              }
            } catch (e) {
              parsed.menuId = 200000;
            }
          }
          setConfig(parsed);
        } catch (e) {
          setConfig({
            deviceName: 'QSR Counter',
            menuId: 200000,
            taxRate: 8.25,
            configured: true
          });
        }
      }
      
      // Load today's order number
      loadOrderNumber();
    };
    
    initConfig();
  }, []);
  
  // Load menu when config is ready
  useEffect(() => {
    if (config) {
      loadMenu();
    }
  }, [config]);
  
  // Load layout settings from Back Office
  useEffect(() => {
    loadLayoutSettings();
  }, [loadLayoutSettings]);
  
  // Auto-hide notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  
  // Load online settings
  useEffect(() => {
    const savedSettings = localStorage.getItem(ONLINE_SETTINGS_KEY);
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setOnlineAcceptMode(settings.mode || 'manual');
        setAutoPrepTime(settings.prepTime || '15m');
        setSoundEnabled(settings.sound !== false);
      } catch (e) {}
    }
  }, []);
  
  // Save online settings
  const saveOnlineSettings = useCallback((mode: 'auto' | 'manual', prepTime: string, sound: boolean) => {
    localStorage.setItem(ONLINE_SETTINGS_KEY, JSON.stringify({ mode, prepTime, sound }));
    setOnlineAcceptMode(mode);
    setAutoPrepTime(prepTime);
    setSoundEnabled(sound);
  }, []);
  
  // Audio initialization
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/Online_Order.mp3');
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 1.0;
    }
  }, []);
  
  // Play notification sound
  const playNotificationSound = useCallback(() => {
    if (!soundEnabled || !audioRef.current) return;
    
    try {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 1.0;
      audioRef.current.play()
        .then(() => {
          console.log('🔔 New order notification played');
          setAudioUnlocked(true);
        })
        .catch(err => {
          console.warn('Audio play failed:', err.message);
        });
    } catch (error) {
      console.error('Audio error:', error);
    }
  }, [soundEnabled]);
  
  // Unlock audio on user interaction
  const unlockAudio = useCallback(() => {
    if (audioUnlocked || !audioRef.current) return;
    audioRef.current.volume = 0;
    audioRef.current.play()
      .then(() => {
        audioRef.current!.pause();
        audioRef.current!.currentTime = 0;
        audioRef.current!.volume = 1.0;
        setAudioUnlocked(true);
        console.log('🔓 Audio unlocked');
      })
      .catch(() => {});
  }, [audioUnlocked]);
  
  // Get restaurant ID from localStorage
  const getRestaurantId = useCallback(() => {
    return localStorage.getItem('firebaseRestaurantId') || localStorage.getItem('firebase_restaurant_id');
  }, []);
  
  // Load online orders
  const loadOnlineOrders = useCallback(async () => {
    const restaurantId = getRestaurantId();
    if (!restaurantId) return;
    
    try {
      const res = await fetch(`${API_URL}/online-orders/${restaurantId}`);
      if (!res.ok) return;
      
      const data = await res.json();
      if (!data.success || !data.orders) return;
      
      // Filter to show only pending/confirmed/preparing orders
      const filteredOrders = data.orders.filter((o: any) => 
        ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status?.toLowerCase())
      );
      
      const mappedCards: OnlineQueueCard[] = filteredOrders.map((o: any) => ({
        id: o.id,
        number: o.localOrderId || o.orderNumber?.slice(-6) || o.id.slice(-6),
        time: new Date(o.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        name: o.customerName || 'Online Order',
        total: o.total || 0,
        status: o.status,
        orderType: o.orderType,
        pickupTime: o.pickupTime,
        fullOrder: o
      }));
      
      // Check for new orders
      const currentOrderIds = filteredOrders.map((o: any) => o.id);
      const newOrders = filteredOrders.filter((o: any) => 
        o.status === 'pending' && !previousOnlineOrdersRef.current.includes(o.id)
      );
      
      if (newOrders.length > 0 && previousOnlineOrdersRef.current.length > 0) {
        const newOrder = newOrders[0];
        
        if (onlineAcceptMode === 'auto') {
          // Auto accept
          const prepMinutes = parseInt(autoPrepTime.replace('m', '')) || 15;
          const pickupTime = getLocalDatetimeString(new Date(Date.now() + prepMinutes * 60000));
          
          fetch(`${API_URL}/online-orders/order/${newOrder.id}/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prepTime: prepMinutes, pickupTime })
          }).then(() => {
            console.log('[QSR] Order auto-accepted:', newOrder.id);
            loadOnlineOrders();
            playNotificationSound();
          }).catch(err => console.error('[QSR] Auto accept failed:', err));
        } else {
          // Manual mode - show alert
          playNotificationSound();
          setNewOrderAlertData(newOrder);
          setSelectedPrepTime(15);
          setShowNewOrderAlert(true);
        }
      }
      
      previousOnlineOrdersRef.current = currentOrderIds;
      setOnlineOrders(mappedCards);
    } catch (error) {
      console.warn('Failed to load online orders:', error);
    }
  }, [API_URL, getRestaurantId, onlineAcceptMode, autoPrepTime, playNotificationSound]);
  
  // SSE connection for real-time online orders
  useEffect(() => {
    const restaurantId = getRestaurantId();
    if (!restaurantId) return;
    
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    
    const connectSSE = () => {
      eventSource = new EventSource(`${API_URL}/online-orders/stream/${restaurantId}`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'new_order') {
            const newOrder = data.order;
            console.log('[QSR SSE] New order:', newOrder.id);
            
            if (onlineAcceptMode === 'auto') {
              const prepMinutes = parseInt(autoPrepTime.replace('m', '')) || 15;
              const pickupTime = getLocalDatetimeString(new Date(Date.now() + prepMinutes * 60000));
              
              fetch(`${API_URL}/online-orders/order/${newOrder.id}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prepTime: prepMinutes, pickupTime })
              }).then(() => {
                loadOnlineOrders();
                playNotificationSound();
              });
            } else if (!showNewOrderAlert) {
              playNotificationSound();
              setNewOrderAlertData(newOrder);
              setSelectedPrepTime(15);
              setShowNewOrderAlert(true);
            }
            
            loadOnlineOrders();
          } else if (data.type === 'order_updated') {
            loadOnlineOrders();
          }
        } catch (e) {}
      };
      
      eventSource.onopen = () => {
        console.log('[QSR SSE] Connected');
        setSseConnected(true);
      };
      
      eventSource.onerror = () => {
        setSseConnected(false);
        eventSource?.close();
        reconnectTimeout = setTimeout(connectSSE, 5000);
      };
      
      eventSourceRef.current = eventSource;
    };
    
    connectSSE();
    
    return () => {
      eventSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [API_URL, getRestaurantId, onlineAcceptMode, autoPrepTime, showNewOrderAlert, loadOnlineOrders, playNotificationSound]);
  
  // Initial load and polling for online orders
  useEffect(() => {
    loadOnlineOrders();
    const interval = setInterval(loadOnlineOrders, 30000);
    return () => clearInterval(interval);
  }, [loadOnlineOrders]);
  
  // Accept online order
  const acceptOnlineOrder = async (orderId: string, prepTime: number) => {
    try {
      const pickupTime = getLocalDatetimeString(new Date(Date.now() + prepTime * 60000));
      
      const res = await fetch(`${API_URL}/online-orders/order/${orderId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prepTime, pickupTime })
      });
      
      if (res.ok) {
        setNotification({ type: 'success', message: `Order accepted! Ready in ${prepTime} min` });
        loadOnlineOrders();
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Failed to accept order' });
    }
  };
  
  // Reject online order
  const rejectOnlineOrder = async (orderId: string, reason?: string) => {
    try {
      const res = await fetch(`${API_URL}/online-orders/order/${orderId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Rejected by store' })
      });
      
      if (res.ok) {
        setNotification({ type: 'success', message: 'Order rejected' });
        loadOnlineOrders();
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Failed to reject order' });
    }
  };
  
  // Update online order status
  const updateOnlineOrderStatus = async (orderId: string, status: string) => {
    try {
      const endpoint = status === 'ready' ? 'complete' : 'status';
      const res = await fetch(`${API_URL}/online-orders/order/${orderId}/${endpoint}`, {
        method: status === 'ready' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      
      if (res.ok) {
        loadOnlineOrders();
      }
    } catch (error) {
      console.error('Failed to update order status:', error);
    }
  };
  
  // Mark as picked up
  const markAsPickedUp = async (orderId: string) => {
    try {
      await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      loadOnlineOrders();
      setSelectedOnlineOrder(null);
    } catch (error) {
      console.error('Failed to mark as picked up:', error);
    }
  };
  
  // Load Pickup and Delivery orders from POS
  const loadPosOrders = useCallback(async () => {
    try {
      // Load pickup orders (from orders table with channel = PICKUP)
      const pickupRes = await fetch(`${API_URL}/orders?channel=PICKUP&status=pending,preparing,ready`);
      if (pickupRes.ok) {
        const data = await pickupRes.json();
        const orders = Array.isArray(data) ? data : (data.orders || []);
        setPickupOrders(orders.filter((o: any) => 
          o.channel === 'PICKUP' && ['pending', 'preparing', 'ready', 'open'].includes(o.status?.toLowerCase())
        ));
      }
      
      // Load delivery orders
      const deliveryRes = await fetch(`${API_URL}/orders/delivery-orders`);
      if (deliveryRes.ok) {
        const data = await deliveryRes.json();
        if (data.success && data.deliveryOrders) {
          setDeliveryOrders(data.deliveryOrders.filter((o: any) => 
            ['pending', 'preparing', 'ready', 'open'].includes(o.status?.toLowerCase())
          ));
        }
      }
    } catch (error) {
      console.warn('Failed to load POS orders:', error);
    }
  }, []);
  
  // Complete pickup/delivery order
  const completeOrder = async (orderId: number, type: 'pickup' | 'delivery') => {
    try {
      await fetch(`${API_URL}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      loadPosOrders();
      setNotification({ type: 'success', message: `${type === 'pickup' ? 'Pickup' : 'Delivery'} order completed!` });
    } catch (error) {
      console.error('Failed to complete order:', error);
    }
  };
  
  // Initial load and polling for POS pickup/delivery orders
  useEffect(() => {
    loadPosOrders();
    const interval = setInterval(loadPosOrders, 15000);
    return () => clearInterval(interval);
  }, [loadPosOrders]);
  
  // ==================== Data Loading ====================
  
  const loadOrderNumber = async () => {
    try {
      const today = getLocalDateString();
      const storedDate = localStorage.getItem('qsr-order-date');
      const storedNumber = localStorage.getItem('qsr-order-number');
      
      if (storedDate === today && storedNumber) {
        setOrderNumber(parseInt(storedNumber));
      } else {
        // Reset for new day
        localStorage.setItem('qsr-order-date', today);
        localStorage.setItem('qsr-order-number', '1');
        setOrderNumber(1);
      }
    } catch (err) {
      setOrderNumber(1);
    }
  };
  
  const incrementOrderNumber = () => {
    const newNumber = orderNumber + 1;
    setOrderNumber(newNumber);
    localStorage.setItem('qsr-order-number', String(newNumber));
  };
  
  const loadMenu = async () => {
    if (!config) return;
    setIsLoading(true);
    
    try {
      const menuId = config.menuId || 1;
      
      // Load categories (correct API path: /api/menu/categories)
      const catRes = await fetch(`${API_URL}/menu/categories?menu_id=${menuId}`);
      if (!catRes.ok) throw new Error('Failed to load categories');
      const catData = await catRes.json();
      
      // Load items for each category (correct API path: /api/menu/items?categoryId=...)
      const categoriesWithItems: Category[] = [];
      
      for (const cat of catData) {
        const itemsRes = await fetch(`${API_URL}/menu/items?categoryId=${cat.category_id}`);
        if (itemsRes.ok) {
          const items = await itemsRes.json();
          categoriesWithItems.push({
            ...cat,
            items: items.filter((item: any) => item.status !== 'Hidden')
          });
        }
      }
      
      // Sort categories by sort_order
      categoriesWithItems.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      
      setCategories(categoriesWithItems);
      if (categoriesWithItems.length > 0) {
        setSelectedCategory(String(categoriesWithItems[0].category_id));
      }
      
    } catch (err) {
      console.error('Failed to load menu:', err);
      setNotification({ type: 'error', message: 'Failed to load menu' });
    } finally {
      setIsLoading(false);
    }
  };
  
  // ==================== Bottom Function Button Handlers ====================
  
  // Open Till (Cash Drawer)
  const handleOpenTill = async () => {
    try {
      const response = await fetch(`${API_URL}/printers/open-drawer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json();
      if (result.success) {
        setNotification({ type: 'success', message: 'Cash drawer opened' });
      } else {
        setNotification({ type: 'error', message: 'Failed to open drawer' });
      }
    } catch (error) {
      setNotification({ type: 'error', message: 'Error opening drawer' });
    }
  };
  
  // Void - Clear cart
  const handleVoid = () => {
    if (cart.length === 0) {
      setNotification({ type: 'error', message: 'No items to void' });
      return;
    }
    setCart([]);
    setCartDiscount(0);
    setNotification({ type: 'success', message: 'Order voided' });
  };
  
  // Open Price - Add custom price item
  const handleOpenPrice = () => {
    if (!openPriceName || !openPriceAmount) {
      setNotification({ type: 'error', message: 'Enter name and price' });
      return;
    }
    const price = parseFloat(openPriceAmount);
    if (isNaN(price) || price <= 0) {
      setNotification({ type: 'error', message: 'Invalid price' });
      return;
    }
    const cartItem: CartItem = {
      item_id: Date.now(),
      name: openPriceName,
      price: price,
      quantity: 1,
      cartId: `open-${Date.now()}`,
      modifiers: [],
      specialInstruction: '',
      category_id: 0
    };
    setCart(prev => [...prev, cartItem]);
    setOpenPriceName('');
    setOpenPriceAmount('');
    setShowOpenPriceModal(false);
    setNotification({ type: 'success', message: `${openPriceName} added` });
  };
  
  // Discount
  const handleApplyDiscount = () => {
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) {
      setNotification({ type: 'error', message: 'Invalid discount' });
      return;
    }
    if (discountType === 'percent') {
      const discountAmount = (cartTotal * value) / 100;
      setCartDiscount(discountAmount);
    } else {
      setCartDiscount(value);
    }
    setShowDiscountModal(false);
    setDiscountValue('');
    setNotification({ type: 'success', message: 'Discount applied' });
  };
  
  // Search menu items
  const handleSearch = () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const results = categories.flatMap(cat => 
      cat.items.filter(item => 
        item.name.toLowerCase().includes(query) ||
        (item.short_name && item.short_name.toLowerCase().includes(query))
      )
    );
    setSearchResults(results);
  };
  
  // Cart Item Actions
  const handleCartItemClick = (cartId: string) => {
    setSelectedCartItemId(selectedCartItemId === cartId ? null : cartId);
  };
  
  const handleItemMemo = () => {
    if (!selectedCartItemId) return;
    const item = cart.find(i => i.cartId === selectedCartItemId);
    setItemMemo(item?.memo?.text || '');
    setItemMemoPrice(item?.memo?.price ? item.memo.price.toString() : '');
    setShowItemMemoModal(true);
  };
  
  const handleSaveItemMemo = () => {
    if (!selectedCartItemId) return;
    const memoData = {
      text: itemMemo,
      price: itemMemoPrice ? parseFloat(itemMemoPrice) : 0
    };
    
    setCart(prev => prev.map(item => 
      item.cartId === selectedCartItemId 
        ? { ...item, memo: memoData }
        : item
    ));
    setShowItemMemoModal(false);
    setItemMemo('');
    setItemMemoPrice('');
    setNotification({ type: 'success', message: 'Memo saved' });
  };
  
  const handleItemDiscount = () => {
    if (!selectedCartItemId) return;
    const item = cart.find(i => i.cartId === selectedCartItemId);
    if (item?.discount) {
      setItemDiscountType(item.discount.type);
      setItemDiscountValue(item.discount.value.toString());
    } else {
      setItemDiscountValue('');
      setItemDiscountType('percent');
    }
    setShowItemDiscountModal(true);
  };
  
  const handleApplyItemDiscount = () => {
    if (!selectedCartItemId) return;
    const value = parseFloat(itemDiscountValue);
    if (isNaN(value) || value <= 0) {
      setNotification({ type: 'error', message: 'Invalid discount' });
      return;
    }
    
    setCart(prev => prev.map(item => {
      if (item.cartId !== selectedCartItemId) return item;
      
      // Save original price if not saved yet
      const originalPrice = item.originalPrice || item.price;
      
      return { 
        ...item, 
        originalPrice,
        discount: { type: itemDiscountType, value }
      };
    }));
    
    setShowItemDiscountModal(false);
    setItemDiscountValue('');
    setSelectedCartItemId(null);
    setNotification({ type: 'success', message: 'Discount applied' });
  };
  
  const handleRemoveItemDiscount = () => {
    if (!selectedCartItemId) return;
    setCart(prev => prev.map(item => {
      if (item.cartId !== selectedCartItemId) return item;
      const { discount, originalPrice, ...rest } = item;
      return rest as CartItem;
    }));
    setShowItemDiscountModal(false);
    setItemDiscountValue('');
    setSelectedCartItemId(null);
    setNotification({ type: 'success', message: 'Discount removed' });
  };
  
  const handleEditPrice = () => {
    if (!selectedCartItemId) return;
    const item = cart.find(i => i.cartId === selectedCartItemId);
    setEditPriceValue(item?.price.toFixed(2) || '');
    setShowEditPriceModal(true);
  };
  
  const handleSaveEditPrice = () => {
    if (!selectedCartItemId) return;
    const value = parseFloat(editPriceValue);
    if (isNaN(value) || value < 0) {
      setNotification({ type: 'error', message: 'Invalid price' });
      return;
    }
    
    setCart(prev => prev.map(item => 
      item.cartId === selectedCartItemId 
        ? { ...item, price: value, originalPrice: item.originalPrice || item.price }
        : item
    ));
    
    setShowEditPriceModal(false);
    setEditPriceValue('');
    setSelectedCartItemId(null);
    setNotification({ type: 'success', message: 'Price updated' });
  };
  
  // Calculate item total with memo price and discount
  const getCartItemTotal = (item: CartItem) => {
    const basePrice = item.price;
    const modTotal = item.modifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
    const memoPrice = item.memo?.price || 0;
    let itemTotal = (basePrice + modTotal + memoPrice) * item.quantity;
    
    if (item.discount) {
      if (item.discount.type === 'percent') {
        itemTotal = itemTotal * (1 - item.discount.value / 100);
      } else {
        itemTotal = Math.max(0, itemTotal - item.discount.value);
      }
    }
    return itemTotal;
  };
  
  // Order History
  const fetchOrderHistory = async (date: string) => {
    try {
      const response = await fetch(`${API_URL}/orders/by-date?date=${date}`);
      const result = await response.json();
      if (result.success) {
        setOrderHistoryList(result.orders || []);
      }
    } catch (error) {
      console.error('Failed to fetch order history:', error);
    }
  };
  
  // Opening/Closing check
  useEffect(() => {
    const lastClosedDate = localStorage.getItem('pos_last_closed_date');
    const today = new Date().toISOString().split('T')[0];
    setIsDayClosed(lastClosedDate === today);
  }, []);
  
  // ==================== Item & Modifier Handling ====================
  
  // Track the last added cart item ID for modifier attachment
  const [lastAddedCartId, setLastAddedCartId] = useState<string | null>(null);
  
  const handleItemClick = async (item: MenuItem) => {
    // Always add item to cart immediately
    const cartId = `${item.item_id}-${Date.now()}`;
    const cartItem: CartItem = {
      ...item,
      quantity: 1,
      cartId: cartId,
      modifiers: [],
      specialInstruction: ''
    };
    setCart(prev => [...prev, cartItem]);
    setLastAddedCartId(cartId);
    setSelectedItem(item);
    setNotification({ type: 'success', message: `${item.name} added` });
    setTimeout(() => setNotification(null), 1500);
    
    // Load modifiers for the bottom panel
    setLoadingModifiers(true);
    
    try {
      const res = await fetch(`${API_URL}/menu/items/${item.item_id}/options`);
      if (res.ok) {
        const data = await res.json();
        const groups: ModifierGroup[] = (data.modifier_groups || [])
          .filter((g: any) => g.modifiers && g.modifiers.length > 0)
          .map((g: any) => ({
            modifier_group_id: g.modifier_group_id,
            name: g.name,
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
  
  // Toggle modifier - immediately add/remove from the last added cart item
  const toggleModifier = (group: ModifierGroup, modifier: Modifier) => {
    if (!lastAddedCartId) return;
    
    const newModifier = {
      group_id: group.modifier_group_id,
      group_name: group.name,
      modifier_id: modifier.modifier_id,
      name: modifier.name,
      price_adjustment: modifier.price_adjustment
    };
    
    setCart(prev => {
      return prev.map(item => {
        if (item.cartId !== lastAddedCartId) return item;
        
        const existingModIndex = item.modifiers.findIndex(m => m.modifier_id === modifier.modifier_id);
        
        if (existingModIndex >= 0) {
          // Remove modifier if already exists
          return {
            ...item,
            modifiers: item.modifiers.filter(m => m.modifier_id !== modifier.modifier_id)
          };
        } else {
          // Add modifier
          if (group.selection_type === 'SINGLE') {
            // For single selection, remove other modifiers from same group first
            const filteredMods = item.modifiers.filter(m => m.group_id !== group.modifier_group_id);
            return {
              ...item,
              modifiers: [...filteredMods, newModifier]
            };
          } else {
            // For multiple selection, check max
            const groupCount = item.modifiers.filter(m => m.group_id === group.modifier_group_id).length;
            if (group.max_selection > 0 && groupCount >= group.max_selection) {
              return item;
            }
            return {
              ...item,
              modifiers: [...item.modifiers, newModifier]
            };
          }
        }
      });
    });
    
    // Update selectedModifiers for UI highlight
    setSelectedModifiers(prev => {
      const existing = prev.find(m => m.modifier_id === modifier.modifier_id);
      
      if (group.selection_type === 'SINGLE') {
        const filtered = prev.filter(m => m.group_id !== group.modifier_group_id);
        if (existing) return filtered;
        return [...filtered, newModifier];
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
  
  const isModifierSelectionValid = () => {
    for (const group of modifierGroups) {
      const selectedCount = selectedModifiers.filter(m => m.group_id === group.modifier_group_id).length;
      if (group.min_selection > 0 && selectedCount < group.min_selection) {
        return false;
      }
    }
    return true;
  };
  
  const addToCart = () => {
    if (!selectedItem) return;
    
    setCart(prev => [...prev, {
      ...selectedItem,
      quantity: itemQuantity,
      cartId: `${selectedItem.item_id}_${Date.now()}`,
      modifiers: selectedModifiers,
      specialInstruction: specialInstruction || undefined
    }]);
    
    setShowModifierModal(false);
    setSelectedItem(null);
    setModifierGroups([]);
    setSelectedModifiers([]);
    setSpecialInstruction('');
    setItemQuantity(1);
  };
  
  const removeFromCart = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };
  
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
  
  // ==================== Payment ====================
  
  const handlePay = () => {
    if (cart.length === 0) return;
    setShowPaymentModal(true);
    setPaymentMethod('card');
    setCashReceived('');
  };
  
  const processPayment = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    try {
      // Calculate totals (apply discount)
      const subtotal = Math.max(0, cartTotal - cartDiscount);
      const tax = subtotal * ((config?.taxRate || 8.25) / 100);
      const total = subtotal + tax;
      
      // Determine order type and channel
      let orderTypeStr = 'TOGO';
      let channelStr = 'QSR';
      let tableId = `QSR-${orderNumber}`;
      let tableLabel = `Order #${orderNumber}`;
      
      if (orderType === 'forhere') {
        orderTypeStr = 'DINE_IN';
        tableLabel = `EAT IN #${orderNumber}`;
      } else if (orderType === 'togo') {
        orderTypeStr = 'TOGO';
        tableLabel = `TOGO #${orderNumber}`;
      } else if (orderType === 'pickup') {
        orderTypeStr = 'TOGO';
        channelStr = 'PICKUP';
        tableLabel = pickupCustomerName || `PICKUP #${orderNumber}`;
      } else if (orderType === 'delivery') {
        orderTypeStr = 'DELIVERY';
        channelStr = deliveryChannel;
        tableId = `DL${Date.now()}`;
        tableLabel = `${deliveryChannel} #${deliveryOrderNumber}`;
      }
      
      // Create order
      const orderData: any = {
        store_id: 'default',
        table_id: tableId,
        table_label: tableLabel,
        order_type: orderTypeStr,
        channel: channelStr,
        customer_name: orderType === 'pickup' ? pickupCustomerName : (customerName || undefined),
        customer_phone: orderType === 'pickup' ? pickupCustomerPhone : undefined,
        items: cart.map(item => ({
          item_id: item.item_id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          guest_number: 1,
          modifiers: item.modifiers || [],
          special_instruction: item.specialInstruction
        })),
        subtotal,
        tax,
        total,
        payment_method: paymentMethod,
        payment_status: 'PAID',
        source: 'QSR',
        fulfillment_mode: orderType === 'delivery' ? 'delivery' : (orderType === 'pickup' ? 'togo' : (orderType === 'togo' ? 'togo' : 'dine-in'))
      };
      
      // Add delivery-specific fields
      if (orderType === 'delivery') {
        orderData.delivery_company = deliveryChannel;
        orderData.delivery_order_number = deliveryOrderNumber;
        orderData.prep_time = deliveryPrepTime;
      }
      
      // Add pickup-specific fields
      if (orderType === 'pickup') {
        orderData.prep_time = pickupPrepTime;
        const pickupTime = new Date(Date.now() + pickupPrepTime * 60000);
        orderData.ready_time = getLocalDatetimeString(pickupTime);
      }
      
      // Submit to backend
      const orderRes = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
      
      if (!orderRes.ok) throw new Error('Failed to create order');
      
      const orderResult = await orderRes.json();
      
      // For delivery orders, also save to delivery_orders table
      if (orderType === 'delivery') {
        try {
          await fetch(`${API_URL}/orders/delivery-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              delivery_company: deliveryChannel,
              delivery_order_number: deliveryOrderNumber,
              prep_time: deliveryPrepTime,
              order_id: orderResult.id || orderResult.order_id
            })
          });
        } catch (e) {
          console.warn('Failed to save delivery order metadata:', e);
        }
      }
      
      // Print kitchen ticket
      try {
        const printOrderInfo: any = {
          orderType: orderTypeStr,
          channel: channelStr,
          table_label: tableLabel,
          orderNumber: orderNumber,
          customer_name: orderType === 'pickup' ? pickupCustomerName : customerName
        };
        
        if (orderType === 'delivery') {
          printOrderInfo.deliveryCompany = deliveryChannel;
          printOrderInfo.deliveryOrderNumber = deliveryOrderNumber;
          printOrderInfo.prepTime = deliveryPrepTime;
        }
        
        if (orderType === 'pickup') {
          printOrderInfo.customerPhone = pickupCustomerPhone;
          printOrderInfo.prepTime = pickupPrepTime;
        }
        
        await fetch(`${API_URL}/printers/print-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: orderResult.id || orderResult.order_id,
            items: cart.map(item => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              modifiers: item.modifiers.map(m => ({
                name: m.name,
                price_delta: m.price_adjustment
              })),
              specialInstruction: item.specialInstruction
            })),
            orderInfo: printOrderInfo
          })
        });
      } catch (printErr) {
        console.error('Kitchen print failed:', printErr);
      }
      
      // Show success
      setShowPaymentModal(false);
      setCompletedOrderNumber(orderNumber);
      setShowOrderComplete(true);
      
      // Clear cart and reset
      setCart([]);
      setCustomerName('');
      setPickupCustomerName('');
      setPickupCustomerPhone('');
      setDeliveryChannel('');
      setDeliveryOrderNumber('');
      setOrderType('forhere');
      incrementOrderNumber();
      
    } catch (error) {
      console.error('Payment failed:', error);
      setNotification({ type: 'error', message: 'Payment failed. Please try again.' });
    } finally {
      setIsProcessing(false);
    }
  };
  
  // ==================== Computed Values ====================
  
  // Build displayed categories (merged groups + standalone categories)
  const displayedCategories = useMemo(() => {
    const mergedGroups = layoutSettings.mergedGroups || [];
    const mergedCategoryNames = new Set<string>();
    
    // Collect all category names that are in merged groups
    mergedGroups.forEach((group: { id: string; name: string; categoryNames: string[] }) => {
      group.categoryNames.forEach(name => mergedCategoryNames.add(name));
    });
    
    // Build display list: merged groups first, then standalone categories
    const displayList: Array<{ type: 'group' | 'category'; id: string; name: string; categoryIds?: number[] }> = [];
    
    // Add merged groups
    mergedGroups.forEach((group: { id: string; name: string; categoryNames: string[] }) => {
      const categoryIds = categories
        .filter(c => group.categoryNames.includes(c.name))
        .map(c => c.category_id);
      if (categoryIds.length > 0) {
        displayList.push({ type: 'group', id: group.id, name: group.name, categoryIds });
      }
    });
    
    // Add standalone categories (not in any merged group)
    categories
      .filter(c => !mergedCategoryNames.has(c.name))
      .forEach(cat => {
        displayList.push({ type: 'category', id: String(cat.category_id), name: cat.name });
      });
    
    return displayList;
  }, [categories, layoutSettings.mergedGroups]);
  
  const currentItems = useMemo(() => {
    if (!selectedCategory && !selectedMergyGroupId) return [];
    
    // If a merged group is selected
    if (selectedMergyGroupId) {
      const group = displayedCategories.find(d => d.type === 'group' && d.id === selectedMergyGroupId);
      if (group && group.categoryIds) {
        // Return items from all categories in the group
        return categories
          .filter(c => group.categoryIds!.includes(c.category_id))
          .flatMap(c => c.items);
      }
      return [];
    }
    
    // Regular category selection
    const cat = categories.find(c => String(c.category_id) === selectedCategory);
    return cat?.items || [];
  }, [categories, selectedCategory, selectedMergyGroupId, displayedCategories]);
  
  // 할인 전 총액 (Sub Total)
  const cartSubtotalBeforeDiscount = useMemo(() => {
    return cart.reduce((sum, item) => {
      const basePrice = item.price;
      const modTotal = item.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
      const memoPrice = item.memo?.price || 0;
      return sum + (basePrice + modTotal + memoPrice) * item.quantity;
    }, 0);
  }, [cart]);
  
  // 아이템별 할인 합계
  const itemDiscountTotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      if (!item.discount) return sum;
      const basePrice = item.price;
      const modTotal = item.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
      const memoPrice = item.memo?.price || 0;
      const itemTotal = (basePrice + modTotal + memoPrice) * item.quantity;
      if (item.discount.type === 'percent') {
        return sum + (itemTotal * item.discount.value / 100);
      } else {
        return sum + item.discount.value;
      }
    }, 0);
  }, [cart]);
  
  // 할인 후 총액
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + getCartItemTotal(item), 0);
  }, [cart]);
  
  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);
  
  const getItemTotal = () => {
    if (!selectedItem) return 0;
    const modTotal = selectedModifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
    return (selectedItem.price + modTotal) * itemQuantity;
  };
  
  const discountedSubtotal = useMemo(() => {
    // cartTotal은 이미 아이템별 할인이 적용된 금액, 여기서 전체 할인(cartDiscount)도 적용
    return Math.max(0, cartTotal - cartDiscount);
  }, [cartTotal, cartDiscount]);
  
  const taxAmount = useMemo(() => {
    // 세금은 할인 후 금액에 적용
    return discountedSubtotal * ((config?.taxRate || 8.25) / 100);
  }, [discountedSubtotal, config]);
  
  const grandTotal = useMemo(() => {
    return discountedSubtotal + taxAmount;
  }, [discountedSubtotal, taxAmount]);
  
  const cashChange = useMemo(() => {
    const received = parseFloat(cashReceived) || 0;
    return Math.max(0, received - grandTotal);
  }, [cashReceived, grandTotal]);
  
  // ==================== Loading State ====================
  
  if (!config || isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100">
        <div className="text-center">
          <Coffee className="w-16 h-16 text-amber-600 animate-pulse mx-auto mb-4" />
          <p className="text-amber-800 font-medium">Loading Menu...</p>
        </div>
      </div>
    );
  }
  
  // ==================== Order Complete Screen ====================
  
  if (showOrderComplete) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <div className="text-center">
          <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <Check className="w-16 h-16 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Order Complete!</h1>
          <p className="text-gray-600 mb-8">Your order number is</p>
          <div className="bg-white rounded-2xl shadow-xl px-16 py-8 inline-block mb-8">
            <span className="text-8xl font-black text-amber-600">{completedOrderNumber}</span>
          </div>
          <p className="text-gray-500 mb-8">We'll call your number when ready</p>
          <button
            onClick={() => setShowOrderComplete(false)}
            className="px-12 py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-xl transition shadow-lg"
          >
            New Order
          </button>
        </div>
      </div>
    );
  }
  
  // ==================== Main Render ====================
  
  return (
    <div className="h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex overflow-hidden">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {notification.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
      
      {/* Left Side - Cart (moved from right) */}
      <div className="w-80 bg-white shadow-xl flex flex-col border-r">
        
        {/* Online Orders Mini Bar (when panel is closed) */}
        {!showOnlinePanel && onlineOrders.length > 0 && (
          <div 
            onClick={() => setShowOnlinePanel(true)}
            className="bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2 cursor-pointer hover:from-blue-600 hover:to-indigo-600 transition"
          >
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Wifi className={`w-4 h-4 ${sseConnected ? 'opacity-100' : 'opacity-50'}`} />
                <span className="font-semibold text-sm">Online Orders</span>
              </div>
              <div className="flex items-center gap-2">
                {onlineOrders.filter(o => o.status === 'pending').length > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                    {onlineOrders.filter(o => o.status === 'pending').length} NEW
                  </span>
                )}
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </div>
        )}
        {/* Cart Header - Shows Order Type */}
        <div className={`px-3 py-3 flex items-center justify-between ${
          orderType === 'forhere' ? 'bg-gradient-to-r from-amber-600 to-amber-500' :
          orderType === 'togo' ? 'bg-gradient-to-r from-green-600 to-green-500' :
          orderType === 'pickup' ? 'bg-gradient-to-r from-blue-600 to-blue-500' :
          orderType === 'delivery' ? 'bg-gradient-to-r from-purple-600 to-purple-500' :
          'bg-gradient-to-r from-slate-700 to-slate-600'
        }`}>
          <div className="flex items-center gap-2 text-white">
            {orderType === 'forhere' && <Coffee className="w-5 h-5" />}
            {orderType === 'togo' && <ShoppingBag className="w-5 h-5" />}
            {orderType === 'pickup' && <Phone className="w-5 h-5" />}
            {orderType === 'delivery' && <Car className="w-5 h-5" />}
            <div>
              <span className="font-bold">#{orderNumber}</span>
              <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs font-semibold uppercase">
                {orderType === 'forhere' ? 'EAT IN' : 
                 orderType === 'togo' ? 'TOGO' :
                 orderType === 'pickup' ? 'PICKUP' : 
                 orderType === 'delivery' ? `${deliveryChannel}` : ''}
              </span>
            </div>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="text-slate-300 hover:text-white text-xs flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
        
        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-4">
              <ShoppingCart className="w-12 h-12 mb-2 opacity-30" />
              <p className="text-center text-sm">Tap items to add</p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {cart.map(item => (
                <div 
                  key={item.cartId} 
                  className={`rounded-lg p-2 cursor-pointer transition-all ${
                    selectedCartItemId === item.cartId 
                      ? 'bg-blue-50 ring-2 ring-blue-400' 
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                  onClick={() => handleCartItemClick(item.cartId)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-800 text-sm">{item.name}</h4>
                      {item.modifiers.length > 0 && (
                        <div className="mt-0.5 space-y-0.5">
                          {item.modifiers.map((mod, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs text-gray-600">
                              <div className="flex items-center">
                                <span className="text-blue-600 font-medium mr-1">{'>>'}</span>
                                <span className="font-medium italic">{mod.name}</span>
                              </div>
                              {mod.price_adjustment > 0 && (
                                <span className="text-red-600 font-medium">+${mod.price_adjustment.toFixed(2)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {item.memo?.text && (
                        <div className="mt-0.5 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center text-blue-600">
                              <span className="font-medium mr-1">--{'>'}</span>
                              <span className="italic">{item.memo.text}</span>
                            </div>
                            {item.memo.price > 0 && (
                              <span className="text-red-500 font-medium">+${item.memo.price.toFixed(2)}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {item.discount && (() => {
                        const basePrice = (item.originalPrice || item.price) + item.modifiers.reduce((s, m) => s + m.price_adjustment, 0) + (item.memo?.price || 0);
                        const discountAmount = item.discount.type === 'percent' ? basePrice * item.discount.value / 100 : item.discount.value;
                        const discountedPrice = Math.max(0, basePrice - discountAmount);
                        return (
                          <div className="mt-0.5 text-xs text-right">
                            <span className="text-gray-400 line-through">${basePrice.toFixed(2)}</span>
                            <div className="text-red-500">
                              {item.discount.type === 'percent' ? `${item.discount.value}%` : ''} -${discountAmount.toFixed(2)}
                            </div>
                            <div className="text-blue-600 font-bold">${discountedPrice.toFixed(2)}</div>
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromCart(item.cartId); }}
                      className="p-1 hover:bg-red-100 rounded text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  
                  {/* Action Buttons - Show when item is selected */}
                  {selectedCartItemId === item.cartId && (
                    <div className="flex gap-1 mt-2 pt-2 border-t border-blue-200">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleItemMemo(); }}
                        className="flex-1 py-1.5 text-xs font-medium bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
                      >
                        Memo
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleItemDiscount(); }}
                        className="flex-1 py-1.5 text-xs font-medium bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition"
                      >
                        Item D/C
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditPrice(); }}
                        className="flex-1 py-1.5 text-xs font-medium bg-green-100 text-green-700 rounded hover:bg-green-200 transition"
                      >
                        Edit Price
                      </button>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); updateCartQuantity(item.cartId, -1); }}
                        className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded transition"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateCartQuantity(item.cartId, 1); }}
                        className="w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded transition"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="font-bold text-gray-800 text-sm">
                      ${getCartItemTotal(item).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Cart Summary & Pay Button */}
        <div className="border-t bg-gray-50 p-3">
          <div className="space-y-1 mb-3 text-sm">
            <div className="flex justify-between text-gray-600">
              <span className="font-medium text-blue-600">Sub Total:</span>
              <span>${cartSubtotalBeforeDiscount.toFixed(2)}</span>
            </div>
            {(itemDiscountTotal > 0 || cartDiscount > 0) && (
              <>
                <div className="flex justify-between text-red-500">
                  <span className="font-medium">Discount:</span>
                  <span>- ${(itemDiscountTotal + cartDiscount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span className="font-medium text-blue-600">Sub After D/C:</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-600">
              <span className="font-medium text-blue-600">GST:</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-gray-800 pt-2 border-t">
              <span className="text-blue-600">Total:</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>
          
          <button
            onClick={handlePay}
            disabled={cart.length === 0}
            className={`w-full py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2 ${
              cart.length > 0
                ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <CreditCard className="w-5 h-5" />
            Pay ${grandTotal.toFixed(2)}
          </button>
        </div>
      </div>
      
      {/* Right Side - Menu Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header - Order Type Buttons */}
        <header className="bg-slate-800 px-3 py-2 flex items-center justify-between shadow-lg">
          {/* Left: Back + Order Type Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/sales')}
              className="p-2 hover:bg-white/10 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            
            {/* Order Type Buttons */}
            <div className="flex gap-1">
              {/* Eat In */}
              <button
                onClick={() => setOrderType('forhere')}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg font-bold transition ${
                  orderType === 'forhere'
                    ? 'bg-amber-500 text-white shadow-lg'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                <Coffee className="w-5 h-5" />
                Eat In
              </button>
              {/* Togo */}
              <button
                onClick={() => setOrderType('togo')}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg font-bold transition ${
                  orderType === 'togo'
                    ? 'bg-green-500 text-white shadow-lg'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                <ShoppingBag className="w-5 h-5" />
                Togo
              </button>
              {/* Pickup */}
              <button
                onClick={() => {
                  setPickupCustomerName('');
                  setPickupCustomerPhone('');
                  setPickupPrepTime(15);
                  setShowPickupModal(true);
                }}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg font-bold transition ${
                  orderType === 'pickup'
                    ? 'bg-blue-500 text-white shadow-lg'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                <Phone className="w-5 h-5" />
                Pickup
              </button>
              {/* Online */}
              <button
                onClick={() => { setShowOnlinePanel(!showOnlinePanel); unlockAudio(); }}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 rounded-lg font-bold transition ${
                  showOnlinePanel 
                    ? 'bg-cyan-500 text-white shadow-lg' 
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                <Globe className="w-5 h-5" />
                Online
                {onlineOrders.filter(o => o.status === 'pending').length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                    {onlineOrders.filter(o => o.status === 'pending').length}
                  </span>
                )}
              </button>
              {/* Delivery */}
              <button
                onClick={() => {
                  setDeliveryChannel('');
                  setDeliveryOrderNumber('');
                  setDeliveryPrepTime(10);
                  setShowDeliveryModal(true);
                }}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg font-bold transition ${
                  orderType === 'delivery'
                    ? 'bg-purple-500 text-white shadow-lg'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                <Car className="w-5 h-5" />
                Delivery
              </button>
            </div>
          </div>
          
          {/* Right: Settings */}
          <div className="flex items-center gap-2">
            {/* Customer Name Input - Eat In/Togo only */}
            {(orderType === 'forhere' || orderType === 'togo') && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer Name"
                  className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg w-40 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-amber-400"
                />
              </div>
            )}
            
            <button
              onClick={() => navigate('/qsr-setup')}
              className="p-2 hover:bg-white/10 rounded-lg transition"
            >
              <Settings className="w-5 h-5 text-white" />
            </button>
          </div>
        </header>
        
        {/* Category Grid - Blue theme with Back Office settings */}
        <div className="bg-gradient-to-b from-blue-900 to-blue-950 px-2 py-2">
          <div 
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${layoutSettings.categoryColumns || 10}, 1fr)` }}
          >
            {displayedCategories.map(item => {
              const isSelected = item.type === 'group' 
                ? selectedMergyGroupId === item.id 
                : selectedCategory === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.type === 'group') {
                      setSelectedMergyGroupId(item.id);
                      setSelectedCategory(null);
                    } else {
                      setSelectedCategory(item.id);
                      setSelectedMergyGroupId(null);
                    }
                  }}
                  style={{ height: `${layoutSettings.categoryHeight || 44}px` }}
                  className={`text-xs font-bold rounded-lg transition-all duration-150 flex items-center justify-center ${
                    isSelected
                      ? 'bg-gradient-to-b from-cyan-400 to-cyan-600 text-white shadow-lg shadow-cyan-500/40 ring-2 ring-cyan-300'
                      : item.type === 'group'
                        ? 'bg-gradient-to-b from-purple-600 to-purple-800 text-purple-100 hover:from-purple-500 hover:to-purple-700 border border-purple-500'
                        : 'bg-gradient-to-b from-blue-700 to-blue-800 text-blue-100 hover:from-blue-600 hover:to-blue-700 border border-blue-600'
                  }`}
                >
                  <span className="truncate px-1">{item.name}</span>
                  {item.type === 'group' && (
                    <span className="ml-1 text-[9px] opacity-70">({item.categoryIds?.length})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        
        {/* Menu Items Grid - Amber/Orange theme with Back Office settings */}
        <div className="flex-1 p-2 overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50">
          <div 
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${layoutSettings.menuGridColumns || 8}, 1fr)` }}
          >
            {currentItems.map(item => (
              <button
                key={item.item_id}
                onClick={() => handleItemClick(item)}
                style={{ height: `${layoutSettings.menuItemHeight || 64}px` }}
                className="bg-gradient-to-b from-amber-100 to-amber-200 rounded-lg px-2 py-1.5 shadow-md hover:shadow-lg transition-all duration-150 active:scale-[0.97] border border-amber-300 hover:border-amber-500 group flex flex-col justify-center overflow-hidden"
              >
                <h3 
                  className={`${layoutSettings.menuFontExtraBold ? 'font-black' : layoutSettings.menuFontBold ? 'font-bold' : 'font-semibold'} text-amber-900 leading-tight line-clamp-2 group-hover:text-amber-700 transition-colors text-center`}
                  style={{ fontSize: `${layoutSettings.menuFontSize || 14}px` }}
                >
                  {layoutSettings.useShortName ? (item.short_name || item.name) : item.name}
                </h3>
                {layoutSettings.showPrices !== false && (
                  <p className="text-amber-700 font-semibold text-xs text-center mt-0.5">${item.price.toFixed(2)}</p>
                )}
              </button>
            ))}
          </div>
          
          {currentItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Coffee className="w-12 h-12 mb-2 opacity-30" />
              <p>No items in this category</p>
            </div>
          )}
        </div>
        
        {/* Bottom Modifier Panel - Grid layout with Back Office settings */}
        <div 
          className="bg-gradient-to-b from-slate-800 to-slate-900 border-t border-slate-700 px-2 py-1.5"
          style={{ height: `${(layoutSettings.modifierRows || 2) * (layoutSettings.modifierItemHeight || 48) + 12}px` }}
        >
          {loadingModifiers ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
            </div>
          ) : modifierGroups.length > 0 ? (
            <div 
              className="grid gap-1 h-full"
              style={{ 
                gridTemplateColumns: `repeat(${layoutSettings.modifierColumns || 12}, 1fr)`,
                gridTemplateRows: `repeat(${layoutSettings.modifierRows || 2}, 1fr)`
              }}
            >
              {modifierGroups.flatMap(group => 
                group.modifiers.map(mod => {
                  const isSelected = selectedModifiers.some(m => m.modifier_id === mod.modifier_id);
                  return (
                    <button
                      key={mod.modifier_id}
                      onClick={() => toggleModifier(group, mod)}
                      style={{ 
                        height: `${layoutSettings.modifierItemHeight || 40}px`,
                        fontSize: `${layoutSettings.modifierFontSize || 12}px`
                      }}
                      className={`px-1.5 rounded-lg font-medium transition-all flex items-center justify-center ${
                        isSelected
                          ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-lg'
                          : 'bg-gradient-to-b from-slate-600 to-slate-700 text-slate-200 hover:from-slate-500 hover:to-slate-600'
                      }`}
                    >
                      <span className="truncate">{mod.name}</span>
                      {layoutSettings.modifierShowPrices !== false && mod.price_adjustment !== 0 && (
                        <span className={`ml-1 text-[10px] ${isSelected ? 'text-emerald-200' : 'text-slate-400'}`}>
                          +${mod.price_adjustment.toFixed(0)}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="h-full" />
          )}
        </div>
        
        {/* Bottom Function Buttons */}
        <div className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 px-2 py-2 border-t border-white/10">
          <div className="grid grid-cols-9 gap-1.5">
            <button 
              onClick={handleOpenTill}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Open Till
            </button>
            <button 
              onClick={handleVoid}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Void
            </button>
            <button 
              onClick={() => setShowOpenPriceModal(true)}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Open Price
            </button>
            <button 
              onClick={() => setShowDiscountModal(true)}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              D/C
            </button>
            <button 
              onClick={() => setNotification({ type: 'success', message: 'Sold Out feature - Back Office' })}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Sold Out
            </button>
            <button 
              onClick={() => setShowKitchenNoteModal(true)}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Kitchen Note
            </button>
            <button 
              onClick={() => { setShowSearchModal(true); setSearchQuery(''); setSearchResults([]); }}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Search
            </button>
            <button 
              onClick={() => { setShowOrderHistoryModal(true); fetchOrderHistory(orderHistoryDate); }}
              className="h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 hover:shadow-white/10"
            >
              Order History
            </button>
            {/* More Button with Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="w-full h-11 rounded-lg bg-white/10 backdrop-blur-sm text-white text-xs font-semibold hover:bg-white/20 transition-all shadow-lg border border-white/20 hover:border-white/40 flex items-center justify-center gap-1"
              >
                More
                <ChevronRight className={`w-3 h-3 transition-transform ${showMoreMenu ? 'rotate-90' : ''}`} />
              </button>
              
              {/* More Dropdown Menu */}
              {showMoreMenu && (
                <>
                  {/* Backdrop to close menu */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowMoreMenu(false)}
                  />
                  <div className="absolute bottom-full right-0 mb-2 w-44 bg-slate-900/80 backdrop-blur-xl rounded-xl shadow-2xl border border-white/20 overflow-hidden z-50">
                    <button 
                      onClick={() => { setShowMoreMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-3"
                    >
                      <User className="w-4 h-4 text-white/70" />
                      Waiting List
                    </button>
                    <button 
                      onClick={() => { setShowMoreMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-3 border-t border-white/10"
                    >
                      <CreditCard className="w-4 h-4 text-white/70" />
                      Gift Card
                    </button>
                    <button 
                      onClick={() => { setShowOnlinePanel(true); setShowMoreMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-3 border-t border-white/10"
                    >
                      <Wifi className="w-4 h-4 text-white/70" />
                      Online
                    </button>
                    <button 
                      onClick={() => { setShowMoreMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-3 border-t border-white/10"
                    >
                      <Clock className="w-4 h-4 text-white/70" />
                      Opening/Closing
                    </button>
                    <button 
                      onClick={() => { navigate('/backoffice/menu'); setShowMoreMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-3 border-t border-white/10"
                    >
                      <Settings className="w-4 h-4 text-white/70" />
                      Back Office
                    </button>
                    <div className="border-t border-white/20 my-1" />
                    <button 
                      type="button"
                      onClick={() => { 
                        setShowMoreMenu(false);
                        quitToOsFromPos();
                      }}
                      className="w-full px-4 py-3 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-3"
                    >
                      <ArrowLeft className="w-4 h-4 text-white/70" />
                      Go to Windows
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Modifier Modal */}
      {showModifierModal && selectedItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-xl">{selectedItem.name}</h3>
                <p className="text-amber-100">${selectedItem.price.toFixed(2)}</p>
              </div>
              <button
                onClick={() => setShowModifierModal(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingModifiers ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Quantity */}
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-500 mb-3">Quantity</h4>
                    <div className="flex items-center justify-center gap-4">
                      <button
                        onClick={() => setItemQuantity(q => Math.max(1, q - 1))}
                        className="w-12 h-12 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-xl transition"
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <span className="text-3xl font-bold w-16 text-center">{itemQuantity}</span>
                      <button
                        onClick={() => setItemQuantity(q => q + 1)}
                        className="w-12 h-12 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-xl transition"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Modifier Groups */}
                  {modifierGroups.map(group => (
                    <div key={group.modifier_group_id} className="mb-5">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-gray-700">{group.name}</h4>
                        {group.min_selection > 0 && (
                          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                            Required
                          </span>
                        )}
                        {group.selection_type === 'SINGLE' && (
                          <span className="text-xs text-gray-400">Choose one</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {group.modifiers.map(mod => {
                          const isSelected = selectedModifiers.some(m => m.modifier_id === mod.modifier_id);
                          return (
                            <button
                              key={mod.modifier_id}
                              onClick={() => toggleModifier(group, mod)}
                              className={`p-3 rounded-xl border-2 text-left transition ${
                                isSelected
                                  ? 'border-amber-500 bg-amber-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                  isSelected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'
                                }`}>
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <span className="font-medium text-gray-800">{mod.name}</span>
                              </div>
                              {mod.price_adjustment !== 0 && (
                                <span className={`text-sm ml-7 ${mod.price_adjustment > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                                  {mod.price_adjustment > 0 ? '+' : ''}${mod.price_adjustment.toFixed(2)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  
                  {/* Special Instructions */}
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-1">
                      <MessageSquare className="w-4 h-4" />
                      Special Instructions
                    </h4>
                    <textarea
                      value={specialInstruction}
                      onChange={(e) => setSpecialInstruction(e.target.value)}
                      placeholder="Add any special requests..."
                      className="w-full p-3 border rounded-xl resize-none focus:outline-none focus:border-amber-400"
                      rows={2}
                    />
                  </div>
                </>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="bg-gray-50 px-5 py-4 border-t flex items-center justify-between">
              <div>
                <span className="text-gray-500 text-sm">Total</span>
                <p className="text-2xl font-bold text-gray-800">${getItemTotal().toFixed(2)}</p>
              </div>
              <button
                onClick={addToCart}
                disabled={!isModifierSelectionValid()}
                className={`px-8 py-3 rounded-xl font-bold text-lg transition flex items-center gap-2 ${
                  isModifierSelectionValid()
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Plus className="w-5 h-5" />
                Add to Order
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            {/* Payment Header */}
            <div className="bg-gradient-to-r from-green-600 to-emerald-500 px-5 py-4 flex items-center justify-between">
              <h3 className="text-white font-bold text-xl">Payment</h3>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Payment Content */}
            <div className="p-5">
              {/* Order Summary */}
              <div className="bg-gray-50 rounded-xl p-4 mb-5">
                <div className="flex justify-between text-gray-600 mb-1">
                  <span>Subtotal</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
                {cartDiscount > 0 && (
                  <div className="flex justify-between text-green-600 mb-1">
                    <span>Discount</span>
                    <span>-${cartDiscount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600 mb-2">
                  <span>Tax</span>
                  <span>${taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-2xl font-bold text-gray-800 pt-2 border-t">
                  <span>Total</span>
                  <span>${grandTotal.toFixed(2)}</span>
                </div>
              </div>
              
              {/* Payment Method */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-gray-500 mb-3">Payment Method</h4>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setPaymentMethod('card')}
                    className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition ${
                      paymentMethod === 'card'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <CreditCard className={`w-8 h-8 ${paymentMethod === 'card' ? 'text-green-600' : 'text-gray-400'}`} />
                    <span className={`font-medium ${paymentMethod === 'card' ? 'text-green-700' : 'text-gray-600'}`}>Card</span>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition ${
                      paymentMethod === 'cash'
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <DollarSign className={`w-8 h-8 ${paymentMethod === 'cash' ? 'text-green-600' : 'text-gray-400'}`} />
                    <span className={`font-medium ${paymentMethod === 'cash' ? 'text-green-700' : 'text-gray-600'}`}>Cash</span>
                  </button>
                </div>
              </div>
              
              {/* Cash Input */}
              {paymentMethod === 'cash' && (
                <div className="mb-5">
                  <h4 className="text-sm font-semibold text-gray-500 mb-2">Cash Received</h4>
                  <div className="relative">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="number"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-10 pr-4 py-3 text-2xl font-bold border-2 rounded-xl focus:outline-none focus:border-green-500"
                    />
                  </div>
                  {cashChange > 0 && (
                    <div className="mt-3 bg-amber-50 rounded-lg p-3 flex justify-between">
                      <span className="text-amber-700 font-medium">Change Due</span>
                      <span className="text-amber-700 font-bold text-xl">${cashChange.toFixed(2)}</span>
                    </div>
                  )}
                  
                  {/* Quick Cash Buttons */}
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {[10, 20, 50, 100].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setCashReceived(String(amount))}
                        className="py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-700 transition"
                      >
                        ${amount}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Process Button */}
              <button
                onClick={processPayment}
                disabled={isProcessing || (paymentMethod === 'cash' && parseFloat(cashReceived) < grandTotal)}
                className={`w-full py-4 rounded-xl font-bold text-xl transition flex items-center justify-center gap-2 ${
                  isProcessing || (paymentMethod === 'cash' && parseFloat(cashReceived) < grandTotal)
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
                }`}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-6 h-6 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Check className="w-6 h-6" />
                    Complete Payment
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Orders Panel (Online/Pickup/Delivery) ==================== */}
      {showOnlinePanel && (
        <div className="fixed right-0 top-0 h-full w-[450px] bg-white shadow-2xl z-50 flex flex-col">
          {/* Panel Header */}
          <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-white font-bold text-xl">Order Queue</h2>
              {sseConnected && (
                <span className="flex items-center gap-1 text-green-300 text-sm">
                  <Wifi className="w-4 h-4" />
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-2 rounded-lg transition ${soundEnabled ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50'}`}
              >
                {soundEnabled ? <Volume2 className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              </button>
              <button
                onClick={() => setShowOnlinePanel(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          
          {/* Tab Navigation */}
          <div className="bg-gray-100 px-2 py-2 flex gap-1">
            <button
              onClick={() => setOrderPanelTab('online')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium transition ${
                orderPanelTab === 'online'
                  ? 'bg-blue-500 text-white shadow'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Wifi className="w-4 h-4" />
              Online
              {onlineOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  orderPanelTab === 'online' ? 'bg-white/20' : 'bg-blue-100 text-blue-600'
                }`}>
                  {onlineOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setOrderPanelTab('pickup')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium transition ${
                orderPanelTab === 'pickup'
                  ? 'bg-blue-500 text-white shadow'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Phone className="w-4 h-4" />
              Pickup
              {pickupOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  orderPanelTab === 'pickup' ? 'bg-white/20' : 'bg-blue-100 text-blue-600'
                }`}>
                  {pickupOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setOrderPanelTab('delivery')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium transition ${
                orderPanelTab === 'delivery'
                  ? 'bg-purple-500 text-white shadow'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Car className="w-4 h-4" />
              Delivery
              {deliveryOrders.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  orderPanelTab === 'delivery' ? 'bg-white/20' : 'bg-purple-100 text-purple-600'
                }`}>
                  {deliveryOrders.length}
                </span>
              )}
            </button>
          </div>
          
          {/* Online Tab - Accept Mode */}
          {orderPanelTab === 'online' && (
            <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between text-sm">
              <span className="text-gray-600">Accept:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => saveOnlineSettings('auto', autoPrepTime, soundEnabled)}
                  className={`px-3 py-1 rounded text-xs font-medium transition ${
                    onlineAcceptMode === 'auto' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  Auto
                </button>
                <button
                  onClick={() => saveOnlineSettings('manual', autoPrepTime, soundEnabled)}
                  className={`px-3 py-1 rounded text-xs font-medium transition ${
                    onlineAcceptMode === 'manual' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  Manual
                </button>
              </div>
              {onlineAcceptMode === 'auto' && (
                <select
                  value={autoPrepTime}
                  onChange={(e) => saveOnlineSettings('auto', e.target.value, soundEnabled)}
                  className="px-2 py-1 text-xs border rounded"
                >
                  {['10m', '15m', '20m', '25m', '30m'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          
          {/* Orders List */}
          <div className="flex-1 overflow-y-auto">
            {/* Online Orders Tab */}
            {orderPanelTab === 'online' && (
              onlineOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <Wifi className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-lg">No online orders</p>
                  <p className="text-sm mt-1">Orders will appear here in real-time</p>
                </div>
              ) : (
                <div className="divide-y">
                  {onlineOrders.map(order => (
                    <div
                      key={order.id}
                      onClick={() => setSelectedOnlineOrder(order.fullOrder || null)}
                      className={`p-4 cursor-pointer hover:bg-gray-50 transition ${
                        selectedOnlineOrder?.id === order.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">
                            {order.orderType === 'pickup' ? '🛍️' : order.orderType === 'delivery' ? '🚗' : '🍽️'}
                          </span>
                          <div>
                            <span className="font-bold text-gray-800">#{order.number}</span>
                            <span className="text-gray-400 text-sm ml-2">{order.time}</span>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                          order.status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                          order.status === 'ready' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {order.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mb-1">{order.name}</div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-bold text-blue-600">${order.total.toFixed(2)}</span>
                        {order.pickupTime && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(order.pickupTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      {/* Quick Actions */}
                      <div className="flex gap-2 mt-3">
                        {order.status === 'pending' && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); acceptOnlineOrder(order.id, 15); }}
                              className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600"
                            >
                              Accept (15m)
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); rejectOnlineOrder(order.id); }}
                              className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-sm font-medium"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {order.status === 'confirmed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateOnlineOrderStatus(order.id, 'preparing'); }}
                            className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium"
                          >
                            🍳 Preparing
                          </button>
                        )}
                        {order.status === 'preparing' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateOnlineOrderStatus(order.id, 'ready'); }}
                            className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium"
                          >
                            ✓ Ready
                          </button>
                        )}
                        {order.status === 'ready' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markAsPickedUp(order.id); }}
                            className="flex-1 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium"
                          >
                            ✓ Picked Up
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            
            {/* Pickup Orders Tab */}
            {orderPanelTab === 'pickup' && (
              pickupOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <Phone className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-lg">No pickup orders</p>
                  <p className="text-sm mt-1">Create pickup orders from the main screen</p>
                </div>
              ) : (
                <div className="divide-y">
                  {pickupOrders.map((order: any) => (
                    <div key={order.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">📞</span>
                          <div>
                            <span className="font-bold text-gray-800">
                              {order.customer_name || order.table_label || `#${order.id}`}
                            </span>
                            <span className="text-gray-400 text-sm ml-2">
                              {new Date(order.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          order.status === 'ready' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {(order.status || 'PENDING').toUpperCase()}
                        </span>
                      </div>
                      {order.customer_phone && (
                        <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {order.customer_phone}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-bold text-blue-600">${Number(order.total || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => completeOrder(order.id, 'pickup')}
                          className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600"
                        >
                          ✓ Picked Up
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            
            {/* Delivery Orders Tab */}
            {orderPanelTab === 'delivery' && (
              deliveryOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <Car className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-lg">No delivery orders</p>
                  <p className="text-sm mt-1">Create delivery orders from the main screen</p>
                </div>
              ) : (
                <div className="divide-y">
                  {deliveryOrders.map((order: any) => (
                    <div key={order.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🚗</span>
                          <div>
                            <span className="font-bold text-purple-700">
                              {order.delivery_company || 'Delivery'}
                            </span>
                            <span className="font-bold text-gray-800 ml-1">
                              #{order.delivery_order_number || order.id}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          order.status === 'ready' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {(order.status || 'PENDING').toUpperCase()}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mb-1">
                        Prep: {order.prep_time || 10}min
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-bold text-purple-600">${Number(order.total || 0).toFixed(2)}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(order.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => completeOrder(order.order_id || order.id, 'delivery')}
                          className="flex-1 py-2 bg-purple-500 text-white rounded-lg text-sm font-medium hover:bg-purple-600"
                        >
                          ✓ Picked Up
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
          
          {/* Refresh Button */}
          <div className="p-3 border-t bg-gray-50">
            <button
              onClick={() => {
                loadOnlineOrders();
                loadPosOrders();
              }}
              className="w-full py-2 text-gray-600 hover:text-blue-600 flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh All
            </button>
          </div>
        </div>
      )}
      
      {/* ==================== New Order Alert Modal ==================== */}
      {showNewOrderAlert && newOrderAlertData && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-pulse-slow">
            {/* Alert Header */}
            <div className="bg-gradient-to-r from-red-500 to-orange-500 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <Bell className="w-7 h-7 text-white animate-bounce" />
                </div>
                <div>
                  <h2 className="text-white font-bold text-2xl">🔔 New Online Order!</h2>
                  <p className="text-white/80">#{newOrderAlertData.orderNumber?.slice(-8) || newOrderAlertData.id.slice(-8)}</p>
                </div>
              </div>
            </div>
            
            {/* Order Info */}
            <div className="p-5">
              {/* Customer Info */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3 mb-2">
                  <User className="w-5 h-5 text-gray-400" />
                  <span className="font-semibold text-gray-800">{newOrderAlertData.customerName || 'Customer'}</span>
                </div>
                {newOrderAlertData.customerPhone && (
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span>{newOrderAlertData.customerPhone}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-2xl">
                    {newOrderAlertData.orderType === 'pickup' ? '🛍️' : newOrderAlertData.orderType === 'delivery' ? '🚗' : '🍽️'}
                  </span>
                  <span className="font-medium text-gray-700">
                    {newOrderAlertData.orderType === 'pickup' ? 'PICKUP' : newOrderAlertData.orderType === 'delivery' ? 'DELIVERY' : 'DINE-IN'}
                  </span>
                </div>
              </div>
              
              {/* Items */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4 max-h-48 overflow-y-auto">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Order Items</h4>
                {newOrderAlertData.items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm py-1 border-b last:border-0">
                    <span>{item.name} x{item.quantity}</span>
                    <span className="text-gray-600">${item.subtotal?.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-lg pt-2 mt-2 border-t">
                  <span>Total</span>
                  <span className="text-blue-600">${newOrderAlertData.total?.toFixed(2)}</span>
                </div>
              </div>
              
              {/* Notes */}
              {newOrderAlertData.notes && (
                <div className="bg-yellow-50 rounded-xl p-3 mb-4 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-sm font-medium text-yellow-800">Customer Note:</span>
                    <p className="text-sm text-yellow-700">{newOrderAlertData.notes}</p>
                  </div>
                </div>
              )}
              
              {/* Prep Time Selection */}
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Prep Time</h4>
                <div className="grid grid-cols-5 gap-2">
                  {[10, 15, 20, 30, 45].map(time => (
                    <button
                      key={time}
                      onClick={() => setSelectedPrepTime(time)}
                      className={`py-3 rounded-xl font-bold transition ${
                        selectedPrepTime === time
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {time}m
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    await rejectOnlineOrder(newOrderAlertData.id, 'Store too busy');
                    setShowNewOrderAlert(false);
                    setNewOrderAlertData(null);
                  }}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition"
                >
                  Reject
                </button>
                <button
                  onClick={async () => {
                    await acceptOnlineOrder(newOrderAlertData.id, selectedPrepTime);
                    setShowNewOrderAlert(false);
                    setNewOrderAlertData(null);
                  }}
                  className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold text-lg hover:bg-green-600 transition flex items-center justify-center gap-2"
                >
                  <Check className="w-6 h-6" />
                  Accept ({selectedPrepTime} min)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Pickup Modal ==================== */}
      {showPickupModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-2xl w-full max-w-3xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Phone className="w-6 h-6 text-white" />
                <h3 className="text-white font-bold text-xl">Pickup Order</h3>
              </div>
              <button onClick={() => setShowPickupModal(false)} className="p-2 hover:bg-white/20 rounded-lg transition">
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="p-4 space-y-3">
              {/* Customer Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">Customer Name</label>
                <input
                  type="text"
                  value={pickupCustomerName}
                  readOnly
                  onClick={() => setPickupActiveField('name')}
                  className={`w-full px-4 py-3 border-2 rounded-xl text-lg ${
                    pickupActiveField === 'name' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                  placeholder="Tap to enter name"
                />
              </div>
              
              {/* Customer Phone */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={pickupCustomerPhone}
                  readOnly
                  onClick={() => setPickupActiveField('phone')}
                  className={`w-full px-4 py-3 border-2 rounded-xl text-lg font-mono ${
                    pickupActiveField === 'phone' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                  placeholder="Tap to enter phone"
                />
              </div>
              
              {/* Prep Time */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">Prep Time</label>
                <div className="grid grid-cols-5 gap-2">
                  {[10, 15, 20, 30, 45].map(time => (
                    <button
                      key={time}
                      onClick={() => setPickupPrepTime(time)}
                      className={`py-2 rounded-xl font-bold transition ${
                        pickupPrepTime === time
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {time}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Virtual Keyboard */}
            <VirtualKeyboard
              open={true}
              onType={(key) => {
                if (pickupActiveField === 'name') {
                  setPickupCustomerName(pickupCustomerName + key);
                } else {
                  setPickupCustomerPhone(pickupCustomerPhone + key);
                }
              }}
              onBackspace={() => {
                if (pickupActiveField === 'name') {
                  setPickupCustomerName(pickupCustomerName.slice(0, -1));
                } else {
                  setPickupCustomerPhone(pickupCustomerPhone.slice(0, -1));
                }
              }}
              onClear={() => {
                if (pickupActiveField === 'name') {
                  setPickupCustomerName('');
                } else {
                  setPickupCustomerPhone('');
                }
              }}
              showNumpad={pickupActiveField === 'phone'}
              bottomOffsetPx={0}
            />
            
            {/* Modal Footer */}
            <div className="bg-gray-100 px-4 py-3 flex gap-3">
              <button
                onClick={() => setShowPickupModal(false)}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setOrderType('pickup');
                  setCustomerName(pickupCustomerName);
                  setShowPickupModal(false);
                }}
                className="flex-1 py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" />
                Start Pickup Order
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Delivery Modal ==================== */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-2xl w-full max-w-3xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Car className="w-6 h-6 text-white" />
                <h3 className="text-white font-bold text-xl">Delivery Order</h3>
              </div>
              <button onClick={() => setShowDeliveryModal(false)} className="p-2 hover:bg-white/20 rounded-lg transition">
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="p-4 space-y-3">
              {/* Delivery Channel */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">Delivery Channel</label>
                <div className="grid grid-cols-5 gap-2">
                  {['Doordash', 'UberEats', 'Skip', 'Fantuan', 'Other'].map(ch => (
                    <button
                      key={ch}
                      onClick={() => setDeliveryChannel(ch)}
                      className={`py-2.5 px-2 rounded-xl font-medium text-sm transition ${
                        deliveryChannel === ch
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* External Order Number */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">Order Number (from app)</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={deliveryOrderNumber}
                    readOnly
                    className="w-full pl-10 pr-4 py-3 border-2 border-purple-500 bg-purple-50 rounded-xl uppercase font-mono text-xl"
                    placeholder="e.g. ABC123"
                  />
                </div>
              </div>
              
              {/* Prep Time */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1">Prep Time</label>
                <div className="grid grid-cols-5 gap-2">
                  {[5, 10, 15, 20, 30].map(time => (
                    <button
                      key={time}
                      onClick={() => setDeliveryPrepTime(time)}
                      className={`py-2 rounded-xl font-bold transition ${
                        deliveryPrepTime === time
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {time}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Virtual Keyboard */}
            <VirtualKeyboard
              open={true}
              onType={(key) => setDeliveryOrderNumber(deliveryOrderNumber + key.toUpperCase())}
              onBackspace={() => setDeliveryOrderNumber(deliveryOrderNumber.slice(0, -1))}
              onClear={() => setDeliveryOrderNumber('')}
              showNumpad={true}
              bottomOffsetPx={0}
            />
            
            {/* Modal Footer */}
            <div className="bg-gray-100 px-4 py-3 flex gap-3">
              <button
                onClick={() => setShowDeliveryModal(false)}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!deliveryChannel || !deliveryOrderNumber) {
                    setNotification({ type: 'error', message: 'Please select channel and enter order number' });
                    return;
                  }
                  setOrderType('delivery');
                  setShowDeliveryModal(false);
                }}
                disabled={!deliveryChannel || !deliveryOrderNumber}
                className={`flex-1 py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 ${
                  deliveryChannel && deliveryOrderNumber
                    ? 'bg-purple-500 text-white hover:bg-purple-600'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Check className="w-5 h-5" />
                Start Delivery Order
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Online Order Detail Modal ==================== */}
      {selectedOnlineOrder && !showNewOrderAlert && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-xl">Order #{selectedOnlineOrder.orderNumber?.slice(-8) || selectedOnlineOrder.id.slice(-8)}</h3>
                <p className="text-blue-100 text-sm flex items-center gap-2">
                  <span className="text-lg">
                    {selectedOnlineOrder.orderType === 'pickup' ? '🛍️' : selectedOnlineOrder.orderType === 'delivery' ? '🚗' : '🍽️'}
                  </span>
                  {selectedOnlineOrder.orderType?.toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => setSelectedOnlineOrder(null)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* Status Badge */}
              <div className="mb-4">
                <span className={`px-4 py-2 rounded-full font-semibold ${
                  selectedOnlineOrder.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  selectedOnlineOrder.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                  selectedOnlineOrder.status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                  selectedOnlineOrder.status === 'ready' ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {selectedOnlineOrder.status?.toUpperCase()}
                </span>
              </div>
              
              {/* Customer Info */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Customer</h4>
                <div className="font-medium text-gray-800">{selectedOnlineOrder.customerName || 'Customer'}</div>
                {selectedOnlineOrder.customerPhone && (
                  <div className="text-gray-600 text-sm">{selectedOnlineOrder.customerPhone}</div>
                )}
                {selectedOnlineOrder.pickupTime && (
                  <div className="flex items-center gap-2 mt-2 text-sm text-blue-600">
                    <Clock className="w-4 h-4" />
                    Pickup: {new Date(selectedOnlineOrder.pickupTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              
              {/* Order Items */}
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Items</h4>
                {selectedOnlineOrder.items?.map((item, idx) => (
                  <div key={idx} className="py-2 border-b last:border-0">
                    <div className="flex justify-between">
                      <span className="font-medium">{item.name} x{item.quantity}</span>
                      <span>${item.subtotal?.toFixed(2)}</span>
                    </div>
                    {item.options?.map((opt, optIdx) => (
                      <div key={optIdx} className="text-xs text-gray-500 pl-3">
                        + {opt.choiceName} {opt.price > 0 && `($${opt.price.toFixed(2)})`}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 space-y-1">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>${selectedOnlineOrder.subtotal?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Tax</span>
                    <span>${selectedOnlineOrder.tax?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span className="text-blue-600">${selectedOnlineOrder.total?.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              
              {/* Notes */}
              {selectedOnlineOrder.notes && (
                <div className="bg-yellow-50 rounded-xl p-4 mb-4">
                  <h4 className="text-sm font-semibold text-yellow-800 mb-1">Customer Note</h4>
                  <p className="text-yellow-700">{selectedOnlineOrder.notes}</p>
                </div>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="border-t p-4 bg-gray-50 flex gap-3">
              {selectedOnlineOrder.status === 'pending' && (
                <>
                  <button
                    onClick={() => { rejectOnlineOrder(selectedOnlineOrder.id); setSelectedOnlineOrder(null); }}
                    className="px-6 py-3 bg-red-100 text-red-600 rounded-xl font-medium hover:bg-red-200 transition"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => { acceptOnlineOrder(selectedOnlineOrder.id, 15); setSelectedOnlineOrder(null); }}
                    className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition"
                  >
                    Accept (15m)
                  </button>
                </>
              )}
              {selectedOnlineOrder.status === 'confirmed' && (
                <button
                  onClick={() => { updateOnlineOrderStatus(selectedOnlineOrder.id, 'preparing'); setSelectedOnlineOrder(null); }}
                  className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition"
                >
                  🍳 Start Preparing
                </button>
              )}
              {selectedOnlineOrder.status === 'preparing' && (
                <button
                  onClick={() => { updateOnlineOrderStatus(selectedOnlineOrder.id, 'ready'); setSelectedOnlineOrder(null); }}
                  className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition"
                >
                  ✓ Ready for Pickup
                </button>
              )}
              {selectedOnlineOrder.status === 'ready' && (
                <button
                  onClick={() => markAsPickedUp(selectedOnlineOrder.id)}
                  className="flex-1 py-3 bg-gray-600 text-white rounded-xl font-bold hover:bg-gray-700 transition"
                >
                  ✓ Picked Up
                </button>
              )}
              <button
                onClick={() => setSelectedOnlineOrder(null)}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Open Price Modal ==================== */}
      {showOpenPriceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div
            className="w-96 max-w-[95vw] overflow-hidden rounded-2xl border-0 p-5"
            style={{ ...PAY_NEO.modalShell, background: PAY_NEO_CANVAS }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-800">Open Price</h3>
              <button
                type="button"
                onClick={() => setShowOpenPriceModal(false)}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border-0 text-lg font-bold text-gray-700 touch-manipulation hover:brightness-[1.02] ${QSR_PAGE_MODAL_PAD_PRESS}`}
                style={PAY_NEO.raised}
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-800">Item Name</label>
                <div className="relative rounded-[14px] focus-within:ring-2 focus-within:ring-blue-400/50 focus-within:ring-offset-2 focus-within:ring-offset-[#e0e5ec]">
                  <div className="overflow-hidden rounded-[14px]" style={PAY_NEO.inset}>
                    <input
                      type="text"
                      value={openPriceName}
                      onChange={(e) => setOpenPriceName(e.target.value)}
                      className="h-12 w-full border-0 bg-transparent px-4 text-base text-gray-900 outline-none focus:ring-0"
                      placeholder="Enter item name"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-800">Price ($)</label>
                <div className="relative rounded-[14px] focus-within:ring-2 focus-within:ring-blue-400/50 focus-within:ring-offset-2 focus-within:ring-offset-[#e0e5ec]">
                  <div className="overflow-hidden rounded-[14px]" style={PAY_NEO.inset}>
                    <input
                      type="number"
                      step="0.01"
                      value={openPriceAmount}
                      onChange={(e) => setOpenPriceAmount(e.target.value)}
                      className="h-12 w-full border-0 bg-transparent px-4 text-base font-semibold text-gray-900 outline-none focus:ring-0"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOpenPriceModal(false)}
                  className={`flex-1 rounded-[14px] border-0 py-3 text-base font-semibold text-gray-900 touch-manipulation hover:brightness-[1.02] ${QSR_PAGE_MODAL_PAD_PRESS}`}
                  style={PAY_NEO.key}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOpenPrice}
                  className={`flex-1 rounded-[14px] border-0 py-3 text-base font-bold text-white touch-manipulation hover:brightness-[1.02] ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                  style={PAY_NEO_PRIMARY_BLUE}
                >
                  Add to Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Discount Modal ==================== */}
      {showDiscountModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-96 overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-4">
              <h3 className="text-white font-bold text-xl">Apply Discount</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setDiscountType('percent')}
                  className={`flex-1 py-3 rounded-xl font-medium transition ${
                    discountType === 'percent' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  % Percent
                </button>
                <button
                  onClick={() => setDiscountType('amount')}
                  className={`flex-1 py-3 rounded-xl font-medium transition ${
                    discountType === 'amount' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  $ Amount
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {discountType === 'percent' ? 'Discount %' : 'Discount Amount ($)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder={discountType === 'percent' ? '10' : '5.00'}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowDiscountModal(false); setDiscountValue(''); }}
                  className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyDiscount}
                  className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Kitchen Note Modal ==================== */}
      {showKitchenNoteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-96 overflow-hidden">
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4">
              <h3 className="text-white font-bold text-xl">Kitchen Note</h3>
            </div>
            <div className="p-6 space-y-4">
              <textarea
                value={kitchenNote}
                onChange={(e) => setKitchenNote(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 h-32 resize-none"
                placeholder="Enter note for kitchen..."
              />
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowKitchenNoteModal(false); setKitchenNote(''); }}
                  className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (kitchenNote.trim()) {
                      setSpecialInstruction(kitchenNote);
                      setNotification({ type: 'success', message: 'Kitchen note added' });
                    }
                    setShowKitchenNoteModal(false);
                    setKitchenNote('');
                  }}
                  className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Search Modal ==================== */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex max-h-[80vh] w-[500px] flex-col overflow-hidden border-0" style={PAY_NEO.modalShell}>
            <div className="px-5 py-3" style={{ ...PAY_NEO.raised, borderRadius: '16px 16px 0 0' }}>
              <h3 className="text-xl font-extrabold text-slate-800">Search Menu</h3>
            </div>
            <div className="border-0 p-4" style={{ background: PAY_NEO_CANVAS }}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="min-w-0 flex-1 rounded-[14px] border-0 px-4 py-3 text-gray-900 outline-none focus:ring-2 focus:ring-blue-400/50 focus:ring-offset-2 focus:ring-offset-[#e0e5ec]"
                  style={PAY_NEO.inset}
                  placeholder="Search items..."
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  className={`rounded-[14px] border-0 px-6 py-3 font-bold text-white touch-manipulation hover:brightness-[1.02] ${NEO_COLOR_BTN_PRESS_SNAP}`}
                  style={PAY_NEO_PRIMARY_BLUE}
                >
                  Search
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ background: PAY_NEO_CANVAS }}>
              {searchResults.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {searchResults.map(item => (
                    <button
                      type="button"
                      key={item.item_id}
                      onClick={() => {
                        handleItemClick(item);
                        setShowSearchModal(false);
                      }}
                      className={`rounded-[12px] border-0 p-3 text-left touch-manipulation hover:brightness-[1.02] ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
                      style={PAY_NEO.key}
                    >
                      <div className="font-medium text-gray-800">{item.name}</div>
                      <div className="text-sm text-gray-500">${item.price.toFixed(2)}</div>
                    </button>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="py-8 text-center text-gray-500">No items found</div>
              ) : (
                <div className="py-8 text-center text-gray-500">Enter search term</div>
              )}
            </div>
            <div className="border-0 p-4 pt-0" style={{ background: PAY_NEO_CANVAS }}>
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className={`w-full rounded-[14px] border-0 py-3 font-bold text-gray-700 touch-manipulation transition-[box-shadow,filter] duration-0 ease-out hover:brightness-[1.02] [-webkit-tap-highlight-color:transparent] active:!shadow-[inset_6px_6px_12px_#babecc,inset_-6px_-6px_12px_#ffffff] active:brightness-[0.92]`}
                style={PAY_NEO.inset}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Order History Modal ==================== */}
      {showOrderHistoryModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4 flex items-center justify-between">
              <h3 className="text-white font-bold text-xl">Order History</h3>
              <input
                type="date"
                value={orderHistoryDate}
                onChange={(e) => {
                  setOrderHistoryDate(e.target.value);
                  fetchOrderHistory(e.target.value);
                }}
                className="px-3 py-1.5 rounded-lg bg-white/20 text-white border border-white/30 focus:outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {orderHistoryList.length > 0 ? (
                <div className="space-y-2">
                  {orderHistoryList.map((order: any) => (
                    <div key={order.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-gray-800">#{order.order_number || order.id}</span>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          order.payment_status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {order.payment_status || 'PENDING'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        <span>{order.order_type || 'QSR'}</span>
                        <span className="mx-2">•</span>
                        <span>${parseFloat(order.total || 0).toFixed(2)}</span>
                        <span className="mx-2">•</span>
                        <span>{new Date(order.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-8">No orders found for this date</div>
              )}
            </div>
            <div className="p-4 border-t">
              <button
                onClick={() => setShowOrderHistoryModal(false)}
                className="w-full py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== Item Memo Modal with Keyboard ==================== */}
      {showItemMemoModal && (
        <div className="fixed inset-0 bg-black/60 flex flex-col z-50">
          {/* Modal at top */}
          <div className="flex-1 flex items-start justify-center pt-4">
            <div className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-3">
                <h3 className="text-white font-bold text-xl">Item Memo</h3>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Memo</label>
                  <textarea
                    value={itemMemo}
                    onChange={(e) => setItemMemo(e.target.value)}
                    onFocus={() => setActiveInputField('memo')}
                    className={`w-full px-4 py-2 border rounded-xl h-20 resize-none ${
                      activeInputField === 'memo' ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-300'
                    }`}
                    placeholder="Enter memo for this item..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Memo Price ($)</label>
                  <input
                    type="text"
                    value={itemMemoPrice}
                    onChange={(e) => setItemMemoPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    onFocus={() => setActiveInputField('memoPrice')}
                    className={`w-full px-4 py-2 border rounded-xl text-lg ${
                      activeInputField === 'memoPrice' ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-300'
                    }`}
                    placeholder="0.00"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => { setShowItemMemoModal(false); setItemMemo(''); setItemMemoPrice(''); setActiveInputField(null); }}
                    className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { handleSaveItemMemo(); setActiveInputField(null); }}
                    className="flex-1 py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Keyboard at bottom */}
          <div className="flex-shrink-0">
            <VirtualKeyboard
              open={true}
              showNumpad={true}
              displayText={activeInputField === 'memo' ? itemMemo : itemMemoPrice}
              onType={(key) => {
                if (activeInputField === 'memo') {
                  setItemMemo(prev => prev + key);
                } else if (activeInputField === 'memoPrice') {
                  setItemMemoPrice(prev => {
                    const next = prev + key;
                    return next.replace(/[^0-9.]/g, '');
                  });
                }
              }}
              onBackspace={() => {
                if (activeInputField === 'memo') {
                  setItemMemo(prev => prev.slice(0, -1));
                } else if (activeInputField === 'memoPrice') {
                  setItemMemoPrice(prev => prev.slice(0, -1));
                }
              }}
              onClear={() => {
                if (activeInputField === 'memo') {
                  setItemMemo('');
                } else if (activeInputField === 'memoPrice') {
                  setItemMemoPrice('');
                }
              }}
              onEnter={() => { handleSaveItemMemo(); setActiveInputField(null); }}
              onTab={() => setActiveInputField(activeInputField === 'memo' ? 'memoPrice' : 'memo')}
            />
          </div>
        </div>
      )}
      
      {/* ==================== Item Discount Modal with Keyboard ==================== */}
      {showItemDiscountModal && (() => {
        const selectedItem = cart.find(i => i.cartId === selectedCartItemId);
        const itemName = selectedItem?.name || 'Selected Item';
        const itemOriginalPrice = selectedItem ? (selectedItem.originalPrice || selectedItem.price) + (selectedItem.memo?.price || 0) : 0;
        const inputVal = Number(itemDiscountValue || '0');
        const discountAmount = itemDiscountType === 'percent' 
          ? (itemOriginalPrice * inputVal / 100) 
          : inputVal;
        const finalPrice = Math.max(0, itemOriginalPrice - discountAmount);
        const hasExistingDiscount = selectedItem?.discount;
        
        return (
          <div className="fixed inset-0 bg-black/60 flex flex-col z-50">
            <style>{`
              #qsr-item-discount-kb-scope div.flex.gap-2.justify-center.w-full > div.flex.flex-col.items-center {
                transform: scale(0.95);
                transform-origin: bottom center;
              }
              #qsr-item-discount-kb-scope div.flex.gap-2.justify-center.w-full > div.grid.grid-cols-3 {
                transform: scale(0.68);
                transform-origin: bottom center;
              }
            `}</style>
            {/* Modal at top */}
            <div className="flex-1 min-h-0 flex items-start justify-center pt-4 overflow-y-auto">
              <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden mt-[30px]">
                <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-[22.8px] py-[11.4px]">
                  <h3 className="text-white font-bold text-[1.1875rem]">Item Discount</h3>
                  <p className="text-orange-100 text-[13.3px]">{itemName}</p>
                </div>
                <div className="p-[15.2px] space-y-[11.4px]">
                  {/* Price Preview */}
                  <div className="bg-gray-50 rounded-xl p-[11.4px]">
                    <div className="flex justify-between text-[13.3px] text-gray-600 mb-[3.8px]">
                      <span>Original Price</span>
                      <span>${itemOriginalPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[13.3px] text-orange-600 mb-[3.8px]">
                      <span>Discount</span>
                      <span>-${discountAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[1.06875rem] font-bold text-gray-800 pt-[7.6px] border-t">
                      <span>Final Price</span>
                      <span>${finalPrice.toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-[7.6px]">
                    <button
                      onClick={() => setItemDiscountType('percent')}
                      className={`flex-1 py-[7.6px] rounded-xl font-medium transition text-[13.3px] ${
                        itemDiscountType === 'percent' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      % Percent
                    </button>
                    <button
                      onClick={() => setItemDiscountType('amount')}
                      className={`flex-1 py-[7.6px] rounded-xl font-medium transition text-[13.3px] ${
                        itemDiscountType === 'amount' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      $ Amount
                    </button>
                  </div>
                  
                  {/* Preset Discount Buttons */}
                  {itemDiscountType === 'percent' && (
                    <div className="grid grid-cols-6 gap-[5.7px]">
                      {[5, 10, 15, 20, 30, 45, 50, 60, 70, 80, 90, 100].map((pct) => (
                        <button
                          key={pct}
                          onClick={() => setItemDiscountValue(String(pct))}
                          className={`py-[7.6px] rounded-lg font-medium text-[13.3px] transition ${
                            itemDiscountValue === String(pct)
                              ? 'bg-orange-500 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-[13.3px] font-medium text-gray-700 mb-[3.8px]">
                      {itemDiscountType === 'percent' ? 'Discount %' : 'Discount Amount ($)'}
                    </label>
                    <input
                      type="text"
                      value={itemDiscountValue}
                      onChange={(e) => setItemDiscountValue(e.target.value.replace(/[^0-9.]/g, ''))}
                      onFocus={() => setActiveInputField('discount')}
                      className="w-full px-[15.2px] py-[11.4px] border border-orange-500 ring-2 ring-orange-500 rounded-xl text-[1.1875rem] text-center"
                      placeholder={itemDiscountType === 'percent' ? '10' : '5.00'}
                    />
                  </div>
                  <div className="flex gap-[11.4px] pt-[7.6px]">
                    <button
                      onClick={() => { setShowItemDiscountModal(false); setItemDiscountValue(''); setActiveInputField(null); }}
                      className="flex-1 py-[11.4px] bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition text-[13.3px]"
                    >
                      Cancel
                    </button>
                    {hasExistingDiscount && (
                      <button
                        onClick={() => { handleRemoveItemDiscount(); setActiveInputField(null); }}
                        className="flex-1 py-[11.4px] bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition text-[13.3px]"
                      >
                        Remove
                      </button>
                    )}
                    <button
                      onClick={() => { handleApplyItemDiscount(); setActiveInputField(null); }}
                      className="flex-1 py-[11.4px] bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition text-[13.3px]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Keyboard at bottom */}
            <div className="flex-shrink-0" id="qsr-item-discount-kb-scope">
              <VirtualKeyboard
                open={true}
                showNumpad={true}
                displayText={itemDiscountValue}
                onType={(key) => {
                  setItemDiscountValue(prev => {
                    const next = prev + key;
                    return next.replace(/[^0-9.]/g, '');
                  });
                }}
                onBackspace={() => setItemDiscountValue(prev => prev.slice(0, -1))}
                onClear={() => setItemDiscountValue('')}
                onEnter={() => { handleApplyItemDiscount(); setActiveInputField(null); }}
              />
            </div>
          </div>
        );
      })()}
      
      {/* ==================== Edit Price Modal with Keyboard ==================== */}
      {showEditPriceModal && (() => {
        const selectedItem = cart.find(i => i.cartId === selectedCartItemId);
        const itemName = selectedItem?.name || 'Selected Item';
        const currentPrice = selectedItem?.price || 0;
        
        return (
          <div className="fixed inset-0 bg-black/60 flex flex-col z-50">
            {/* Modal at top */}
            <div className="flex-1 flex items-start justify-center pt-4">
              <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden">
                <div className="bg-gradient-to-r from-green-500 to-green-600 px-6 py-3">
                  <h3 className="text-white font-bold text-xl">Edit Price</h3>
                  <p className="text-green-100 text-sm">{itemName}</p>
                </div>
                <div className="p-4 space-y-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Current Price</span>
                      <span>${currentPrice.toFixed(2)}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Price ($)</label>
                    <input
                      type="text"
                      value={editPriceValue}
                      onChange={(e) => setEditPriceValue(e.target.value.replace(/[^0-9.]/g, ''))}
                      onFocus={() => setActiveInputField('editPrice')}
                      className="w-full px-4 py-3 border border-green-500 ring-2 ring-green-500 rounded-xl text-xl text-center"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => { setShowEditPriceModal(false); setEditPriceValue(''); setActiveInputField(null); }}
                      className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-300 transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { handleSaveEditPrice(); setActiveInputField(null); }}
                      className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Keyboard at bottom */}
            <div className="flex-shrink-0">
              <VirtualKeyboard
                open={true}
                showNumpad={true}
                displayText={editPriceValue}
                onType={(key) => {
                  setEditPriceValue(prev => {
                    const next = prev + key;
                    return next.replace(/[^0-9.]/g, '');
                  });
                }}
                onBackspace={() => setEditPriceValue(prev => prev.slice(0, -1))}
                onClear={() => setEditPriceValue('')}
                onEnter={() => { handleSaveEditPrice(); setActiveInputField(null); }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default QsrPage;
