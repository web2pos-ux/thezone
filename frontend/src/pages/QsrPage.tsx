import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, ShoppingCart, Plus, Minus, X, Settings, RefreshCw,
  Check, Trash2, MessageSquare, CreditCard, DollarSign, Printer,
  Coffee, ShoppingBag, Car, Clock, User, Hash, Wifi, WifiOff, Bell, BellOff,
  ChevronRight, Phone, MapPin, AlertCircle, Volume2
} from 'lucide-react';
import { API_URL } from '../config/constants';

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
}

interface SetupConfig {
  deviceName: string;
  menuId: number;
  taxRate: number;
  configured: boolean;
}

type OrderType = 'counter' | 'togo' | 'pickup';

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
  
  // Config
  const [config, setConfig] = useState<SetupConfig | null>(null);
  
  // Order Type
  const [orderType, setOrderType] = useState<OrderType>('counter');
  const [customerName, setCustomerName] = useState('');
  
  // Data
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
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
      audioRef.current = new Audio('/sounds/new-order.mp3');
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
    return localStorage.getItem('firebaseRestaurantId');
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
          const pickupTime = new Date(Date.now() + prepMinutes * 60000).toISOString();
          
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
              const pickupTime = new Date(Date.now() + prepMinutes * 60000).toISOString();
              
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
      const pickupTime = new Date(Date.now() + prepTime * 60000).toISOString();
      
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
  
  // ==================== Data Loading ====================
  
  const loadOrderNumber = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
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
        setSelectedCategory(categoriesWithItems[0].category_id);
      }
      
    } catch (err) {
      console.error('Failed to load menu:', err);
      setNotification({ type: 'error', message: 'Failed to load menu' });
    } finally {
      setIsLoading(false);
    }
  };
  
  // ==================== Item & Modifier Handling ====================
  
  const handleItemClick = async (item: MenuItem) => {
    setSelectedItem(item);
    setItemQuantity(1);
    setSelectedModifiers([]);
    setSpecialInstruction('');
    setLoadingModifiers(true);
    setShowModifierModal(true);
    
    try {
      // Correct API path: /api/menu/items/:id/options
      const res = await fetch(`${API_URL}/menu/items/${item.item_id}/options`);
      if (res.ok) {
        const data = await res.json();
        // The API returns modifier_groups (not modifierGroups)
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
      // Calculate totals
      const subtotal = cartTotal;
      const tax = subtotal * ((config?.taxRate || 8.25) / 100);
      const total = subtotal + tax;
      
      // Create order
      const orderData = {
        store_id: 'default',
        table_id: `QSR-${orderNumber}`,
        table_label: `Order #${orderNumber}`,
        order_type: orderType === 'counter' ? 'DINE_IN' : 'TOGO',
        channel: 'QSR',
        customer_name: customerName || undefined,
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
        source: 'QSR'
      };
      
      // Submit to backend
      const orderRes = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
      
      if (!orderRes.ok) throw new Error('Failed to create order');
      
      const orderResult = await orderRes.json();
      
      // Print kitchen ticket
      try {
        await fetch(`${API_URL}/printers/print-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: orderResult.id || orderResult.order_id,
            orderInfo: {
              orderType: orderType === 'counter' ? 'DINE_IN' : 'TOGO',
              channel: 'QSR',
              table_label: `#${orderNumber}`,
              customer_name: customerName
            }
          })
        });
      } catch (printErr) {
        console.error('Kitchen print failed:', printErr);
      }
      
      // Show success
      setShowPaymentModal(false);
      setCompletedOrderNumber(orderNumber);
      setShowOrderComplete(true);
      
      // Clear cart and increment order number
      setCart([]);
      setCustomerName('');
      incrementOrderNumber();
      
    } catch (error) {
      console.error('Payment failed:', error);
      setNotification({ type: 'error', message: 'Payment failed. Please try again.' });
    } finally {
      setIsProcessing(false);
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
  
  const taxAmount = useMemo(() => {
    return cartTotal * ((config?.taxRate || 8.25) / 100);
  }, [cartTotal, config]);
  
  const grandTotal = useMemo(() => {
    return cartTotal + taxAmount;
  }, [cartTotal, taxAmount]);
  
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
    <div className="h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {notification.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
      
      {/* Left Side - Menu */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-gradient-to-r from-amber-600 to-orange-500 px-4 py-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/sales')}
              className="p-2 hover:bg-white/20 rounded-lg transition"
            >
              <ArrowLeft className="w-6 h-6 text-white" />
            </button>
            <div>
              <h1 className="text-white font-bold text-xl flex items-center gap-2">
                <Coffee className="w-6 h-6" />
                QSR / Café Mode
              </h1>
              <p className="text-amber-100 text-sm">{config.deviceName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Online Orders Button */}
            <button
              onClick={() => { setShowOnlinePanel(!showOnlinePanel); unlockAudio(); }}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                showOnlinePanel 
                  ? 'bg-white text-amber-600' 
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {sseConnected ? (
                <Wifi className="w-5 h-5" />
              ) : (
                <WifiOff className="w-5 h-5 opacity-50" />
              )}
              <span className="font-medium">Online</span>
              {onlineOrders.filter(o => o.status === 'pending').length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                  {onlineOrders.filter(o => o.status === 'pending').length}
                </span>
              )}
            </button>
            
            {/* Order Number Display */}
            <div className="bg-white/20 rounded-lg px-4 py-2 text-white">
              <span className="text-sm opacity-80">Next Order</span>
              <span className="ml-2 font-bold text-xl">#{orderNumber}</span>
            </div>
            
            <button
              onClick={() => navigate('/qsr-setup')}
              className="p-2 hover:bg-white/20 rounded-lg transition"
            >
              <Settings className="w-6 h-6 text-white" />
            </button>
          </div>
        </header>
        
        {/* Order Type Selector */}
        <div className="bg-white shadow-sm px-4 py-3 flex items-center gap-4">
          <span className="text-gray-500 font-medium">Order Type:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOrderType('counter')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition ${
                orderType === 'counter'
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Coffee className="w-5 h-5" />
              For Here
            </button>
            <button
              onClick={() => setOrderType('togo')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition ${
                orderType === 'togo'
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <ShoppingBag className="w-5 h-5" />
              To Go
            </button>
            <button
              onClick={() => setOrderType('pickup')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition ${
                orderType === 'pickup'
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Clock className="w-5 h-5" />
              Pickup
            </button>
          </div>
          
          {/* Customer Name Input */}
          <div className="ml-auto flex items-center gap-2">
            <User className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer Name (optional)"
              className="px-3 py-2 border border-gray-200 rounded-lg w-48 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>
        
        {/* Category Tabs */}
        <div className="bg-white shadow-sm overflow-x-auto flex-shrink-0 border-b">
          <div className="flex">
            {categories.map(cat => (
              <button
                key={cat.category_id}
                onClick={() => setSelectedCategory(cat.category_id)}
                className={`px-6 py-4 text-sm font-semibold whitespace-nowrap transition border-b-3 ${
                  selectedCategory === cat.category_id
                    ? 'text-amber-600 border-amber-500 bg-amber-50'
                    : 'text-gray-600 border-transparent hover:bg-gray-50'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
        
        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-4 gap-3">
            {currentItems.map(item => (
              <button
                key={item.item_id}
                onClick={() => handleItemClick(item)}
                className="bg-white rounded-xl p-4 shadow-md hover:shadow-lg transition active:scale-98 text-left border border-gray-100 group"
              >
                <h3 className="font-bold text-gray-800 text-base leading-tight line-clamp-2 min-h-[2.5rem] group-hover:text-amber-600 transition">
                  {item.short_name || item.name}
                </h3>
                <p className="text-amber-600 font-bold text-lg mt-2">${item.price.toFixed(2)}</p>
              </button>
            ))}
          </div>
          
          {currentItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <Coffee className="w-12 h-12 mb-2 opacity-30" />
              <p>No items in this category</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Right Side - Cart */}
      <div className="w-96 bg-white shadow-xl flex flex-col">
        
        {/* Online Orders Mini Bar (when panel is closed) */}
        {!showOnlinePanel && onlineOrders.length > 0 && (
          <div 
            onClick={() => setShowOnlinePanel(true)}
            className="bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-3 cursor-pointer hover:from-blue-600 hover:to-indigo-600 transition"
          >
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Wifi className={`w-5 h-5 ${sseConnected ? 'opacity-100' : 'opacity-50'}`} />
                <span className="font-semibold">Online Orders</span>
              </div>
              <div className="flex items-center gap-2">
                {onlineOrders.filter(o => o.status === 'pending').length > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                    {onlineOrders.filter(o => o.status === 'pending').length} NEW
                  </span>
                )}
                <span className="bg-white/20 text-white text-sm px-2 py-1 rounded">
                  {onlineOrders.length} total
                </span>
                <ChevronRight className="w-5 h-5" />
              </div>
            </div>
          </div>
        )}
        {/* Cart Header */}
        <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ShoppingCart className="w-6 h-6" />
            <span className="font-bold text-lg">Order #{orderNumber}</span>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="text-slate-300 hover:text-white text-sm flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
        
        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
              <ShoppingCart className="w-16 h-16 mb-4 opacity-30" />
              <p className="text-center">Tap items to add to order</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {cart.map(item => (
                <div key={item.cartId} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-800">{item.name}</h4>
                      {item.modifiers.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          {item.modifiers.map(m => m.name).join(', ')}
                        </p>
                      )}
                      {item.specialInstruction && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {item.specialInstruction}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => removeFromCart(item.cartId)}
                      className="p-1 hover:bg-red-100 rounded-lg text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateCartQuantity(item.cartId, -1)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg transition"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center font-bold">{item.quantity}</span>
                      <button
                        onClick={() => updateCartQuantity(item.cartId, 1)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg transition"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <span className="font-bold text-gray-800">
                      ${((item.price + item.modifiers.reduce((s, m) => s + m.price_adjustment, 0)) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Cart Summary & Pay Button */}
        <div className="border-t bg-gray-50 p-4">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>${cartTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Tax ({config.taxRate}%)</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold text-gray-800 pt-2 border-t">
              <span>Total</span>
              <span>${grandTotal.toFixed(2)}</span>
            </div>
          </div>
          
          <button
            onClick={handlePay}
            disabled={cart.length === 0}
            className={`w-full py-4 rounded-xl font-bold text-xl transition flex items-center justify-center gap-2 ${
              cart.length > 0
                ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <CreditCard className="w-6 h-6" />
            Pay ${grandTotal.toFixed(2)}
          </button>
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
      
      {/* ==================== Online Orders Panel ==================== */}
      {showOnlinePanel && (
        <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col">
          {/* Panel Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wifi className={`w-6 h-6 ${sseConnected ? 'text-green-300' : 'text-red-300'}`} />
              <h2 className="text-white font-bold text-xl">Online Orders</h2>
              {sseConnected && (
                <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-2 rounded-lg transition ${soundEnabled ? 'bg-white/20 text-white' : 'bg-white/10 text-white/50'}`}
                title={soundEnabled ? 'Sound ON' : 'Sound OFF'}
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
          
          {/* Accept Mode Toggle */}
          <div className="bg-gray-100 px-4 py-3 border-b flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">Accept Mode:</span>
            <div className="flex gap-2">
              <button
                onClick={() => saveOnlineSettings('auto', autoPrepTime, soundEnabled)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                  onlineAcceptMode === 'auto' 
                    ? 'bg-green-500 text-white' 
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                Auto
              </button>
              <button
                onClick={() => saveOnlineSettings('manual', autoPrepTime, soundEnabled)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                  onlineAcceptMode === 'manual' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                Manual
              </button>
            </div>
            {onlineAcceptMode === 'auto' && (
              <select
                value={autoPrepTime}
                onChange={(e) => saveOnlineSettings('auto', e.target.value, soundEnabled)}
                className="ml-2 px-2 py-1 text-sm border rounded-lg"
              >
                {['10m', '15m', '20m', '25m', '30m', '45m', '60m'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
          
          {/* Orders List */}
          <div className="flex-1 overflow-y-auto">
            {onlineOrders.length === 0 ? (
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
                    
                    {order.fullOrder?.items && (
                      <div className="text-xs text-gray-400 truncate">
                        {order.fullOrder.items.map(i => `${i.name} x${i.quantity}`).join(', ')}
                      </div>
                    )}
                    
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
                            className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition"
                          >
                            Accept (15m)
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); rejectOnlineOrder(order.id); }}
                            className="px-4 py-2 bg-red-100 text-red-600 rounded-lg text-sm font-medium hover:bg-red-200 transition"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {order.status === 'confirmed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateOnlineOrderStatus(order.id, 'preparing'); }}
                          className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition"
                        >
                          🍳 Start Preparing
                        </button>
                      )}
                      {order.status === 'preparing' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateOnlineOrderStatus(order.id, 'ready'); }}
                          className="flex-1 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition"
                        >
                          ✓ Ready for Pickup
                        </button>
                      )}
                      {order.status === 'ready' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markAsPickedUp(order.id); }}
                          className="flex-1 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition"
                        >
                          ✓ Picked Up
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Refresh Button */}
          <div className="p-3 border-t bg-gray-50">
            <button
              onClick={loadOnlineOrders}
              className="w-full py-2 text-gray-600 hover:text-blue-600 flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
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
    </div>
  );
};

export default QsrPage;
