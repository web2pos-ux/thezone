/*
 * =====================================================
 * MENU MANAGER - LOCKED FOR MODIFICATION
 * =====================================================
 * 
 * ⚠️  WARNING: DO NOT MODIFY THIS FILE
 * 
 * This file is part of the Menu Manager module which is
 * currently locked for modifications. Any changes to this
 * file or related Menu Manager components should be avoided
 * until the lock is explicitly removed.
 * 
 * Last modified: [Current Date]
 * Lock status: ACTIVE
 * 
 * =====================================================
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor, useDraggable, DragOverlay, useDroppable, useDndContext } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Settings, Receipt, Printer, Plus, ChevronDown, ChevronUp, GripVertical, Link, CheckCircle, X, Edit, Trash2, Save } from 'lucide-react';
import InvalidLinkBadge from '../components/InvalidLinkBadge';

import Header from '../components/Header';
import CategorySidebar from '../components/CategorySidebar';
import MenuItemList from '../components/MenuItemList';
import ModifierGroupManager, { ModifierGroupEditor } from '../components/ModifierGroupManager';
import TaxGroupManager, { TaxGroupEditor } from '../components/TaxGroupManager';
import PrinterGroupManager, { PrinterGroupEditor } from '../components/PrinterGroupManager';
import { Menu, Category, MenuItem, TaxGroup, PrinterGroup } from '../types';
import { getDarkerHexColor } from '../utils/colorUtils';

import { API_URL, API_BASE } from '../config/constants';

type TabName = 'modifier' | 'tax' | 'printer';

const MenuEditPage = () => {
  const { menuId } = useParams<{ menuId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [currentMenu, setCurrentMenu] = useState<Menu | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>('modifier');
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  // State for unified drag and drop
  const [modifierGroups, setModifierGroups] = useState<any[]>([]);
  const [taxGroups, setTaxGroups] = useState<any[]>([]);
  const [printerGroups, setPrinterGroups] = useState<any[]>([]);
  const [categoryConnections, setCategoryConnections] = useState<Map<number, any[]>>(new Map());
  const [itemModifierConnections, setItemModifierConnections] = useState<Map<number, any[]>>(new Map());
  const [categoryTaxConnections, setCategoryTaxConnections] = useState<Map<number, any[]>>(new Map());
  const [itemTaxConnections, setItemTaxConnections] = useState<Map<number, any[]>>(new Map());
  const [categoryPrinterConnections, setCategoryPrinterConnections] = useState<Map<number, any[]>>(new Map());
  const [itemPrinterConnections, setItemPrinterConnections] = useState<Map<number, any[]>>(new Map());
  const [isDragMode, setIsDragMode] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragData, setActiveDragData] = useState<any>(null);

  // Modifier Group management state
  const [editingModifierGroup, setEditingModifierGroup] = useState<any>(null);
  const [isSavingModifier, setIsSavingModifier] = useState(false);

  // Tax Group management state
  const [editingTaxGroup, setEditingTaxGroup] = useState<any>(null);
  const [isSavingTax, setIsSavingTax] = useState(false);

  // Printer Group management state
  const [editingPrinterGroup, setEditingPrinterGroup] = useState<any | 'new' | null>(null);
  const [isSavingPrinter, setIsSavingPrinter] = useState(false);

  // State for hover effect
  const [hoveredOptionId, setHoveredOptionId] = useState<string | null>(null);

  // Base color state for theming
  const [baseColor, setBaseColor] = useState<string>(() => {
    try { return localStorage.getItem('menu_layer_base_color') || '#3b82f6'; } catch { return '#3b82f6'; }
  });
  useEffect(() => {
    try { localStorage.setItem('menu_layer_base_color', baseColor); } catch {}
  }, [baseColor]);
  const darkerColor = useMemo(() => getDarkerHexColor(baseColor), [baseColor]);
  
  // Modifier group expanded/collapsed state
  const [expandedModifierGroups, setExpandedModifierGroups] = useState<Set<number>>(new Set());
  
  // Tax group expanded/collapsed state
  const [expandedTaxGroups, setExpandedTaxGroups] = useState<Set<number>>(new Set());
  
  // Printer group expanded/collapsed state
  const [expandedPrinterGroups, setExpandedPrinterGroups] = useState<Set<number>>(new Set());
  
  // Sidebar collapsed state (shared from BackOfficeLayout)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('backoffice_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    const handleStorageChange = () => {
      const collapsed = localStorage.getItem('backoffice_sidebar_collapsed') === '1';
      setSidebarCollapsed(collapsed);
    };
    window.addEventListener('storage', handleStorageChange);
    // Check periodically for same-window updates
    const interval = setInterval(handleStorageChange, 200);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);
  
  // Group ID to keep highlight effect
  const [persistentHighlight, setPersistentHighlight] = useState<{type: string, groupId: number} | null>(null);

  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>([]);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemData, setNewItemData] = useState({
    name: '',
    short_name: '',
    description: '',
    price: 0,
    price2: 0
  });
  const [showInlineForm, setShowInlineForm] = useState<number | null>(null);
  const [inlineFormData, setInlineFormData] = useState({
    name: '',
    short_name: '',
    description: '',
    price: 0,
    price2: 0
  });

  // Expanded/collapsed state management
  const [collapsedCategories, setCollapsedCategories] = useState<Set<number>>(new Set());

  // Category addition inline form state
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Category editing state
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  // Export/Import state
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStep, setImportStep] = useState('');
  
  // Save state
  const [isSaving, setIsSaving] = useState(false);

  // Backup state
  const [backups, setBackups] = useState<any[]>([]);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [itemOptions, setItemOptions] = useState<Map<number, any>>(new Map());

  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'modifier' | 'tax' | 'printer';
    group: any;
    connectedCategories: any[];
    connectedItems: any[];
  } | null>(null);
  
  // Tooltip state
  const [tooltipState, setTooltipState] = useState<{
    isVisible: boolean;
    type: 'modifier' | 'tax' | 'printer' | null;
    groupId: number | null;
    position: { x: number; y: number };
  }>({
    isVisible: false,
    type: null,
    groupId: null,
    position: { x: 0, y: 0 }
  });
  
  // State for highlighted elements
  const [highlightedElements, setHighlightedElements] = useState<{
    categories: number[];
    items: number[];
  }>({
    categories: [],
    items: []
  });

  // Refs for scroll/focus to recently created elements
  const categoryNodeRefs = useRef<{ [key: number]: HTMLElement | null }>({});
  const itemNodeRefs = useRef<{ [key: number]: HTMLElement | null }>({});
  const lastCreatedRef = useRef<{ type: 'category' | 'item'; id: number } | null>(null);

  // Track current drag type and Shift press to support category-only dropping and visual cues
  const [currentDragType, setCurrentDragType] = useState<string | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
  const isDragRelevantForCategory = useMemo(() => {
    return currentDragType === 'modifier' || currentDragType === 'tax' || currentDragType === 'printer';
  }, [currentDragType]);
  const categoryOnlyDrop = useMemo(() => isDragRelevantForCategory && isShiftPressed, [isDragRelevantForCategory, isShiftPressed]);

  const toggleCategoryCollapse = (categoryId: number) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  useEffect(() => {
    if (!menuId) return;
    
    fetch(`${API_URL}/menus/${menuId}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((menu: Menu) => {
        setCurrentMenu(menu);
      })
      .catch(err => {
        console.error("Failed to fetch menu:", err)
        navigate('/backoffice/menu');
      });
    
    // Load backup list
    loadBackups();
  }, [menuId, navigate]);

  useEffect(() => {
    if (!menuId) return;
    
    const loadCategoriesAndMaybeItems = async () => {
      try {
        // Prefer direct categories endpoint
        const catRes = await fetch(`${API_URL}/menu/categories?menu_id=${menuId}`);
        if (catRes.ok) {
          const cats: any[] = await catRes.json();
          const mappedCategories = cats.map(c => ({ ...c, id: c.category_id }));
          setCategories(mappedCategories);
          // Collapse all categories by default
          setCollapsedCategories(new Set(mappedCategories.map(c => c.id)));
          if (mappedCategories.length > 0 && selectedCategoryId === null) {
            setSelectedCategoryId(mappedCategories[0].id);
          }
          return;
        }
        // Fallback to structure endpoint
        const res = await fetch(`${API_URL}/menus/${menuId}/structure`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data: any[] = await res.json();
        const mappedCategories = data.map(c => ({ ...c, id: c.category_id }));
        setCategories(mappedCategories);
        // Collapse all categories by default for fallback
        setCollapsedCategories(new Set(mappedCategories.map(c => c.id)));
        // collect items from structure as fallback
        const allItems: MenuItem[] = [];
        data.forEach(category => {
          if (category.items && Array.isArray(category.items)) {
            category.items.forEach((item: any) => {
              allItems.push({
                ...item,
                id: item.item_id,
                category_id: category.category_id
              });
            });
          }
        });
        setMenuItems(allItems);
        setAllMenuItems(allItems);
        if (mappedCategories.length > 0 && selectedCategoryId === null) {
          setSelectedCategoryId(mappedCategories[0].id);
        }
      } catch (err) {
        console.error('Failed to load categories/items:', err);
      }
    };

    loadCategoriesAndMaybeItems();
  }, [menuId, selectedCategoryId]);

  // Auto-open New Item inline form when navigated with ?autoNewItem=1
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shouldAutoOpen = params.get('autoNewItem') === '1';
    if (!shouldAutoOpen) return;
    // choose first category if none selected yet
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
      setShowInlineForm(categories[0].id);
      setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
      // focus the first inline input on next tick
      setTimeout(() => {
        const input = document.querySelector('input[name="name"]') as HTMLInputElement | null;
        input?.focus();
      }, 0);
    } else if (selectedCategoryId) {
      setShowInlineForm(selectedCategoryId);
      setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
      setTimeout(() => {
        const input = document.querySelector('input[name="name"]') as HTMLInputElement | null;
        input?.focus();
      }, 0);
    }
  }, [location.search, categories, selectedCategoryId]);

  // Load modifier groups
  useEffect(() => {
    const loadModifierGroups = async () => {
      try {
        console.log('🔄 Loading modifier groups for menuId:', menuId);
        const url = `${API_URL}/modifier-groups${menuId ? `?menu_id=${menuId}` : ''}`;
        console.log('Request URL:', url);
        
        const response = await fetch(url);
        console.log('Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Loaded modifier groups:', data);
          const normalized = (Array.isArray(data) ? data : []).map((g: any) => ({
            ...g,
            min_selection: g.min_selection ?? g.min_selections ?? 0,
            max_selection: g.max_selection ?? g.max_selections ?? 0,
          }));
          setModifierGroups(normalized);
        } else {
          console.error('❌ Failed to load modifier groups, status:', response.status);
          const errorText = await response.text();
          console.error('Error response:', errorText);
        }
      } catch (error) {
        console.error('❌ Failed to load modifier groups:', error);
      }
    };

    if (menuId) {
    loadModifierGroups();
    }
  }, [menuId]);

  // Load Tax Groups (uses Tax Groups created in Tax Settings)
  useEffect(() => {
    const loadTaxGroups = async () => {
      try {
        // Get Tax Groups made in Tax Settings
        const response = await fetch(`${API_URL}/tax-groups`);
        if (response.ok) {
          const data = await response.json();
          console.log('Loaded tax groups from Tax Settings:', data);
          setTaxGroups(data);
        }
      } catch (error) {
        console.error('Failed to load tax groups:', error);
      }
    };

    loadTaxGroups();
  }, []);

  // Load Printer Groups (uses Printer Groups created in Printer Settings)
  useEffect(() => {
    const loadPrinterGroups = async () => {
      try {
        // Get Printer Groups made in Printer Settings
        const response = await fetch(`${API_URL}/printers/groups`);
        if (response.ok) {
          const data = await response.json();
          console.log('Loaded printer groups from Printer Settings:', data);
          setPrinterGroups(data);
        }
      } catch (error) {
        console.error('Failed to load printer groups:', error);
      }
    };

    loadPrinterGroups();
  }, []);

  // Load modifier connections per category
  const loadCategoryConnections = async () => {
    if (!categories.length) return;

    console.log('🔄 Starting loadCategoryConnections...');
    console.log('Categories:', categories.map(c => ({ id: c.category_id, name: c.name })));
    
    const connectionsMap = new Map<number, any[]>();
    
    for (const category of categories) {
      try {
        console.log(`Fetching modifier connections for category ${category.category_id} (${category.name})`);
        const response = await fetch(`${API_URL}/menu/categories/${category.category_id}/modifiers`);
        console.log(`Category ${category.category_id} modifier response status:`, response.status);
        
        if (response.ok) {
          const connections = await response.json();
          console.log(`Category ${category.category_id} modifier connections:`, connections);
          connectionsMap.set(category.category_id, connections);
        } else {
          console.log(`Category ${category.category_id} has no modifier connections (status: ${response.status})`);
          connectionsMap.set(category.category_id, []);
        }
      } catch (error) {
        console.error(`Failed to load modifier connections for category ${category.category_id}:`, error);
        connectionsMap.set(category.category_id, []);
      }
    }
    
    console.log('Final category modifier connections map:', connectionsMap);
    setCategoryConnections(new Map(connectionsMap));
    console.log('✅ loadCategoryConnections completed');
  };

  // Load tax connections per category
  const loadCategoryTaxConnections = async () => {
    if (!categories.length) return;

    console.log('🔄 Starting loadCategoryTaxConnections...');
    console.log('Categories:', categories.map(c => ({ id: c.category_id, name: c.name })));
    
    const connectionsMap = new Map<number, any[]>();
    
    for (const category of categories) {
      try {
        console.log(`Fetching tax connections for category ${category.category_id} (${category.name})`);
        const response = await fetch(`${API_URL}/menu/categories/${category.category_id}/taxes`);
        console.log(`Category ${category.category_id} tax response status:`, response.status);
        
        if (response.ok) {
          const connections = await response.json();
          console.log(`Category ${category.category_id} tax connections:`, connections);
          connectionsMap.set(category.category_id, connections);
        } else {
          console.log(`Category ${category.category_id} has no tax connections (status: ${response.status})`);
          connectionsMap.set(category.category_id, []);
        }
      } catch (error) {
        console.error(`Failed to load tax connections for category ${category.category_id}:`, error);
        connectionsMap.set(category.category_id, []);
      }
    }
    
    console.log('Final category tax connections map:', connectionsMap);
    setCategoryTaxConnections(new Map(connectionsMap));
    console.log('✅ loadCategoryTaxConnections completed');
  };

  // Load printer connections per category
  const loadCategoryPrinterConnections = async () => {
    if (!categories.length) return;

    console.log('🔄 Starting loadCategoryPrinterConnections...');
    console.log('Categories:', categories.map(c => ({ id: c.category_id, name: c.name })));
    
    const connectionsMap = new Map<number, any[]>();
    
    for (const category of categories) {
      try {
        console.log(`Fetching printer connections for category ${category.category_id} (${category.name})`);
        const response = await fetch(`${API_URL}/menu/categories/${category.category_id}/printers`);
        console.log(`Category ${category.category_id} printer response status:`, response.status);
        
        if (response.ok) {
          const connections = await response.json();
          console.log(`Category ${category.category_id} printer connections:`, connections);
          connectionsMap.set(category.category_id, connections);
        } else {
          console.log(`Category ${category.category_id} has no printer connections (status: ${response.status})`);
          connectionsMap.set(category.category_id, []);
        }
      } catch (error) {
        console.error(`Failed to load printer connections for category ${category.category_id}:`, error);
        connectionsMap.set(category.category_id, []);
      }
    }
    
    console.log('Final category printer connections map:', connectionsMap);
    setCategoryPrinterConnections(new Map(connectionsMap));
    console.log('✅ loadCategoryPrinterConnections completed');
  };

  // Load modifier connections per category
  useEffect(() => {
    loadCategoryConnections();
  }, [categories]);

  // Load tax connections per category
  useEffect(() => {
    loadCategoryTaxConnections();
  }, [categories]);

  // Load printer connections per category
  useEffect(() => {
    loadCategoryPrinterConnections();
  }, [categories]);

  // Function to load connections per menu item
  const loadItemConnections = async () => {
    console.log('🔄 Starting loadItemConnections...');
    console.log('All menu items:', allMenuItems);
    
    if (!allMenuItems.length) {
      console.log('No menu items available, skipping load');
      return;
    }

    console.log('Loading item connections for items:', allMenuItems.map(i => ({ id: i.id, name: i.name })));
    const connectionsMap = new Map<number, any[]>();
    const taxConnectionsMap = new Map<number, any[]>();
    const printerConnectionsMap = new Map<number, any[]>();
    
    for (const item of allMenuItems) {
      const itemId = Number(item.id);
      try {
        console.log(`Fetching connections for item ${itemId} (${item.name})`);
        const response = await fetch(`${API_URL}/menu/items/${itemId}/options`);
        if (response.ok) {
          const data = await response.json();
          console.log(`Item ${itemId} connections data:`, data);
          connectionsMap.set(itemId, data.modifier_groups || []);
          taxConnectionsMap.set(itemId, data.tax_groups || []);
          printerConnectionsMap.set(itemId, data.printer_groups || []);
          
          // Check Wakame item
          if (item.name === 'Wakame') {
            console.log('=== Checking Wakame connection status ===');
            console.log('Wakame item ID:', item.id);
            console.log('Wakame modifier connections:', data.modifier_groups || []);
            console.log('Wakame tax connections:', data.tax_groups || []);
            console.log('Wakame printer connections:', data.printer_groups || []);
            console.log('Total connections:', {
              modifiers: (data.modifier_groups || []).length,
              taxes: (data.tax_groups || []).length,
              printers: (data.printer_groups || []).length
            });
            console.log('========================');
          }
          } else {
          console.log(`Item ${itemId} has no connections (status: ${response.status})`);
          connectionsMap.set(itemId, []);
          taxConnectionsMap.set(itemId, []);
          printerConnectionsMap.set(itemId, []);
        }
      } catch (error) {
        console.error(`Failed to load connections for item ${itemId}:`, error);
        connectionsMap.set(itemId, []);
        taxConnectionsMap.set(itemId, []);
        printerConnectionsMap.set(itemId, []);
      }
    }
    
    console.log('Final connections map:', connectionsMap);
    console.log('Final tax connections map:', taxConnectionsMap);
    console.log('Final printer connections map:', printerConnectionsMap);
    
    setItemModifierConnections(new Map(connectionsMap));
    setItemTaxConnections(new Map(taxConnectionsMap));
    setItemPrinterConnections(new Map(printerConnectionsMap));
    
    // Also save item option info
    const optionsMap = new Map<number, any>();
    for (const item of allMenuItems) {
      const itemId = Number(item.id);
      const modifierGroups = connectionsMap.get(itemId) || [];
      const taxGroups = taxConnectionsMap.get(itemId) || [];
      const printerGroups = printerConnectionsMap.get(itemId) || [];
      
      optionsMap.set(itemId, {
        modifier_groups: modifierGroups,
        tax_groups: taxGroups,
        printer_groups: printerGroups
      });
    }
    setItemOptions(new Map(optionsMap));
    
    console.log('✅ loadItemConnections completed');
  };

  // Load connections per menu item
  useEffect(() => {
    loadItemConnections();
  }, [allMenuItems]);

  // Fetch all menu items at once
  useEffect(() => {
    if (!menuId || categories.length === 0) return;
    
    // Fetch all items of all categories in parallel
    const fetchPromises = categories.map(category => 
      fetch(`${API_URL}/menu/items?categoryId=${category.id}`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          return res.json();
        })
        .then((data: any[]) => data.map(i => ({ ...i, id: i.item_id, item_id: undefined })))
        .catch(err => {
          console.error(`Failed to fetch items for category ${category.id}:`, err);
          return [];
        })
    );
    
    Promise.all(fetchPromises)
      .then(results => {
        const allItems = results.flat();
        setAllMenuItems(allItems);
      })
      .catch(err => console.error("Failed to fetch all menu items:", err));
  }, [menuId, categories]);

  // Filter items of selected category only
  useEffect(() => {
    if (selectedCategoryId === null) {
      setMenuItems([]);
      return;
    }
    const filteredItems = allMenuItems.filter(item => item.category_id === selectedCategoryId);
    setMenuItems(filteredItems);
  }, [selectedCategoryId, allMenuItems]);

  const sensors = useSensors(useSensor(PointerSensor, { 
    activationConstraint: { 
      distance: 5,
    } 
  }));

  const handleDragStart = (event: any) => {
    const { active } = event;
    console.log('Drag started:', active.id, active.data.current);
    setActiveDragId(active.id);
    setActiveDragData(active.data.current);
    try { setCurrentDragType(active?.data?.current?.type || null); } catch {}
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    setActiveDragData(null);
    setCurrentDragType(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    console.log('=== DRAG END EVENT ===');
    console.log('Active ID:', active.id);
    console.log('Over ID:', over?.id);
    console.log('Active data:', active.data.current);
    console.log('Over data:', over?.data.current);
    
    // Reset drag state
    setActiveDragId(null);
    setActiveDragData(null);
    setCurrentDragType(null);
    
    if (!over) {
      console.log('No drop target, returning');
      return;
    }
    
    const activeId = String(active.id);
    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    console.log('Active ID (string):', activeId);
    console.log('Active type:', activeType);
    console.log('Over type:', overType);

    // Connect modifier group to category
    if (activeId.startsWith('modifier-') && overType === 'category') {
      const modifierGroupId = parseInt(activeId.replace('modifier-', ''));
      // Robustly derive categoryId from droppable data or id (supports header strip ids)
      const overData: any = over.data && over.data.current ? over.data.current : {};
      const overCategory: any = overData.category || {};
      let categoryId = overCategory.category_id || overCategory.id;
      if (!categoryId) {
        const overIdStr = String(over.id || '');
        const cleaned = overIdStr.replace(/^cat-strip-/, '');
        const parsed = parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) categoryId = parsed;
      }
      if (!categoryId) {
        console.warn('Could not resolve categoryId from drop target; aborting connect.', { over });
        return;
      }
      
      console.log('✅ Connecting modifier to category:', { activeId, modifierGroupId, categoryId, overId: over.id });
      await connectModifierToCategory(categoryId, modifierGroupId);
    }
    // Connect modifier group to menu item
    else if (activeId.startsWith('modifier-') && overType === 'item') {
      const modifierGroupId = parseInt(activeId.replace('modifier-', ''));
      
      const overData: any = over.data && over.data.current ? over.data.current : {};
      const overItem: any = overData.item || {};
      let itemId = Number(overItem.id || overItem.item_id);
      
      if (!itemId || !Number.isFinite(itemId)) {
        const overIdStr = String(over.id || '');
        const cleaned = overIdStr.replace(/^item-/, '');
        const parsed = parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) itemId = parsed;
      }

      if (!itemId || !Number.isFinite(itemId)) {
        console.warn('Could not resolve itemId for modifier drop; aborting.', { over });
        return;
      }
      
      console.log('✅ Connecting modifier to item:', { activeId, modifierGroupId, itemId, overId: over.id });
      await connectModifierToItem(itemId, modifierGroupId);
    }
    // Connect Tax Group to category
    else if (activeId.startsWith('tax-') && overType === 'category') {
      const taxGroupId = parseInt(activeId.replace('tax-', ''));
      // robust category id resolution (supports header strip)
      const overData: any = over.data && over.data.current ? over.data.current : {};
      const overCategory: any = overData.category || {};
      let categoryId = overCategory.category_id || overCategory.id;
      if (!categoryId) {
        const overIdStr = String(over.id || '');
        const cleaned = overIdStr.replace(/^cat-strip-/, '').replace(/^category-/, '');
        const parsed = parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) categoryId = parsed;
      }
      if (!categoryId) {
        console.warn('Could not resolve categoryId for tax drop; aborting.', { over });
        return;
      }
      
      console.log('Drag drop detected (category tax):', { activeId, taxGroupId, categoryId, overId: over.id });
      await connectTaxToCategory(categoryId, taxGroupId);
    }
    // Connect Tax Group to menu item
    else if (activeId.startsWith('tax-') && overType === 'item') {
      const taxGroupId = parseInt(activeId.replace('tax-', ''));
      
      const overData: any = over.data && over.data.current ? over.data.current : {};
      const overItem: any = overData.item || {};
      let itemId = Number(overItem.id || overItem.item_id);
      
      if (!itemId || !Number.isFinite(itemId)) {
        const overIdStr = String(over.id || '');
        const cleaned = overIdStr.replace(/^item-/, '');
        const parsed = parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) itemId = parsed;
      }

      if (!itemId || !Number.isFinite(itemId)) {
        console.warn('Could not resolve itemId for tax drop; aborting.', { over });
        return;
      }
      
      console.log('Drag drop detected (item tax):', { activeId, taxGroupId, itemId, overId: over.id });
      await connectTaxToItem(itemId, taxGroupId);
    }
    // Connect Printer Group to category
    else if (activeId.startsWith('printer-') && overType === 'category') {
      const printerGroupId = parseInt(activeId.replace('printer-', ''));
      // robust category id resolution (supports header strip)
      const overData: any = over.data && over.data.current ? over.data.current : {};
      const overCategory: any = overData.category || {};
      let categoryId = overCategory.category_id || overCategory.id;
      if (!categoryId) {
        const overIdStr = String(over.id || '');
        const cleaned = overIdStr.replace(/^cat-strip-/, '').replace(/^category-/, '');
        const parsed = parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) categoryId = parsed;
      }
      if (!categoryId) {
        console.warn('Could not resolve categoryId for printer drop; aborting.', { over });
        return;
      }
      
      console.log('Drag drop detected (category printer):', { activeId, printerGroupId, categoryId, overId: over.id });
      await connectPrinterToCategory(categoryId, printerGroupId);
    }
    // Connect Printer Group to menu item
    else if (activeId.startsWith('printer-') && overType === 'item') {
      const printerGroupId = parseInt(activeId.replace('printer-', ''));
      
      const overData: any = over.data && over.data.current ? over.data.current : {};
      const overItem: any = overData.item || {};
      let itemId = Number(overItem.id || overItem.item_id);
      
      if (!itemId || !Number.isFinite(itemId)) {
        const overIdStr = String(over.id || '');
        const cleaned = overIdStr.replace(/^item-/, '');
        const parsed = parseInt(cleaned, 10);
        if (Number.isFinite(parsed)) itemId = parsed;
      }

      if (!itemId || !Number.isFinite(itemId)) {
        console.warn('Could not resolve itemId for printer drop; aborting.', { over });
        return;
      }
      
      console.log('Drag drop detected (item printer):', { activeId, printerGroupId, itemId, overId: over.id });
      await connectPrinterToItem(itemId, printerGroupId);
    }
    // Move items between categories
    else if (activeType === 'item' && overType === 'category') {
      const itemId = parseInt(activeId);
      const targetCategoryId = parseInt(over.id as string);
      
      // Update item's category
      setAllMenuItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, category_id: targetCategoryId } : item
      ));
    }
    // 카테고리 순서 변경
    else if (activeType === 'category' && overType === 'category' && active.id !== over.id) {
      const oldIndex = categories.findIndex((item) => item.id === active.id);
      const newIndex = categories.findIndex((item) => item.id === over.id);
      
      // Update local state
      const newCategories = arrayMove(categories, oldIndex, newIndex);
      setCategories(newCategories);
      
      // Save order to database
      try {
        const categoryOrder = newCategories.map((category, index) => ({
          category_id: category.id,
          sort_order: index + 1
        }));
        
        const response = await fetch(`${API_URL}/menu/categories/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryOrder })
        });
        
        if (!response.ok) {
          throw new Error('Failed to save category order');
        }
        
        console.log('✅ Category order saved successfully');
      } catch (error) {
        console.error('Failed to save category order:', error);
        // Revert to original order if save fails
        setCategories(categories);
        alert('Failed to save category order. Please try again.');
      }
    } 
    // 아이템 순서 변경
    else if (activeType === 'item' && overType === 'item' && active.id !== over.id) {
      setMenuItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
      // Also change order of this category's items in allMenuItems
      setAllMenuItems((prev) => {
        // current category id
        const currentCategoryId = selectedCategoryId;
        if (!currentCategoryId) return prev;
        // extract items of this category only
        const categoryItems = prev.filter(item => item.category_id === currentCategoryId);
        const otherItems = prev.filter(item => item.category_id !== currentCategoryId);
        const oldIndex = categoryItems.findIndex((item) => item.id === active.id);
        const newIndex = categoryItems.findIndex((item) => item.id === over.id);
        const newCategoryItems = arrayMove(categoryItems, oldIndex, newIndex);
        // Merge after changing order of category items only
        return [
          ...otherItems,
          ...newCategoryItems
        ];
      });
    }
  };

  // Connect modifier to category
  const connectModifierToCategory = async (categoryId: number, modifierGroupId: number) => {
    console.log('Connecting modifier:', { categoryId, modifierGroupId });
    
    try {
      const requestBody = { modifier_group_id: modifierGroupId };
      console.log('Request body:', requestBody);
      console.log('Request URL:', `${API_URL}/menu/categories/${categoryId}/modifiers`);
      
      const response = await fetch(`${API_URL}/menu/categories/${categoryId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        const data = JSON.parse(responseText);
        console.log('✅ Category connection successful with inheritance:', data);
        
        // Inheritance info is shown only in console (removed popup)
        if (data.inherited_items > 0) {
          console.log(`Linked to category! Inherited menu items: ${data.inherited_items}, Total menu items: ${data.total_items}`);
        } else {
          console.log('Linked to category!');
        }
        
        // Reload actual data from backend
        try {
        console.log('Loading category connections after successful connection...');
          await Promise.all([
            loadCategoryConnections(),
            loadItemConnections() // Refresh all item connections
          ]);
        console.log('Connection successful and data reloaded');
        } catch (error) {
          console.error('Failed to refresh connections after successful API call:', error);
          // API call was successful, so ignore error and continue
        }
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        console.error('Connection failed:', errorMessage);
        alert(`Connection failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to connect modifier:', error);
      alert('An error occurred during connection.');
    }
  };

  // Unlink modifier
  const disconnectModifierFromCategory = async (categoryId: number, modifierGroupId: number) => {
    try {
      console.log('🔗 Disconnecting modifier from category:', { categoryId, modifierGroupId });
      const url = `${API_URL}/menu/categories/${categoryId}/modifiers/${modifierGroupId}`;
      console.log('URL:', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
      });
      
      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

              if (response.ok) {
        // Reload actual data from backend
        await loadCategoryConnections();
              } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        alert(`Unlink failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to disconnect modifier:', error);
      alert('An error occurred during unlinking.');
    }
  };

  // Unlink tax
  const disconnectTaxFromCategory = async (categoryId: number, taxGroupId: number) => {
    try {
      console.log('🔗 Disconnecting tax from category:', { categoryId, taxGroupId });
      const url = `${API_URL}/menu/categories/${categoryId}/taxes/${taxGroupId}`;
      console.log('URL:', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
      });
      
      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

              if (response.ok) {
        await loadCategoryTaxConnections();
              } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        alert(`Tax unlink failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to disconnect tax:', error);
      alert('An error occurred during tax unlinking.');
    }
  };

  // Unlink printer
  const disconnectPrinterFromCategory = async (categoryId: number, printerGroupId: number) => {
    try {
      console.log('🔗 Disconnecting printer from category:', { categoryId, printerGroupId });
      const url = `${API_URL}/menu/categories/${categoryId}/printers/${printerGroupId}`;
      console.log('URL:', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        await loadCategoryPrinterConnections();
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        alert(`Printer unlink failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to disconnect printer:', error);
      alert('An error occurred during printer unlinking.');
    }
  };

  // Unlink modifier from item
  const disconnectModifierFromItem = async (itemId: number, modifierGroupId: number) => {
    try {
      const response = await fetch(`${API_URL}/menu/items/${itemId}/options/modifier/${modifierGroupId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        await loadItemConnections();
      } else {
        const error = await response.json();
        alert(`Modifier unlink failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to disconnect modifier from item:', error);
      alert('An error occurred during modifier unlinking.');
    }
  };

  // Unlink tax from item
  const disconnectTaxFromItem = async (itemId: number, taxGroupId: number) => {
    try {
      const response = await fetch(`${API_URL}/menu/items/${itemId}/options/tax/${taxGroupId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        await loadItemConnections();
      } else {
        const error = await response.json();
        alert(`Tax unlink failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to disconnect tax from item:', error);
      alert('An error occurred during tax unlinking.');
    }
  };

  // Unlink printer from item
  const disconnectPrinterFromItem = async (itemId: number, printerGroupId: number) => {
    try {
      console.log('🔗 Disconnecting printer from item:', { itemId, printerGroupId });
      const url = `${API_URL}/menu/items/${itemId}/options/printer/${printerGroupId}`;
      console.log('URL:', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        await loadItemConnections();
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        alert(`Printer unlink failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to disconnect printer from item:', error);
      alert('An error occurred during printer unlinking.');
    }
  };

  // Connect modifier to menu item
  const connectModifierToItem = async (itemId: number, modifierGroupId: number) => {
    const numericItemId = Number(itemId);
    console.log('🚀 Starting modifier to item connection:', { itemId: numericItemId, modifierGroupId });
    
    try {
      const requestBody = { modifier_group_id: modifierGroupId };
      console.log('Request body:', requestBody);
      console.log('Request URL:', `${API_URL}/menu/items/${numericItemId}/options/modifier`);
      
      const response = await fetch(`${API_URL}/menu/items/${numericItemId}/options/modifier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        console.log('✅ API call successful, reloading item connections...');
        
        // Refresh all connections
        try {
          await Promise.all([
            // Update connection status of this item
            (async () => {
        try {
          console.log('🔄 Reloading item connections for item:', numericItemId);
          const itemResponse = await fetch(`${API_URL}/menu/items/${numericItemId}/options`);
          if (itemResponse.ok) {
            const itemData = await itemResponse.json();
            console.log(`✅ Updated item ${numericItemId} connections:`, itemData);
            
                  setItemModifierConnections(prev => {
              const newMap = new Map(prev);
              newMap.set(numericItemId, itemData.modifier_groups || []);
              return newMap;
            });
            
            setItemTaxConnections(prev => {
              const newMap = new Map(prev);
              newMap.set(numericItemId, itemData.tax_groups || []);
              return newMap;
            });
            
            setItemPrinterConnections(prev => {
              const newMap = new Map(prev);
              newMap.set(numericItemId, itemData.printer_groups || []);
              return newMap;
            });
          } else {
            console.error(`Failed to reload item ${numericItemId} connections:`, itemResponse.status);
          }
        } catch (error) {
          console.error('Failed to reload item connections:', error);
              }
            })(),
            
            // Also refresh category connections (there might be inherited items)
            loadCategoryConnections()
          ]);
        } catch (error) {
          console.error('Failed to refresh connections after successful API call:', error);
          // API call was successful, so ignore error and continue
        }
        
        console.log('✅ Item connection successful and data reloaded');
      } else {
        console.error('❌ API call failed with status:', response.status);
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        console.error('Item connection failed:', errorMessage);
        alert(`Item connection failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('❌ Network or other error during connection:', error);
      alert('An error occurred during connection.');
    }
  };

  // Tax Group을 카테고리에 연결
  const connectTaxToCategory = async (categoryId: number, taxGroupId: number) => {
    console.log('Connecting tax to category:', { categoryId, taxGroupId });
    
    try {
      const response = await fetch(`${API_URL}/menu/categories/${categoryId}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_group_id: taxGroupId }),
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        console.log('✅ Tax category connection successful, refreshing all connections...');
        
        // Refresh all connections
        try {
          await Promise.all([
            loadCategoryTaxConnections(),
            loadItemConnections() // Refresh menu item connection states
          ]);
          console.log('✅ All connections refreshed after tax category connection');
        } catch (error) {
          console.error('Failed to refresh connections after successful API call:', error);
          // API call was successful, so ignore error and continue
        }
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        console.error('Category tax connection failed:', errorMessage);
        alert(`Category tax connection failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to connect tax to category:', error);
      alert('An error occurred during category tax connection.');
    }
  };

  // Tax Group을 메뉴 아이템에 연결
  const connectTaxToItem = async (itemId: number, taxGroupId: number) => {
    const numericItemId = Number(itemId);
    console.log('Connecting tax to item:', { itemId: numericItemId, taxGroupId });
    
    try {
      const response = await fetch(`${API_URL}/menu/items/${numericItemId}/options/tax`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tax_group_id: taxGroupId }),
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        console.log('✅ Tax item connection successful, refreshing all connections...');
        
        // Refresh all connections
        try {
          await Promise.all([
            loadItemConnections(),
            loadCategoryTaxConnections() // Refresh category connection states
          ]);
          console.log('✅ All connections refreshed after tax item connection');
        } catch (error) {
          console.error('Failed to refresh connections after successful API call:', error);
          // API call was successful, so ignore error and continue
        }
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        console.error('Item tax connection failed:', errorMessage);
        alert(`Item tax connection failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to connect tax to item:', error);
      alert('An error occurred during item tax connection.');
    }
  };

  // Printer Group을 카테고리에 연결
  const connectPrinterToCategory = async (categoryId: number, printerGroupId: number) => {
    console.log('Connecting printer to category:', { categoryId, printerGroupId });
    
    try {
      const response = await fetch(`${API_URL}/menu/categories/${categoryId}/printers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer_group_id: printerGroupId }),
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        console.log('✅ Printer category connection successful, refreshing all connections...');
        
        // Refresh all connections
        try {
          await Promise.all([
            loadCategoryPrinterConnections(),
            loadItemConnections() // Refresh menu item connection states
          ]);
          console.log('✅ All connections refreshed after printer category connection');
        } catch (error) {
          console.error('Failed to refresh connections after successful API call:', error);
          // API call was successful, so ignore error and continue
        }
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        console.error('Category printer connection failed:', errorMessage);
        alert(`Category printer connection failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to connect printer to category:', error);
      alert('An error occurred during category printer connection.');
    }
  };

  // Printer Group을 메뉴 아이템에 연결
  const connectPrinterToItem = async (itemId: number, printerGroupId: number) => {
    const numericItemId = Number(itemId);
    console.log('Connecting printer to item:', { itemId: numericItemId, printerGroupId });
    
    try {
      const response = await fetch(`${API_URL}/menu/items/${numericItemId}/options/printer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer_group_id: printerGroupId }),
      });

      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (response.ok) {
        console.log('✅ Printer item connection successful, refreshing all connections...');
        
        // Refresh all connections
        try {
          await Promise.all([
            loadItemConnections(),
            loadCategoryPrinterConnections() // Refresh category connection states
          ]);
          console.log('✅ All connections refreshed after printer item connection');
        } catch (error) {
          console.error('Failed to refresh connections after successful API call:', error);
          // API call was successful, so ignore error and continue
        }
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorMessage = responseText || `HTTP ${response.status}`;
        }
        console.error('Item printer connection failed:', errorMessage);
        alert(`Item printer connection failed: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Failed to connect printer to item:', error);
      alert('An error occurred during item printer connection.');
    }
  };

  // Modifier group management functions
  const handleSaveModifierGroup = async (groupData: { name: string, min_selections: number, max_selections: number, modifiers: { name: string, price_adjustment: number }[], label?: string }) => {
    setIsSavingModifier(true);
    try {
      const isNew = editingModifierGroup === 'new';
      const url = isNew ? `${API_URL}/modifier-groups` : `${API_URL}/modifier-groups/${editingModifierGroup.id}`;
      const method = isNew ? 'POST' : 'PUT';
      
      const requestBody = menuId ? { ...groupData, menu_id: parseInt(menuId) } : groupData;
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error(`Failed to ${isNew ? 'create' : 'update'} modifier group`);

      // Refresh modifier group list
      const loadModifierGroups = async () => {
        try {
          const response = await fetch(`${API_URL}/modifier-groups${menuId ? `?menu_id=${menuId}` : ''}`);
          if (response.ok) {
            const data = await response.json();
            console.log('Loaded modifier groups:', data);
            setModifierGroups(data);
          }
        } catch (error) {
          console.error('Failed to load modifier groups:', error);
        }
      };
      await loadModifierGroups();
      
      setEditingModifierGroup(null);
    } catch (error) {
      console.error('Error saving modifier group:', error);
      alert('Failed to save modifier group. Please try again.');
    } finally {
      setIsSavingModifier(false);
    }
  };

  const handleDeleteModifierGroup = async (groupId: number) => {
    // if (!window.confirm('Are you sure you want to delete this modifier group?')) return;
    
    try {
      console.log('🗑️ Deleting modifier group:', groupId);
      console.log('🗑️ Delete URL:', `${API_URL}/modifier-groups/${groupId}`);
      
      const response = await fetch(`${API_URL}/modifier-groups/${groupId}`, { method: 'DELETE' });
      
      console.log('🗑️ Delete response status:', response.status);
      console.log('🗑️ Delete response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('🗑️ Delete failed with response:', errorText);
        throw new Error(`Failed to delete modifier group: ${response.status} - ${errorText}`);
      }
      
      console.log('✅ Modifier group deleted successfully, refreshing all connections...');
      
      // 모든 연결 상태 새로고침
      await Promise.all([
      // Refresh modifier group list
        (async () => {
        try {
            const response = await fetch(`${API_URL}/modifier-groups${menuId ? `?menu_id=${menuId}` : ''}`);
          if (response.ok) {
            const data = await response.json();
              console.log('✅ Refreshed modifier groups:', data);
            setModifierGroups(data);
          }
        } catch (error) {
          console.error('Failed to load modifier groups:', error);
        }
        })(),
        
        // Refresh category connections
        loadCategoryConnections(),
        
        // Refresh menu item connections
        loadItemConnections()
      ]);
      
      console.log('✅ All connections refreshed after deletion');
    } catch (error) {
      console.error('Error deleting modifier group:', error);
      alert('Failed to delete modifier group. Please try again.');
    }
  };

  // Tax group management functions
  const handleSaveTaxGroup = async (groupData: { name: string, taxes: any[] }) => {
    setIsSavingTax(true);
    try {
      const isNew = editingTaxGroup === 'new';
      const url = isNew ? `${API_URL}/tax-groups` : `${API_URL}/tax-groups/${editingTaxGroup.id}`;
      const method = isNew ? 'POST' : 'PUT';
      
      const requestBody = menuId ? { ...groupData, menu_id: parseInt(menuId) } : groupData;
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error(`Failed to ${isNew ? 'create' : 'update'} tax group`);

      // Refresh Tax Group list
      const loadTaxGroups = async () => {
        try {
          const response = await fetch(`${API_URL}/tax-groups`);
          if (response.ok) {
            const data = await response.json();
            console.log('Refreshed tax groups from Tax Settings:', data);
            setTaxGroups(data);
          }
        } catch (error) {
          console.error('Failed to load tax groups:', error);
        }
      };
      await loadTaxGroups();
      
      setEditingTaxGroup(null);
    } catch (error) {
      console.error('Error saving tax group:', error);
      alert('Failed to save tax group. Please try again.');
    } finally {
      setIsSavingTax(false);
    }
  };

  const handleDeleteTaxGroup = async (groupId: number) => {
    // if (!window.confirm('Are you sure you want to delete this tax group?')) return;
    
    try {
      console.log('🗑️ Deleting tax group:', groupId);
      const response = await fetch(`${API_URL}/tax-groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete tax group');
      
      console.log('✅ Tax group deleted successfully, refreshing all connections...');
      
      // 모든 연결 상태 새로고침
      await Promise.all([
      // Refresh Tax Group list
        (async () => {
        try {
          const response = await fetch(`${API_URL}/tax-groups`);
          if (response.ok) {
            const data = await response.json();
              console.log('✅ Refreshed tax groups from Tax Settings:', data);
            setTaxGroups(data);
          }
        } catch (error) {
          console.error('Failed to load tax groups:', error);
        }
        })(),
        
        // Refresh category connections
        loadCategoryTaxConnections(),
        
        // Refresh menu item connections
        loadItemConnections()
      ]);
      
      console.log('✅ All connections refreshed after deletion');
    } catch (error) {
      console.error('Error deleting tax group:', error);
      alert('Failed to delete tax group. Please try again.');
    }
  };

  // Printer group management functions
  const handleSavePrinterGroup = async (groupData: { name: string, type: string, printers: any[] }) => {
    setIsSavingPrinter(true);
    try {
      const isNew = editingPrinterGroup === 'new';
      const url = isNew ? `${API_URL}/printers/groups` : `${API_URL}/printers/groups/${editingPrinterGroup.id}`;
      const method = isNew ? 'POST' : 'PUT';
      
      const printersWithType = groupData.printers.map(printer => ({ ...printer, type: groupData.type }));
      const requestBody = menuId ? { ...groupData, printers: printersWithType, menu_id: parseInt(menuId) } : { ...groupData, printers: printersWithType };
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error(`Failed to ${isNew ? 'create' : 'update'} printer group`);

      // Refresh Printer Group list
      const loadPrinterGroups = async () => {
        try {
          const response = await fetch(`${API_URL}/printers/groups?menu_id=${menuId}`);
          if (response.ok) {
            const data = await response.json();
            console.log('Loaded printer groups:', data);
            setPrinterGroups(data);
          }
        } catch (error) {
          console.error('Failed to load printer groups:', error);
        }
      };
      await loadPrinterGroups();
      
      setEditingPrinterGroup(null);
    } catch (error) {
      console.error('Error saving printer group:', error);
      alert('Failed to save printer group. Please try again.');
    } finally {
      setIsSavingPrinter(false);
    }
  };

  const handleDeletePrinterGroup = async (groupId: number) => {
    // if (!window.confirm('Are you sure you want to delete this printer group?')) return;
    
    try {
      console.log('🗑️ Deleting printer group:', groupId);
      const response = await fetch(`${API_URL}/printers/groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete printer group');
      
      console.log('✅ Printer group deleted successfully, refreshing all connections...');
      
      // 모든 연결 상태 새로고침
      await Promise.all([
      // Refresh Printer Group list
        (async () => {
        try {
          const response = await fetch(`${API_URL}/printers/groups?menu_id=${menuId}`);
          if (response.ok) {
            const data = await response.json();
              console.log('✅ Refreshed printer groups:', data);
            setPrinterGroups(data);
          }
        } catch (error) {
          console.error('Failed to load printer groups:', error);
        }
        })(),
        
        // Refresh category connections
        loadCategoryPrinterConnections(),
        
        // Refresh menu item connections
        loadItemConnections()
      ]);
      
      console.log('✅ All connections refreshed after deletion');
    } catch (error) {
      console.error('Error deleting printer group:', error);
      alert('Failed to delete printer group. Please try again.');
    }
  };

  const handleAddCategory = async (name: string) => {
    if (menuEditLocked) { alert('Editing is locked.'); return; }
    if (!menuId) return;
    
    try {
      const response = await fetch(`${API_URL}/menu/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, menu_id: parseInt(menuId) })
      });
      
      if (!response.ok) throw new Error('Failed to add category');
      
      const newCategory = await response.json();
      setCategories(prev => [...prev, { ...newCategory, id: newCategory.category_id }]);

      // Prepare scroll/highlight for new category location
      lastCreatedRef.current = { type: 'category', id: newCategory.category_id };
      setCollapsedCategories(prev => { const ns = new Set(prev); ns.delete(newCategory.category_id); return ns; });
      // Open new item form and move cursor immediately after creation
      setSelectedCategoryId(newCategory.category_id);
      setShowInlineForm(newCategory.category_id);
      setTimeout(() => {
        const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement | null;
        if (nameInput) nameInput.focus();
      }, 0);
    } catch (error) {
      console.error(error);
      alert('Failed to add category.');
    }
  };

  const handleUpdateCategory = async (id: number, name: string) => {
    if (menuEditLocked) { alert('Editing is locked.'); return; }
    try {
      const response = await fetch(`${API_URL}/menu/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      if (!response.ok) throw new Error('Failed to update category');
      
      setCategories(prev => prev.map(cat => 
        cat.id === id ? { ...cat, name } : cat
      ));
    } catch (error) {
      console.error(error);
      alert('Failed to update category.');
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (menuEditLocked) { alert('Editing is locked.'); return; }
    if (!window.confirm('Are you sure you want to delete this category? All items in the category will also be deleted.')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/menu/categories/${id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to delete category');
      
      setCategories(prev => prev.filter(cat => cat.id !== id));
      setAllMenuItems(prev => prev.filter(item => item.category_id !== id));
      
      if (selectedCategoryId === id) {
        const remainingCategories = categories.filter(cat => cat.id !== id);
        setSelectedCategoryId(remainingCategories.length > 0 ? remainingCategories[0].id : null);
      }
    } catch (error) {
      console.error(error);
      alert('Failed to delete category.');
    }
  };

  const handleAddItem = async (name: string, short_name: string, description: string, price: number, price2: number = 0, isOpenPrice: boolean = false) => {
    if (menuEditLocked) { alert('Editing is locked.'); return; }
    if (!selectedCategoryId || !menuId) return;
    
    try {
      const response = await fetch(`${API_URL}/menu/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          short_name, 
          description, 
          price,
          price2, 
          category_id: selectedCategoryId,
          menu_id: parseInt(menuId),
          is_open_price: isOpenPrice ? 1 : 0
        })
      });
      
      if (!response.ok) throw new Error('Failed to add item');
      
      const newItem = await response.json();
      const mappedItem = { ...newItem, id: newItem.item_id, item_id: undefined };
      setAllMenuItems(prev => [...prev, mappedItem]);
      setMenuItems(prev => [...prev, mappedItem]);
      
      // Close modal and reset form
      setShowAddItemModal(false);
      setNewItemData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
    } catch (error) {
      console.error(error);
      alert('Failed to add item.');
    }
  };

  const handleAddItemClick = (categoryId: number) => {
    if (menuEditLocked) { alert('Editing is locked.'); return; }
    setSelectedCategoryId(categoryId);
    setShowInlineForm(categoryId);
    setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
  };

  const handleAddItemSubmit = () => {
    if (menuEditLocked) { alert('Editing is locked.'); return; }
    if (!newItemData.name.trim() || newItemData.price <= 0) {
      alert('Please enter item name and price.');
      return;
    }
    handleAddItem(
      newItemData.name,
      newItemData.short_name,
      newItemData.description,
      newItemData.price,
      newItemData.price2
    );
  };

  const handleInlineFormSubmit = () => {
    if (!inlineFormData.name.trim() || inlineFormData.price <= 0) {
      alert('Please enter item name and price.');
      return;
    }
    
    // If showInlineForm is a number, edit menu item; if null, add new item
    if (typeof showInlineForm === 'number') {
      // Edit menu item
      handleUpdateItem(
        showInlineForm,
        inlineFormData.name,
        inlineFormData.short_name,
        inlineFormData.description,
        inlineFormData.price,
        inlineFormData.price2
      );
      setShowInlineForm(null);
      setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
    } else {
      // Add new menu item
      handleAddItem(
        inlineFormData.name,
        inlineFormData.short_name,
        inlineFormData.description,
        inlineFormData.price,
        inlineFormData.price2
      );
      
      // Open new New Item window immediately after resetting form
      setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
      
      // Focus on Item Name input in next tick
      setTimeout(() => {
        const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
        if (nameInput) {
          nameInput.focus();
        }
      }, 0);
    }
  };

  const handleInlineFormCancel = () => {
    setShowInlineForm(null);
    setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
  };

  const handleUpdateItem = async (id: number, name: string, short_name: string, description: string, price: number, price2: number = 0) => {
    try {
      const response = await fetch(`${API_URL}/menu/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, short_name, description, price, price2 })
      });
      
      if (!response.ok) throw new Error('Failed to update item');
      
      setAllMenuItems(prev => prev.map(item => 
        item.id === id ? { ...item, name, short_name, description, price, price2 } : item
      ));
      setMenuItems(prev => prev.map(item => 
        item.id === id ? { ...item, name, short_name, description, price, price2 } : item
      ));
    } catch (error) {
      console.error(error);
      alert('Failed to update item.');
    }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      const response = await fetch(`${API_URL}/menu/items/${id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error('Failed to delete item');
      
      setAllMenuItems(prev => prev.filter(item => item.id !== id));
      setMenuItems(prev => prev.filter(item => item.id !== id));
    } catch (error) {
      console.error(error);
      alert('Failed to delete item.');
    }
  };

  const handleUploadImage = async (id: number, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const response = await fetch(`${API_URL}/menu/items/${id}/image`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error('Failed to upload image');
      
      const { imageUrl } = await response.json();
      
      setAllMenuItems(prev => prev.map(item => 
        item.id === id ? { ...item, image_url: imageUrl } : item
      ));
      setMenuItems(prev => prev.map(item => 
        item.id === id ? { ...item, image_url: imageUrl } : item
      ));
    } catch (error) {
      console.error(error);
      alert('Failed to upload image.');
    }
  };

  const handleSortItems = () => {
    // Sort logic implementation
    console.log('Sorting items...');
  };

  const handleBackToList = () => {
    navigate('/backoffice/menu');
  };

  // Save all menu
  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      // 1. Save menu basic info (names etc. are already saved individually)
      // 2. Save category order
      const categoryOrder = categories.map((cat, idx) => ({
        category_id: cat.category_id,
        sort_order: idx
      }));
      
      await fetch(`${API_URL}/menu/${menuId}/categories/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: categoryOrder }),
      });

      // 3. Save item order (per category)
      for (const category of categories) {
        const categoryItems = allMenuItems.filter(item => item.category_id === category.category_id);
        const itemOrder = categoryItems.map((item, idx) => ({
          item_id: item.item_id,
          sort_order: idx
        }));
        
        if (itemOrder.length > 0) {
          await fetch(`${API_URL}/menu/categories/${category.category_id}/items/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemOrder }),
          });
        }
      }

      alert('✅ Menu saved successfully!');
    } catch (error) {
      console.error('Failed to save menu:', error);
      alert('❌ An error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMenuNameChange = async (newName: string) => {
    if (!menuId || !currentMenu) return;
    
    try {
      const response = await fetch(`${API_URL}/menus/${menuId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      
      if (!response.ok) throw new Error('Failed to update menu name');
      
      setCurrentMenu(prev => prev ? { ...prev, name: newName } : null);
    } catch (error) {
      console.error(error);
      alert('Failed to update menu name.');
    }
  };

  // Export functionality


  // Excel Export functionality
  const handleExcelExport = async () => {
    if (!menuId) {
      alert('Menu ID is missing.');
      return;
    }
    
    setIsExporting(true);
    try {
      console.log('Exporting to Excel:', menuId);
      
      const response = await fetch(`${API_URL}/menu/${menuId}/export-excel`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Export failed');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `menu-${menuId}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('Excel export successful');
      
    } catch (error) {
      console.error('Export failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert('Export failed: ' + errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  // Excel Import functionality
  const handleExcelImport = async (file?: File) => {
    // Replace with popup message
    const message = `Export is implemented, and Import was implemented but had recurring errors, so the feature remains while replaced with this popup.

Points for Import:

Modifiers have multiple identical names, so it's impossible to know which one it is. They are displayed with badges in the category or menu item list.
If there are typos or missing option groups, the name will be in the badge with an X mark.

Like this. The basic logic is maintained for future re-implementation.`;
    
    alert(message);
  };

  // Load backups
  const loadBackups = async () => {
    if (!menuId) return;
    
    try {
      const response = await fetch(`${API_URL}/menu/${menuId}/backups`);
      if (response.ok) {
        const data = await response.json();
        setBackups(data.backups || []);
      }
    } catch (error) {
      console.error('Failed to load backups:', error);
    }
  };

  // Restore backup
  const handleRestoreBackup = async (backupFile: File) => {
    if (!menuId) {
      alert('Menu ID is missing.');
      return;
    }
    
    setIsRestoringBackup(true);
    
    try {
      const formData = new FormData();
      formData.append('backup', backupFile);
      
      const response = await fetch(`${API_URL}/menu/${menuId}/restore-backup`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Backup restore failed');
      }
      
      const result = await response.json();
      console.log('Backup restore successful:', result);
      alert('Backup restored successfully!');
      
      // Reload page
      window.location.reload();
      
    } catch (error) {
      console.error('Backup restore failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert('Backup restore failed: ' + errorMessage);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const getTabIcon = (name: TabName) => {
    switch (name) {
      case 'modifier':
        return <Settings size={16} />;
      case 'tax':
        return <Receipt size={16} />;
      case 'printer':
        return <Printer size={16} />;
      default:
        return null;
    }
  };

  const TabButton = ({ name, label }: { name: TabName; label: string }) => (
    <button
      onClick={() => setActiveTab(name)}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-all duration-300 rounded-lg
        ${activeTab === name 
          ? 'bg-blue-500 text-white shadow-md' 
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
    >
      <div className={`${activeTab === name ? 'text-white' : 'text-gray-500'}`}>
        {getTabIcon(name)}
      </div>
      {label}
    </button>
  );

  // Draggable Modifier Group component
  const DraggableModifierGroup: React.FC<{
    group: any;
    isConnected: boolean;
  }> = ({ group, isConnected }) => {
    const isHovered = hoveredOptionId === `modifier-${group.id}`;
    const isExpanded = expandedModifierGroups.has(group.id);

    const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingModifierGroup(group);
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      showDeleteConfirmation('modifier', group);
    };

    const handleToggleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedModifierGroups(prev => {
        const newSet = new Set(prev);
        if (newSet.has(group.id)) {
          newSet.delete(group.id);
        } else {
          newSet.add(group.id);
        }
        return newSet;
      });
    };

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `modifier-${group.id}`,
      data: { type: 'modifier', group },
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`
          flex items-center justify-between py-0 px-0 rounded-lg border-2
          transition-all duration-200 hover:shadow-md relative z-10 transform-gpu
          border-green-200 bg-white hover:border-green-400 hover:bg-green-50
          ${isDragging ? 'shadow-lg' : ''}
          ${isHovered ? 'border-green-400 bg-green-100 shadow-lg' : ''}
        `}
        title="Drag to connect to categories or menu items"
      >
        <div className="flex items-center space-x-3">
          {/* Drag handle icon */}
          <div
            {...attributes}
            {...listeners}
            className="p-2 rounded hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-300 cursor-grab hover:cursor-grabbing"
          >
            <GripVertical size={20} className="text-slate-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 min-w-0 pr-20">
            <h4 className="font-medium text-gray-900">{group.name}</h4>
                <div className="flex items-center gap-2 text-sm">
                  {group.labels && group.labels.length > 0 && (
                    <span className="text-gray-500">({group.labels[0].name})</span>
                  )}
                  <span className="text-gray-600">
                    Min: {group.min_selection || 0}, Max: {group.max_selection || 0}
                  </span>
          </div>
        </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center space-x-1 bg-white px-2 py-1 rounded-bl">
          {isConnected && (
                  <Link 
                    className="text-green-500 w-4 h-4 cursor-help" 
                    onMouseEnter={(e) => showTooltip('modifier', group.id, e)}
                    onMouseLeave={hideTooltip}
                  />
          )}
          <button
            onClick={handleEditClick}
                  className="p-1 hover:bg-blue-100 rounded transition-colors pointer-events-auto z-20"
            title="Edit"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </button>
          <button
            onClick={handleDeleteClick}
                  className="p-1 hover:bg-red-100 rounded transition-colors pointer-events-auto z-20"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </button>
                <button
                  onClick={handleToggleClick}
                  className="p-1.5 hover:bg-gray-100 rounded transition-colors pointer-events-auto z-20"
                  title={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-600" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                  )}
                </button>
              </div>
            </div>
            {isExpanded && group.modifiers && group.modifiers.length > 0 && (
              <div className="mt-2 space-y-1">
                {/* Header */}
                <div className="flex items-center justify-between text-xs text-gray-400 px-2 border-b pb-1">
                  <span>Option</span>
                  <div className="flex gap-4">
                    <span className="min-w-[70px] text-right">Price_Modi1</span>
                    <span className="min-w-[70px] text-right text-green-500">Price_Modi2</span>
                  </div>
                </div>
                {group.modifiers.map((modifier: any, index: number) => {
                  const p1 = modifier.price_adjustment || 0;
                  const p2 = modifier.price_adjustment_2 || 0;
                  return (
                    <div key={index} className="flex items-center justify-between text-sm bg-gray-50 rounded px-2 py-1">
                      <div className="flex-1 mr-4">
                        <span className="text-gray-700">{modifier.name}</span>
                        {modifier.label && (
                          <span className="text-gray-500 text-xs ml-2">({modifier.label})</span>
                        )}
                      </div>
                      <div className="flex gap-4">
                        <span className="text-gray-600 min-w-[70px] text-right font-medium">
                          {p1 === 0 ? 'Free' : p1 > 0 ? `+$${p1.toFixed(2)}` : `-$${Math.abs(p1).toFixed(2)}`}
                        </span>
                        <span className="text-green-600 min-w-[70px] text-right font-medium">
                          {p2 === 0 ? 'Free' : p2 > 0 ? `+$${p2.toFixed(2)}` : `-$${Math.abs(p2).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };



  // Draggable Printer Group component
  const DraggablePrinterGroup: React.FC<{
    group: any;
    isConnected: boolean;
  }> = ({ group, isConnected }) => {
    const isHovered = hoveredOptionId === `printer-${group.id}`;
    const isExpanded = expandedPrinterGroups.has(group.id);
    
    const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingPrinterGroup(group);
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      showDeleteConfirmation('printer', group);
    };

    const handleToggleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedPrinterGroups(prev => {
        const newSet = new Set(prev);
        if (newSet.has(group.id)) {
          newSet.delete(group.id);
        } else {
          newSet.add(group.id);
        }
        return newSet;
      });
    };

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `printer-${group.id}`,
      data: { type: 'printer', group },
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`
          flex items-center justify-between py-0 px-0 rounded-lg border-2
          transition-all duration-200 hover:shadow-md relative z-10 transform-gpu
          border-purple-200 bg-white hover:border-purple-400 hover:bg-purple-50
          ${isDragging ? 'shadow-lg' : ''}
          ${isHovered ? 'border-purple-400 bg-purple-100 shadow-lg' : ''}
        `}
        title="Drag to connect to categories or menu items"
      >
        <div className="flex items-center space-x-3">
          {/* Drag handle icon */}
          <div
            {...attributes}
            {...listeners}
            className="p-2 rounded hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-300 cursor-grab hover:cursor-grabbing"
          >
            <GripVertical size={20} className="text-slate-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 min-w-0 pr-16">
            <h4 className="font-medium text-gray-900">{group.name}</h4>
          </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center space-x-1 bg-white px-2 py-1 rounded-bl">
          {isConnected && (
                  <Link 
                    className="text-purple-500 w-4 h-4 cursor-help" 
                    onMouseEnter={(e) => showTooltip('printer', group.id, e)}
                    onMouseLeave={hideTooltip}
                  />
          )}
          <button
            onClick={handleEditClick}
                              className="p-1 hover:bg-blue-100 rounded transition-colors pointer-events-auto z-20"
            title="Edit"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </button>
          <button
            onClick={handleDeleteClick}
            className="p-1 hover:bg-red-100 rounded transition-colors pointer-events-auto z-20"
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </button>
                <button
                  onClick={handleToggleClick}
                  className="p-1.5 hover:bg-gray-100 rounded transition-colors pointer-events-auto z-20"
                  title="Expand/Collapse"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-600" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                  )}
                </button>
              </div>
            </div>
            {isExpanded && group.printers && group.printers.length > 0 && (
              <div className="mt-2 space-y-1">
                {group.printers.map((printer: any, index: number) => (
                  <div key={index} className="flex items-center text-sm bg-gray-50 rounded px-2 py-1">
                    <span className="text-gray-700 flex-1 mr-4">{printer.name}</span>
                    <span className="text-gray-500 min-w-fit">{printer.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Draggable Tax Group component
  const DraggableTaxGroup: React.FC<{
    group: any;
    isConnected: boolean;
  }> = ({ group, isConnected }) => {
    const isHovered = hoveredOptionId === `tax-${group.id}`;
    const isExpanded = expandedTaxGroups.has(group.id);
    
    const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingTaxGroup(group);
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      showDeleteConfirmation('tax', group);
    };

    const handleToggleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedTaxGroups(prev => {
        const newSet = new Set(prev);
        if (newSet.has(group.id)) {
          newSet.delete(group.id);
        } else {
          newSet.add(group.id);
        }
        return newSet;
      });
    };

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `tax-${group.id}`,
      data: { type: 'tax', group },
    });

    const style = { transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.5 : 1 };

    return (
      <div ref={setNodeRef} style={style} className={`
          flex items-center justify-between py-0 px-0 rounded-lg border-2
          transition-all duration-200 hover:shadow-md relative z-10 transform-gpu
          border-red-200 bg-white hover:border-red-300
          ${isDragging ? 'shadow-lg' : ''}
          ${isHovered ? 'border-red-400 bg-red-100 shadow-lg' : ''}
        `} title="Drag to connect to category or menu item">
        <div className="flex items-center space-x-3">
          <div {...attributes} {...listeners} className="p-2 rounded hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-300 cursor-grab hover:cursor-grabbing">
            <GripVertical size={20} className="text-slate-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 min-w-0 pr-16">
                <h4 className="font-medium text-gray-900">{group.name}</h4>
              </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center space-x-1 bg-white px-2 py-1 rounded-bl">
                {isConnected && (
                  <Link className="text-red-500 w-4 h-4 cursor-help" onMouseEnter={(e) => showTooltip('tax', group.id, e)} onMouseLeave={hideTooltip} />
                )}
                <button onClick={handleEditClick} className="p-0.5 hover:bg-blue-100 rounded transition-colors pointer-events-auto z-20" title="Edit">
                  <Edit className="w-4 h-4 text-blue-600" />
                </button>
                <button onClick={handleDeleteClick} className="p-0.5 hover:bg-red-100 rounded transition-colors pointer-events-auto z-20" title="Delete">
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
                <button onClick={handleToggleClick} className="p-1.5 hover:bg-gray-100 rounded transition-colors pointer-events-auto z-20" title="Expand/Collapse">
                  {isExpanded ? (<ChevronUp className="w-4 h-4 text-gray-600" />) : (<ChevronDown className="w-4 h-4 text-gray-600" />)}
                </button>
              </div>
            </div>
            {isExpanded && group.taxes && group.taxes.length > 0 && (
              <div className="mt-2 space-y-1">
                {group.taxes.map((tax: any, index: number) => (
                  <div key={index} className="flex items-center justify-between text-sm bg-gray-50 rounded px-2 py-1">
                    <span className="text-gray-700 flex-1 mr-4">{tax.name}</span>
                    <span className="text-gray-500 min-w-fit">{tax.rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Group items by category
  const itemsByCategory = categories.map(category => ({ category, items: allMenuItems.filter(item => item.category_id === category.id) }));

  // Add SortableCategoryBlock component
  const SortableCategoryBlock = ({
    category,
    items,
    isCollapsed,
    onToggleCollapse,
    onAddItemClick,
    onDeleteItem,
    onNavigate,
    showInlineForm,
    inlineFormData,
    setInlineFormData,
    handleInlineFormCancel,
    handleInlineFormSubmit,
    selectedCategoryId,
  }: any) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: category.id,
      data: { type: 'category', category },
    });

    const { setNodeRef: setDroppableRef, isOver } = useDroppable({
      id: category.id,
      data: { type: 'category', category },
    });
    // Header drop strip droppable to make category drop easier
    const { setNodeRef: setHeaderDropRef, isOver: isHeaderOver } = useDroppable({
      id: `cat-strip-${category.id}`,
      data: { type: 'category', category },
    });
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 50 : 'auto',
    };
    return (
      <div
        ref={(node) => {
          setNodeRef(node);
          setDroppableRef(node);
        }}
        style={style}
        className={`bg-white rounded-lg shadow-sm border mb-0 transition-all duration-200
          ${isDragging ? 'scale-[1.02] shadow-xl opacity-90 border-blue-400' : 
            isOver ? 'border-2 border-green-500 bg-green-50 shadow-md' : 'border-gray-200'}`}
        {...attributes}
      >
        {/* Category header */}
        <div className={`relative flex items-center justify-between py-1 px-2 border-b border-gray-100 bg-gray-200 rounded-t-lg transition-all duration-200 ${
          isOver ? 'ring-2 ring-green-500 bg-green-50' : 
          isDragRelevantForCategory ? 'ring-1 ring-blue-300 bg-blue-50' : 
          highlightedElements.categories.includes(category.category_id) ? 'ring-2 ring-blue-400' : ''
        }`}>
          {/* Header drop strip (active only during drag) */}
          {isDragRelevantForCategory && (
            <div
              ref={setHeaderDropRef as any}
              className={`absolute -top-1 left-0 right-0 h-8 rounded-t-lg ${isHeaderOver ? 'bg-green-100/80' : 'bg-blue-50/50'} pointer-events-auto`}
              style={{ zIndex: 5 }}
            />
          )}
          <div className="flex items-center space-x-3">
            <div {...listeners} className="cursor-grab p-1.5 self-stretch flex items-center hover:bg-gray-200 rounded-full transition-colors">
              <GripVertical size={20} className="text-slate-400" />
            </div>
            {/* Category image preview and upload/delete */}
            <div className="relative flex items-center">
              {category.image_url ? (
                <img
                  src={`${API_BASE}${category.image_url}`}
                  alt="Category image"
                  className="w-10 h-10 object-cover rounded-lg border border-gray-300 mr-2"
                />
              ) : (
                <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 mr-2 text-xs">No img</div>
              )}
              {/* Upload button (+) */}
              <button
                type="button"
                className="absolute top-0 right-0 bg-white rounded-full w-4 h-4 flex items-center justify-center border border-gray-300 hover:bg-blue-100 text-blue-500 font-bold text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRefs.current[category.id]?.click();
                }}
                title="Upload category image"
              >
                +
              </button>
              {/* Delete button (-) - shown only when image exists */}
              {category.image_url && (
                <button
                  type="button"
                  className="absolute bottom-0 right-0 bg-white rounded-full w-4 h-4 flex items-center justify-center border border-red-300 hover:bg-red-100 text-red-500 font-bold text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCategoryImage(category.id);
                  }}
                  title="Delete category image"
                >
                  −
                </button>
              )}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={setCategoryFileInputRef(category.id)}
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    handleUploadCategoryImage(category.id, e.target.files[0]);
                  }
                }}
              />
            </div>
            {editingCategoryId === category.id ? (
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={editingCategoryName}
                  onChange={(e) => setEditingCategoryName(e.target.value)}
                  className="text-lg font-semibold text-gray-800 bg-white border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleUpdateCategory(category.id, editingCategoryName);
                      setEditingCategoryId(null);
                      setEditingCategoryName('');
                    }
                    if (e.key === 'Escape') {
                      setEditingCategoryId(null);
                      setEditingCategoryName('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    handleUpdateCategory(category.id, editingCategoryName);
                    setEditingCategoryId(null);
                    setEditingCategoryName('');
                  }}
                  className="p-1 hover:bg-green-100 rounded-full transition-colors"
                  title="Save"
                >
                  <CheckCircle size={14} className="text-green-600" />
                </button>
                <button
                  onClick={() => {
                    setEditingCategoryId(null);
                    setEditingCategoryName('');
                  }}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                  title="Cancel"
                >
                  <X size={14} className="text-gray-600" />
                </button>
              </div>
            ) : (
            <h3 className="text-lg font-semibold text-gray-800">{category.name}</h3>
            )}
            {(category.name || '').toLowerCase() === 'open price' && (
              <p className="mt-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                This category is for Open Price. It does not appear on ordering screens.
              </p>
            )}
            <span className="text-sm text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
              {items.length} items
            </span>
          </div>
          <div className="flex items-center space-x-3">
            {/* Display connected options - vertical alignment based on right edge */}
            {(() => {
              const connections = categoryConnections.get(category.category_id);
              const taxConnections = categoryTaxConnections.get(category.category_id);
              const printerConnections = categoryPrinterConnections.get(category.category_id);
              
              console.log(`Category ${category.category_id} (${category.name}) connections:`, {
                modifiers: connections,
                taxes: taxConnections,
                printers: printerConnections
              });
              
              const hasConnections = (connections && connections.length > 0) || 
                                   (taxConnections && taxConnections.length > 0) || 
                                   (printerConnections && printerConnections.length > 0);
              
              if (!hasConnections) return null;
              
              return (
                <div className="flex flex-wrap items-center gap-1 mr-3 justify-end">
                  {/* Display connected modifiers */}
                  {connections && connections.map((modifier: any, index: number) => {
                    console.log(`Modifier ${index}:`, modifier);
                    return (
                      <span 
                        key={modifier.modifier_group_id} 
                        className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full cursor-pointer hover:bg-green-200 transition-colors group relative"
                        onMouseEnter={() => setHoveredOptionId(`modifier-${modifier.modifier_group_id}`)}
                        onMouseLeave={() => setHoveredOptionId(null)}
                      >
                        {modifier.group_name || modifier.name || 'Unknown Modifier'}
                      <button
                          onClick={(e) => {
                            e.stopPropagation();
                            disconnectModifierFromCategory(category.category_id, modifier.modifier_group_id);
                          }}
                          className="ml-1 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove Modifier"
                      >
                        ×
                      </button>
                      </span>
                    );
                  })}
                  
            {/* Display connected Taxes */}
                  {taxConnections && taxConnections.map((tax: any, index: number) => {
                                const taxName = tax.group_name || tax.name;
                    const taxId = tax.tax_group_id;
            console.log(`Tax ${index}:`, tax, 'Name:', taxName, 'ID:', taxId);
            return taxName && taxId ? (
                      <span 
                        key={taxId} 
                        className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full cursor-pointer hover:bg-red-200 transition-colors group relative"
                        onMouseEnter={() => setHoveredOptionId(`tax-${taxId}`)}
                        onMouseLeave={() => setHoveredOptionId(null)}
                      >
                        {taxName}
                      <button
                          onClick={(e) => {
                            e.stopPropagation();
                            disconnectTaxFromCategory(category.category_id, taxId);
                          }}
                          className="ml-1 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove Tax"
                      >
                        ×
                      </button>
                      </span>
                    ) : null;
                  })}
                  
            {/* Display connected Printers */}
                  {printerConnections && printerConnections.map((printer: any, index: number) => {
                    const printerName = printer.printer_group_name || printer.name;
                    console.log(`Printer ${index}:`, printer, 'Name:', printerName);
                    return printerName ? (
                      <span 
                        key={printer.printer_group_id} 
                        className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full cursor-pointer hover:bg-purple-200 transition-colors group relative"
                        onMouseEnter={() => setHoveredOptionId(`printer-${printer.printer_group_id}`)}
                        onMouseLeave={() => setHoveredOptionId(null)}
                      >
                        {printerName}
                      <button
                          onClick={(e) => {
                            e.stopPropagation();
                            disconnectPrinterFromCategory(category.category_id, printer.printer_group_id);
                          }}
                          className="ml-1 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove Printer"
                      >
                        ×
                      </button>
                      </span>
                    ) : null;
                  })}
                </div>
              );
            })()}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => {
                setEditingCategoryId(category.id);
                setEditingCategoryName(category.name);
              }}
              className="p-1 hover:bg-blue-100 rounded-full transition-colors focus:outline-none"
              title="Edit category"
            >
              <Edit size={16} className="text-blue-600" />
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Are you sure you want to delete category "${category.name}"?`)) {
                  handleDeleteCategory(category.id);
                }
              }}
              className="p-1 hover:bg-red-100 rounded-full transition-colors focus:outline-none"
              title="Delete category"
            >
              <Trash2 size={16} className="text-red-600" />
            </button>
            <button
              onClick={() => onToggleCollapse(category.id)}
              className="p-1 hover:bg-gray-200 rounded-full flex-shrink-0 transition-colors focus:outline-none flex items-center"
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {!isCollapsed ? (
                <ChevronUp size={20} className="text-gray-500 transition-transform duration-200" />
              ) : (
                <ChevronDown size={20} className="text-gray-500 transition-transform duration-200" />
              )}
            </button>
            </div>
          </div>
        </div>
        {/* Items in category */}
        {!isCollapsed && (
          <div className="p-2">
            {items.length > 0 ? (
              <SortableContext items={items.map((item: any) => item.id)} strategy={verticalListSortingStrategy}>
                {items.map((item: any) => (
                  <SortableMenuItemBlock
                    key={item.id}
                    item={item}
                    onNavigate={onNavigate}
                    onDeleteItem={onDeleteItem}
                    showInlineForm={showInlineForm}
                    inlineFormData={inlineFormData}
                    setInlineFormData={setInlineFormData}
                    handleInlineFormCancel={handleInlineFormCancel}
                    handleInlineFormSubmit={handleInlineFormSubmit}
                  />
                ))}
              </SortableContext>
            ) : null}

            {/* Menu Item Creation Form */}
            {showInlineForm === category.id && (
              <div className="p-4 bg-white border-t border-gray-200">
                <h4 className="font-medium text-gray-800 mb-4">Add New Menu Item</h4>
                <form onSubmit={(e) => { 
                  e.preventDefault(); 
                  const formEl = e.currentTarget as HTMLFormElement; 
                  const formData = new FormData(formEl);
                  const name = formData.get('name') as string;
                  const short_name = formData.get('short_name') as string;
                  const price = parseFloat(formData.get('price') as string) || 0;
                  const price2 = parseFloat(formData.get('price2') as string) || 0;
                  const description = formData.get('description') as string;
                  const isOpenPrice = formData.get('is_open_price') !== null;
                  
                  if (!name.trim() || (!isOpenPrice && price <= 0)) {
                    alert('Please enter item name and price.');
                    return;
                  }
                  
                  handleAddItem(name, short_name, description, price, price2, isOpenPrice);
                  // Keep form open for the same category, reset, and focus Item Name
                  setShowInlineForm(category.id);
                  setInlineFormData({ name: '', short_name: '', description: '', price: 0, price2: 0 });
                  // reset DOM form and focus name
                  formEl.reset();
                 setTimeout(() => {
                   const input = formEl ? (formEl.querySelector('input[name="name"]') as HTMLInputElement | null) : null;
                   if (input) input.focus();
                 }, 0);
                }}>
                  <div className="space-y-4">
                    <div className="grid grid-cols-10 gap-4">
                      <div className="col-span-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                          Item Name
                    </label>
                    <input
                      type="text"
                        name="name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter item name"
                          autoFocus
                          onChange={(e) => {
                            const input = e.target;
                            const value = input.value;
                            // Capitalize first letter and after spaces, others lowercase
                            const newValue = value.toLowerCase().replace(/^[a-z]|\s+[a-z]/g, (match) => match.toUpperCase());
                            input.value = newValue;
                          }}
                    />
                  </div>
                  
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Short Name
                    </label>
                    <input
                      type="text"
                          name="short_name"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Short name"
                          onChange={(e) => {
                            const input = e.target;
                            const value = input.value;
                            // Capitalize first letter and after spaces, others lowercase
                            const newValue = value.toLowerCase().replace(/^[a-z]|\s+[a-z]/g, (match) => match.toUpperCase());
                            input.value = newValue;
                          }}
                    />
                  </div>
                  
                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Price 1
                    </label>
                    <input
                      type="number"
                          name="price"
                      step="0.01"
                      min="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                      </div>

                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Price 2
                    </label>
                    <input
                      type="number"
                          name="price2"
                      step="0.01"
                      min="0"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const formData = new FormData(e.currentTarget.form!);
                          const name = formData.get('name') as string;
                          const short_name = formData.get('short_name') as string;
                          const price = parseFloat(formData.get('price') as string) || 0;
                          const price2 = parseFloat(formData.get('price2') as string) || 0;
                          const description = formData.get('description') as string;
                          const isOpenPrice = formData.get('is_open_price') !== null;
                          
                          if (!name.trim() || (!isOpenPrice && price <= 0)) {
                            alert('Please enter item name and price.');
                            return;
                          }
                          
                          handleAddItem(name, short_name, description, price, price2, isOpenPrice);
                          // Reset form
                          e.currentTarget.form!.reset();
                          // Focus on Item Name field
                          const nameInput = e.currentTarget.form!.querySelector('input[name="name"]') as HTMLInputElement;
                          if (nameInput) {
                            nameInput.focus();
                          }
                        }
                      }}
                    />
                      </div>

                      {(category.name || '').toLowerCase() === 'open price' && (
                        <div className="col-span-10">
                          <label className="inline-flex items-center space-x-2 select-none">
                            <input type="checkbox" name="is_open_price" className="h-4 w-4" />
                            <span className="text-sm text-gray-700">Open Price (allow 0 price)</span>
                          </label>
                        </div>
                      )}
                  </div>
                  
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                        name="description"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Item description (optional)"
                        rows={3}
                        onChange={(e) => {
                          const textarea = e.target;
                          const value = textarea.value;
                          // Only first letter capitalized, others lowercase
                          const newValue = value.toLowerCase().replace(/^[a-z]/g, (match) => match.toUpperCase());
                          textarea.value = newValue;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget.form!);
                            const name = formData.get('name') as string;
                            const short_name = formData.get('short_name') as string;
                            const price = parseFloat(formData.get('price') as string) || 0;
                            const price2 = parseFloat(formData.get('price2') as string) || 0;
                            const description = formData.get('description') as string;
                            const isOpenPrice = formData.get('is_open_price') !== null;
                            
                            if (!name.trim() || (!isOpenPrice && price <= 0)) {
                              alert('Please enter item name and price.');
                              return;
                            }
                            
                            handleAddItem(name, short_name, description, price, price2, isOpenPrice);
                            // Reset form
                            e.currentTarget.form!.reset();
                            // Focus on Item Name field
                            const nameInput = e.currentTarget.form!.querySelector('input[name="name"]') as HTMLInputElement;
                            if (nameInput) {
                              nameInput.focus();
                            }
                          }
                        }}
                    />
                  </div>
                </div>
                
                  <div className="flex justify-end space-x-3 mt-6">
                  <button
                      type="button"
                    onClick={handleInlineFormCancel}
                      className="px-4 py-2 text-sm text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                      type="submit"
                      className="px-4 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                  >
                    Add
                  </button>
                </div>
                </form>
              </div>
            )}
            
            {/* New Item button */}
            <div className="pt-1 pb-0.5 px-2 border-t border-gray-100">
              <button
                onClick={() => onAddItemClick(category.id)}
                className="w-[22%] py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium ml-4"
              >
                New Item
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // SortableMenuItemBlock component changed to functional
  const SortableMenuItemBlock = ({
    item,
    onNavigate,
    onDeleteItem,
    showInlineForm,
    inlineFormData,
    setInlineFormData,
    handleInlineFormCancel,
    handleInlineFormSubmit,
  }: any) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: item.id,
      data: { type: 'item', item },
    });

    const { setNodeRef: setDroppableRef, isOver } = useDroppable({
      id: item.id,
      data: { type: 'item', item },
      disabled: categoryOnlyDrop,
    });
    
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 40 : 'auto',
    };
    
    return (
      <div
        ref={(node) => {
          setNodeRef(node);
          setDroppableRef(node);
        }}
        style={style}
        className={`flex items-center justify-between py-0.5 px-2 bg-gray-100 rounded-lg hover:bg-gray-100 transition-colors mb-1 ml-6 min-h-[40px] cursor-pointer
        ${isDragging ? 'scale-[1.03] shadow-2xl opacity-90 border border-blue-400' : ''}
        ${isOver ? 'border-2 border-green-400 bg-green-50 shadow-lg' : ''}
        ${categoryOnlyDrop ? 'opacity-60 pointer-events-none' : ''}
        ${highlightedElements.items.includes(item.id) ? 'ring-4 ring-green-500 ring-opacity-50 border-green-500' : ''}`}
        data-highlighted={highlightedElements.items.includes(item.id)}
        data-item-id={item.id}
        {...attributes}
      >
      <div {...listeners} className="cursor-grab p-1.5 flex items-center hover:bg-gray-200 rounded-full transition-colors mr-2">
        <GripVertical size={18} className="text-slate-400" />
      </div>
      <div className="flex items-center space-x-3 flex-1">
        {/* Menu item image preview and upload/delete */}
        <div className="relative flex items-center">
          {item.image_url ? (
            <img src={`${API_BASE}${item.image_url}`} alt={item.name} className="w-12 h-12 object-cover rounded-lg border border-gray-300 mr-2" />
          ) : (
            <div className="w-12 h-12 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 mr-2 text-xs">No img</div>
          )}
          {/* 업로드 버튼 (+) */}
          <button
            type="button"
            className="absolute top-0 right-0 bg-white rounded-full w-5 h-5 flex items-center justify-center border border-gray-300 hover:bg-blue-100 text-blue-500 font-bold text-sm"
            onClick={(e) => {
              e.stopPropagation();
              const input = document.querySelector(`input[data-item-id="${item.id}"]`) as HTMLInputElement;
              input?.click();
            }}
            title="Upload menu item image"
          >
            +
          </button>
          {/* 삭제 버튼 (-) - 이미지가 있을 때만 표시 */}
          {item.image_url && (
            <button
              type="button"
              className="absolute bottom-0 right-0 bg-white rounded-full w-5 h-5 flex items-center justify-center border border-red-300 hover:bg-red-100 text-red-500 font-bold text-sm"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteMenuItemImage(item.id);
              }}
              title="Delete menu item image"
            >
              −
            </button>
          )}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            data-item-id={item.id}
            onChange={e => {
              if (e.target.files && e.target.files[0]) {
                handleUploadMenuItemImage(item.id, e.target.files[0]);
              }
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          {showInlineForm === item.id ? (
            /* Edit mode - inline input */
            <form onSubmit={(e) => { e.preventDefault(); handleInlineFormSubmit(); }} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={inlineFormData.name}
                  onChange={(e) => setInlineFormData({ ...inlineFormData, name: e.target.value })}
                  className="flex-1 min-w-[120px] px-2 py-1 border border-blue-300 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Item Name"
                />
                <input
                  type="text"
                  value={inlineFormData.short_name}
                  onChange={(e) => setInlineFormData({ ...inlineFormData, short_name: e.target.value })}
                  className="flex-1 min-w-[100px] px-2 py-1 border border-blue-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Short Name"
                />
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    step="0.01"
                    value={inlineFormData.price}
                    onChange={(e) => setInlineFormData({ ...inlineFormData, price: parseFloat(e.target.value) || 0 })}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Price1"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={inlineFormData.price2}
                    onChange={(e) => setInlineFormData({ ...inlineFormData, price2: parseFloat(e.target.value) || 0 })}
                    className="w-20 px-2 py-1 border border-orange-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                    placeholder="Price2"
                  />
                </div>
              </div>
              <textarea
                value={inlineFormData.description}
                onChange={(e) => setInlineFormData({ ...inlineFormData, description: e.target.value })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Description"
                rows={2}
              />
              {/* Option label + button (same line) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {(() => {
                    const itemIdNum = Number(item.id);
                    const connections = itemModifierConnections.get(itemIdNum);
                    const taxConnections = itemTaxConnections.get(itemIdNum);
                    const printerConnections = itemPrinterConnections.get(itemIdNum);
                    return (
                      <>
                        {connections && connections.map((m: any) => (
                          <span key={m.modifier_group_id} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                            {m.name || m.group_name || 'Modifier'}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Disconnect "${m.name || m.group_name}" from this item?`)) {
                                  disconnectModifierFromItem(itemIdNum, m.modifier_group_id);
                                }
                              }}
                              className="ml-1 hover:bg-green-200 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                              title="Disconnect modifier"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        {taxConnections && taxConnections.map((t: any) => (
                          <span key={t.tax_group_id} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">
                            {t.name || t.group_name || 'Tax'}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Disconnect "${t.name || t.group_name}" from this item?`)) {
                                  disconnectTaxFromItem(itemIdNum, t.tax_group_id);
                                }
                              }}
                              className="ml-1 hover:bg-red-200 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                              title="Disconnect tax"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        {printerConnections && printerConnections.map((p: any) => (
                          <span key={p.printer_group_id} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">
                            {p.name || p.printer_group_name || 'Printer'}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Disconnect "${p.name || p.printer_group_name}" from this item?`)) {
                                  disconnectPrinterFromItem(itemIdNum, p.printer_group_id);
                                }
                              }}
                              className="ml-1 hover:bg-purple-200 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                              title="Disconnect printer"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleInlineFormCancel} className="px-3 py-1 text-sm text-gray-600 bg-gray-200 rounded hover:bg-gray-300">
                    Cancel
                  </button>
                  <button type="button" onClick={() => onDeleteItem(item.id)} className="px-3 py-1 text-sm text-red-600 bg-red-100 rounded hover:bg-red-200">
                    Delete
                  </button>
                  <button type="submit" className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
                    Save
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* Normal mode - list display */
            <>
              <div className="flex items-center space-x-2">
                <h4 className="font-medium text-gray-800 truncate">{item.name}</h4>
                {item.short_name && (
                  <span className="text-sm text-blue-600 font-medium">({item.short_name})</span>
                )}
              </div>
              <p className="text-sm text-gray-500 truncate">{(item.description && item.description.length > 80) ? `${item.description.slice(0, 80)}...` : (item.description || 'No description')}</p>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {(() => {
                  const itemIdNum = Number(item.id);
                  const connections = itemModifierConnections.get(itemIdNum);
                  const taxConnections = itemTaxConnections.get(itemIdNum);
                  const printerConnections = itemPrinterConnections.get(itemIdNum);
                  return (
                    <>
                      {connections && connections.map((m: any) => (
                        <span key={m.modifier_group_id} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 group">
                          {m.name || m.group_name || 'Modifier'}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Disconnect "${m.name || m.group_name}" from this item?`)) {
                                disconnectModifierFromItem(itemIdNum, m.modifier_group_id);
                              }
                            }}
                            className="ml-1 hover:bg-green-200 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                            title="Disconnect modifier"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      {taxConnections && taxConnections.map((t: any) => (
                        <span key={t.tax_group_id} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 group">
                          {t.name || t.group_name || 'Tax'}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Disconnect "${t.name || t.group_name}" from this item?`)) {
                                disconnectTaxFromItem(itemIdNum, t.tax_group_id);
                              }
                            }}
                            className="ml-1 hover:bg-red-200 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                            title="Disconnect tax"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                      {printerConnections && printerConnections.map((p: any) => (
                        <span key={p.printer_group_id} className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700 group">
                          {p.name || p.printer_group_name || 'Printer'}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Disconnect "${p.name || p.printer_group_name}" from this item?`)) {
                                disconnectPrinterFromItem(itemIdNum, p.printer_group_id);
                              }
                            }}
                            className="ml-1 hover:bg-purple-200 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity"
                            title="Disconnect printer"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Price, edit, delete buttons - shown only in normal mode */}
      {showInlineForm !== item.id && (
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-gray-800">${item.price.toFixed(2)}</span>
          <span className="font-semibold text-orange-600">${(item.price2 || 0).toFixed(2)}</span>
          <button 
            onClick={() => {
              setShowInlineForm(item.id);
              setInlineFormData({
                name: item.name,
                short_name: item.short_name || '',
                description: item.description || '',
                price: item.price,
                price2: item.price2 || 0
              });
            }}
            className="p-1 hover:bg-blue-100 rounded-full transition-colors"
            title="Edit Item"
          >
            <Edit size={16} className="text-blue-600" />
          </button>
          <button 
            onClick={() => onDeleteItem(item.id)}
            className="p-1 hover:bg-red-100 rounded-full transition-colors"
            title="Delete Item"
          >
            <Trash2 size={16} className="text-red-600" />
          </button>
        </div>
      )}
    </div>
  );
};

  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});
  const itemFileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});

  const handleUploadCategoryImage = async (categoryId: number, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const response = await fetch(`${API_URL}/menu/categories/${categoryId}/image`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to upload category image');
      const { imageUrl } = await response.json();
      setCategories(prev => prev.map(cat =>
        cat.id === categoryId ? { ...cat, image_url: imageUrl } : cat
      ));
    } catch (error) {
      console.error(error);
      alert('Failed to upload category image.');
    }
  };

  const setCategoryFileInputRef = (categoryId: number) => (el: HTMLInputElement | null) => {
    fileInputRefs.current[categoryId] = el;
  };

  const handleUploadMenuItemImage = async (itemId: number, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const response = await fetch(`${API_URL}/menu/items/${itemId}/image`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to upload menu item image');
      const { imageUrl } = await response.json();
      setAllMenuItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, image_url: imageUrl } : item
      ));
      setMenuItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, image_url: imageUrl } : item
      ));
    } catch (error) {
      console.error(error);
      alert('Failed to upload menu item image.');
    }
  };

  // Delete image confirmation state
  const [deleteImageConfirm, setDeleteImageConfirm] = useState<{ 
    show: boolean; 
    type: 'category' | 'item' | null; 
    id: number | null 
  }>({ show: false, type: null, id: null });

  const handleDeleteMenuItemImage = (itemId: number) => {
    setDeleteImageConfirm({ show: true, type: 'item', id: itemId });
  };

  const handleDeleteCategoryImage = (categoryId: number) => {
    setDeleteImageConfirm({ show: true, type: 'category', id: categoryId });
  };

  const confirmDeleteImage = async () => {
    const { type, id } = deleteImageConfirm;
    if (!id) {
      setDeleteImageConfirm({ show: false, type: null, id: null });
      return;
    }
    
    try {
      if (type === 'category') {
        const response = await fetch(`${API_URL}/menu/categories/${id}/image`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error('Failed to delete category image');
        setCategories(prev => prev.map(cat =>
          cat.id === id ? { ...cat, image_url: '' } : cat
        ));
      } else if (type === 'item') {
        const response = await fetch(`${API_URL}/menu/items/${id}/image`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error('Failed to delete menu item image');
        setAllMenuItems(prev => prev.map(item =>
          item.id === id ? { ...item, image_url: '' } : item
        ));
        setMenuItems(prev => prev.map(item =>
          item.id === id ? { ...item, image_url: '' } : item
        ));
      }
      setDeleteImageConfirm({ show: false, type: null, id: null });
    } catch (error) {
      console.error(error);
      setDeleteImageConfirm({ show: false, type: null, id: null });
    }
  };

  const setItemFileInputRef = (itemId: number) => (el: HTMLInputElement | null) => {
    itemFileInputRefs.current[itemId] = el;
  };

  // Delete confirmation modal component
  const DeleteConfirmationModal = () => {
    if (!showDeleteModal || !deleteTarget) return null;

    const { type, group, connectedCategories, connectedItems } = deleteTarget;
    
    const getTypeInfo = () => {
      switch (type) {
        case 'modifier': return { name: 'Modifier Group', color: 'blue' };
        case 'tax': return { name: 'Tax Group', color: 'red' };
        case 'printer': return { name: 'Printer Group', color: 'purple' };
        default: return { name: 'Group', color: 'gray' };
      }
    };

    const typeInfo = getTypeInfo();

    const handleConfirmDelete = async () => {
      try {
        switch (type) {
          case 'modifier':
            await handleDeleteModifierGroup(group.id);
            break;
          case 'tax':
            await handleDeleteTaxGroup(group.id);
            break;
          case 'printer':
            await handleDeletePrinterGroup(group.id);
            break;
        }
        setShowDeleteModal(false);
        setDeleteTarget(null);
      } catch (error) {
        console.error('Failed to delete group:', error);
        // alert('그룹 삭제에 실패했습니다.');
      }
    };

    const handleCancel = () => {
      setShowDeleteModal(false);
      setDeleteTarget(null);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center space-x-3 mb-4">
            <div className={`w-3 h-3 rounded-full bg-${typeInfo.color}-500`}></div>
            <h3 className="text-lg font-semibold text-gray-900">
              Delete {group.name} {typeInfo.name}
            </h3>
          </div>
          
          <div className="mb-4">
            <p className="text-gray-700 mb-4">
              Are you sure you want to delete this {typeInfo.name}?
            </p>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              className="px-4 py-2 text-sm text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Function to check connected items
  const checkConnectedItems = (type: 'modifier' | 'tax' | 'printer', groupId: number) => {


    const connectedCategories: any[] = [];
    const connectedItems: any[] = [];

    // Check category connections
    switch (type) {
      case 'modifier':
        categoryConnections.forEach((connections, categoryId) => {
          const category = categories.find(c => c.category_id === categoryId);
          const hasConnection = connections.some((c: any) => Number(c.modifier_group_id) === Number(groupId));
          if (category && hasConnection) {
            connectedCategories.push(category);
          }
        });
        break;
      case 'tax':
        categoryTaxConnections.forEach((connections, categoryId) => {
          const category = categories.find(c => c.category_id === categoryId);
          if (category && connections.some((c: any) => c.tax_group_id === groupId)) {
            connectedCategories.push(category);
          }
        });
        break;
      case 'printer':
        categoryPrinterConnections.forEach((connections, categoryId) => {
          const category = categories.find(c => c.category_id === categoryId);
          if (category && connections.some((c: any) => c.printer_group_id === groupId)) {
            connectedCategories.push(category);
          }
        });
        break;
    }

    // Check menu item connections
    switch (type) {
      case 'modifier':
        itemModifierConnections.forEach((connections, itemId) => {
          const item = allMenuItems.find(i => i.id === itemId);
          const hasConnection = connections.some((c: any) => Number(c.modifier_group_id) === Number(groupId));
          if (item && hasConnection) {
            connectedItems.push(item);
          }
        });
        break;
      case 'tax':
        itemTaxConnections.forEach((connections, itemId) => {
          const item = allMenuItems.find(i => i.id === itemId);
          if (item && connections.some((c: any) => c.tax_group_id === groupId)) {
            connectedItems.push(item);
          }
        });
        break;
      case 'printer':
        itemPrinterConnections.forEach((connections, itemId) => {
          const item = allMenuItems.find(i => i.id === itemId);
          if (item && connections.some((c: any) => c.printer_group_id === groupId)) {
            connectedItems.push(item);
          }
        });
        break;
    }

    return { connectedCategories, connectedItems };
  };

  // Function to show delete confirmation dialog
  const showDeleteConfirmation = (type: 'modifier' | 'tax' | 'printer', group: any) => {
    const { connectedCategories, connectedItems } = checkConnectedItems(type, group.id);
    
    setDeleteTarget({
      type,
      group,
      connectedCategories,
      connectedItems
    });
    setShowDeleteModal(true);
  };

  // Tooltip component to show connected items
  const ConnectionTooltip = ({ 
    type, 
    groupId, 
    isVisible, 
    position 
  }: { 
    type: 'modifier' | 'tax' | 'printer'; 
    groupId: number; 
    isVisible: boolean; 
    position: { x: number; y: number }; 
  }) => {
    if (!isVisible) return null;

    const { connectedCategories, connectedItems } = checkConnectedItems(type, groupId);
    
    const getTypeInfo = () => {
      switch (type) {
        case 'modifier': return { name: 'Modifier Group', color: 'blue' };
        case 'tax': return { name: 'Tax Group', color: 'red' };
        case 'printer': return { name: 'Printer Group', color: 'indigo' };
        default: return { name: 'Group', color: 'gray' };
      }
    };

    const typeInfo = getTypeInfo();

    return (
      <div 
        className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 max-w-sm"
        style={{
          left: position.x + 10,
          top: position.y - 10,
          transform: 'translateY(-100%)'
        }}
      >
        <div className="flex items-center space-x-2 mb-2">
          <div className={`w-2 h-2 rounded-full bg-${typeInfo.color}-500`}></div>
          <h4 className="font-medium text-gray-900 text-sm">Connected Items</h4>
        </div>
        
        {connectedCategories.length > 0 && (
          <div className="mb-2">
            <h5 className="text-xs font-medium text-gray-700 mb-1">Categories:</h5>
            <div className="space-y-1">
              {connectedCategories.map((category, index) => (
                <div key={index} className="text-xs text-gray-600 flex items-center space-x-1">
                  <span>•</span>
                  <span>{category.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {connectedItems.length > 0 && (
          <div className="mb-2">
            <h5 className="text-xs font-medium text-gray-700 mb-1">Menu Items:</h5>
            <div className="space-y-1">
              {connectedItems.map((item, index) => (
                <div key={index} className="text-xs text-gray-600 flex items-center justify-between">
                  <div className="flex items-center space-x-1">
                    <span>•</span>
                    <span>{item.name}</span>
                  </div>
                  <span className="text-gray-500">${item.price?.toFixed(2) || '0.00'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {connectedCategories.length === 0 && connectedItems.length === 0 && (
          <div className="text-xs text-gray-500">No connected items.</div>
        )}
      </div>
    );
  };

  // Function to show tooltip
  const showTooltip = (type: 'modifier' | 'tax' | 'printer', groupId: number, event: React.MouseEvent) => {
    const { connectedCategories, connectedItems } = checkConnectedItems(type, groupId);
    
    // Highlight connected elements (do not show tooltip modal)
    const newHighlightedElements = {
      categories: connectedCategories.map(cat => cat.category_id),
      items: connectedItems.map(item => item.id)
    };
    
    setHighlightedElements(newHighlightedElements);
  };

  // Function to hide tooltip
  const hideTooltip = () => {
    // Remove highlight effect only (tooltip modal is not shown, so state change not needed)
    setHighlightedElements({ categories: [], items: [] });
  };

  // Backup modal component
  const BackupModal = () => {
    if (!showBackupModal) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-96 max-h-96 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Backup Management</h3>
            <button
              onClick={() => setShowBackupModal(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={20} />
            </button>
          </div>

          {backups.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No backup files found.</p>
          ) : (
            <div className="space-y-3">
              {backups.map((backup, index) => (
                <div key={index} className="border rounded-lg p-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{backup.filename}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(backup.timestamp).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-400">
                        Size: {(backup.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        // Backup file download logic
                        const link = document.createElement('a');
                        link.href = `${API_URL}/menu/${menuId}/backups/${backup.filename}`;
                        link.download = backup.filename;
                        link.click();
                      }}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                    >
                      Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-4 border-t">
            <h4 className="font-medium mb-2">Restore Backup</h4>
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleRestoreBackup(file);
                  setShowBackupModal(false);
                }
              }}
              className="w-full p-2 border rounded"
            />
            {isRestoringBackup && (
              <p className="text-blue-500 text-sm mt-2">Restoring backup...</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Menu edit lock state (persisted in localStorage)
  const [menuEditLocked, setMenuEditLocked] = useState<boolean>(() => {
    try {
      return (localStorage.getItem('menu_edit_locked') || '0') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('menu_edit_locked', menuEditLocked ? '1' : '0');
    } catch {}
  }, [menuEditLocked]);

  if (menuEditLocked) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Menu Manager editing is locked.
      </div>
    );
  }

  return (
    <div className="menu-edit-scope flex flex-col h-screen bg-gray-50" style={{ ['--layer-base' as any]: baseColor, ['--layer-darker' as any]: darkerColor }}>

      {/* Top Tab Navigation */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-6">
        <h1 className="text-xl font-bold text-gray-900 whitespace-nowrap">Menu Manager</h1>
        <div className="flex gap-1">
          <button
            className="px-4 py-2 font-medium rounded-t-lg transition-colors text-sm bg-blue-600 text-white"
          >
            Menu
          </button>
          <button
            onClick={() => navigate('/backoffice/menu?tab=tax')}
            className="px-4 py-2 font-medium rounded-t-lg transition-colors text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            Tax Settings
          </button>
          <button
            onClick={() => navigate('/backoffice/menu?tab=sync')}
            className="px-4 py-2 font-medium rounded-t-lg transition-colors text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            🌐 Thezoneorder Sync
          </button>
        </div>
        {/* Save Button */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExcelExport}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {isExporting ? '⏳' : '📥'} Excel Export
          </button>
          <label className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 cursor-pointer">
            {isImporting ? '⏳' : '📤'} Excel Import
            <input type="file" accept=".xlsx,.xls" onChange={(e) => handleExcelImport(e.target.files?.[0])} className="hidden" />
          </label>
          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      
      <main className="flex-1 flex overflow-hidden">
        <DndContext 
          sensors={sensors} 
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {/* Left Panel - Integrated category and item list */}
          <div className="w-[70%] flex flex-col overflow-hidden">
            						<div className="flex-1 overflow-y-scroll p-4">
              <div className="space-y-2">
                <SortableContext items={itemsByCategory.map(({ category }) => category.id)} strategy={verticalListSortingStrategy}>
                  {itemsByCategory.map(({ category, items }) => (
                    <SortableCategoryBlock
                      key={category.id}
                      category={category}
                      items={items}
                      isCollapsed={collapsedCategories.has(category.id)}
                      onToggleCollapse={toggleCategoryCollapse}
                      onAddItemClick={handleAddItemClick}
                      onDeleteItem={handleDeleteItem}
                      onNavigate={navigate}
                      showInlineForm={showInlineForm}
                      inlineFormData={inlineFormData}
                      setInlineFormData={setInlineFormData}
                      handleInlineFormCancel={handleInlineFormCancel}
                      handleInlineFormSubmit={handleInlineFormSubmit}
                      selectedCategoryId={selectedCategoryId}
                    />
                  ))}
                </SortableContext>
                
                                 {/* New Category Addition Inline Form */}
                 <div className="bg-white rounded-lg border-2 border-blue-300 p-4">
                   {isAddingCategory ? (
                     <div className="flex items-center space-x-2">
                       <input
                         type="text"
                         value={newCategoryName}
                         onChange={(e) => setNewCategoryName(e.target.value)}
                         placeholder="Enter new category name"
                         className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                         autoFocus
                         onKeyDown={(e) => {
                           if (e.key === 'Enter') {
                             if (newCategoryName.trim()) {
                               handleAddCategory(newCategoryName.trim());
                               setNewCategoryName('');
                               setIsAddingCategory(false);
                             }
                           }
                           if (e.key === 'Escape') {
                             setNewCategoryName('');
                             setIsAddingCategory(false);
                           }
                         }}
                       />
                   <button 
                     onClick={() => {
                           if (newCategoryName.trim()) {
                             handleAddCategory(newCategoryName.trim());
                             setNewCategoryName('');
                             setIsAddingCategory(false);
                           }
                         }}
                         className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                       >
                         Add
                       </button>
                       <button 
                         onClick={() => {
                           setNewCategoryName('');
                           setIsAddingCategory(false);
                         }}
                         className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                       >
                         Cancel
                       </button>
                     </div>
                   ) : (
                     <button 
                       onClick={() => setIsAddingCategory(true)}
                       className="flex items-center justify-center space-x-2 text-blue-600 hover:text-blue-700 transition-all duration-300 w-full"
                   >
                     <Plus size={20} />
                     <span>Add New Category</span>
                   </button>
                   )}
                 </div>
              </div>
            </div>
          </div>
          
          {/* Right Panel - Option management */}
          <div className={`${sidebarCollapsed ? 'w-[38%]' : 'w-[30%]'} flex flex-col bg-white border-l border-gray-200 relative transition-all duration-300`}>
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-gray-800">Menu Options</h2>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Base Color</label>
                  <input
                    type="color"
                    value={baseColor}
                    onChange={(e) => setBaseColor(e.target.value)}
                    className="w-6 h-6 p-0 border rounded cursor-pointer"
                    title="Layer Base Color"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <TabButton name="modifier" label="Modifiers" />
                <TabButton name="tax" label="Taxes" />
                <TabButton name="printer" label="Printers" />
              </div>
            </div>
            
            						<div className="flex-1 overflow-y-scroll p-2">
              {activeTab === 'modifier' && (
                						<div className="space-y-4 border-2 border-green-200 rounded-lg p-2 bg-white h-[calc(100vh-120px)] overflow-y-scroll">
                  {editingModifierGroup ? (
                    <ModifierGroupEditor
                      group={editingModifierGroup === 'new' ? null : editingModifierGroup}
                      onSave={handleSaveModifierGroup}
                      onCancel={() => setEditingModifierGroup(null)}
                      isSaving={isSavingModifier}
                    />
                  ) : (
                    <>
                      {/* Add new group button */}
                      <div className="mb-4">
                        <button
                          onClick={() => setEditingModifierGroup('new')}
                          className="w-full flex items-center justify-center space-x-2 p-3 border-2 border-dashed border-green-300 rounded-lg text-green-600 hover:text-green-700 hover:border-green-400 transition-colors"
                        >
                          <Plus size={20} />
                          <span>Add New Modifier Group</span>
                        </button>
                      </div>
                      
                      {/* Draggable modifier group list */}
                      <div className="mb-4 border-2 border-green-300 rounded-lg p-1">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">Drag to connect to categories or menu items</h3>
                        <div className="space-y-1">
                          {modifierGroups.length > 0 ? (
                            modifierGroups.map((group) => (
                              <DraggableModifierGroup
                                key={group.id}
                                group={group}
                                isConnected={
                                  (() => {
                                    const categoryConnected = Array.from(categoryConnections.values()).some(conns => 
                                      conns.some(m => m.modifier_group_id === group.id)
                                    );
                                    const itemConnected = Array.from(itemModifierConnections.values()).some(conns => 
                                      conns.some(m => m.modifier_group_id === group.id)
                                    );
                                    const isConnected = categoryConnected || itemConnected;
                                    
                                    if (isConnected) {
                                      console.log(`🔗 Modifier Group "${group.name}" (ID: ${group.id}) is connected:`, {
                                        categoryConnected,
                                        itemConnected,
                                        categoryConnections: Array.from(categoryConnections.entries()),
                                        itemModifierConnections: Array.from(itemModifierConnections.entries())
                                      });
                                    }
                                    
                                    return isConnected;
                                  })()
                                }
                              />
                            ))
                          ) : (
                            <div className="text-gray-500 text-sm">Loading...</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {activeTab === 'tax' && (
                <div className="space-y-4 border-2 border-red-200 rounded-lg p-2 bg-white h-[calc(100vh-120px)] overflow-y-scroll">
                  {editingTaxGroup ? (
                    <TaxGroupEditor
                      group={editingTaxGroup === 'new' ? null : editingTaxGroup}
                      onSave={handleSaveTaxGroup}
                      onCancel={() => setEditingTaxGroup(null)}
                      isSaving={isSavingTax}
                    />
                  ) : (
                    <>
                      {/* Add new group button */}
                      <div className="mb-4">
                        <button
                          onClick={() => setEditingTaxGroup('new')}
                          className="w-full flex items-center justify-center space-x-2 p-3 border-2 border-dashed border-red-300 rounded-lg text-red-600 hover:text-red-700 hover:border-red-400 transition-colors"
                        >
                          <Plus size={20} />
                          <span>Add New Tax Group</span>
                        </button>
                      </div>
                      
                      {/* Draggable Tax Groups list */}
                      <div className="mb-4 border-2 border-red-300 rounded-lg p-1">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">Drag to connect to categories or menu items</h3>
                        <div className="space-y-1">
                          {taxGroups.length > 0 ? (
                            taxGroups.map((group) => (
                              <DraggableTaxGroup
                                key={group.id}
                                group={group}
                                isConnected={
                                  (() => {
                                    const categoryConnected = Array.from(categoryTaxConnections.values()).some(conns => 
                                      conns.some(t => t.tax_group_id === group.id)
                                    );
                                    const itemConnected = Array.from(itemTaxConnections.values()).some(conns => 
                                      conns.some(t => t.tax_group_id === group.id)
                                    );
                                    const isConnected = categoryConnected || itemConnected;
                                    
                                    if (isConnected) {
                                      console.log(`🔗 Tax Group "${group.name}" (ID: ${group.id}) is connected:`, {
                                        categoryConnected,
                                        itemConnected,
                                        categoryTaxConnections: Array.from(categoryTaxConnections.entries()),
                                        itemTaxConnections: Array.from(itemTaxConnections.entries())
                                      });
                                    }
                                    
                                    return isConnected;
                                  })()
                                }
                              />
                            ))
                          ) : (
                            <div className="text-gray-500 text-sm">Loading...</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {activeTab === 'printer' && (
                <div className="space-y-4 border-2 border-purple-200 rounded-lg p-2 bg-white">
                    <>
                      {/* Guide message */}
                      <div className="mb-2 p-2 bg-purple-50 rounded-lg border border-purple-200">
                        <p className="text-xs text-purple-600">
                          💡 Printer Groups are created/managed in <strong>Hardware Manager → Printer</strong>.
                        </p>
                      </div>
                      
                      {/* Draggable Printer Groups list */}
                      <div className="mb-4 border-2 border-purple-300 rounded-lg p-1">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">Drag to connect to categories or menu items</h3>
                        <div className="space-y-1">
                          {printerGroups.length > 0 ? (
                            printerGroups.map((group) => (
                              <DraggablePrinterGroup
                                key={group.id}
                                group={group}
                                isConnected={
                                  (() => {
                                    const categoryConnected = Array.from(categoryPrinterConnections.values()).some(conns => 
                                      conns.some(p => p.printer_group_id === group.id)
                                    );
                                    const itemConnected = Array.from(itemPrinterConnections.values()).some(conns => 
                                      conns.some(p => p.printer_group_id === group.id)
                                    );
                                    const isConnected = categoryConnected || itemConnected;
                                    
                                    if (isConnected) {
                                      console.log(`🔗 Printer Group "${group.name}" (ID: ${group.id}) is connected:`, {
                                        categoryConnected,
                                        itemConnected,
                                        categoryPrinterConnections: Array.from(categoryPrinterConnections.entries()),
                                        itemPrinterConnections: Array.from(itemPrinterConnections.entries())
                                      });
                                    } else {
                                      // Even if not connected, log for debugging
                                      console.log(`❌ Printer Group "${group.name}" (ID: ${group.id}) is NOT connected. Checking data:`, {
                                        groupId: group.id,
                                        itemPrinterConnections: Array.from(itemPrinterConnections.entries()).map(([itemId, connections]) => ({
                                          itemId,
                                          connections: connections.map(c => ({ printer_group_id: c.printer_group_id, name: c.name }))
                                        }))
                                      });
                                    }
                                    
                                    return isConnected;
                                  })()
                                }
                              />
                            ))
                          ) : (
                            <div className="text-gray-500 text-sm">Loading...</div>
                          )}
                        </div>
                      </div>
                    </>
                </div>
              )}
            </div>
                     </div>
          
          {/* Drag overlay */}
          <DragOverlay>
            {activeDragId && activeDragData?.type === 'modifier' ? (
              <div className="bg-white border-2 border-blue-300 rounded-lg p-3 shadow-lg opacity-90 z-50 transform-none pointer-events-none">
                <div className="flex items-center space-x-3">
                  <div className="flex flex-col space-y-0.5">
                    <div className="w-4 h-0.5 bg-blue-400 rounded"></div>
                    <div className="w-4 h-0.5 bg-blue-400 rounded"></div>
                    <div className="w-4 h-0.5 bg-blue-400 rounded"></div>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{activeDragData.group.name}</h4>
                    <p className="text-sm text-gray-500">
                      {activeDragData.group.selection_type === 'SINGLE' ? 'Single' : 'Multiple'} • 
                        {activeDragData.group.min_selection}-{activeDragData.group.max_selection} selections
                    </p>
                    <p className="text-xs text-blue-600 font-medium">Drag to category or menu item</p>
                  </div>
                </div>
              </div>
            ) : activeDragId && activeDragData?.type === 'tax' ? (
              <div className="bg-white border-2 border-red-300 rounded-lg p-3 shadow-lg opacity-90 z-50 transform-none pointer-events-none">
                <div className="flex items-center space-x-3">
                  <div className="flex flex-col space-y-0.5">
                    <div className="w-4 h-0.5 bg-red-400 rounded"></div>
                    <div className="w-4 h-0.5 bg-red-400 rounded"></div>
                    <div className="w-4 h-0.5 bg-red-400 rounded"></div>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{activeDragData.group.name}</h4>
                    <p className="text-sm text-gray-500">Tax Group</p>
                    <p className="text-xs text-red-600 font-medium">Drag to category or menu item</p>
                  </div>
                </div>
              </div>
            ) : activeDragId && activeDragData?.type === 'printer' ? (
              <div className="bg-white border-2 border-purple-300 rounded-lg p-3 shadow-lg opacity-90 z-50 transform-none pointer-events-none">
                <div className="flex items-center space-x-3">
                  <div className="flex flex-col space-y-0.5">
                    <div className="w-4 h-0.5 bg-purple-400 rounded"></div>
                    <div className="w-4 h-0.5 bg-purple-400 rounded"></div>
                    <div className="w-4 h-0.5 bg-purple-400 rounded"></div>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{activeDragData.group.name}</h4>
                    <p className="text-sm text-gray-500">Printer Group</p>
                    <p className="text-xs text-purple-600 font-medium">Drag to category or menu item</p>
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        
        {/* Delete confirmation modal */}
        <DeleteConfirmationModal />
        
        {/* Connection tooltip */}
        <ConnectionTooltip 
          type={tooltipState.type as 'modifier' | 'tax' | 'printer'} 
          groupId={tooltipState.groupId || 0}
          isVisible={tooltipState.isVisible}
          position={tooltipState.position}
        />
      </main>

      {/* Backup modal */}
      <BackupModal />

      {/* Delete Image Confirmation Modal */}
      {deleteImageConfirm.show && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10001]"
          onClick={() => setDeleteImageConfirm({ show: false, type: null, id: null })}
        >
          <div 
            className="bg-white rounded-2xl p-6 w-[350px] shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl mb-4">🗑️</div>
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
              Delete Image
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {deleteImageConfirm.type === 'category' 
                ? 'Are you sure you want to delete this category image?' 
                : 'Are you sure you want to delete this image?'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setDeleteImageConfirm({ show: false, type: null, id: null })}
                className="px-6 py-2.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteImage}
                className="px-6 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
     </div>
   );
 };

export default MenuEditPage; 
