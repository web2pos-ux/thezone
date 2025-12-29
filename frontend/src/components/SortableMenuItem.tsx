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

import React, { useState, useRef } from 'react';
import { MenuItem, TaxGroup, PrinterGroup, MenuItemModifierGroup, MenuItemTaxGroup, MenuItemPrinterGroup } from '../types';
import ItemActions from './ItemActions';
import { GripVertical, Loader2, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import InvalidLinkBadge from './InvalidLinkBadge';
import AmbiguousLinkBadge from './AmbiguousLinkBadge';

interface SortableMenuItemProps {
  item: MenuItem;
  onUpdate: (id: number, name: string, short_name: string, description: string, price: number) => void;
  onDelete: (id: number) => void;
  onUploadImage: (id: number, file: File) => void;
  onHide?: (id: number) => void;
  attributes: any;
  listeners: any;
  style: React.CSSProperties;
  itemOptions?: {
    modifier_groups: MenuItemModifierGroup[];
    tax_groups: MenuItemTaxGroup[];
    printer_groups: MenuItemPrinterGroup[];
  };
}

const SortableMenuItem = React.forwardRef<HTMLDivElement, SortableMenuItemProps>(
  ({ 
    item, 
    onUpdate, 
    onDelete, 
    onUploadImage, 
    onHide, 
    attributes, 
    listeners, 
    style,
    itemOptions
  }, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(item.name);
    const [editedShortName, setEditedShortName] = useState(item.short_name || '');
    const [editedDescription, setEditedDescription] = useState(item.description || '');
    const [editedPrice, setEditedPrice] = useState(item.price.toString());
    const nameInputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    const handlePriceChange = (amount: number) => {
      const currentPrice = parseFloat(editedPrice);
      if (isNaN(currentPrice)) {
          setEditedPrice(amount > 0 ? amount.toFixed(2) : "0.00");
          return;
      }
      const newPrice = Math.max(0, currentPrice + amount);
      setEditedPrice(newPrice.toFixed(2));
    };

    const handleUpdate = () => {
      const price = parseFloat(editedPrice);
      if (editedName.trim() && !isNaN(price)) {
        onUpdate(item.id, editedName.trim(), editedShortName.trim(), editedDescription, price);
      }
      setIsEditing(false);
    };

    const handleStartEdit = () => {
      setIsEditing(true);
      // Focus on name input after a short delay to ensure DOM is updated
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 100);
    };

    const handleCancelEdit = () => {
      setIsEditing(false);
      // Reset to original values
      setEditedName(item.name);
      setEditedShortName(item.short_name || '');
      setEditedDescription(item.description || '');
      setEditedPrice(item.price.toString());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleUpdate();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelEdit();
      }
    };

    const handleOptionsClick = () => {
      navigate(`/menu/item/${item.id}/options`);
    };

    const renderInvalidLinks = () => {
      if (!itemOptions) return null;

      const invalidModifiers = itemOptions.modifier_groups.filter(group => group.is_invalid);
      const invalidTaxes = itemOptions.tax_groups.filter(group => group.is_invalid);
      const invalidPrinters = itemOptions.printer_groups.filter(group => group.is_invalid);

      const allInvalid = [...invalidModifiers, ...invalidTaxes, ...invalidPrinters];
      
      if (allInvalid.length === 0) return null;

      return (
        <div className="flex flex-wrap gap-1 mt-1">
          {invalidModifiers.map((group, index) => (
            <InvalidLinkBadge 
              key={`modifier-${index}`} 
              name={group.name} 
              type="modifier" 
            />
          ))}
          {invalidTaxes.map((group, index) => (
            <InvalidLinkBadge 
              key={`tax-${index}`} 
              name={group.name} 
              type="tax" 
            />
          ))}
          {invalidPrinters.map((group, index) => (
            <InvalidLinkBadge 
              key={`printer-${index}`} 
              name={group.name} 
              type="printer" 
            />
          ))}
        </div>
      );
    };

    const renderAmbiguousLinks = () => {
      if (!itemOptions) return null;

      const ambiguousModifiers = itemOptions.modifier_groups.filter(group => group.is_ambiguous);
      const ambiguousTaxes = itemOptions.tax_groups.filter(group => group.is_ambiguous);
      const ambiguousPrinters = itemOptions.printer_groups.filter(group => group.is_ambiguous);

      const allAmbiguous = [...ambiguousModifiers, ...ambiguousTaxes, ...ambiguousPrinters];
      
      if (allAmbiguous.length === 0) return null;

      return (
        <div className="flex flex-wrap gap-1 mt-1">
          {ambiguousModifiers.map((group, index) => (
            <AmbiguousLinkBadge 
              key={`modifier-${index}`} 
              name={group.name} 
              isAmbiguous={true}
            />
          ))}
          {ambiguousTaxes.map((group, index) => (
            <AmbiguousLinkBadge 
              key={`tax-${index}`} 
              name={group.name} 
              isAmbiguous={true}
            />
          ))}
          {ambiguousPrinters.map((group, index) => (
            <AmbiguousLinkBadge 
              key={`printer-${index}`} 
              name={group.name} 
              isAmbiguous={true}
            />
          ))}
        </div>
      );
    };

    const renderDisplayMode = () => (
      <div className="flex-grow p-3 flex flex-col justify-center space-y-0">
        {/* Row 1 */}
        <div className="flex items-center w-full">
          {/* Left section: Name */}
          <div className="flex-1 min-w-0">
            <h3 
              className={`font-semibold truncate cursor-pointer hover:text-blue-600 transition-colors ${item.is_active === false ? 'text-inactive-red' : 'text-slate-800'}`}
              title={`${item.name} (클릭하여 수정)`}
              onClick={handleStartEdit}
            >
              {item.name}
            </h3>
          </div>

          {/* Middle section: Short Name */}
          <div className="flex-1 text-center px-4">
            {item.short_name && (
                <p 
                  className={`text-sm truncate ${item.is_active === false ? 'text-inactive-red' : 'text-slate-500'}`}
                >
                  {item.short_name}
                </p>
            )}
          </div>

          {/* Right section: Price, Options Button, and Actions */}
          <div className="flex-1 flex items-center justify-end space-x-2">
            <span 
              className={`font-semibold whitespace-nowrap ${item.is_active === false ? 'text-inactive-red' : 'text-slate-800'}`}
            >
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.price)}
            </span>
            
            {/* Options Button */}
            <button
              onClick={handleOptionsClick}
              className="p-1.5 hover:bg-blue-100 rounded-full transition-colors opacity-0 group-hover:opacity-100"
              title="옵션 관리"
            >
              <Settings size={16} className="text-blue-600" />
            </button>
            
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <ItemActions 
                onEdit={handleStartEdit} 
                onDelete={() => onDelete(item.id)}
                onHide={onHide ? () => onHide(item.id) : undefined}
                is_active={item.is_active}
              />
            </div>
          </div>
        </div>
        
        {/* Row 2 */}
        <p 
          className={`text-sm truncate ${item.is_active === false ? 'text-inactive-red' : 'text-slate-600'}`}
          title={item.description}
        >
          {item.description || 'No description'}
        </p>
        
        {/* Row 3: Invalid Links */}
        {renderInvalidLinks()}
        {/* Row 4: Ambiguous Links */}
        {renderAmbiguousLinks()}
      </div>
    );

    const renderEditMode = () => (
      <div className="flex flex-col p-3 space-y-2 bg-blue-50 border-2 border-blue-200 rounded-lg flex-grow">
        <div className="grid grid-cols-6 gap-2">
          <input 
            ref={nameInputRef}
            value={editedName} 
            onChange={e => setEditedName(e.target.value)} 
            onKeyDown={handleKeyDown}
            className="w-full text-sm border rounded-md px-2 py-1 col-span-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
            placeholder="메뉴 이름" 
          />
          <input 
            value={editedShortName} 
            onChange={e => setEditedShortName(e.target.value)} 
            onKeyDown={handleKeyDown}
            className="w-full text-sm border rounded-md px-2 py-1 col-span-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
            placeholder="짧은 이름" 
          />
          <div className="flex items-center col-span-1">
            <button 
              type="button"
              onClick={() => handlePriceChange(-0.25)}
              className="px-2 py-1 border border-r-0 border-slate-300 rounded-l-md bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold"
              aria-label="Decrease price by 0.25"
            >
              -
            </button>
            <input 
              value={editedPrice} 
              onChange={e => setEditedPrice(e.target.value)} 
              onKeyDown={handleKeyDown}
              type="number" 
              step="0.25"
              className="w-full text-sm border-y border-slate-300 px-1 py-1 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="가격" 
            />
            <button 
              type="button"
              onClick={() => handlePriceChange(0.25)}
              className="px-2 py-1 border border-l-0 border-slate-300 rounded-r-md bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold"
              aria-label="Increase price by 0.25"
            >
              +
            </button>
          </div>
        </div>
        <textarea 
          value={editedDescription} 
          onChange={e => setEditedDescription(e.target.value)} 
          onKeyDown={handleKeyDown}
          className="w-full text-sm border rounded-md px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
          placeholder="설명" 
          rows={1}
        ></textarea>
        <div className="flex justify-between items-center mt-1">
          <span className="text-xs text-slate-500">Enter: 저장, Esc: 취소</span>
          <div className="flex space-x-2">
            <button onClick={handleCancelEdit} className="px-3 py-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md">취소</button>
            <button onClick={handleUpdate} className="px-3 py-1 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md">저장</button>
          </div>
        </div>
      </div>
    );

    const itemContainerClass = `
    bg-white rounded-lg shadow-md flex items-center mb-1 group menu-item-container
    ${item.is_active === false ? 'bg-slate-100 opacity-40' : 'bg-white hover:bg-blue-50 hover:shadow transition duration-150'}
  `;

    if (isEditing) {
      return (
        <div ref={ref} style={style} className={itemContainerClass}>
          <div {...attributes} {...listeners} className="pl-3 pr-2 cursor-grab self-stretch flex items-center">
            <GripVertical size={20} className="text-slate-400" />
          </div>
          {renderEditMode()}
        </div>
      );
    }

    return (
      <div ref={ref} style={style} className={itemContainerClass}>
        <div {...attributes} {...listeners} className="pl-3 pr-2 cursor-grab self-stretch flex items-center">
          <GripVertical size={20} className="text-slate-400" />
        </div>
        {renderDisplayMode()}
      </div>
    );
  }
);

export default SortableMenuItem; 