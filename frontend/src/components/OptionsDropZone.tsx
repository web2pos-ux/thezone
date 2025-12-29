import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Settings, Receipt, Printer, X, Plus } from 'lucide-react';
import { DroppableZone, MenuItemModifierGroup, MenuItemTaxGroup, MenuItemPrinterGroup } from '../types';

interface OptionsDropZoneProps {
  zone: DroppableZone;
  onRemoveOption: (type: string, id: number) => void;
}

const OptionsDropZone: React.FC<OptionsDropZoneProps> = ({ zone, onRemoveOption }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: zone.id,
  });

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'modifier': return 'border-blue-300 bg-blue-50';
      case 'tax': return 'border-green-300 bg-green-50';
      case 'printer': return 'border-purple-300 bg-purple-50';
      default: return 'border-gray-300 bg-gray-50';
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

  const getTypeText = (type: string) => {
    switch (type) {
      case 'modifier': return '모디파이어';
      case 'tax': return '세금';
      case 'printer': return '프린터';
      default: return '옵션';
    }
  };

  const renderOption = (option: MenuItemModifierGroup | MenuItemTaxGroup | MenuItemPrinterGroup) => {
    const isModifier = 'group_id' in option;
    const isTax = 'tax_group_id' in option;
    const isPrinter = 'printer_group_id' in option;

    let id: number;
    let name: string;
    let description: string = '';

    if (isModifier) {
      id = option.group_id;
      name = option.name;
      description = `${option.selection_type} • ${option.min_selection}-${option.max_selection}개 선택`;
    } else if (isTax) {
      id = option.tax_group_id;
      name = option.name;
      description = '세금 그룹';
    } else if (isPrinter) {
      id = option.printer_group_id;
      name = option.name;
      description = '프린터 그룹';
    } else {
      return null;
    }

    return (
      <div
        key={`${zone.type}-${id}`}
        className={`p-3 border rounded-lg bg-white shadow-sm ${getTypeColor(zone.type)}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              {getTypeIcon(zone.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-800 truncate">{name}</div>
              <div className="text-sm text-gray-500">{description}</div>
            </div>
          </div>
          <button
            onClick={() => onRemoveOption(zone.type, id)}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="옵션 제거"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        {getTypeIcon(zone.type)}
        <h4 className="font-medium text-gray-700">{zone.title}</h4>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
          {zone.options.length}
        </span>
      </div>
      
      <div
        ref={setNodeRef}
        className={`min-h-[120px] p-4 border-2 border-dashed rounded-lg transition-colors ${
          isOver 
            ? `${getTypeColor(zone.type).replace('bg-', 'bg-opacity-80 ')} border-opacity-100` 
            : 'border-gray-300 bg-gray-50'
        }`}
      >
        {zone.options.length > 0 ? (
          <div className="space-y-2">
            {zone.options.map(renderOption)}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Plus className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">여기에 {getTypeText(zone.type)}를 드래그하세요</p>
            <p className="text-xs mt-1">또는 옵션 라이브러리에서 선택하세요</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OptionsDropZone; 