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
import { Category } from '../types';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SortableCategoryItem from './SortableCategoryItem';
import { Check, X } from 'lucide-react';

interface CategorySidebarProps {
  categories: Category[];
  selectedCategoryId: number | null;
  onSelectCategory: (id: number) => void;
  onAddCategory: (name: string) => void;
  onUpdateCategory: (id: number, name: string) => void;
  onDeleteCategory?: (id: number) => void;
  onToggleVisibility?: (id: number) => void;
  dndContextProps?: any;

}

const SortableCategoryItemWrapper = ({
  category, isSelected, onClick, onUpdate, onDelete, onToggleVisibility
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: category.id,
    data: { type: 'category', category },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

      const handleDelete = onDelete ? () => onDelete(category.id) : undefined;

  return (
    <SortableCategoryItem
      ref={setNodeRef}
      style={style}
      category={category}
      isSelected={isSelected}
      onClick={onClick}
      onUpdate={onUpdate}
      onDelete={handleDelete}
      onToggleVisibility={onToggleVisibility ? () => onToggleVisibility(category.id) : undefined}
      attributes={attributes}
      listeners={listeners}
      is_active={category.is_active ?? true}
    />
  );
};

const CategorySidebar: React.FC<CategorySidebarProps> = ({
  categories,
  selectedCategoryId,
  onSelectCategory,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onToggleVisibility,
}) => {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    if (newCategoryName.trim()) {
      onAddCategory(newCategoryName.trim());
      setNewCategoryName('');
      // 폼을 유지하기 위해 setIsAdding(false) 제거
    }
  };

  const handleCancel = () => {
    setNewCategoryName('');
    setIsAdding(false);
  };

  return (
    <aside className="h-full bg-white rounded-lg shadow-md flex flex-col overflow-hidden">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold text-slate-800">Categories</h2>
      </div>
      <div className="p-4 bg-slate-50 shrink-0 border-b">
        {isAdding ? (
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value.replace(/\b\w/g, char => char.toUpperCase()))}
              placeholder="New category name"
              className="w-full px-2 py-2 border rounded-md"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') handleCancel();
              }}
            />
            <button onClick={handleAdd} className="p-2 text-white bg-blue-500 rounded-md hover:bg-blue-600">
              <Check size={18} />
            </button>
            <button onClick={handleCancel} className="p-2 text-slate-600 bg-slate-200 rounded-md hover:bg-slate-300">
              <X size={18} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="group w-full relative overflow-hidden bg-white border-2 border-red-500 hover:border-red-600 text-red-600 hover:text-red-700 rounded-xl p-4 transition-all duration-300 ease-in-out transform hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
          >
            {/* 배경 효과 */}
            <div className="absolute inset-0 bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            
            {/* 메인 콘텐츠 */}
            <div className="relative flex items-center justify-center space-x-3">
              {/* 아이콘 */}
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center group-hover:bg-red-200 transition-all duration-300 transform group-hover:scale-110">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              
              {/* 텍스트 */}
              <div className="text-center">
                <div className="text-sm font-semibold tracking-wide">Add New Category</div>
                <div className="text-xs text-red-500 opacity-80 group-hover:opacity-100 transition-opacity duration-300">
                  Create a new menu category
                </div>
              </div>
            </div>
            
            {/* 호버 효과 */}
            <div className="absolute inset-0 bg-red-100/20 transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out"></div>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-2">
        <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {categories.map(category => (
            <SortableCategoryItemWrapper
              key={category.id}
              category={category}
              isSelected={selectedCategoryId === category.id}
              onClick={() => onSelectCategory(category.id)}
              onUpdate={onUpdateCategory}
              onDelete={onDeleteCategory}
              onToggleVisibility={onToggleVisibility}

            />
          ))}
        </SortableContext>
      </div>
    </aside>
  );
};

export default CategorySidebar;