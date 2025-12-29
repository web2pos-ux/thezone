import React, { useEffect, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Settings, Receipt, Printer } from 'lucide-react';
import { OptionsLibrary, DraggableOption } from '../types';

interface OptionsLibraryProps {
  onOptionDragStart?: (option: DraggableOption) => void;
}

const OptionsLibraryComponent: React.FC<OptionsLibraryProps> = ({ onOptionDragStart }) => {
  const [optionsLibrary, setOptionsLibrary] = useState<OptionsLibrary>({
    modifier_groups: [],
    tax_groups: [],
    printer_groups: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOptionsLibrary();
  }, []);

  const fetchOptionsLibrary = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/menu/options/library');
      if (!response.ok) {
        throw new Error('Failed to fetch options library');
      }
      const data = await response.json();
      setOptionsLibrary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500 text-sm">Error: {error}</div>
        <button 
          onClick={fetchOptionsLibrary}
          className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-sm border">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">옵션 라이브러리</h3>
      
      {/* Modifier Groups */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-4 h-4 text-blue-500" />
          <h4 className="font-medium text-gray-700">모디파이어 그룹</h4>
          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
            {optionsLibrary.modifier_groups.length}
          </span>
        </div>
        <div className="space-y-2">
          {optionsLibrary.modifier_groups.map((group) => (
            <DraggableOptionItem
              key={`modifier-${group.group_id}`}
              id={`modifier-${group.group_id}`}
              type="modifier"
              data={group}
              name={group.name}
              description={`${group.selection_type} • ${group.min_selection}-${group.max_selection}개 선택`}
              onDragStart={onOptionDragStart}
            />
          ))}
          {optionsLibrary.modifier_groups.length === 0 && (
            <div className="text-gray-500 text-sm py-2">모디파이어 그룹이 없습니다.</div>
          )}
        </div>
      </div>

      {/* Tax Groups */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-4 h-4 text-green-500" />
          <h4 className="font-medium text-gray-700">세금 그룹</h4>
          <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded">
            {optionsLibrary.tax_groups.length}
          </span>
        </div>
        <div className="space-y-2">
          {optionsLibrary.tax_groups.map((group) => (
            <DraggableOptionItem
              key={`tax-${group.tax_group_id}`}
              id={`tax-${group.tax_group_id}`}
              type="tax"
              data={group}
              name={group.name}
              description="세금 그룹"
              onDragStart={onOptionDragStart}
            />
          ))}
          {optionsLibrary.tax_groups.length === 0 && (
            <div className="text-gray-500 text-sm py-2">세금 그룹이 없습니다.</div>
          )}
        </div>
      </div>

      {/* Printer Groups */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Printer className="w-4 h-4 text-purple-500" />
          <h4 className="font-medium text-gray-700">프린터 그룹</h4>
          <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded">
            {optionsLibrary.printer_groups.length}
          </span>
        </div>
        <div className="space-y-2">
          {optionsLibrary.printer_groups.map((group) => (
            <DraggableOptionItem
              key={`printer-${group.printer_group_id}`}
              id={`printer-${group.printer_group_id}`}
              type="printer"
              data={group}
              name={group.name}
              description="프린터 그룹"
              onDragStart={onOptionDragStart}
            />
          ))}
          {optionsLibrary.printer_groups.length === 0 && (
            <div className="text-gray-500 text-sm py-2">프린터 그룹이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
};

interface DraggableOptionItemProps {
  id: string;
  type: 'modifier' | 'tax' | 'printer';
  data: any;
  name: string;
  description: string;
  onDragStart?: (option: DraggableOption) => void;
}

const DraggableOptionItem: React.FC<DraggableOptionItemProps> = ({
  id,
  type,
  data,
  name,
  description,
  onDragStart
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: {
      type,
      data
    }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'modifier': return 'border-blue-200 bg-blue-50';
      case 'tax': return 'border-green-200 bg-green-50';
      case 'printer': return 'border-purple-200 bg-purple-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'modifier': return <Settings className="w-4 h-4 text-blue-500" />;
      case 'tax': return <Receipt className="w-4 h-4 text-green-500" />;
      case 'printer': return <Printer className="w-4 h-4 text-purple-500" />;
      default: return <Settings className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 border rounded-lg cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${getTypeColor(type)}`}
      {...attributes}
      {...listeners}
      onMouseDown={() => onDragStart?.({ id, type, data })}
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <GripVertical className="w-4 h-4 text-gray-400" />
        </div>
        <div className="flex-shrink-0">
          {getTypeIcon(type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800 truncate">{name}</div>
          <div className="text-sm text-gray-500">{description}</div>
        </div>
      </div>
    </div>
  );
};

export default OptionsLibraryComponent; 