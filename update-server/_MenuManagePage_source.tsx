import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, where, writeBatch, orderBy, serverTimestamp, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../config/firebase';
import { generateCategoryId, generateMenuItemId, generateModifierGroupId, generateTaxGroupId, generatePrinterGroupId } from '../../utils/firebaseIdGenerator';
import { findDocIdByInternalId } from '../../utils/firestoreDocHelper';
import { Restaurant, MenuCategory, MenuItem } from '../../types';
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor, useDraggable, DragOverlay, useDroppable } from '@dnd-kit/core';
import ExcelMenuUpload from '../../components/menu/ExcelMenuUpload';
import SyncScheduleModal from '../../components/SyncScheduleModal';
import * as XLSX from 'xlsx';
import { 
  Settings, ChevronDown, ChevronUp, GripVertical, 
  X, Edit, Trash2, Save, Search, Plus, Check, Loader2
} from 'lucide-react';

// Firebase 이미지 인터페이스
interface UploadedImage {
  id: string;
  url: string;
  name: string;
  folder: string;
  createdAt: Date;
}

interface MenuManagePageProps {
  restaurant: Restaurant;
  onBack: () => void;
  hideHeader?: boolean;
}

// Types for option groups
interface ModifierOption {
  id: string;
  name: string;
  price_adjustment: number;    // Price_Modi 1 (for menu Price1)
  price_adjustment_2?: number; // Price_Modi 2 (for menu Price2)
}

interface ModifierGroup {
  id: string;
  name: string;
  label?: string;
  min_selection: number;
  max_selection: number;
  modifiers: ModifierOption[];
}

interface TaxItem {
  id: string;
  name: string;
  rate: number;
}

interface TaxGroup {
  id: string;
  name: string;
  taxes: TaxItem[];
}

interface PrinterItem {
  id: string;
  name: string;
  ipAddress?: string;
}

interface PrinterGroup {
  id: string;
  name: string;
  type: string;
  printers: PrinterItem[];
}

type TabName = 'modifier' | 'tax' | 'printer';

// ============================================
// Styles
// ============================================
const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#1e40af',
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'relative' as const,
    zIndex: 1000,
  },
  backButton: {
    padding: '8px 16px',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  headerTitle: {
    color: 'white',
    fontSize: '20px',
    fontWeight: '600',
    margin: 0,
  },
  headerSubtitle: {
    color: '#93c5fd',
    fontSize: '14px',
    margin: 0,
  },
  headerButtons: {
    display: 'flex',
    gap: '12px',
    position: 'relative' as const,
    zIndex: 1001,
  },
  excelButton: {
    padding: '10px 20px',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontWeight: '500',
  },
  categoryButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  menuItemButton: {
    padding: '10px 20px',
    background: 'linear-gradient(to right, #f97316, #ef4444)',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  downloadButton: {
    padding: '10px 20px',
    backgroundColor: '#8b5cf6',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  uploadButton: {
    padding: '10px 20px',
    backgroundColor: '#0ea5e9',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  mainContainer: {
    display: 'flex',
    height: 'calc(100vh - 73px)',
  },
  leftPanel: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
  },
  rightPanel: {
    width: '380px',
    backgroundColor: 'white',
    borderLeft: '1px solid #e2e8f0',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  tabContainer: {
    display: 'flex',
    borderBottom: '1px solid #e2e8f0',
  },
  tab: (isActive: boolean, color: string) => ({
    flex: 1,
    padding: '12px',
    border: 'none',
    backgroundColor: isActive ? `${color}10` : 'transparent',
    borderBottom: isActive ? `3px solid ${color}` : '3px solid transparent',
    color: isActive ? color : '#64748b',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  }),
  tabContent: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
  },
  categoryCard: (isOver: boolean, isSelected: boolean) => ({
    backgroundColor: 'white',
    borderRadius: '12px',
    border: isOver ? '2px solid #3b82f6' : '1px solid #e2e8f0',
    marginBottom: '6px',
    boxShadow: isOver ? '0 4px 12px rgba(59, 130, 246, 0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
    transform: isOver ? 'scale(1.01)' : 'scale(1)',
    transition: 'all 0.2s ease',
  }),
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    cursor: 'pointer',
    gap: '10px',
  },
  categoryIcon: {
    width: '40px',
    height: '40px',
    backgroundColor: '#f1f5f9',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
    fontSize: '11px',
  },
  categoryName: {
    flex: 1,
    fontSize: '16px',
    fontWeight: '600',
    color: '#1e293b',
  },
  itemCount: {
    fontSize: '13px',
    color: '#64748b',
    marginLeft: '8px',
  },
  categoryActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  iconButton: {
    padding: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryItems: {
    padding: '0 16px 12px 16px',
  },
  menuItemCard: (isOver: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px',
    backgroundColor: isOver ? '#eff6ff' : '#f8fafc',
    borderRadius: '8px',
    marginBottom: '4px',
    border: isOver ? '2px solid #3b82f6' : '1px solid #e2e8f0',
    gap: '10px',
    transition: 'all 0.15s ease',
  }),
  itemImage: {
    width: '48px',
    height: '48px',
    backgroundColor: '#e2e8f0',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontSize: '10px',
    flexShrink: 0,
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: '2px',
  },
  itemShortName: {
    fontSize: '13px',
    color: '#64748b',
    marginLeft: '8px',
  },
  itemDescription: {
    fontSize: '12px',
    color: '#94a3b8',
    marginBottom: '4px',
  },
  optionBadge: (type: 'modifier' | 'tax' | 'printer') => ({
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '500',
    marginRight: '4px',
    backgroundColor: type === 'modifier' ? '#f3e8ff' : type === 'tax' ? '#dcfce7' : '#ffedd5',
    color: type === 'modifier' ? '#9333ea' : type === 'tax' ? '#16a34a' : '#ea580c',
  }),
  priceContainer: {
    textAlign: 'right' as const,
    marginRight: '8px',
  },
  price: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#1e293b',
  },
  price2: {
    fontSize: '12px',
    color: '#f97316',
  },
  newItemButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px',
    backgroundColor: '#1e40af',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
    marginTop: '8px',
  },
  optionGroupCard: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    marginBottom: '8px',
    padding: '10px 12px',
    cursor: 'grab',
  },
  optionGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionGroupName: {
    fontWeight: '600',
    fontSize: '14px',
    color: '#1e293b',
  },
  optionBadgeSmall: (isRequired: boolean) => ({
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '500',
    backgroundColor: isRequired ? '#fee2e2' : '#dcfce7',
    color: isRequired ? '#dc2626' : '#16a34a',
  }),
  addGroupButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px',
    border: '2px dashed #3b82f6',
    borderRadius: '8px',
    backgroundColor: 'transparent',
    color: '#3b82f6',
    cursor: 'pointer',
    fontWeight: '500',
    width: '100%',
    marginBottom: '16px',
  },
  dragHint: {
    fontSize: '12px',
    color: '#64748b',
    fontStyle: 'italic',
    marginBottom: '12px',
    padding: '8px',
    backgroundColor: '#f1f5f9',
    borderRadius: '6px',
  },
  modal: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '24px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: '600',
    marginBottom: '20px',
    color: '#1e293b',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
  },
  inputRow: {
    display: 'flex',
    gap: '12px',
  },
  buttonRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '20px',
  },
  cancelButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#e5e7eb',
    border: 'none',
    borderRadius: '8px',
    color: '#374151',
    cursor: 'pointer',
    fontWeight: '500',
  },
  submitButton: {
    flex: 1,
    padding: '12px',
    background: 'linear-gradient(to right, #f97316, #ef4444)',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    cursor: 'pointer',
    fontWeight: '600',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: '8px',
  },
  emptyText: {
    color: '#64748b',
    fontSize: '14px',
  },
};

