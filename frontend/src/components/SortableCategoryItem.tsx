import React, { useState } from 'react';
import { Category } from '../types';
import { GripVertical, Edit, Trash2, Eye, EyeOff, X, Check } from 'lucide-react';

interface SortableCategoryItemProps {
  category: Category;
  isSelected: boolean;
  onClick: () => void;
  onUpdate: (id: number, name: string) => void;
  onDelete?: () => void;
  onToggleVisibility?: (id: number) => void;
  attributes: any;
  listeners: any;
  style: React.CSSProperties;

  is_active: boolean;
}

const SortableCategoryItem = React.forwardRef<HTMLDivElement, SortableCategoryItemProps>(
  ({ category, isSelected, onClick, onUpdate, onDelete, onToggleVisibility, attributes, listeners, style }, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(category.name);

    const handleUpdate = () => {
      if (editedName.trim()) {
        onUpdate(category.id, editedName.trim());
        setIsEditing(false);
      }
    };

    const containerClasses = `
      flex items-center mb-1 group
      rounded-b-md shadow-sm border-x-2 border-b-2 border-slate-100
      transition-all duration-150
      ${category.is_active === false
        ? 'bg-slate-100 opacity-40'
        : `${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : 'bg-white'} hover:shadow-md hover:border-x-blue-200 hover:border-b-blue-200`
      }
    `;
    
    if (isEditing) {
      return (
        <div ref={ref} style={style} className="flex items-center p-1.5 mb-1 bg-white rounded-b-md shadow-md border-x-2 border-b-2 border-slate-100">
          <div {...attributes} {...listeners} className="cursor-grab p-1.5 self-stretch flex items-center">
            <GripVertical size={20} className="text-slate-400" />
          </div>
          <input
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onKeyDown={(e) => { 
              if (e.key === 'Enter') handleUpdate(); 
              if (e.key === 'Escape') setIsEditing(false); 
            }}
            className="flex-grow px-2 py-1 border rounded-md mr-2"
            autoFocus
          />
          <div className="flex items-center space-x-1">
            <button 
              onClick={() => setIsEditing(false)} 
              className="p-1.5 hover:bg-red-100 rounded-full transition-colors"
              title="Cancel"
            >
              <X size={16} className="text-red-600" />
            </button>
            <button 
              onClick={handleUpdate} 
              className="p-1.5 hover:bg-green-100 rounded-full transition-colors"
              title="Save"
            >
              <Check size={16} className="text-green-600" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div ref={ref} style={style} className={containerClasses}>
        <div {...attributes} {...listeners} className="cursor-grab p-1.5 self-stretch flex items-center">
            <GripVertical size={20} className="text-slate-400" />
        </div>
        <div onClick={onClick} className="flex-grow flex items-center justify-between w-full text-left px-3 py-1.5 cursor-pointer">
            <span 
              className={`truncate text-base font-medium ${category.is_active === false ? 'text-inactive-red' : 'text-slate-800'}`}
            >
              {category.name}
            </span>
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity space-x-0">
                {onDelete && (
                  <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="p-1 hover:bg-red-100 rounded-full" 
                      title="Delete Category"
                  >
                      <Trash2 size={18} className="text-red-500" />
                  </button>
                )}
                {onToggleVisibility && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility(category.id); }} 
                        className="p-1 hover:bg-red-100 rounded-full"
                        title={category.is_active ? 'Hide Category' : 'Unhide Category'}
                    >
                        {category.is_active ? <EyeOff size={14} className="text-red-700" /> : <Eye size={14} className="text-blue-600" />}
                    </button>
                )}
                <button 
                    onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                    className="p-1 hover:bg-gray-200 rounded-full" 
                    title="Edit Category"
                >
                    <Edit size={18} className="text-gray-600" />
                </button>
            </div>
        </div>
      </div>
    );
  }
);

export default SortableCategoryItem; 