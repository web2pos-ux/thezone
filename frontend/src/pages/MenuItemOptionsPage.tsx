import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { ArrowLeft, Save, RefreshCw } from 'lucide-react';
import OptionsLibraryComponent from '../components/OptionsLibrary';
import OptionsDropZone from '../components/OptionsDropZone';
import { 
  MenuItemOptions, 
  DroppableZone, 
  DraggableOption,
  MenuItemModifierGroup,
  MenuItemTaxGroup,
  MenuItemPrinterGroup,
  LibraryModifierGroup,
  LibraryTaxGroup,
  LibraryPrinterGroup
} from '../types';

const MenuItemOptionsPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  
  const [itemOptions, setItemOptions] = useState<MenuItemOptions>({
    modifier_groups: [],
    tax_groups: [],
    printer_groups: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DraggableOption | null>(null);

  const dropZones: DroppableZone[] = [
    {
      id: 'modifier-zone',
      type: 'modifier',
      title: '모디파이어 그룹',
      options: itemOptions.modifier_groups
    },
    {
      id: 'tax-zone',
      type: 'tax',
      title: '세금 그룹',
      options: itemOptions.tax_groups
    },
    {
      id: 'printer-zone',
      type: 'printer',
      title: '프린터 그룹',
      options: itemOptions.printer_groups
    }
  ];

  useEffect(() => {
    if (itemId) {
      fetchItemOptions();
    }
  }, [itemId]);

  const fetchItemOptions = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/menu/items/${itemId}/options`);
      if (!response.ok) {
        throw new Error('Failed to fetch item options');
      }
      const data = await response.json();
      setItemOptions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedOption = active.data.current as DraggableOption;
    setActiveDrag(draggedOption);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      setActiveDrag(null);
      return;
    }

    const draggedOption = active.data.current as DraggableOption;
    const dropZoneId = over.id as string;

    // Check if the drop zone matches the option type
    const zone = dropZones.find(z => z.id === dropZoneId);
    if (!zone || zone.type !== draggedOption.type) {
      setActiveDrag(null);
      return;
    }

    try {
      await linkOptionToItem(draggedOption);
      await fetchItemOptions(); // Refresh the options
    } catch (err) {
      console.error('Failed to link option:', err);
      setError('옵션 연결에 실패했습니다.');
    }

    setActiveDrag(null);
  };

  const linkOptionToItem = async (option: DraggableOption) => {
    const endpoint = `/api/menu/items/${itemId}/options/${option.type}`;
    
    let body: any;
    
    if (option.type === 'modifier') {
      const modifierData = option.data as LibraryModifierGroup;
      body = { modifier_group_id: modifierData.group_id };
    } else if (option.type === 'tax') {
      const taxData = option.data as LibraryTaxGroup;
      body = { tax_group_id: taxData.tax_group_id };
    } else if (option.type === 'printer') {
      const printerData = option.data as LibraryPrinterGroup;
      body = { printer_group_id: printerData.printer_group_id };
    } else {
      throw new Error('Invalid option type');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to link option');
    }
  };

  const handleRemoveOption = async (type: string, id: number) => {
    try {
      const endpoint = `/api/menu/items/${itemId}/options/${type}/${id}`;
      const response = await fetch(endpoint, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to remove option');
      }

      await fetchItemOptions(); // Refresh the options
    } catch (err) {
      console.error('Failed to remove option:', err);
      setError('옵션 제거에 실패했습니다.');
    }
  };

  const handleSave = async () => {
    // Options are automatically saved when linked/unlinked
    // This function can be used for additional validation or confirmation
    setSaving(true);
    try {
      // Simulate save process
      await new Promise(resolve => setTimeout(resolve, 500));
      // You could add additional save logic here if needed
    } catch (err) {
      setError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="h-96 bg-gray-200 rounded"></div>
              </div>
              <div className="lg:col-span-2">
                <div className="space-y-6">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-48 bg-gray-200 rounded"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">메뉴 아이템 옵션 관리</h1>
                <p className="text-gray-600">아이템 ID: {itemId}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchItemOptions}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                새로고침
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="text-red-800 text-sm">{error}</div>
              <button
                onClick={() => setError(null)}
                className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
              >
                닫기
              </button>
            </div>
          )}

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Options Library */}
            <div className="lg:col-span-1">
              <OptionsLibraryComponent />
            </div>

            {/* Drop Zones */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-lg font-semibold mb-6 text-gray-800">연결된 옵션</h2>
                
                {dropZones.map((zone) => (
                  <OptionsDropZone
                    key={zone.id}
                    zone={zone}
                    onRemoveOption={handleRemoveOption}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDrag ? (
            <div className="p-3 border rounded-lg bg-white shadow-lg opacity-90">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium text-gray-800">
                    {activeDrag.data.name}
                  </div>
                  <div className="text-sm text-gray-500">
                    {activeDrag.type === 'modifier' ? '모디파이어 그룹' : 
                     activeDrag.type === 'tax' ? '세금 그룹' : '프린터 그룹'}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
};

export default MenuItemOptionsPage; 