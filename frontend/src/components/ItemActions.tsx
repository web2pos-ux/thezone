import React from 'react';
import { Eye, EyeOff, Trash2, Edit } from 'lucide-react';

type ItemActionsProps = {
  onEdit: () => void;
  onDelete?: () => void;
  onHide?: () => void;
  is_active?: boolean;

};

const ItemActions: React.FC<ItemActionsProps> = ({ onEdit, onDelete, onHide, is_active = true }) => {
  return (
    <div className="flex items-center space-x-0">
              {onDelete && (
        <button onClick={onDelete} className="p-1 hover:bg-red-100 rounded-full" title="Delete Item">
          <Trash2 size={18} className="text-red-500" />
        </button>
      )}
      {onHide && (
        <button onClick={onHide} className="p-1 hover:bg-red-100 rounded-full" title={is_active ? "Hide Item" : "Show Item"}>
          {is_active ? <EyeOff size={14} className="text-red-700" /> : <Eye size={14} className="text-slate-600" />}
        </button>
      )}
      <button onClick={onEdit} className="p-1 hover:bg-gray-200 rounded-full" title="Edit Item">
        <Edit size={18} className="text-gray-600" />
      </button>
    </div>
  );
};

export default ItemActions; 