// ============================================
// Draggable Option Item Component
// ============================================
const DraggableOptionItem: React.FC<{
  id: string;
  type: 'modifier' | 'tax' | 'printer';
  name: string;
  children: React.ReactNode;
}> = ({ id, type, name, children }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${type}-${id}`,
    data: { type, id, name }
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

// ============================================
// Droppable Category Component  
// ============================================
const DroppableCategory: React.FC<{
  category: MenuCategory;
  items: MenuItem[];
  isCollapsed: boolean;
  onToggle: () => void;
  onUpdate: (data: Partial<MenuCategory>) => Promise<void>;
  onDelete: () => void;
  onUpdateItem: (itemId: string, data: Partial<MenuItem>) => Promise<void>;
  onDeleteItem: (itemId: string) => void;
  onAddItem: () => void;
  modifierGroups: ModifierGroup[];
  taxGroups: TaxGroup[];
  individualTaxes: TaxItem[];
  printerGroups: PrinterGroup[];
  onHighlightGroup: (groupId: string | null) => void;
  onSelectImage: (itemId: string) => void;
  onDeleteImage: (itemId: string) => void;
}> = ({ 
  category, items, isCollapsed, onToggle, onUpdate, onDelete, 
  onUpdateItem, onDeleteItem, onAddItem,
  modifierGroups, taxGroups, individualTaxes, printerGroups, onHighlightGroup, onSelectImage, onDeleteImage
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id: category.id,
    data: { type: 'category', category }
  });

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: category.name,
    description: category.description || ''
  });

  const handleStartEdit = () => {
    setEditForm({
      name: category.name,
      description: category.description || ''
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editForm.name.trim()) {
      alert('Category name is required');
      return;
    }
    
    try {
      await onUpdate({
        name: editForm.name.trim(),
        description: editForm.description.trim()
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save changes');
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  // Get connected group names for category
  const getCategoryModifierNames = () => {
    return ((category as any).modifierGroupIds || [])
      .map((id: string) => modifierGroups.find(g => g.id === id)?.name)
      .filter(Boolean);
  };
  const getCategoryTaxNames = () => {
    return ((category as any).taxGroupIds || [])
      .map((id: string) => taxGroups.find(g => g.id === id)?.name)
      .filter(Boolean);
  };
  const getCategoryPrinterNames = () => {
    return ((category as any).printerGroupIds || [])
      .map((id: string) => printerGroups.find(g => g.id === id)?.name)
      .filter(Boolean);
  };

  const categoryModifiers = getCategoryModifierNames();
  const categoryTaxes = getCategoryTaxNames();
  const categoryPrinters = getCategoryPrinterNames();
  const hasConnectedGroups = categoryModifiers.length > 0 || categoryTaxes.length > 0 || categoryPrinters.length > 0;

  // Edit mode render
  if (isEditing) {
    return (
      <div ref={setNodeRef} style={{ ...styles.categoryCard(false, false), backgroundColor: '#fffbeb', border: '2px solid #f59e0b' }}>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            placeholder="Category Name"
            style={{ flex: 2, minWidth: '150px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '15px', fontWeight: '600' }}
            autoFocus
          />
          <input
            type="text"
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            placeholder="Description (optional)"
            style={{ flex: 3, minWidth: '200px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
          />
          <button 
            onClick={handleSave}
            style={{ padding: '8px 16px', backgroundColor: '#22c55e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Save size={14} /> Save
          </button>
          <button 
            onClick={handleCancel}
            style={{ padding: '8px 16px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <X size={14} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  // Normal mode render
  return (
    <div ref={setNodeRef} style={styles.categoryCard(isOver, false)}>
      <div style={styles.categoryHeader} onClick={onToggle}>
        <div style={{ cursor: 'grab', color: '#94a3b8' }}>
          <GripVertical size={18} />
        </div>
        <div style={styles.categoryIcon}>
          No img
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={styles.categoryName}>
              {category.name}
              <span style={styles.itemCount}>{items.length} items</span>
            </span>
          </div>
          {hasConnectedGroups && (
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '4px', marginTop: '4px' }}>
              {((category as any).modifierGroupIds || []).map((id: string, i: number) => {
                const group = modifierGroups.find(g => g.id === id);
                if (!group) return null;
                return (
                  <span 
                    key={`mod-${i}`} 
                    style={{ fontSize: '12px', padding: '3px 8px', backgroundColor: '#f3e8ff', color: '#9333ea', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
                    onMouseEnter={() => onHighlightGroup(id)}
                    onMouseLeave={() => onHighlightGroup(null)}
                  >
                    M: {group.name}
                  </span>
                );
              })}
              {((category as any).taxIds || []).map((id: string, i: number) => {
                const tax = individualTaxes.find(t => t.id === id);
                if (!tax) return null;
                return (
                  <span 
                    key={`itax-${i}`} 
                    style={{ fontSize: '12px', padding: '3px 8px', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
                    onMouseEnter={() => onHighlightGroup(`individual-tax-${id}`)}
                    onMouseLeave={() => onHighlightGroup(null)}
                    title={`Individual Tax: ${tax.name} (${tax.rate}%)`}
                  >
                    IT: {tax.name}
                  </span>
                );
              })}
              {((category as any).taxGroupIds || []).map((id: string, i: number) => {
                const group = taxGroups.find(g => g.id === id);
                if (!group) return null;
                return (
                  <span 
                    key={`tax-${i}`} 
                    style={{ fontSize: '12px', padding: '3px 8px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
                    onMouseEnter={() => onHighlightGroup(id)}
                    onMouseLeave={() => onHighlightGroup(null)}
                  >
                    T: {group.name}
                  </span>
                );
              })}
              {((category as any).printerGroupIds || []).map((id: string, i: number) => {
                const group = printerGroups.find(g => g.id === id);
                if (!group) return null;
                return (
                  <span 
                    key={`prt-${i}`} 
                    style={{ fontSize: '12px', padding: '3px 8px', backgroundColor: '#ffedd5', color: '#ea580c', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
                    onMouseEnter={() => onHighlightGroup(id)}
                    onMouseLeave={() => onHighlightGroup(null)}
                  >
                    P: {group.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div style={styles.categoryActions}>
          <button style={styles.iconButton} onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}>
            <Edit size={16} color="#64748b" />
          </button>
          <button style={styles.iconButton} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 size={16} color="#ef4444" />
          </button>
          {isCollapsed ? <ChevronDown size={20} color="#64748b" /> : <ChevronUp size={20} color="#64748b" />}
        </div>
      </div>

      {!isCollapsed && (
        <div style={styles.categoryItems}>
          {items.map(item => (
            <DroppableMenuItem
              key={item.id}
              item={item}
              onUpdate={(data) => onUpdateItem(String(item.id), data)}
              onDelete={() => onDeleteItem(String(item.id))}
              modifierGroups={modifierGroups}
              taxGroups={taxGroups}
              individualTaxes={individualTaxes}
              printerGroups={printerGroups}
              onHighlightGroup={onHighlightGroup}
              onSelectImage={onSelectImage}
              onDeleteImage={onDeleteImage}
            />
          ))}
          <button style={styles.newItemButton} onClick={onAddItem}>
            New Item
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================
// Droppable Menu Item Component
// ============================================
const DroppableMenuItem: React.FC<{
  item: MenuItem;
  onUpdate: (data: Partial<MenuItem>) => Promise<void>;
  onDelete: () => void;
  modifierGroups: ModifierGroup[];
  taxGroups: TaxGroup[];
  individualTaxes: TaxItem[];
  printerGroups: PrinterGroup[];
  onHighlightGroup: (groupId: string | null) => void;
  onSelectImage: (itemId: string) => void;
  onDeleteImage: (itemId: string) => void;
}> = ({ item, onUpdate, onDelete, modifierGroups, taxGroups, individualTaxes, printerGroups, onHighlightGroup, onSelectImage, onDeleteImage }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `item-${item.id}`,
    data: { type: 'item', item }
  });

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: item.name,
    shortName: item.shortName || '',
    description: item.description || '',
    price: item.price.toString(),
    price2: (item.price2 || 0).toString()
  });

  const handleStartEdit = () => {
    setEditForm({
      name: item.name,
      shortName: item.shortName || '',
      description: item.description || '',
      price: item.price.toString(),
      price2: (item.price2 || 0).toString()
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editForm.name.trim()) {
      alert('Name is required');
      return;
    }
    
    // Build update data without undefined values (Firebase doesn't accept undefined)
    const updateData: Partial<MenuItem> = {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      price: parseFloat(editForm.price) || 0,
      price2: parseFloat(editForm.price2) || 0
    };
    
    // Only include shortName if it has a value
    if (editForm.shortName.trim()) {
      updateData.shortName = editForm.shortName.trim();
    }
    
    try {
      await onUpdate(updateData);
      setIsEditing(false);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save changes');
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  // Edit mode render
  if (isEditing) {
    return (
      <div ref={setNodeRef} style={{ ...styles.menuItemCard(false), backgroundColor: '#fffbeb', border: '2px solid #f59e0b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            placeholder="Name"
            style={{ flex: 2, minWidth: '120px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
            autoFocus
          />
          <input
            type="text"
            value={editForm.shortName}
            onChange={(e) => setEditForm({ ...editForm, shortName: e.target.value })}
            placeholder="Short Name"
            style={{ flex: 1, minWidth: '80px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
          />
          <input
            type="text"
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            placeholder="Description"
            style={{ flex: 2, minWidth: '120px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
          />
          <input
            type="number"
            step="0.01"
            value={editForm.price}
            onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
            placeholder="Price1"
            style={{ width: '80px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
          />
          <input
            type="number"
            step="0.01"
            value={editForm.price2}
            onChange={(e) => setEditForm({ ...editForm, price2: e.target.value })}
            placeholder="Price2"
            style={{ width: '80px', padding: '6px 10px', border: '1px solid #f97316', borderRadius: '6px', fontSize: '14px', backgroundColor: '#fff7ed' }}
          />
        </div>
        <button 
          onClick={handleSave}
          style={{ padding: '6px 12px', backgroundColor: '#22c55e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Save size={14} /> Save
        </button>
        <button 
          onClick={handleCancel}
          style={{ padding: '6px 12px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <X size={14} /> Cancel
        </button>
      </div>
    );
  }

  // Normal mode render
  return (
    <div ref={setNodeRef} style={styles.menuItemCard(isOver)}>
      <div style={{ cursor: 'grab', color: '#94a3b8' }}>
        <GripVertical size={16} />
      </div>
      {/* 이미지 영역 전체 클릭시 업로드 */}
      <div 
        style={{ ...styles.itemImage, position: 'relative', cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelectImage(String(item.id));
        }}
        title="클릭하여 이미지 업로드"
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }} />
        ) : (
          <span style={{ fontSize: '9px', textAlign: 'center' }}>📷<br/>No img</span>
        )}
        {/* 삭제 버튼 (-) - 이미지가 있을 때만 표시 */}
        {item.imageUrl && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteImage(String(item.id));
            }}
            style={{
              position: 'absolute',
              bottom: '-4px',
              right: '-4px',
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              backgroundColor: 'white',
              border: '1px solid #ef4444',
              color: '#ef4444',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
            title="이미지 삭제"
          >
            −
          </button>
        )}
      </div>
      <div style={styles.itemInfo}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
          <span style={styles.itemName}>{item.name}</span>
          <span style={{ fontSize: '9px', color: '#aaa' }}>({item.id})</span>
          {item.shortName && <span style={styles.itemShortName}>({item.shortName})</span>}
          {item.description && <span style={{ fontSize: '12px', color: '#64748b' }}>- {item.description}</span>}
        </div>
        <div>
          {(item.modifierGroupIds || []).map((id, i) => {
            const group = modifierGroups.find(g => g.id === id);
            if (!group) return null;
            return (
              <span 
                key={`m-${i}`} 
                style={{ ...styles.optionBadge('modifier'), cursor: 'pointer' }}
                onMouseEnter={() => onHighlightGroup(id)}
                onMouseLeave={() => onHighlightGroup(null)}
              >
                {group.name}
              </span>
            );
          })}
          {((item as any).taxIds || []).map((id: string, i: number) => {
            const tax = individualTaxes.find(t => t.id === id);
            if (!tax) return null;
            return (
              <span 
                key={`it-${i}`} 
                style={{ ...styles.optionBadge('tax'), cursor: 'pointer', backgroundColor: '#fef3c7', color: '#92400e' }}
                onMouseEnter={() => onHighlightGroup(`individual-tax-${id}`)}
                onMouseLeave={() => onHighlightGroup(null)}
                title={`Individual Tax: ${tax.name} (${tax.rate}%)`}
              >
                {tax.name}
              </span>
            );
          })}
          {(item.taxGroupIds || []).map((id, i) => {
            const group = taxGroups.find(g => g.id === id);
            if (!group) return null;
            return (
              <span 
                key={`t-${i}`} 
                style={{ ...styles.optionBadge('tax'), cursor: 'pointer' }}
                onMouseEnter={() => onHighlightGroup(id)}
                onMouseLeave={() => onHighlightGroup(null)}
              >
                {group.name}
              </span>
            );
          })}
          {(item.printerGroupIds || []).map((id, i) => {
            const group = printerGroups.find(g => g.id === id);
            if (!group) return null;
            return (
              <span 
                key={`p-${i}`} 
                style={{ ...styles.optionBadge('printer'), cursor: 'pointer' }}
                onMouseEnter={() => onHighlightGroup(id)}
                onMouseLeave={() => onHighlightGroup(null)}
              >
                {group.name}
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
        <span style={styles.price}>${item.price.toFixed(2)}</span>
        <span style={styles.price2}>${(item.price2 || 0).toFixed(2)}</span>
      </div>
      <button style={styles.iconButton} onClick={handleStartEdit}>
        <Edit size={16} color="#64748b" />
      </button>
      <button style={styles.iconButton} onClick={onDelete}>
        <Trash2 size={16} color="#ef4444" />
      </button>
    </div>
  );
};

// ============================================
// Modifier Group Panel
// ============================================
const ModifierGroupPanel: React.FC<{
  restaurantId: string;
  modifierGroups: ModifierGroup[];
  onRefresh: () => void;
  highlightedGroupId: string | null;
}> = ({ restaurantId, modifierGroups, onRefresh, highlightedGroupId }) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | 'new' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    label: '',
    min_selection: 0,
    max_selection: 0,
    modifiers: [{ name: '', price_adjustment: 0, price_adjustment_2: 0 }] as { name: string; price_adjustment: number; price_adjustment_2: number }[]
  });

  const handleNew = () => {
    setEditingGroup('new');
    setFormData({
      name: '',
      label: '',
      min_selection: 0,
      max_selection: 0,
      modifiers: [{ name: '', price_adjustment: 0, price_adjustment_2: 0 }]
    });
  };

  const handleEdit = (group: ModifierGroup) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      label: group.label || '',
      min_selection: group.min_selection,
      max_selection: group.max_selection,
      modifiers: group.modifiers.map(m => ({ 
        name: m.name, 
        price_adjustment: m.price_adjustment,
        price_adjustment_2: m.price_adjustment_2 || 0
      }))
    });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('Group name is required.');
      return;
    }
    
    setIsSaving(true);
    try {
      const groupData: any = {
        restaurantId,
        name: formData.name.trim(),
        min_selection: formData.min_selection,
        max_selection: formData.max_selection,
        modifiers: formData.modifiers.filter(m => m.name.trim()).map((m, i) => ({
          id: `mod-${Date.now()}-${i}`,
          name: m.name.trim(),
          price_adjustment: m.price_adjustment,
          price_adjustment_2: m.price_adjustment_2,
        })),
        updatedAt: new Date()
      };
      
      // Only add label if it's not empty
      if (formData.label.trim()) {
        groupData.label = formData.label.trim();
      }

      if (editingGroup === 'new') {
        // Generate ID using SQLite rules
        const newId = await generateModifierGroupId(restaurantId);
        const docId = String(newId); // Document ID를 숫자 ID 문자열로 사용
        
        await setDoc(doc(db, 'restaurants', restaurantId, 'modifierGroups', docId), {
          id: newId, // 내부 id 필드도 동일한 값으로 저장
          ...groupData,
          createdAt: new Date()
        });
      } else {
        // 기존 문서 업데이트: 내부 id 필드로 Document ID 찾기
        const editingGroupId = (editingGroup as ModifierGroup).id;
        const docId = await findDocIdByInternalId(
          `restaurants/${restaurantId}/modifierGroups`,
          editingGroupId
        );
        
        if (!docId) {
          throw new Error(`Document not found for modifier group ID: ${editingGroupId}`);
        }
        
        await updateDoc(doc(db, 'restaurants', restaurantId, 'modifierGroups', docId), groupData);
      }
      
      setEditingGroup(null);
      onRefresh();
    } catch (error) {
      console.error('Error saving modifier group:', error);
      alert('Failed to save modifier group.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (groupId: string | number) => {
    if (!window.confirm('Delete this modifier group?')) return;
    try {
      // 내부 id 필드로 Document ID 찾기
      const docId = await findDocIdByInternalId(
        `restaurants/${restaurantId}/modifierGroups`,
        groupId
      );
      
      if (!docId) {
        throw new Error(`Document not found for modifier group ID: ${groupId}`);
      }
      
      await deleteDoc(doc(db, 'restaurants', restaurantId, 'modifierGroups', docId));
      onRefresh();
    } catch (error) {
      console.error('Error deleting:', error);
      alert('Failed to delete modifier group.');
    }
  };

  // Editor
  if (editingGroup) {
    return (
      <div style={{ padding: '4px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>
          {editingGroup === 'new' ? 'New' : 'Edit'} Modifier Group
        </h3>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>Group Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            style={styles.input}
            placeholder="e.g., Size Selection"
          />
        </div>

        <div style={{ ...styles.inputRow, marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Label</label>
            <input
              type="text"
              value={formData.label}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              style={styles.input}
            />
          </div>
          <div style={{ width: '80px' }}>
            <label style={styles.label}>Min</label>
            <input
              type="number"
              value={formData.min_selection}
              onChange={(e) => setFormData({ ...formData, min_selection: parseInt(e.target.value) || 0 })}
              style={styles.input}
              min="0"
            />
          </div>
          <div style={{ width: '80px' }}>
            <label style={styles.label}>Max</label>
            <input
              type="number"
              value={formData.max_selection}
              onChange={(e) => setFormData({ ...formData, max_selection: parseInt(e.target.value) || 0 })}
              style={styles.input}
              min="0"
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Options</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '4px', fontSize: '11px', color: '#64748b' }}>
            <span style={{ flex: 1 }}>Option Name</span>
            <span style={{ width: '75px', textAlign: 'center' }}>Price 1</span>
            <span style={{ width: '75px', textAlign: 'center', color: '#f97316' }}>Price 2</span>
            <span style={{ width: '28px' }}></span>
          </div>
          {formData.modifiers.map((mod, index) => (
            <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={mod.name}
                onChange={(e) => {
                  const newMods = [...formData.modifiers];
                  newMods[index].name = e.target.value;
                  setFormData({ ...formData, modifiers: newMods });
                }}
                style={{ ...styles.input, flex: 1 }}
                placeholder="Option name"
              />
              <input
                type="number"
                step="0.01"
                value={mod.price_adjustment}
                onChange={(e) => {
                  const newMods = [...formData.modifiers];
                  newMods[index].price_adjustment = parseFloat(e.target.value) || 0;
                  setFormData({ ...formData, modifiers: newMods });
                }}
                style={{ ...styles.input, width: '75px' }}
                placeholder="P1"
              />
              <input
                type="number"
                step="0.01"
                value={mod.price_adjustment_2}
                onChange={(e) => {
                  const newMods = [...formData.modifiers];
                  newMods[index].price_adjustment_2 = parseFloat(e.target.value) || 0;
                  setFormData({ ...formData, modifiers: newMods });
                }}
                style={{ ...styles.input, width: '75px', borderColor: '#f97316', backgroundColor: '#fff7ed' }}
                placeholder="P2"
              />
              <button
                onClick={() => setFormData({ ...formData, modifiers: formData.modifiers.filter((_, i) => i !== index) })}
                style={{ ...styles.iconButton, color: '#ef4444' }}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setFormData({ ...formData, modifiers: [...formData.modifiers, { name: '', price_adjustment: 0, price_adjustment_2: 0 }] })}
            style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}
          >
            + Add Option
          </button>
        </div>

        <div style={styles.buttonRow}>
          <button onClick={() => setEditingGroup(null)} style={styles.cancelButton}>Cancel</button>
          <button onClick={handleSave} disabled={isSaving} style={{ ...styles.submitButton, opacity: isSaving ? 0.5 : 1 }}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  // List
  return (
    <div>
      <button onClick={handleNew} style={styles.addGroupButton}>
        <Plus size={18} /> Add New Modifier Group
      </button>
      
      <div style={styles.dragHint}>
        💡 Drag to connect to categories or menu items
      </div>

      {modifierGroups.map(group => (
        <DraggableOptionItem key={group.id} id={group.id} type="modifier" name={group.name}>
          <div style={{
            ...styles.optionGroupCard,
            ...(highlightedGroupId === group.id ? { 
              border: '2px solid #22c55e', 
              boxShadow: '0 0 12px rgba(34, 197, 94, 0.5)',
              backgroundColor: '#f0fdf4'
            } : {})
          }}>
            <div style={styles.optionGroupHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GripVertical size={14} color="#94a3b8" />
                <span style={styles.optionGroupName}>{group.name}</span>
                {group.label && (
                  <span style={{ fontSize: '11px', padding: '2px 6px', backgroundColor: '#dbeafe', color: '#1d4ed8', borderRadius: '4px' }}>
                    {group.label}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={styles.optionBadgeSmall(group.min_selection > 0)}>
                  {group.min_selection > 0 ? `Required` : 'Optional'}
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  Min: {group.min_selection}, Max: {group.max_selection}
                </span>
                <button onClick={() => handleEdit(group)} style={styles.iconButton}>
                  <Edit size={14} color="#64748b" />
                </button>
                <button onClick={() => handleDelete(group.id)} style={styles.iconButton}>
                  <Trash2 size={14} color="#ef4444" />
                </button>
              </div>
            </div>
          </div>
        </DraggableOptionItem>
      ))}

      {modifierGroups.length === 0 && (
        <p style={{ textAlign: 'center', color: '#64748b', padding: '20px' }}>
          No modifier groups yet
        </p>
      )}
    </div>
  );
};

// ============================================
// Tax Group Panel
// ============================================
const TaxGroupPanel: React.FC<{
  restaurantId: string;
  taxGroups: TaxGroup[];
  onRefresh: () => void;
  highlightedGroupId: string | null;
}> = ({ restaurantId, taxGroups, onRefresh, highlightedGroupId }) => {
  // Individual Tax 상태
  const [individualTaxes, setIndividualTaxes] = useState<TaxItem[]>([]);
  const [editingIndividualTax, setEditingIndividualTax] = useState<TaxItem | 'new' | null>(null);
  const [individualTaxForm, setIndividualTaxForm] = useState({ name: '', rate: 0 });
  
  // Group Tax 상태
  const [editingGroup, setEditingGroup] = useState<TaxGroup | 'new' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ name: '', taxes: [{ name: '', rate: 0 }] });

  // Individual Tax 로드
  useEffect(() => {
    const loadIndividualTaxes = async () => {
      try {
        const taxesQuery = query(collection(db, 'restaurants', restaurantId, 'taxes'));
        const taxesSnap = await getDocs(taxesQuery);
        const taxesData = taxesSnap.docs.map(d => ({
          id: d.id,
          name: d.data().name || '',
          rate: d.data().rate || 0
        } as TaxItem));
        setIndividualTaxes(taxesData);
      } catch (error) {
        console.error('Error loading individual taxes:', error);
      }
    };
    loadIndividualTaxes();
  }, [restaurantId, onRefresh]);

  // Individual Tax 핸들러
  const handleNewIndividualTax = () => {
    setEditingIndividualTax('new');
    setIndividualTaxForm({ name: '', rate: 0 });
  };

  const handleSaveIndividualTax = async () => {
    if (!individualTaxForm.name.trim()) return alert('Tax name is required.');
    setIsSaving(true);
    try {
      const taxData = {
        restaurantId,
        name: individualTaxForm.name.trim(),
        rate: individualTaxForm.rate,
        updatedAt: new Date()
      };
      if (editingIndividualTax === 'new') {
        await addDoc(collection(db, 'restaurants', restaurantId, 'taxes'), { ...taxData, createdAt: new Date() });
      } else {
        await updateDoc(doc(db, 'restaurants', restaurantId, 'taxes', (editingIndividualTax as TaxItem).id), taxData);
      }
      setEditingIndividualTax(null);
      onRefresh();
      // Individual Tax 목록 새로고침
      const taxesQuery = query(collection(db, 'restaurants', restaurantId, 'taxes'));
      const taxesSnap = await getDocs(taxesQuery);
      const taxesData = taxesSnap.docs.map(d => ({
        id: d.id,
        name: d.data().name || '',
        rate: d.data().rate || 0
      } as TaxItem));
      setIndividualTaxes(taxesData);
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteIndividualTax = async (taxId: string) => {
    if (!window.confirm('Delete this individual tax?')) return;
    try {
      await deleteDoc(doc(db, 'restaurants', restaurantId, 'taxes', taxId));
      setIndividualTaxes(prev => prev.filter(t => t.id !== taxId));
      onRefresh();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Group Tax 핸들러
  const handleNew = () => {
    setEditingGroup('new');
    setFormData({ name: '', taxes: [{ name: '', rate: 0 }, { name: '', rate: 0 }] });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return alert('Group name is required.');
    setIsSaving(true);
    try {
      const groupData: any = {
        restaurantId,
        name: formData.name.trim(),
        taxes: formData.taxes.filter(t => t.name.trim()).map((t, i) => ({
          id: `tax-${Date.now()}-${i}`,
          name: t.name.trim(),
          rate: t.rate,
        })),
        updatedAt: new Date()
      };
      if (editingGroup === 'new') {
        // Generate ID using SQLite rules
        const newId = await generateTaxGroupId(restaurantId);
        const docId = String(newId); // Document ID를 숫자 ID 문자열로 사용
        
        await setDoc(doc(db, 'restaurants', restaurantId, 'taxGroups', docId), {
          id: newId, // 내부 id 필드도 동일한 값으로 저장
          ...groupData,
          createdAt: new Date()
        });
      } else {
        // 기존 문서 업데이트: 내부 id 필드로 Document ID 찾기
        const editingGroupId = (editingGroup as TaxGroup).id;
        const docId = await findDocIdByInternalId(
          `restaurants/${restaurantId}/taxGroups`,
          editingGroupId
        );
        
        if (!docId) {
          throw new Error(`Document not found for tax group ID: ${editingGroupId}`);
        }
        
        await updateDoc(doc(db, 'restaurants', restaurantId, 'taxGroups', docId), groupData);
      }
      setEditingGroup(null);
      onRefresh();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!window.confirm('Delete this tax group?')) return;
    try {
      // 내부 id 필드로 Document ID 찾기
      const docId = await findDocIdByInternalId(
        `restaurants/${restaurantId}/taxGroups`,
        groupId
      );
      
      if (!docId) {
        throw new Error(`Document not found for tax group ID: ${groupId}`);
      }
      
      await deleteDoc(doc(db, 'restaurants', restaurantId, 'taxGroups', docId));
      onRefresh();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Individual Tax 편집 폼
  if (editingIndividualTax) {
    return (
      <div style={{ padding: '4px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>
          {editingIndividualTax === 'new' ? 'New' : 'Edit'} Individual Tax
        </h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Tax Name</label>
          <input
            type="text"
            value={individualTaxForm.name}
            onChange={(e) => setIndividualTaxForm({ ...individualTaxForm, name: e.target.value })}
            style={styles.input}
            placeholder="e.g., Sales Tax"
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Tax Rate (%)</label>
          <input
            type="number"
            step="0.01"
            value={individualTaxForm.rate}
            onChange={(e) => setIndividualTaxForm({ ...individualTaxForm, rate: parseFloat(e.target.value) || 0 })}
            style={styles.input}
            placeholder="e.g., 8.875"
          />
        </div>
        <div style={styles.buttonRow}>
          <button onClick={() => setEditingIndividualTax(null)} style={styles.cancelButton}>Cancel</button>
          <button onClick={handleSaveIndividualTax} disabled={isSaving} style={{ ...styles.submitButton, opacity: isSaving ? 0.5 : 1 }}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  // Group Tax 편집 폼
  if (editingGroup) {
    return (
      <div style={{ padding: '4px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>
          {editingGroup === 'new' ? 'New' : 'Edit'} Tax Group
        </h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Group Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            style={styles.input}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Taxes</label>
          {formData.taxes.map((tax, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                value={tax.name}
                onChange={(e) => {
                  const newTaxes = [...formData.taxes];
                  newTaxes[i].name = e.target.value;
                  setFormData({ ...formData, taxes: newTaxes });
                }}
                style={{ ...styles.input, flex: 1 }}
                placeholder="Tax name"
              />
              <input
                type="number"
                step="0.01"
                value={tax.rate}
                onChange={(e) => {
                  const newTaxes = [...formData.taxes];
                  newTaxes[i].rate = parseFloat(e.target.value) || 0;
                  setFormData({ ...formData, taxes: newTaxes });
                }}
                style={{ ...styles.input, width: '80px' }}
                placeholder="%"
              />
              <button onClick={() => setFormData({ ...formData, taxes: formData.taxes.filter((_, idx) => idx !== i) })} style={styles.iconButton}>
                <X size={16} color="#ef4444" />
              </button>
            </div>
          ))}
          <button onClick={() => setFormData({ ...formData, taxes: [...formData.taxes, { name: '', rate: 0 }] })} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
            + Add Tax
          </button>
        </div>
        <div style={styles.buttonRow}>
          <button onClick={() => setEditingGroup(null)} style={styles.cancelButton}>Cancel</button>
          <button onClick={handleSave} disabled={isSaving} style={{ ...styles.submitButton, opacity: isSaving ? 0.5 : 1 }}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Individual Tax 섹션 */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>Individual Taxes</h4>
          <button onClick={handleNewIndividualTax} style={{ ...styles.addGroupButton, padding: '8px 12px', fontSize: '13px' }}>
            <Plus size={14} /> Add Individual Tax
          </button>
        </div>
        <div style={styles.dragHint}>💡 Drag to connect to categories or items</div>
        {individualTaxes.map(tax => (
          <DraggableOptionItem key={`individual-${tax.id}`} id={`individual-tax-${tax.id}`} type="tax" name={tax.name}>
            <div style={{
              ...styles.optionGroupCard,
              backgroundColor: '#fef3c7',
              border: '1px solid #fbbf24',
              ...(highlightedGroupId === `individual-tax-${tax.id}` ? { 
                border: '2px solid #f59e0b', 
                boxShadow: '0 0 12px rgba(245, 158, 11, 0.5)',
                backgroundColor: '#fef3c7'
              } : {})
            }}>
              <div style={styles.optionGroupHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <GripVertical size={14} color="#94a3b8" />
                  <span style={{ ...styles.optionGroupName, color: '#92400e' }}>{tax.name}</span>
                  <span style={{ fontSize: '11px', color: '#64748b', padding: '2px 6px', backgroundColor: '#fef3c7', borderRadius: '4px' }}>
                    Individual
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontWeight: '600', color: '#92400e' }}>{tax.rate.toFixed(2)}%</span>
                  <button onClick={() => { setEditingIndividualTax(tax); setIndividualTaxForm({ name: tax.name, rate: tax.rate }); }} style={styles.iconButton}>
                    <Edit size={14} color="#64748b" />
                  </button>
                  <button onClick={() => handleDeleteIndividualTax(tax.id)} style={styles.iconButton}>
                    <Trash2 size={14} color="#ef4444" />
                  </button>
                </div>
              </div>
            </div>
          </DraggableOptionItem>
        ))}
        {individualTaxes.length === 0 && <p style={{ textAlign: 'center', color: '#64748b', padding: '12px', fontSize: '12px' }}>No individual taxes yet</p>}
      </div>

      {/* Group Tax 섹션 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>Tax Groups</h4>
          <button onClick={handleNew} style={{ ...styles.addGroupButton, padding: '8px 12px', fontSize: '13px' }}>
            <Plus size={14} /> Add Tax Group
          </button>
        </div>
        <div style={styles.dragHint}>💡 Drag to connect to categories or items</div>
        {taxGroups.map(group => (
          <DraggableOptionItem key={group.id} id={group.id} type="tax" name={group.name}>
            <div style={{
              ...styles.optionGroupCard,
              ...(highlightedGroupId === group.id ? { 
                border: '2px solid #22c55e', 
                boxShadow: '0 0 12px rgba(34, 197, 94, 0.5)',
                backgroundColor: '#f0fdf4'
              } : {})
            }}>
              <div style={styles.optionGroupHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <GripVertical size={14} color="#94a3b8" />
                  <span style={styles.optionGroupName}>{group.name}</span>
                  <span style={{ fontSize: '11px', color: '#64748b', padding: '2px 6px', backgroundColor: '#dcfce7', borderRadius: '4px' }}>
                    Group
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontWeight: '600' }}>{(group.taxes || []).reduce((sum, t) => sum + t.rate, 0).toFixed(2)}%</span>
                  <button onClick={() => { setEditingGroup(group); setFormData({ name: group.name, taxes: (group.taxes || []).map(t => ({ name: t.name, rate: t.rate })) }); }} style={styles.iconButton}>
                    <Edit size={14} color="#64748b" />
                  </button>
                  <button onClick={() => handleDelete(group.id)} style={styles.iconButton}>
                    <Trash2 size={14} color="#ef4444" />
                  </button>
                </div>
              </div>
            </div>
          </DraggableOptionItem>
        ))}
        {taxGroups.length === 0 && <p style={{ textAlign: 'center', color: '#64748b', padding: '12px', fontSize: '12px' }}>No tax groups yet</p>}
      </div>
    </div>
  );
};

// ============================================
// Printer Group Panel
// ============================================
const PrinterGroupPanel: React.FC<{
  restaurantId: string;
  printerGroups: PrinterGroup[];
  onRefresh: () => void;
  highlightedGroupId: string | null;
}> = ({ restaurantId, printerGroups, onRefresh, highlightedGroupId }) => {
  const [editingGroup, setEditingGroup] = useState<PrinterGroup | 'new' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ name: '', type: 'kitchen', printers: [{ name: '', ipAddress: '' }] as { name: string; ipAddress?: string }[] });

  const handleNew = () => {
    setEditingGroup('new');
    setFormData({ name: '', type: 'kitchen', printers: [{ name: '', ipAddress: '' }] });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return alert('Group name is required.');
    setIsSaving(true);
    try {
      const groupData: any = {
        restaurantId,
        name: formData.name.trim(),
        type: formData.type,
        printers: formData.printers.filter(p => p.name.trim()).map((p, i) => {
          const printer: any = {
            id: `printer-${Date.now()}-${i}`,
            name: p.name.trim(),
          };
          if (p.ipAddress?.trim()) {
            printer.ipAddress = p.ipAddress.trim();
          }
          return printer;
        }),
        updatedAt: new Date()
      };
      if (editingGroup === 'new') {
        // Generate ID using SQLite rules
        const newId = await generatePrinterGroupId(restaurantId);
        const docId = String(newId); // Document ID를 숫자 ID 문자열로 사용
        
        await setDoc(doc(db, 'restaurants', restaurantId, 'printerGroups', docId), {
          id: newId, // 내부 id 필드도 동일한 값으로 저장
          ...groupData,
          createdAt: new Date()
        });
      } else {
        // 기존 문서 업데이트: 내부 id 필드로 Document ID 찾기
        const editingGroupId = (editingGroup as PrinterGroup).id;
        const docId = await findDocIdByInternalId(
          `restaurants/${restaurantId}/printerGroups`,
          editingGroupId
        );
        
        if (!docId) {
          throw new Error(`Document not found for printer group ID: ${editingGroupId}`);
        }
        
        await updateDoc(doc(db, 'restaurants', restaurantId, 'printerGroups', docId), groupData);
      }
      setEditingGroup(null);
      onRefresh();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!window.confirm('Delete this printer group?')) return;
    try {
      // 내부 id 필드로 Document ID 찾기
      const docId = await findDocIdByInternalId(
        `restaurants/${restaurantId}/printerGroups`,
        groupId
      );
      
      if (!docId) {
        throw new Error(`Document not found for printer group ID: ${groupId}`);
      }
      
      await deleteDoc(doc(db, 'restaurants', restaurantId, 'printerGroups', docId));
      onRefresh();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to delete printer group.');
    }
  };

  if (editingGroup) {
    return (
      <div style={{ padding: '4px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>
          {editingGroup === 'new' ? 'New' : 'Edit'} Printer Group
        </h3>
        <div style={{ ...styles.inputRow, marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Group Name</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={styles.input} />
          </div>
          <div style={{ width: '120px' }}>
            <label style={styles.label}>Type</label>
            <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} style={styles.input}>
              <option value="kitchen">Kitchen</option>
              <option value="receipt">Receipt</option>
              <option value="label">Label</option>
            </select>
          </div>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Printers</label>
          {formData.printers.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input type="text" value={p.name} onChange={(e) => { const newP = [...formData.printers]; newP[i].name = e.target.value; setFormData({ ...formData, printers: newP }); }} style={{ ...styles.input, flex: 1 }} placeholder="Printer name" />
              <input type="text" value={p.ipAddress || ''} onChange={(e) => { const newP = [...formData.printers]; newP[i].ipAddress = e.target.value; setFormData({ ...formData, printers: newP }); }} style={{ ...styles.input, width: '120px' }} placeholder="IP Address" />
              <button onClick={() => setFormData({ ...formData, printers: formData.printers.filter((_, idx) => idx !== i) })} style={styles.iconButton}><X size={16} color="#ef4444" /></button>
            </div>
          ))}
          <button onClick={() => setFormData({ ...formData, printers: [...formData.printers, { name: '', ipAddress: '' }] })} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>+ Add Printer</button>
        </div>
        <div style={styles.buttonRow}>
          <button onClick={() => setEditingGroup(null)} style={styles.cancelButton}>Cancel</button>
          <button onClick={handleSave} disabled={isSaving} style={{ ...styles.submitButton, opacity: isSaving ? 0.5 : 1 }}>{isSaving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={handleNew} style={styles.addGroupButton}><Plus size={18} /> Add New Printer Group</button>
      <div style={styles.dragHint}>💡 Printer groups are synced from POS. Drag to connect to categories or items.</div>

      {printerGroups.map(group => (
        <DraggableOptionItem key={group.id} id={group.id} type="printer" name={group.name}>
          <div style={{
            ...styles.optionGroupCard,
            ...(highlightedGroupId === group.id ? { 
              border: '2px solid #22c55e', 
              boxShadow: '0 0 12px rgba(34, 197, 94, 0.5)',
              backgroundColor: '#f0fdf4'
            } : {})
          }}>
            <div style={styles.optionGroupHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GripVertical size={14} color="#94a3b8" />
                <span style={styles.optionGroupName}>{group.name}</span>
                <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#e2e8f0', borderRadius: '4px', textTransform: 'uppercase' }}>{group.type}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>{group.printers.length} printer{group.printers.length !== 1 ? 's' : ''}</span>
                <button onClick={() => { setEditingGroup(group); setFormData({ name: group.name, type: group.type, printers: group.printers.map(p => ({ name: p.name, ipAddress: p.ipAddress })) }); }} style={styles.iconButton}><Edit size={14} color="#64748b" /></button>
                <button onClick={() => handleDelete(group.id)} style={styles.iconButton}><Trash2 size={14} color="#ef4444" /></button>
              </div>
            </div>
          </div>
        </DraggableOptionItem>
      ))}
      {printerGroups.length === 0 && <p style={{ textAlign: 'center', color: '#64748b', padding: '20px' }}>No printer groups yet</p>}
    </div>
  );
};

// ============================================
// Main Menu Manager Page
// ============================================
export default function MenuManagePage({ restaurant, onBack, hideHeader = false }: MenuManagePageProps) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [taxGroups, setTaxGroups] = useState<TaxGroup[]>([]);
  const [individualTaxes, setIndividualTaxes] = useState<TaxItem[]>([]);
  const [printerGroups, setPrinterGroups] = useState<PrinterGroup[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabName>('modifier');
  
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [selectedCategoryForItem, setSelectedCategoryForItem] = useState<string | null>(null);
  const [showExcelUpload, setShowExcelUpload] = useState(false);
  
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [itemForm, setItemForm] = useState({ name: '', shortName: '', description: '', price: '', price2: '' });
  const [saving, setSaving] = useState(false);

  const [activeDragData, setActiveDragData] = useState<any>(null);
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pushingToPOS, setPushingToPOS] = useState(false);
  const [pullingFromPOS, setPullingFromPOS] = useState(false);
  
  // Sync Progress Modal State
  const [showSyncProgressModal, setShowSyncProgressModal] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    type: 'pull' | 'push';
    currentStep: number;
    totalSteps: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    steps: { name: string; status: 'pending' | 'processing' | 'completed' | 'failed'; message?: string }[];
    error?: string;
  }>({
    type: 'pull',
    currentStep: 0,
    totalSteps: 4,
    status: 'pending',
    steps: []
  });
  
  // Sync Schedule Modal State
  const [showSyncScheduleModal, setShowSyncScheduleModal] = useState(false);
  
  // Excel Export 함수 (POS 양식과 동일)
  const handleExportToExcel = () => {
    try {
      const wb = XLSX.utils.book_new();

      // --- Sheet 1: Menu Date (POS format) ---
      const menuDataRows: any[] = [];
      let rowNo = 1;

      const itemsByCategory: Record<string, any[]> = {};
      for (const item of menuItems) {
        const cat = categories.find((c: any) => c.id === item.categoryId);
        const catName = cat?.name || 'Uncategorized';
        if (!itemsByCategory[catName]) itemsByCategory[catName] = [];
        itemsByCategory[catName].push(item);
      }

      for (const cat of categories) {
        const catModNames: string[] = [];
        ((cat as any).modifierGroupIds || []).forEach((mgId: string) => {
          const mg = modifierGroups.find(g => g.id === mgId);
          if (mg) catModNames.push(mg.name);
        });
        const catTaxNames: string[] = [];
        ((cat as any).taxGroupIds || []).forEach((tgId: string) => {
          const tg = taxGroups.find(g => g.id === tgId);
          if (tg) catTaxNames.push(tg.name);
        });
        const catPrinterNames: string[] = [];
        ((cat as any).printerGroupIds || []).forEach((pgId: string) => {
          const pg = printerGroups.find(g => g.id === pgId);
          if (pg) catPrinterNames.push(pg.name);
        });

        const headerRow: any = {
          'No': cat.name,
          'Category': cat.name,
          'Item Name': '',
          'Short Name': '',
          'Price': '',
          'Price2': '',
          'Description': '',
        };
        for (let i = 0; i < 5; i++) headerRow[`Modifier Group ${i + 1}`] = catModNames[i] || '';
        for (let i = 0; i < 3; i++) headerRow[`Tax Group ${i + 1}`] = catTaxNames[i] || '';
        for (let i = 0; i < 3; i++) headerRow[`Printer Group ${i + 1}`] = catPrinterNames[i] || '';
        menuDataRows.push(headerRow);

        const catItems = itemsByCategory[cat.name] || [];
        catItems.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

        for (const item of catItems) {
          const itemModNames: string[] = [];
          (item.modifierGroupIds || []).forEach((mgId: string) => {
            const mg = modifierGroups.find(g => g.id === mgId);
            if (mg) itemModNames.push(mg.name);
          });
          const itemTaxNames: string[] = [];
          (item.taxGroupIds || []).forEach((tgId: string) => {
            const tg = taxGroups.find(g => g.id === tgId);
            if (tg) itemTaxNames.push(tg.name);
          });
          const itemPrinterNames: string[] = [];
          (item.printerGroupIds || []).forEach((pgId: string) => {
            const pg = printerGroups.find(g => g.id === pgId);
            if (pg) itemPrinterNames.push(pg.name);
          });

          const row: any = {
            'No': rowNo++,
            'Category': cat.name,
            'Item Name': item.name,
            'Short Name': item.shortName || '',
            'Price': item.price || 0,
            'Price2': item.price2 || 0,
            'Description': item.description || '',
          };
          for (let i = 0; i < 5; i++) row[`Modifier Group ${i + 1}`] = itemModNames[i] || '';
          for (let i = 0; i < 3; i++) row[`Tax Group ${i + 1}`] = itemTaxNames[i] || '';
          for (let i = 0; i < 3; i++) row[`Printer Group ${i + 1}`] = itemPrinterNames[i] || '';
          menuDataRows.push(row);
        }
      }

      const wsMenu = XLSX.utils.json_to_sheet(menuDataRows);
      XLSX.utils.book_append_sheet(wb, wsMenu, 'Menu Date');

      // --- Sheet 2: Modifiers (POS format) ---
      const modifierRows: any[] = [];
      for (const group of modifierGroups) {
        const row: any = {
          'No': group.id || '',
          'Group Name': group.name,
          'Label': group.label || '',
          'Min': group.min_selection || 0,
          'Max': group.max_selection || 0,
        };
        (group.modifiers || []).forEach((mod: any, i: number) => {
          row[`Modifier ${i + 1}`] = mod.name || '';
          row[`Price ${i + 1}`] = mod.price_adjustment || 0;
        });
        modifierRows.push(row);
      }
      const wsMod = XLSX.utils.json_to_sheet(modifierRows);
      XLSX.utils.book_append_sheet(wb, wsMod, 'Modifiers');

      // --- Sheet 3: Taxes (POS format) ---
      const taxRows: any[] = [];
      for (const group of taxGroups) {
        const row: any = {
          'No': group.id || '',
          'Group Name': group.name,
        };
        (group.taxes || []).forEach((tax: any, i: number) => {
          row[`Tax ${i + 1}`] = tax.name || '';
          row[`Rate ${i + 1}`] = tax.rate || 0;
        });
        taxRows.push(row);
      }
      const wsTax = XLSX.utils.json_to_sheet(taxRows);
      XLSX.utils.book_append_sheet(wb, wsTax, 'Taxes');

      // --- Sheet 4: Printers (POS format) ---
      const printerRows: any[] = [];
      for (const group of printerGroups) {
        printerRows.push({
          'No': group.id || '',
          'Group Name': group.name,
          'Kitchen Type': group.type || '',
        });
      }
      const wsPrinter = XLSX.utils.json_to_sheet(printerRows);
      XLSX.utils.book_append_sheet(wb, wsPrinter, 'Printers');

      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const fileName = `${restaurant.name.replace(/\s+/g, '_')}_Menu_${dateStr}.xlsx`;
      
      XLSX.writeFile(wb, fileName);
      console.log('Excel exported:', fileName);
    } catch (error) {
      console.error('Excel export error:', error);
      alert('Failed to export Excel file');
    }
  };
  
  // Menu Selection Modal State (for Pull From POS)
  const [showMenuSelectModal, setShowMenuSelectModal] = useState(false);
  const [posMenus, setPosMenus] = useState<{ menu_id: number; name: string; channels: string[]; category_count: number; item_count: number }[]>([]);
  const [loadingPosMenus, setLoadingPosMenus] = useState(false);
  const [selectedPosMenuId, setSelectedPosMenuId] = useState<number | null>(null);
  const [newFirebaseMenuName, setNewFirebaseMenuName] = useState('');
  
  const sensors = useSensors(useSensor(PointerSensor, { 
    activationConstraint: { 
      distance: 5,
      delay: 0,
      tolerance: 5
    } 
  }));

  // Hidden file input ref for JSON upload
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ============================================
  // Image Gallery States
  // ============================================
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [firebaseImages, setFirebaseImages] = useState<UploadedImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [selectedImageItemId, setSelectedImageItemId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ total: 0, completed: 0 });
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  // ============================================
  // Image Gallery Functions
  // ============================================
  
  // Load images from Firebase
  const loadFirebaseImages = async () => {
    setLoadingImages(true);
    try {
      const imagesQuery = query(
        collection(db, 'restaurants', restaurant.id, 'images'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(imagesQuery);
      const images = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date()
      })) as UploadedImage[];
      setFirebaseImages(images);
    } catch (error) {
      console.error('Failed to load images:', error);
      setFirebaseImages([]);
    } finally {
      setLoadingImages(false);
    }
  };

  // Open image gallery for a menu item
  const handleOpenImageGallery = (itemId: string) => {
    setSelectedImageItemId(itemId);
    setSelectedImageUrl(null);
    setShowImageGallery(true);
    loadFirebaseImages();
  };

  // Delete image confirmation state
  const [deleteImageConfirm, setDeleteImageConfirm] = useState<{ show: boolean; itemId: string | null }>({ show: false, itemId: null });

  // Delete image from menu item (Firebase Firestore)
  const handleDeleteImage = (itemId: string) => {
    setDeleteImageConfirm({ show: true, itemId });
  };

  const confirmDeleteImage = async () => {
    const itemId = deleteImageConfirm.itemId;
    if (!itemId) return;
    
    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId), {
        imageUrl: '',
        image_url: '',
        updatedAt: new Date()
      });
      
      // Update local state
      setMenuItems(prev => prev.map(item =>
        item.id === itemId
          ? { ...item, imageUrl: '', image_url: '' }
          : item
      ));
      setDeleteImageConfirm({ show: false, itemId: null });
    } catch (error) {
      console.error('Failed to delete image:', error);
      setDeleteImageConfirm({ show: false, itemId: null });
    }
  };

  // Apply selected image to menu item
  const handleApplyImage = async () => {
    if (!selectedImageUrl || !selectedImageItemId) return;
    
    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', selectedImageItemId), {
        imageUrl: selectedImageUrl,
        image_url: selectedImageUrl,
        updatedAt: new Date()
      });
      
      // Update local state
      setMenuItems(prev => prev.map(item =>
        item.id === selectedImageItemId
          ? { ...item, imageUrl: selectedImageUrl, image_url: selectedImageUrl }
          : item
      ));
      
      setShowImageGallery(false);
      setSelectedImageItemId(null);
      setSelectedImageUrl(null);
    } catch (error) {
      console.error('Failed to apply image:', error);
      alert('Failed to apply image. Please try again.');
    }
  };

  // Convert file to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  // Upload new images
  const handleImageUpload = async (files: FileList) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSizeMB = 5;
    
    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (allowedTypes.includes(file.type) && file.size <= maxSizeMB * 1024 * 1024) {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      alert('No valid images selected. Only JPEG, PNG, GIF, WebP under 5MB are allowed.');
      return;
    }

    setUploadingImage(true);
    setUploadProgress({ total: validFiles.length, completed: 0 });

    const functions = getFunctions();
    const uploadImage = httpsCallable(functions, 'uploadImage');

    for (const file of validFiles) {
      try {
        const base64Data = await fileToBase64(file);
        
        const result = await uploadImage({
          imageData: base64Data,
          fileName: file.name,
          contentType: file.type,
          folder: 'menu',
          restaurantId: restaurant.id
        });

        const { url } = result.data as { success: boolean; url: string };
        
        // Save to Firestore
        await addDoc(collection(db, 'restaurants', restaurant.id, 'images'), {
          url,
          name: file.name,
          folder: 'menu',
          createdAt: serverTimestamp()
        });

        setUploadProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
      } catch (error) {
        console.error('Failed to upload:', file.name, error);
      }
    }

    // Refresh the image list
    await loadFirebaseImages();
    setUploadingImage(false);
    
    // Reset file input
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = '';
    }
  };

  // Fetch data - 서브컬렉션 구조 (restaurants/{restaurantId}/...)
  const fetchData = async () => {
    try {
      const restaurantRef = `restaurants/${restaurant.id}`;
      
      // Categories (서브컬렉션)
      const catQuery = query(collection(db, restaurantRef, 'menuCategories'), orderBy('sortOrder', 'asc'));
      const catSnap = await getDocs(catQuery);
      const cats = catSnap.docs.map(d => {
        const data = d.data();
        // 항상 Firebase 문서 ID를 사용 (문자열)
        const id: string = d.id;
        return { id, ...data } as MenuCategory;
      }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      setCategories(cats);
      setCollapsedCategories(new Set(cats.map(c => String(c.id))));

      // Menu items (서브컬렉션)
      const itemQuery = query(collection(db, restaurantRef, 'menuItems'), orderBy('sortOrder', 'asc'));
      const itemSnap = await getDocs(itemQuery);
      const items = itemSnap.docs.map(d => {
        const data = d.data();
        // 항상 Firebase 문서 ID를 사용 (문자열)
        const id: string = d.id;
        return { id, ...data } as MenuItem;
      }).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      setMenuItems(items);

      // Modifier groups (서브컬렉션)
      const modQuery = query(collection(db, restaurantRef, 'modifierGroups'));
      const modSnap = await getDocs(modQuery);
      const modGroups = modSnap.docs.map(d => {
        const data = d.data();
        let id: string | number = d.id;
        if (data.id && typeof data.id === 'number') {
          id = data.id;
        } else {
          const parsed = parseInt(d.id, 10);
          if (!isNaN(parsed)) id = parsed;
        }
        return { id, ...data } as ModifierGroup;
      });
      
      // Modifiers (별도 서브컬렉션) - 각 그룹의 modifiers 로드
      for (const group of modGroups) {
        const modifiersQuery = query(collection(db, restaurantRef, 'modifiers'), where('groupIds', 'array-contains', group.id));
        const modifiersSnap = await getDocs(modifiersQuery);
        group.modifiers = modifiersSnap.docs.map(d => ({
          id: d.id,
          name: d.data().name,
          price_adjustment: d.data().priceDelta || 0,
          price_adjustment_2: d.data().priceDelta2 || 0
        }));
      }
      setModifierGroups(modGroups);

      // Tax groups (서브컬렉션) - taxes 배열이 문서에 포함됨
      const taxGroupQuery = query(collection(db, restaurantRef, 'taxGroups'));
      const taxGroupSnap = await getDocs(taxGroupQuery);
      const taxGroupsData = taxGroupSnap.docs.map(d => {
        const data = d.data();
        let id: string | number = d.id;
        if (data.id && typeof data.id === 'number') {
          id = data.id;
        } else {
          const parsed = parseInt(d.id, 10);
          if (!isNaN(parsed)) id = parsed;
        }
        return {
          id,
          name: data.name || '',
          taxes: data.taxes || []
        } as TaxGroup;
      });
      setTaxGroups(taxGroupsData);

      // Printer groups (서브컬렉션) - 논리적 그룹만
      const printQuery = query(collection(db, restaurantRef, 'printerGroups'));
      const printSnap = await getDocs(printQuery);
      const printerGroupsData = printSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || '',
          type: data.type || 'kitchen',
          printers: []
        } as PrinterGroup;
      });
      setPrinterGroups(printerGroupsData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [restaurant.id]);

  // Helper: Get modifier group display name (name + label)
  const getModifierDisplayName = (group: ModifierGroup) => {
    return group.label ? `${group.name} (${group.label})` : group.name;
  };

  // Helper: Get connected group names for an item
  const getConnectedModifierNames = (groupIds: string[] | undefined) => {
    if (!groupIds || groupIds.length === 0) return '';
    return groupIds
      .map(id => {
        const group = modifierGroups.find(g => g.id === id);
        return group ? getModifierDisplayName(group) : null;
      })
      .filter(Boolean)
      .join(', ');
  };

  const getConnectedTaxNames = (groupIds: string[] | undefined) => {
    if (!groupIds || groupIds.length === 0) return '';
    return groupIds
      .map(id => taxGroups.find(g => g.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  };

  const getConnectedPrinterNames = (groupIds: string[] | undefined) => {
    if (!groupIds || groupIds.length === 0) return '';
    return groupIds
      .map(id => printerGroups.find(g => g.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  };

  // Download menu to Excel file (multi-sheet)
  const handleDownloadMenu = async () => {
    setDownloading(true);
    try {
      const wb = XLSX.utils.book_new();

      // --- Sheet 1: Menu Date (POS format) ---
      const menuDataRows: any[] = [];
      let rowNo = 1;

      const itemsByCategory: Record<string, any[]> = {};
      for (const item of menuItems) {
        const cat = categories.find((c: any) => c.id === item.categoryId);
        const catName = cat?.name || 'Uncategorized';
        if (!itemsByCategory[catName]) itemsByCategory[catName] = [];
        itemsByCategory[catName].push(item);
      }

      for (const cat of categories) {
        const catModNames: string[] = [];
        ((cat as any).modifierGroupIds || []).forEach((mgId: string) => {
          const mg = modifierGroups.find(g => g.id === mgId);
          if (mg) catModNames.push(mg.name);
        });
        const catTaxNames: string[] = [];
        ((cat as any).taxGroupIds || []).forEach((tgId: string) => {
          const tg = taxGroups.find(g => g.id === tgId);
          if (tg) catTaxNames.push(tg.name);
        });
        const catPrinterNames: string[] = [];
        ((cat as any).printerGroupIds || []).forEach((pgId: string) => {
          const pg = printerGroups.find(g => g.id === pgId);
          if (pg) catPrinterNames.push(pg.name);
        });

        const headerRow: any = {
          'No': cat.name,
          'Category': cat.name,
          'Item Name': '',
          'Short Name': '',
          'Price': '',
          'Price2': '',
          'Description': '',
        };
        for (let i = 0; i < 5; i++) headerRow[`Modifier Group ${i + 1}`] = catModNames[i] || '';
        for (let i = 0; i < 3; i++) headerRow[`Tax Group ${i + 1}`] = catTaxNames[i] || '';
        for (let i = 0; i < 3; i++) headerRow[`Printer Group ${i + 1}`] = catPrinterNames[i] || '';
        menuDataRows.push(headerRow);

        const catItems = itemsByCategory[cat.name] || [];
        catItems.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

        for (const item of catItems) {
          const itemModNames: string[] = [];
          (item.modifierGroupIds || []).forEach((mgId: string) => {
            const mg = modifierGroups.find(g => g.id === mgId);
            if (mg) itemModNames.push(mg.name);
          });
          const itemTaxNames: string[] = [];
          (item.taxGroupIds || []).forEach((tgId: string) => {
            const tg = taxGroups.find(g => g.id === tgId);
            if (tg) itemTaxNames.push(tg.name);
          });
          const itemPrinterNames: string[] = [];
          (item.printerGroupIds || []).forEach((pgId: string) => {
            const pg = printerGroups.find(g => g.id === pgId);
            if (pg) itemPrinterNames.push(pg.name);
          });

          const row: any = {
            'No': rowNo++,
            'Category': cat.name,
            'Item Name': item.name,
            'Short Name': item.shortName || '',
            'Price': item.price || 0,
            'Price2': item.price2 || 0,
            'Description': item.description || '',
          };
          for (let i = 0; i < 5; i++) row[`Modifier Group ${i + 1}`] = itemModNames[i] || '';
          for (let i = 0; i < 3; i++) row[`Tax Group ${i + 1}`] = itemTaxNames[i] || '';
          for (let i = 0; i < 3; i++) row[`Printer Group ${i + 1}`] = itemPrinterNames[i] || '';
          menuDataRows.push(row);
        }
      }

      const wsMenu = XLSX.utils.json_to_sheet(menuDataRows);
      XLSX.utils.book_append_sheet(wb, wsMenu, 'Menu Date');

      // --- Sheet 2: Modifiers (POS format - 1 group per row, horizontal) ---
      const modifierRows: any[] = [];
      for (const group of modifierGroups) {
        const row: any = {
          'No': group.id || '',
          'Group Name': group.name,
          'Label': group.label || '',
          'Min': group.min_selection || 0,
          'Max': group.max_selection || 0,
        };
        (group.modifiers || []).forEach((mod: any, i: number) => {
          row[`Modifier ${i + 1}`] = mod.name || '';
          row[`Price ${i + 1}`] = mod.price_adjustment || 0;
        });
        modifierRows.push(row);
      }
      const wsMod = XLSX.utils.json_to_sheet(modifierRows);
      XLSX.utils.book_append_sheet(wb, wsMod, 'Modifiers');

      // --- Sheet 3: Taxes (POS format - 1 group per row, horizontal) ---
      const taxRows: any[] = [];
      for (const group of taxGroups) {
        const row: any = {
          'No': group.id || '',
          'Group Name': group.name,
        };
        (group.taxes || []).forEach((tax: any, i: number) => {
          row[`Tax ${i + 1}`] = tax.name || '';
          row[`Rate ${i + 1}`] = tax.rate || 0;
        });
        taxRows.push(row);
      }
      const wsTax = XLSX.utils.json_to_sheet(taxRows);
      XLSX.utils.book_append_sheet(wb, wsTax, 'Taxes');

      // --- Sheet 4: Printers (POS format - 1 group per row) ---
      const printerRows: any[] = [];
      for (const group of printerGroups) {
        const row: any = {
          'No': group.id || '',
          'Group Name': group.name,
          'Kitchen Type': group.type || '',
        };
        printerRows.push(row);
      }
      const wsPrinter = XLSX.utils.json_to_sheet(printerRows);
      XLSX.utils.book_append_sheet(wb, wsPrinter, 'Printers');

      const fileName = `${restaurant.name.replace(/\s+/g, '_')}_menu_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      alert(`✅ Excel 다운로드 완료!\n\n📄 Categories: ${categories.length}개\n📄 Menu Items: ${menuItems.length}개\n📄 Modifiers: ${modifierGroups.length}개 그룹\n📄 Taxes: ${taxGroups.length}개 그룹\n📄 Printers: ${printerGroups.length}개 그룹`);
    } catch (error) {
      console.error('Error downloading menu:', error);
      alert('Failed to download menu.');
    } finally {
      setDownloading(false);
    }
  };

  // Helper: Parse modifier display name back to name and label
  const parseModifierDisplayName = (displayName: string): { name: string; label: string } => {
    const match = displayName.match(/^(.+?)\s*\((.+)\)$/);
    if (match) {
      return { name: match[1].trim(), label: match[2].trim() };
    }
    return { name: displayName.trim(), label: '' };
  };

  // Upload menu from Excel file (POS 양식: Menu Date, Modifiers, Taxes, Printers)
  const handleUploadMenu = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const toStr = (v: any): string => {
      if (v === null || v === undefined) return '';
      return String(v);
    };

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetNames = workbook.SheetNames;
      console.log('Excel sheets:', sheetNames);

      const menuSheet = workbook.Sheets['Menu Date'] || workbook.Sheets[sheetNames[0]];
      const modifiersSheet = workbook.Sheets['Modifiers'];
      const taxesSheet = workbook.Sheets['Taxes'];
      const printersSheet = workbook.Sheets['Printers'];

      const menuData = XLSX.utils.sheet_to_json(menuSheet) as any[];
      const modifiersData = modifiersSheet ? XLSX.utils.sheet_to_json(modifiersSheet) as any[] : [];
      const taxesData = taxesSheet ? XLSX.utils.sheet_to_json(taxesSheet) as any[] : [];
      const printersData = printersSheet ? XLSX.utils.sheet_to_json(printersSheet) as any[] : [];

      const itemRows = menuData.filter(r => toStr(r['Item Name']).trim() !== '');
      const confirmed = window.confirm(
        `Excel Upload: "${file.name}"\n\n` +
        `Menu Items: ${itemRows.length}\n` +
        `Modifier Groups: ${modifiersData.length}\n` +
        `Tax Groups: ${taxesData.length}\n` +
        `Printer Groups: ${printersData.length}\n\n` +
        `Continue?`
      );

      if (!confirmed) {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      let updatedItems = 0;
      let newItems = 0;
      let updatedModifiers = 0;
      let newModifiers = 0;

      // 1. Process Modifiers Sheet (POS format: 1 group per row, horizontal modifiers)
      for (const row of modifiersData) {
        const groupName = toStr(row['Group Name'] || '').trim();
        const label = toStr(row['Label'] || '').trim();
        const minSel = parseInt(toStr(row['Min'] || 0)) || 0;
        const maxSel = parseInt(toStr(row['Max'] || 0)) || 0;

        if (!groupName) continue;

        const mods: any[] = [];
        for (let i = 1; i <= 50; i++) {
          const modName = toStr(row[`Modifier ${i}`] || '').trim();
          if (!modName) break;
          const modPrice = parseFloat(toStr(row[`Price ${i}`] || 0)) || 0;
          mods.push({ name: modName, price_adjustment: modPrice, price_adjustment_2: 0 });
        }

        const existingGroup = modifierGroups.find(g =>
          g.name.toLowerCase() === groupName.toLowerCase() &&
          (g.label || '').toLowerCase() === label.toLowerCase()
        );

        if (existingGroup) {
          await updateDoc(doc(db, 'restaurants', restaurant.id, 'modifierGroups', existingGroup.id), {
            min_selection: minSel,
            max_selection: maxSel,
            modifiers: mods.map((m, i) => ({ id: `mod-${Date.now()}-${i}`, ...m })),
            updatedAt: new Date()
          });
          updatedModifiers++;
        } else {
          await addDoc(collection(db, 'restaurants', restaurant.id, 'modifierGroups'), {
            name: groupName,
            label: label || '',
            min_selection: minSel,
            max_selection: maxSel,
            modifiers: mods.map((m, i) => ({ id: `mod-${Date.now()}-${i}`, ...m })),
            createdAt: new Date(),
            updatedAt: new Date()
          });
          newModifiers++;
        }
      }

      // 2. Process Taxes Sheet (POS format: 1 group per row, horizontal taxes)
      for (const row of taxesData) {
        const groupName = toStr(row['Group Name'] || '').trim();
        if (!groupName) continue;

        const taxes: any[] = [];
        for (let i = 1; i <= 10; i++) {
          const taxName = toStr(row[`Tax ${i}`] || '').trim();
          if (!taxName) break;
          const rate = parseFloat(toStr(row[`Rate ${i}`] || 0)) || 0;
          taxes.push({ name: taxName, rate });
        }

        const existingGroup = taxGroups.find(g => g.name.toLowerCase() === groupName.toLowerCase());

        if (existingGroup) {
          await updateDoc(doc(db, 'restaurants', restaurant.id, 'taxGroups', existingGroup.id), {
            taxes,
            updatedAt: new Date()
          });
        } else {
          const newTaxGroupId = await generateTaxGroupId(restaurant.id);
          const docId = String(newTaxGroupId);
          await setDoc(doc(db, 'restaurants', restaurant.id, 'taxGroups', docId), {
            id: newTaxGroupId,
            name: groupName,
            taxes,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }

      // 3. Process Printers Sheet (POS format)
      for (const row of printersData) {
        const groupName = toStr(row['Group Name'] || '').trim();
        const kitchenType = toStr(row['Kitchen Type'] || '');
        if (!groupName) continue;

        const existingGroup = printerGroups.find(g => g.name.toLowerCase() === groupName.toLowerCase());

        if (!existingGroup) {
          await addDoc(collection(db, 'restaurants', restaurant.id, 'printerGroups'), {
            name: groupName,
            type: kitchenType || 'kitchen',
            printers: [],
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }

      // Refresh data to get new IDs
      await fetchData();

      const modQuery = query(collection(db, 'restaurants', restaurant.id, 'modifierGroups'));
      const modSnap = await getDocs(modQuery);
      const freshModifierGroups = modSnap.docs.map(d => ({ id: d.id, ...d.data() } as ModifierGroup));

      const taxQuery = query(collection(db, 'restaurants', restaurant.id, 'taxGroups'));
      const taxSnap = await getDocs(taxQuery);
      const freshTaxGroups = taxSnap.docs.map(d => ({ id: d.id, ...d.data() } as TaxGroup));

      const printQuery = query(collection(db, 'restaurants', restaurant.id, 'printerGroups'));
      const printSnap = await getDocs(printQuery);
      const freshPrinterGroups = printSnap.docs.map(d => ({ id: d.id, ...d.data() } as PrinterGroup));

      // 4. Process Menu Date Sheet (POS format: category header rows + item rows)
      // Category header rows: Item Name is empty, No = category name
      // Item rows: Item Name is not empty
      let currentCategoryName = '';

      for (const row of menuData) {
        const categoryCol = toStr(row['Category'] || '').trim();
        const itemName = toStr(row['Item Name'] || '').trim();

        // Category header row detection: Item Name is empty
        if (!itemName && categoryCol) {
          currentCategoryName = categoryCol;

          // Ensure category exists
          let category = categories.find(c => c.name.toLowerCase() === currentCategoryName.toLowerCase());
          if (!category) {
            const newCategoryId = await generateCategoryId(restaurant.id);
            const docId = String(newCategoryId);
            await setDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', docId), {
              id: newCategoryId,
              name: currentCategoryName,
              description: '',
              sortOrder: categories.length,
              isActive: true
            });
            category = { id: docId, name: currentCategoryName } as MenuCategory;
            categories.push(category);
          }

          // Link category-level modifier/tax/printer groups
          const catModIds: string[] = [];
          for (let i = 1; i <= 5; i++) {
            const mgName = toStr(row[`Modifier Group ${i}`] || '').trim();
            if (mgName) {
              const mg = freshModifierGroups.find(g => g.name.toLowerCase() === mgName.toLowerCase());
              if (mg) catModIds.push(mg.id);
            }
          }
          const catTaxIds: string[] = [];
          for (let i = 1; i <= 3; i++) {
            const tgName = toStr(row[`Tax Group ${i}`] || '').trim();
            if (tgName) {
              const tg = freshTaxGroups.find(g => g.name.toLowerCase() === tgName.toLowerCase());
              if (tg) catTaxIds.push(tg.id);
            }
          }
          const catPrinterIds: string[] = [];
          for (let i = 1; i <= 3; i++) {
            const pgName = toStr(row[`Printer Group ${i}`] || '').trim();
            if (pgName) {
              const pg = freshPrinterGroups.find(g => g.name.toLowerCase() === pgName.toLowerCase());
              if (pg) catPrinterIds.push(pg.id);
            }
          }

          if (catModIds.length > 0 || catTaxIds.length > 0 || catPrinterIds.length > 0) {
            const updateData: any = { updatedAt: new Date() };
            if (catModIds.length > 0) updateData.modifierGroupIds = catModIds;
            if (catTaxIds.length > 0) updateData.taxGroupIds = catTaxIds;
            if (catPrinterIds.length > 0) updateData.printerGroupIds = catPrinterIds;
            await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', category.id), updateData);
          }
          continue;
        }

        // Item row
        if (!itemName) continue;
        const useCategoryName = categoryCol || currentCategoryName;
        if (!useCategoryName) continue;

        let category = categories.find(c => c.name.toLowerCase() === useCategoryName.toLowerCase());
        if (!category) {
          const newCategoryId = await generateCategoryId(restaurant.id);
          const docId = String(newCategoryId);
          await setDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', docId), {
            id: newCategoryId,
            name: useCategoryName,
            description: '',
            sortOrder: categories.length,
            isActive: true
          });
          category = { id: docId, name: useCategoryName } as MenuCategory;
          categories.push(category);
        }

        const shortName = toStr(row['Short Name'] || '').trim();
        const description = toStr(row['Description'] || '').trim();
        const price1 = parseFloat(toStr(row['Price'] || 0)) || 0;
        const price2 = parseFloat(toStr(row['Price2'] || 0)) || 0;

        // Parse numbered group columns
        const modifierIds: string[] = [];
        for (let i = 1; i <= 5; i++) {
          const mgName = toStr(row[`Modifier Group ${i}`] || '').trim();
          if (mgName) {
            const mg = freshModifierGroups.find(g => g.name.toLowerCase() === mgName.toLowerCase());
            if (mg) modifierIds.push(mg.id);
          }
        }
        const taxIds: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const tgName = toStr(row[`Tax Group ${i}`] || '').trim();
          if (tgName) {
            const tg = freshTaxGroups.find(g => g.name.toLowerCase() === tgName.toLowerCase());
            if (tg) taxIds.push(tg.id);
          }
        }
        const printerIds: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const pgName = toStr(row[`Printer Group ${i}`] || '').trim();
          if (pgName) {
            const pg = freshPrinterGroups.find(g => g.name.toLowerCase() === pgName.toLowerCase());
            if (pg) printerIds.push(pg.id);
          }
        }

        const existingItem = menuItems.find(i =>
          i.categoryId === category!.id &&
          i.name.toLowerCase() === itemName.toLowerCase()
        );

        if (existingItem) {
          await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', String(existingItem.id)), {
            shortName: shortName || existingItem.shortName || '',
            description: description || existingItem.description || '',
            price: price1,
            price2: price2,
            modifierGroupIds: modifierIds.length > 0 ? modifierIds : existingItem.modifierGroupIds || [],
            taxGroupIds: taxIds.length > 0 ? taxIds : existingItem.taxGroupIds || [],
            printerGroupIds: printerIds.length > 0 ? printerIds : existingItem.printerGroupIds || [],
            updatedAt: new Date()
          });
          updatedItems++;
        } else {
          const newItemId = await generateMenuItemId(restaurant.id);
          const docId = String(newItemId);
          await setDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', docId), {
            id: newItemId,
            categoryId: category!.id,
            name: itemName,
            shortName: shortName || '',
            description: description || '',
            price: price1,
            price2: price2,
            imageUrl: '',
            isAvailable: true,
            options: [],
            modifierGroupIds: modifierIds,
            taxGroupIds: taxIds,
            printerGroupIds: printerIds,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          newItems++;
        }
      }

      alert(
        `Excel Upload Complete!\n\n` +
        `Menu Items:\n` +
        `   Updated: ${updatedItems}\n` +
        `   New: ${newItems}\n\n` +
        `Modifier Groups:\n` +
        `   Updated: ${updatedModifiers}\n` +
        `   New: ${newModifiers}`
      );

      fetchData();
    } catch (error: any) {
      console.error('Error uploading menu:', error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Load POS menus for selection
  const loadPosMenus = async () => {
    setLoadingPosMenus(true);
    try {
      const POS_API_URL = 'http://localhost:3177/api';
      const res = await fetch(`${POS_API_URL}/menu-sync/pos-menus`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' }
      });
      const data = await res.json();
      if (data.success) {
        setPosMenus(data.menus);
        if (data.menus.length > 0) {
          setSelectedPosMenuId(data.menus[0].menu_id);
          setNewFirebaseMenuName(data.menus[0].name);
        }
      } else {
        throw new Error(data.error || 'Failed to load POS menus');
      }
    } catch (error: any) {
      console.error('Failed to load POS menus:', error);
      if (error.message?.includes('Failed to fetch')) {
        alert('❌ Cannot connect to POS.\n\nPlease make sure POS is running.');
      } else {
        alert(`❌ Failed to load POS menus: ${error.message}`);
      }
    } finally {
      setLoadingPosMenus(false);
    }
  };

  // Pull From POS - Show menu selection modal first
  const handlePullFromPOS = async () => {
    // Load POS menus and show selection modal
    await loadPosMenus();
    setShowMenuSelectModal(true);
  };

  // Execute Pull From POS with selected menu
  const executePullFromPOS = async () => {
    if (!selectedPosMenuId) {
      alert('Please select a menu to upload.');
      return;
    }
    
    // Firebase에 기존 이미지가 있으면 덮어쓸지 물어봄
    let skipImages = false;
    const hasImages = categories.some((c: any) => c.imageUrl || c.image_url) ||
      menuItems.some((i: any) => i.imageUrl || i.image_url);
    if (hasImages) {
      skipImages = !window.confirm('🖼️ Firebase에 이미지가 있습니다.\n\nPOS의 이미지로 덮어쓰시겠습니까?\n\n• 확인 → POS 이미지로 덮어쓰기\n• 취소 → Firebase 이미지 유지');
    }
    
    setShowMenuSelectModal(false);
    setPullingFromPOS(true);
    
    // Initialize progress modal
    const initialSteps = [
      { name: 'Modifier Groups', status: 'pending' as const, message: '' },
      { name: 'Tax Groups', status: 'pending' as const, message: '' },
      { name: 'Printer Groups', status: 'pending' as const, message: '' },
      { name: `Menu: ${newFirebaseMenuName || 'Selected Menu'}`, status: 'pending' as const, message: '' }
    ];
    setSyncProgress({
      type: 'pull',
      currentStep: 0,
      totalSteps: 4,
      status: 'processing',
      steps: initialSteps
    });
    setShowSyncProgressModal(true);
    
    const updateStep = (stepIndex: number, status: 'processing' | 'completed' | 'failed', message?: string) => {
      setSyncProgress(prev => ({
        ...prev,
        currentStep: stepIndex + 1,
        steps: prev.steps.map((s, i) => 
          i === stepIndex ? { ...s, status, message: message || s.message } : s
        )
      }));
    };
    
    try {
      const POS_API_URL = 'http://localhost:3177/api';
      
      // Step 1: Upload Modifier Groups
      updateStep(0, 'processing', 'Uploading...');
      const modRes = await fetch(`${POS_API_URL}/menu-sync/upload-modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: restaurant.id })
      });
      const modData = await modRes.json();
      if (!modData.success) {
        throw new Error(`Modifier Groups upload failed: ${modData.error || 'Unknown error'}`);
      }
      const modGroups = modData.uploadedGroups || [];
      updateStep(0, 'completed', `${modGroups.length} groups synced`);
      
      // Step 2: Upload Tax Groups
      updateStep(1, 'processing', 'Uploading...');
      const taxRes = await fetch(`${POS_API_URL}/menu-sync/upload-tax-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: restaurant.id })
      });
      const taxData = await taxRes.json();
      if (!taxData.success) {
        throw new Error(`Tax Groups upload failed: ${taxData.error || 'Unknown error'}`);
      }
      const taxGroups = taxData.uploadedGroups || [];
      updateStep(1, 'completed', `${taxGroups.length} groups synced`);
      
      // Step 3: Upload Printer Groups
      updateStep(2, 'processing', 'Uploading...');
      const printerRes = await fetch(`${POS_API_URL}/menu-sync/upload-printer-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: restaurant.id })
      });
      const printerData = await printerRes.json();
      if (!printerData.success) {
        throw new Error(`Printer Groups upload failed: ${printerData.error || 'Unknown error'}`);
      }
      const printerGroups = printerData.uploadedGroups || [];
      updateStep(2, 'completed', `${printerGroups.length} groups synced`);
      
      // Step 4: Upload Menu (with selected menuId and custom name)
      updateStep(3, 'processing', 'Uploading categories & items...');
      const menuRes = await fetch(`${POS_API_URL}/menu-sync/sync-to-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ 
          restaurantId: restaurant.id,
          menuId: selectedPosMenuId,
          menuName: newFirebaseMenuName,
          skipImages
        })
      });
      const menuData = await menuRes.json();
      
      if (!menuData.success) {
        throw new Error(`Menu upload failed: ${menuData.error || 'Unknown error'}`);
      }
      updateStep(3, 'completed', `${menuData.summary?.categoriesUploaded || 0} categories, ${menuData.summary?.itemsUploaded || 0} items`);
      
      // Mark overall as completed
      setSyncProgress(prev => ({ ...prev, status: 'completed' }));
      
      // Refresh data
      fetchData();
      
    } catch (error: any) {
      console.error('Pull from POS failed:', error);
      let errorMsg = error.message;
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        errorMsg = 'Cannot connect to POS. Make sure POS is running.';
      }
      setSyncProgress(prev => ({ ...prev, status: 'failed', error: errorMsg }));
    } finally {
      setPullingFromPOS(false);
    }
  };

  // Push to POS - Trigger POS to download from Firebase
  const handlePushToPOS = async () => {
    if (!window.confirm('🔄 Push menu data to POS?\n\nThis will trigger POS to download the latest menu, modifiers, taxes, and printer groups from Firebase.\n\nMake sure POS is running and connected.')) {
      return;
    }
    
    // Firebase 이미지로 POS를 덮어쓸지 물어봄
    let skipImages = false;
    const hasImages = categories.some((c: any) => c.imageUrl || c.image_url) ||
      menuItems.some((i: any) => i.imageUrl || i.image_url);
    if (hasImages) {
      skipImages = !window.confirm('🖼️ Firebase에 이미지가 있습니다.\n\nFirebase 이미지로 POS를 덮어쓰시겠습니까?\n\n• 확인 → Firebase 이미지로 덮어쓰기\n• 취소 → POS 이미지 유지');
    }
    
    setPushingToPOS(true);
    
    // Initialize progress modal
    const initialSteps = [
      { name: 'Menu (Categories & Items)', status: 'pending' as const, message: '' },
      { name: 'Modifier Groups', status: 'pending' as const, message: '' },
      { name: 'Tax Groups', status: 'pending' as const, message: '' }
    ];
    setSyncProgress({
      type: 'push',
      currentStep: 0,
      totalSteps: 3,
      status: 'processing',
      steps: initialSteps
    });
    setShowSyncProgressModal(true);
    
    const updateStep = (stepIndex: number, status: 'processing' | 'completed' | 'failed', message?: string) => {
      setSyncProgress(prev => ({
        ...prev,
        currentStep: stepIndex + 1,
        steps: prev.steps.map((s, i) => 
          i === stepIndex ? { ...s, status, message: message || s.message } : s
        )
      }));
    };
    
    try {
      const POS_API_URL = 'http://localhost:3177/api';
      
      // 1. Sync menu (categories & items)
      updateStep(0, 'processing', 'Downloading...');
      const menuRes = await fetch(`${POS_API_URL}/menu-sync/sync-from-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: restaurant.id, skipImages })
      });
      
      if (!menuRes.ok) {
        throw new Error(`Menu sync failed: ${menuRes.statusText}`);
      }
      const menuData = await menuRes.json();
      updateStep(0, 'completed', `${menuData.summary?.itemsCreated || 0} created, ${menuData.summary?.itemsUpdated || 0} updated`);
      
      // 2. Sync modifier groups
      updateStep(1, 'processing', 'Downloading...');
      const modRes = await fetch(`${POS_API_URL}/menu-sync/download-modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: restaurant.id })
      });
      
      if (!modRes.ok) {
        throw new Error(`Modifier sync failed: ${modRes.statusText}`);
      }
      const modData = await modRes.json();
      updateStep(1, 'completed', `${modData.summary?.groupsCreated || 0} created, ${modData.summary?.groupsUpdated || 0} updated`);
      
      // 3. Sync tax groups
      updateStep(2, 'processing', 'Downloading...');
      const taxRes = await fetch(`${POS_API_URL}/menu-sync/download-tax-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: restaurant.id })
      });
      
      if (!taxRes.ok) {
        throw new Error(`Tax sync failed: ${taxRes.statusText}`);
      }
      const taxData = await taxRes.json();
      updateStep(2, 'completed', `${taxData.summary?.groupsCreated || 0} created, ${taxData.summary?.groupsUpdated || 0} updated`);
      
      // Mark overall as completed
      setSyncProgress(prev => ({ ...prev, status: 'completed' }));
      
    } catch (error: any) {
      console.error('Push to POS failed:', error);
      let errorMsg = error.message;
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        errorMsg = 'Cannot connect to POS. Make sure POS is running.';
      }
      setSyncProgress(prev => ({ ...prev, status: 'failed', error: errorMsg }));
    } finally {
      setPushingToPOS(false);
    }
  };

  // Category operations
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Generate ID using SQLite rules
      const newCategoryId = await generateCategoryId(restaurant.id);
      const docId = String(newCategoryId);
      
      await setDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', docId), {
        id: newCategoryId,
        name: categoryForm.name,
        description: categoryForm.description,
        sortOrder: categories.length,
        isActive: true
      });
      setShowCategoryModal(false);
      setCategoryForm({ name: '', description: '' });
      fetchData();
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to add category.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!window.confirm('Delete this category and all its items?')) return;
    try {
      const itemsToDelete = menuItems.filter(item => item.categoryId === categoryId);
      for (const item of itemsToDelete) {
        await deleteDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', String(item.id)));
      }
      await deleteDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', categoryId));
      fetchData();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleUpdateCategory = async (categoryId: string, data: Partial<MenuCategory>) => {
    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', categoryId), { ...data, updatedAt: new Date() });
      fetchData();
    } catch (error) {
      console.error('Error updating category:', error);
    }
  };

  // Menu item operations
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🔥 handleAddItem called');
    console.log('🔥 selectedCategoryForItem:', selectedCategoryForItem);
    console.log('🔥 itemForm:', itemForm);
    console.log('🔥 restaurant.id:', restaurant?.id);
    
    if (!selectedCategoryForItem) {
      console.log('❌ No category selected - returning early');
      alert('Please select a category first!');
      return;
    }
    
    if (!itemForm.name?.trim()) {
      console.log('❌ No item name - returning early');
      alert('Please enter item name!');
      return;
    }
    
    if (!restaurant?.id) {
      console.log('❌ No restaurant ID');
      alert('Restaurant not selected!');
      return;
    }
    
    setSaving(true);
    console.log('🔥 Starting save...');
    try {
      const categoryItems = menuItems.filter(item => item.categoryId === selectedCategoryForItem);
      const itemData: any = {
        categoryId: selectedCategoryForItem,
        name: itemForm.name,
        description: itemForm.description || '',
        price: parseFloat(itemForm.price) || 0,
        price2: parseFloat(itemForm.price2) || 0,
        imageUrl: '',
        isAvailable: true,
        options: [],
        modifierGroupIds: [],
        taxGroupIds: [],
        printerGroupIds: [],
        sortOrder: categoryItems.length,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      if (itemForm.shortName?.trim()) {
        itemData.shortName = itemForm.shortName.trim();
      }
      
      // Generate ID using SQLite rules
      console.log('🔥 Generating new item ID...');
      const newItemId = await generateMenuItemId(restaurant.id);
      console.log('🔥 Generated ID:', newItemId);
      const docId = String(newItemId);
      
      console.log('🔥 Saving to Firestore...', { docId, itemData });
      await setDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', docId), {
        id: newItemId,
        ...itemData
      });
      console.log('✅ Item saved successfully!');
      alert('✅ Menu item saved successfully!');
      setShowItemModal(false);
      setItemForm({ name: '', shortName: '', description: '', price: '', price2: '' });
      fetchData();
    } catch (error: any) {
      console.error('❌ Error saving item:', error);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error code:', error.code);
      alert(`Failed to add item: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateItem = async (itemId: string, data: Partial<MenuItem>) => {
    try {
      await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId), { ...data, updatedAt: new Date() });
      fetchData();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm('Delete this item?')) return;
    try {
      await deleteDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId));
      fetchData();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Drag and drop
  const handleDragStart = (event: any) => {
    setActiveDragData(event.active.data.current);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    console.log('🎯 Drag End:', { active: active?.id, over: over?.id, overData: over?.data?.current });
    setActiveDragData(null);
    if (!over) {
      console.log('❌ No drop target detected');
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    const overType = over.data.current?.type;
    console.log('📍 Drop info:', { activeId, overId, overType });

    // Connect modifier/tax/printer to category or item
    if (activeId.startsWith('modifier-') && (overType === 'category' || overType === 'item')) {
      const groupId = activeId.replace('modifier-', '');
      if (overType === 'category') {
        // Update category itself
        const category = categories.find(c => c.id === overId);
        if (category) {
          const currentCatIds = (category as any).modifierGroupIds || [];
          if (!currentCatIds.includes(groupId)) {
            await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', overId), { 
              modifierGroupIds: [...currentCatIds, groupId], 
              updatedAt: new Date() 
            });
          }
        }
        // Update all items in category
        const categoryItems = menuItems.filter(item => item.categoryId === overId);
        const batch = writeBatch(db);
        for (const item of categoryItems) {
          const currentIds = item.modifierGroupIds || [];
          if (!currentIds.includes(groupId)) {
            batch.update(doc(db, 'restaurants', restaurant.id, 'menuItems', String(item.id)), { modifierGroupIds: [...currentIds, groupId], updatedAt: new Date() });
          }
        }
        await batch.commit();
      } else {
        const itemId = overId.replace('item-', '');
        const item = menuItems.find(i => i.id === itemId);
        if (item) {
          const currentIds = item.modifierGroupIds || [];
          if (!currentIds.includes(groupId)) {
            await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId), { modifierGroupIds: [...currentIds, groupId], updatedAt: new Date() });
          }
        }
      }
      fetchData();
    } else if ((activeId.startsWith('tax-') || activeId.startsWith('individual-tax-')) && (overType === 'category' || overType === 'item')) {
      // Individual Tax 처리
      if (activeId.startsWith('individual-tax-')) {
        const taxId = activeId.replace('individual-tax-', '');
        if (overType === 'category') {
          // Update category itself
          const category = categories.find(c => c.id === overId);
          if (category) {
            const currentCatIds = (category as any).taxIds || [];
            if (!currentCatIds.includes(taxId)) {
              await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', overId), { 
                taxIds: [...currentCatIds, taxId], 
                updatedAt: new Date() 
              });
            }
          }
          // Update all items in category
          const categoryItems = menuItems.filter(item => item.categoryId === overId);
          const batch = writeBatch(db);
          for (const item of categoryItems) {
            const currentIds = (item as any).taxIds || [];
            if (!currentIds.includes(taxId)) {
              batch.update(doc(db, 'restaurants', restaurant.id, 'menuItems', String(item.id)), { taxIds: [...currentIds, taxId], updatedAt: new Date() });
            }
          }
          await batch.commit();
        } else {
          const itemId = overId.replace('item-', '');
          const item = menuItems.find(i => i.id === itemId);
          if (item) {
            const currentIds = (item as any).taxIds || [];
            if (!currentIds.includes(taxId)) {
              await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId), { taxIds: [...currentIds, taxId], updatedAt: new Date() });
            }
          }
        }
      } else {
        // Group Tax 처리 (기존 로직)
        const groupId = activeId.replace('tax-', '');
        if (overType === 'category') {
          // Update category itself
          const category = categories.find(c => c.id === overId);
          if (category) {
            const currentCatIds = (category as any).taxGroupIds || [];
            if (!currentCatIds.includes(groupId)) {
              await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', overId), { 
                taxGroupIds: [...currentCatIds, groupId], 
                updatedAt: new Date() 
              });
            }
          }
          // Update all items in category
          const categoryItems = menuItems.filter(item => item.categoryId === overId);
          const batch = writeBatch(db);
          for (const item of categoryItems) {
            const currentIds = item.taxGroupIds || [];
            if (!currentIds.includes(groupId)) {
              batch.update(doc(db, 'restaurants', restaurant.id, 'menuItems', String(item.id)), { taxGroupIds: [...currentIds, groupId], updatedAt: new Date() });
            }
          }
          await batch.commit();
        } else {
          const itemId = overId.replace('item-', '');
          const item = menuItems.find(i => i.id === itemId);
          if (item) {
            const currentIds = item.taxGroupIds || [];
            if (!currentIds.includes(groupId)) {
              await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId), { taxGroupIds: [...currentIds, groupId], updatedAt: new Date() });
            }
          }
        }
      }
      fetchData();
    } else if (activeId.startsWith('printer-') && (overType === 'category' || overType === 'item')) {
      const groupId = activeId.replace('printer-', '');
      if (overType === 'category') {
        // Update category itself
        const category = categories.find(c => c.id === overId);
        if (category) {
          const currentCatIds = (category as any).printerGroupIds || [];
          if (!currentCatIds.includes(groupId)) {
            await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuCategories', overId), { 
              printerGroupIds: [...currentCatIds, groupId], 
              updatedAt: new Date() 
            });
          }
        }
        // Update all items in category
        const categoryItems = menuItems.filter(item => item.categoryId === overId);
        const batch = writeBatch(db);
        for (const item of categoryItems) {
          const currentIds = item.printerGroupIds || [];
          if (!currentIds.includes(groupId)) {
            batch.update(doc(db, 'restaurants', restaurant.id, 'menuItems', String(item.id)), { printerGroupIds: [...currentIds, groupId], updatedAt: new Date() });
          }
        }
        await batch.commit();
      } else {
        const itemId = overId.replace('item-', '');
        const item = menuItems.find(i => i.id === itemId);
        if (item) {
          const currentIds = item.printerGroupIds || [];
          if (!currentIds.includes(groupId)) {
            await updateDoc(doc(db, 'restaurants', restaurant.id, 'menuItems', itemId), { printerGroupIds: [...currentIds, groupId], updatedAt: new Date() });
          }
        }
      }
      fetchData();
    }
  };

  const toggleCategory = (id: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  return (
    <>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={styles.page}>
        {/* Header */}
        <header style={styles.header}>
          {!hideHeader && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button onClick={onBack} style={styles.backButton}>← Back to List</button>
              <div>
                <h1 style={styles.headerTitle}>{restaurant.name} <span style={{ fontSize: '11px', color: '#999', fontWeight: 'normal' }}>({restaurant.id})</span></h1>
                <p style={styles.headerSubtitle}>Menu Manager</p>
              </div>
            </div>
          )}
          <div style={styles.headerButtons}>
            <button 
              onClick={handleDownloadMenu} 
              disabled={downloading}
              style={{ ...styles.downloadButton, opacity: downloading ? 0.6 : 1 }}
            >
              {downloading ? '⏳ Exporting...' : '📥 Download Excel'}
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={uploading}
              style={{ ...styles.uploadButton, opacity: uploading ? 0.6 : 1 }}
            >
              {uploading ? '⏳ Importing...' : '📤 Upload Excel'}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              accept=".xlsx,.xls,.csv" 
              style={{ display: 'none' }} 
              onChange={handleUploadMenu} 
            />
            <button onClick={() => setShowCategoryModal(true)} style={styles.categoryButton}>+ Category</button>
            <button onClick={() => {
              if (categories.length === 0) return alert('Please add a category first.');
              setSelectedCategoryForItem(String(categories[0].id));
              setShowItemModal(true);
            }} style={styles.menuItemButton}>+ Menu Item</button>
            <button 
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleExportToExcel}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(to right, #10b981, #059669)',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              📥 Export Excel
            </button>
            <button 
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handlePullFromPOS}
              disabled={pullingFromPOS}
              style={{
                padding: '10px 20px',
                background: pullingFromPOS ? '#94a3b8' : 'linear-gradient(to right, #f59e0b, #d97706)',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                cursor: pullingFromPOS ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {pullingFromPOS ? '⏳ Syncing...' : '📤 Sync From POS'}
            </button>
            <button 
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handlePushToPOS}
              disabled={pushingToPOS}
              style={{
                padding: '10px 20px',
                background: pushingToPOS ? '#94a3b8' : 'linear-gradient(to right, #0ea5e9, #3b82f6)',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                cursor: pushingToPOS ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {pushingToPOS ? '⏳ Syncing...' : '📥 Sync to POS'}
            </button>
          </div>
        </header>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ marginLeft: '12px', color: '#64748b' }}>Loading...</span>
          </div>
        ) : (
          <div style={styles.mainContainer}>
            {/* Left Panel - Categories & Items */}
            <div style={styles.leftPanel}>
              {categories.length === 0 ? (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIcon}>📂</div>
                  <div style={styles.emptyTitle}>No categories yet</div>
                  <div style={styles.emptyText}>Click '+ Category' to get started</div>
                </div>
              ) : (
                categories.map(category => (
                  <DroppableCategory
                    key={category.id}
                    category={category}
                    items={menuItems.filter(item => item.categoryId === category.id)}
                    isCollapsed={collapsedCategories.has(String(category.id))}
                    onToggle={() => toggleCategory(String(category.id))}
                    onUpdate={(data) => handleUpdateCategory(String(category.id), data)}
                    onDelete={() => handleDeleteCategory(String(category.id))}
                    onUpdateItem={handleUpdateItem}
                    onDeleteItem={handleDeleteItem}
                    onAddItem={() => { setSelectedCategoryForItem(String(category.id)); setShowItemModal(true); }}
                    modifierGroups={modifierGroups}
                    taxGroups={taxGroups}
                    individualTaxes={individualTaxes}
                    printerGroups={printerGroups}
                    onHighlightGroup={setHighlightedGroupId}
                    onSelectImage={handleOpenImageGallery}
                    onDeleteImage={handleDeleteImage}
                  />
                ))
              )}
            </div>

            {/* Right Panel - Options */}
            <div style={styles.rightPanel}>
              <div style={styles.tabContainer}>
                <button style={styles.tab(activeTab === 'modifier', '#9333ea')} onClick={() => setActiveTab('modifier')}>
                  <Settings size={16} /> Modifiers
                </button>
                <button style={styles.tab(activeTab === 'tax', '#16a34a')} onClick={() => setActiveTab('tax')}>
                  Taxes
                </button>
                <button style={styles.tab(activeTab === 'printer', '#ea580c')} onClick={() => setActiveTab('printer')}>
                  Printers
                </button>
              </div>
              <div style={styles.tabContent}>
                {activeTab === 'modifier' && (
                  <ModifierGroupPanel restaurantId={restaurant.id} modifierGroups={modifierGroups} onRefresh={fetchData} highlightedGroupId={highlightedGroupId} />
                )}
                {activeTab === 'tax' && (
                  <TaxGroupPanel restaurantId={restaurant.id} taxGroups={taxGroups} onRefresh={fetchData} highlightedGroupId={highlightedGroupId} />
                )}
                {activeTab === 'printer' && (
                  <PrinterGroupPanel restaurantId={restaurant.id} printerGroups={printerGroups} onRefresh={fetchData} highlightedGroupId={highlightedGroupId} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDragData && (
            <div style={{ padding: '8px 12px', backgroundColor: 'white', border: '2px solid #3b82f6', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <span style={{ fontWeight: '500' }}>{activeDragData.name}</span>
              <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: activeDragData.type === 'modifier' ? '#f3e8ff' : activeDragData.type === 'tax' ? '#dcfce7' : '#ffedd5', color: activeDragData.type === 'modifier' ? '#9333ea' : activeDragData.type === 'tax' ? '#16a34a' : '#ea580c' }}>
                {activeDragData.type}
              </span>
            </div>
          )}
        </DragOverlay>

        {/* Category Modal */}
        {showCategoryModal && (
          <div style={styles.modal}>
            <div style={styles.modalContent}>
              <h2 style={styles.modalTitle}>New Category</h2>
              <form onSubmit={handleAddCategory}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Category Name *</label>
                  <input type="text" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} required style={styles.input} placeholder="e.g., Appetizers" />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Description</label>
                  <input type="text" value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} style={styles.input} />
                </div>
                <div style={styles.buttonRow}>
                  <button type="button" onClick={() => setShowCategoryModal(false)} style={styles.cancelButton}>Cancel</button>
                  <button type="submit" disabled={saving} style={{ ...styles.submitButton, opacity: saving ? 0.5 : 1 }}>{saving ? 'Adding...' : 'Add Category'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Item Modal */}
        {showItemModal && (
          <div style={styles.modal}>
            <div style={styles.modalContent}>
              <h2 style={styles.modalTitle}>New Menu Item</h2>
              <form onSubmit={handleAddItem}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Category *</label>
                  <select value={selectedCategoryForItem || ''} onChange={(e) => setSelectedCategoryForItem(e.target.value)} style={styles.input}>
                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
                <div style={{ ...styles.inputRow, marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Item Name *</label>
                    <input type="text" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} required style={styles.input} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Short Name</label>
                    <input type="text" value={itemForm.shortName} onChange={(e) => setItemForm({ ...itemForm, shortName: e.target.value })} style={styles.input} />
                  </div>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Description</label>
                  <textarea value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} style={{ ...styles.input, minHeight: '60px' }} />
                </div>
                <div style={{ ...styles.inputRow, marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Price 1 ($) *</label>
                    <input type="number" step="0.01" min="0" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} required style={styles.input} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.label}>Price 2 ($)</label>
                    <input type="number" step="0.01" min="0" value={itemForm.price2} onChange={(e) => setItemForm({ ...itemForm, price2: e.target.value })} style={{ ...styles.input, borderColor: '#fb923c' }} placeholder="Delivery" />
                  </div>
                </div>
                <div style={styles.buttonRow}>
                  <button type="button" onClick={() => setShowItemModal(false)} style={styles.cancelButton}>Cancel</button>
                  <button type="submit" disabled={saving} style={{ ...styles.submitButton, opacity: saving ? 0.5 : 1 }}>{saving ? 'Adding...' : 'Add Item'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Excel Upload */}
        {showExcelUpload && (
          <ExcelMenuUpload
            restaurantId={restaurant.id}
            existingCategories={categories}
            onUploadComplete={() => { setShowExcelUpload(false); fetchData(); }}
            onClose={() => setShowExcelUpload(false)}
          />
        )}

        {/* Image Gallery Modal */}
        {showImageGallery && (
          <div style={styles.modal}>
            <div style={{ ...styles.modalContent, maxWidth: '800px', maxHeight: '85vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={styles.modalTitle}>🖼️ Select Image</h2>
                <button
                  onClick={() => {
                    setShowImageGallery(false);
                    setSelectedImageItemId(null);
                    setSelectedImageUrl(null);
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', color: '#64748b' }}
                >
                  ×
                </button>
              </div>

              {/* Upload Section */}
              <div style={{ 
                backgroundColor: '#f8fafc', 
                border: '2px dashed #cbd5e1', 
                borderRadius: '12px', 
                padding: '20px', 
                textAlign: 'center',
                marginBottom: '20px'
              }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>Upload New Images</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                  JPEG, PNG, GIF, WebP up to 5MB each
                </div>
                <input
                  type="file"
                  ref={imageFileInputRef}
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleImageUpload(e.target.files);
                    }
                  }}
                />
                <button
                  onClick={() => imageFileInputRef.current?.click()}
                  disabled={uploadingImage}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: uploadingImage ? '#94a3b8' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: uploadingImage ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  {uploadingImage ? (
                    <>
                      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                      Uploading... ({uploadProgress.completed}/{uploadProgress.total})
                    </>
                  ) : (
                    <>📤 Select Images</>
                  )}
                </button>
              </div>

              {/* Image Grid */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontWeight: '600', color: '#374151' }}>
                    📷 Uploaded Images ({firebaseImages.length})
                  </span>
                  <button
                    onClick={loadFirebaseImages}
                    disabled={loadingImages}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#e2e8f0',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '500'
                    }}
                  >
                    {loadingImages ? '⏳ Loading...' : '🔄 Refresh'}
                  </button>
                </div>

                <div style={{ 
                  maxHeight: '350px', 
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px'
                }}>
                  {loadingImages ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                      <div style={{ marginTop: '8px' }}>Loading images...</div>
                    </div>
                  ) : firebaseImages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                      <div>No images uploaded yet</div>
                    </div>
                  ) : (
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', 
                      gap: '12px' 
                    }}>
                      {firebaseImages.map(img => (
                        <div
                          key={img.id}
                          onClick={() => setSelectedImageUrl(img.url)}
                          style={{
                            position: 'relative',
                            aspectRatio: '1',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            border: selectedImageUrl === img.url ? '3px solid #3b82f6' : '2px solid #e2e8f0',
                            boxShadow: selectedImageUrl === img.url ? '0 0 0 2px rgba(59, 130, 246, 0.3)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <img
                            src={img.url}
                            alt={img.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                          {selectedImageUrl === img.url && (
                            <div style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              backgroundColor: '#3b82f6',
                              borderRadius: '50%',
                              width: '24px',
                              height: '24px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              <Check size={14} color="white" />
                            </div>
                          )}
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            padding: '4px',
                            fontSize: '9px',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap'
                          }}>
                            {img.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={styles.buttonRow}>
                <button
                  onClick={() => {
                    setShowImageGallery(false);
                    setSelectedImageItemId(null);
                    setSelectedImageUrl(null);
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyImage}
                  disabled={!selectedImageUrl}
                  style={{
                    ...styles.submitButton,
                    opacity: selectedImageUrl ? 1 : 0.5,
                    cursor: selectedImageUrl ? 'pointer' : 'not-allowed'
                  }}
                >
                  ✅ Apply Image
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Menu Selection Modal */}
      {showMenuSelectModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '24px',
            width: '500px',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            {/* Header */}
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#1e293b' }}>
                📥 Select Menu to Pull from POS
              </h2>
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#64748b' }}>
                Choose which POS menu to upload to Firebase
              </p>
            </div>

            {loadingPosMenus ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ marginLeft: '12px', color: '#64748b' }}>Loading POS menus...</span>
              </div>
            ) : posMenus.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                No menus found in POS
              </div>
            ) : (
              <>
                {/* Menu List */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#374151' }}>
                    Select POS Menu:
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflow: 'auto' }}>
                    {posMenus.map(menu => (
                      <div
                        key={menu.menu_id}
                        onClick={() => {
                          setSelectedPosMenuId(menu.menu_id);
                          setNewFirebaseMenuName(menu.name);
                        }}
                        style={{
                          padding: '12px 16px',
                          borderRadius: '8px',
                          border: selectedPosMenuId === menu.menu_id ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                          backgroundColor: selectedPosMenuId === menu.menu_id ? '#eff6ff' : '#f8fafc',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: '600', fontSize: '14px', color: '#1e293b' }}>
                              {selectedPosMenuId === menu.menu_id && '✓ '}{menu.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                              {menu.category_count} categories • {menu.item_count} items
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {menu.channels?.map((ch: string) => (
                              <span key={ch} style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: '500',
                                backgroundColor: ch === 'dine-in' ? '#dbeafe' : ch === 'togo' ? '#fef3c7' : '#e0e7ff',
                                color: ch === 'dine-in' ? '#1d4ed8' : ch === 'togo' ? '#b45309' : '#4338ca'
                              }}>
                                {ch}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Firebase Menu Name */}
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#374151' }}>
                    Firebase Menu Name (can be changed):
                  </label>
                  <input
                    type="text"
                    value={newFirebaseMenuName}
                    onChange={(e) => setNewFirebaseMenuName(e.target.value)}
                    placeholder="Enter menu name for Firebase"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      fontSize: '14px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                    This name will be used in Firebase. You can customize it.
                  </p>
                </div>

                {/* Info Box */}
                <div style={{
                  padding: '12px',
                  backgroundColor: '#fef3c7',
                  borderRadius: '8px',
                  marginBottom: '20px'
                }}>
                  <div style={{ fontSize: '13px', color: '#92400e' }}>
                    ⚠️ <strong>Note:</strong> This will replace all existing menu data in Firebase with the selected POS menu.
                  </div>
                </div>
              </>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowMenuSelectModal(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  backgroundColor: 'white',
                  color: '#374151',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={executePullFromPOS}
                disabled={!selectedPosMenuId || loadingPosMenus}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: selectedPosMenuId ? '#3b82f6' : '#9ca3af',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: selectedPosMenuId ? 'pointer' : 'not-allowed'
                }}
              >
                📥 Pull Selected Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Progress Modal */}
      {showSyncProgressModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '24px',
            width: '450px',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>
                {syncProgress.type === 'pull' ? '📥' : '🚀'}
              </div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#1e293b' }}>
                {syncProgress.type === 'pull' ? 'Pull From POS' : 'Push to POS'}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                {syncProgress.status === 'processing' && 'Syncing in progress...'}
                {syncProgress.status === 'completed' && '✅ Sync completed successfully!'}
                {syncProgress.status === 'failed' && '❌ Sync failed'}
              </p>
            </div>

            {/* Progress Bar */}
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#e2e8f0',
              borderRadius: '4px',
              overflow: 'hidden',
              marginBottom: '20px'
            }}>
              <div style={{
                width: `${(syncProgress.currentStep / syncProgress.totalSteps) * 100}%`,
                height: '100%',
                backgroundColor: syncProgress.status === 'failed' ? '#ef4444' : syncProgress.status === 'completed' ? '#22c55e' : '#3b82f6',
                transition: 'width 0.3s ease',
                borderRadius: '4px'
              }} />
            </div>

            {/* Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {syncProgress.steps.map((step, index) => (
                <div key={index} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  backgroundColor: step.status === 'processing' ? '#eff6ff' : step.status === 'completed' ? '#f0fdf4' : step.status === 'failed' ? '#fef2f2' : '#f8fafc',
                  borderRadius: '8px',
                  border: step.status === 'processing' ? '1px solid #3b82f6' : '1px solid #e2e8f0'
                }}>
                  {/* Status Icon */}
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    backgroundColor: 
                      step.status === 'completed' ? '#22c55e' : 
                      step.status === 'failed' ? '#ef4444' : 
                      step.status === 'processing' ? '#3b82f6' : '#94a3b8',
                    color: 'white',
                    flexShrink: 0
                  }}>
                    {step.status === 'completed' && '✓'}
                    {step.status === 'failed' && '✗'}
                    {step.status === 'processing' && (
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    )}
                    {step.status === 'pending' && (index + 1)}
                  </div>

                  {/* Step Info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      fontSize: '14px', 
                      fontWeight: '500', 
                      color: step.status === 'processing' ? '#1e40af' : '#1e293b' 
                    }}>
                      Step {index + 1}: {step.name}
                    </div>
                    {step.message && (
                      <div style={{ 
                        fontSize: '12px', 
                        color: step.status === 'completed' ? '#16a34a' : step.status === 'failed' ? '#dc2626' : '#64748b',
                        marginTop: '2px'
                      }}>
                        {step.message}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Error Message */}
            {syncProgress.error && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                backgroundColor: '#fef2f2',
                borderRadius: '8px',
                border: '1px solid #fecaca'
              }}>
                <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: '500' }}>
                  ❌ Error: {syncProgress.error}
                </div>
              </div>
            )}

            {/* Close Button */}
            {(syncProgress.status === 'completed' || syncProgress.status === 'failed') && (
              <button
                onClick={() => setShowSyncProgressModal(false)}
                style={{
                  marginTop: '20px',
                  width: '100%',
                  padding: '12px',
                  backgroundColor: syncProgress.status === 'completed' ? '#22c55e' : '#64748b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                {syncProgress.status === 'completed' ? '✅ Done' : 'Close'}
              </button>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </DndContext>

    {/* Sync Schedule Modal - DndContext 바깥에 배치 */}
    {showSyncScheduleModal && (
      <SyncScheduleModal
        isOpen={showSyncScheduleModal}
        onClose={() => setShowSyncScheduleModal(false)}
        syncType="menu"
        restaurantId={restaurant.id}
        data={{ categories, items: menuItems, modifierGroups, taxGroups }}
        onSyncComplete={() => {
          console.log('Menu sync scheduled/completed!');
        }}
      />
    )}

    {/* Delete Image Confirmation Modal */}
    {deleteImageConfirm.show && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '24px',
          width: '350px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗑️</div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '600', color: '#1e293b' }}>
            Delete Image
          </h3>
          <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#64748b' }}>
            Are you sure you want to delete this image?
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              onClick={() => setDeleteImageConfirm({ show: false, itemId: null })}
              style={{
                padding: '10px 24px',
                backgroundColor: '#e2e8f0',
                color: '#475569',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteImage}
              style={{
                padding: '10px 24px',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '14px'
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

