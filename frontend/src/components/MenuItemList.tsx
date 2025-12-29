import React, { useState, useRef, useEffect } from 'react';
import { MenuItem, TaxGroup, PrinterGroup } from '../types';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SortableMenuItem from './SortableMenuItem';
import { Check, X, ArrowDownAZ } from 'lucide-react';

interface MenuItemListProps {
  items: MenuItem[];
  onAddItem: (name: string, short_name: string, description: string, price: number) => void;
  onUpdateItem: (id: number, name: string, short_name: string, description: string, price: number) => void;
  onDeleteItem: (id: number) => void;
  onUploadImage: (id: number, file: File) => void;
  onSort: () => void;
  onHide?: (id: number) => void;

}

const SortableItem = ({ 
  item, 
  onUpdateItem, 
  onDeleteItem, 
  onUploadImage, 
  onHide
}: { 
  item: MenuItem, 
  onUpdateItem: any, 
  onDeleteItem: any, 
  onUploadImage: any, 
  onHide: any
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ 
    id: item.id,
    data: {
      type: 'item',
      item: item
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <SortableMenuItem
      ref={setNodeRef}
      style={style}
      item={item}
      onUpdate={onUpdateItem}
      onDelete={onDeleteItem}
      onUploadImage={onUploadImage}
      attributes={attributes}
      listeners={listeners}
      onHide={onHide}
    />
  );
};

const MenuItemList: React.FC<MenuItemListProps> = ({
  items,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onUploadImage,
  onSort,
  onHide
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemShortName, setNewItemShortName] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const price = parseFloat(newItemPrice);
    if (newItemName.trim() && !isNaN(price)) {
      onAddItem(newItemName.trim(), newItemShortName.trim(), newItemDescription, price);
      setNewItemName('');
      setNewItemShortName('');
      setNewItemDescription('');
      setNewItemPrice('');
      
      // Focus back to the name input after saving
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setNewItemName('');
    setNewItemShortName('');
    setNewItemDescription('');
    setNewItemPrice('');
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSave();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancel();
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-md flex flex-col h-full">
      <div className="flex justify-between items-center p-4 border-b">
        <h2 className="text-lg font-semibold text-slate-800">Menu Items</h2>
        <button onClick={onSort} className="p-1.5 hover:bg-slate-200 rounded-full" title="Sort by Short Name">
          <ArrowDownAZ size={18} className="text-slate-600" />
        </button>
      </div>
      <div className="p-4 bg-slate-50 shrink-0 border-b">
        {isAdding ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
              <input
                ref={nameInputRef}
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value.replace(/\b\w/g, char => char.toUpperCase()))}
                onKeyDown={handleKeyDown}
                placeholder="New item name"
                className="w-full px-2 py-2 border rounded-md md:col-span-3"
                autoFocus
              />
              <input
                type="text"
                value={newItemShortName}
                onChange={(e) => setNewItemShortName(e.target.value.replace(/\b\w/g, char => char.toUpperCase()))}
                onKeyDown={handleKeyDown}
                placeholder="Short Name (Optional)"
                className="w-full px-2 py-2 border rounded-md md:col-span-2"
              />
              <input
                type="number"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Price"
                className="w-full px-2 py-2 border rounded-md md:col-span-1"
              />
            </div>
            <div className="flex items-center space-x-2">
              <textarea
                value={newItemDescription}
                onChange={(e) => setNewItemDescription(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Description (Optional)"
                className="w-full flex-auto px-2 py-2 border rounded-md"
                rows={1}
              />
              <button onPointerDown={handleCancel} className="p-2 text-slate-600 bg-slate-200 rounded-md hover:bg-slate-300 flex-shrink-0">
                  <X size={18} />
              </button>
              <button onPointerDown={handleSave} className="p-2 text-white bg-blue-500 rounded-md hover:bg-blue-600 flex-shrink-0">
                  <Check size={18} />
              </button>
            </div>
          </div>
        ) : (
          (
            <button 
              onClick={() => setIsAdding(true)} 
              className="w-56 px-3 py-2 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
            >
              + Add Menu Item
            </button>
          )
        )}
      </div>
      
      <div className="flex-grow overflow-y-auto p-4">
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {items.map(item => (
            <SortableItem 
              key={item.id} 
              item={item} 
              onUpdateItem={onUpdateItem} 
              onDeleteItem={onDeleteItem} 
              onUploadImage={onUploadImage} 
              onHide={onHide}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
};

export default MenuItemList; 