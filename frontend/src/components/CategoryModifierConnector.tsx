import React, { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  GripVertical, 
  Plus, 
  X, 
  CheckCircle, 
  AlertCircle,
  Loader2 
} from 'lucide-react';

const API_URL = 'http://localhost:3177/api';

interface ModifierGroup {
  group_id: number;
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
}

interface Category {
  category_id: number;
  name: string;
  menu_id: number;
  sort_order: number;
}

interface CategoryModifierConnectorProps {
  menuId: number;
}

// 드래그 가능한 모디파이어 그룹 컴포넌트
const DraggableModifierGroup: React.FC<{
  group: ModifierGroup;
  isConnected: boolean;
}> = ({ group, isConnected }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `modifier-${group.group_id}`,
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
        flex items-center justify-between p-3 mb-2 rounded-lg border-2
        transition-all duration-200 hover:shadow-md
        ${isConnected 
          ? 'border-green-200 bg-green-50 hover:border-green-300' 
          : 'border-gray-200 bg-white hover:border-blue-300'
        }
        ${isDragging ? 'shadow-lg scale-105' : ''}
      `}
    >
      <div className="flex items-center space-x-3">
        {/* 드래그 핸들 - 여기만 드래그 가능 */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab hover:cursor-grabbing p-2 rounded hover:bg-gray-100 transition-colors group border border-transparent hover:border-gray-300 active:cursor-grabbing"
          title="드래그하여 카테고리에 연결"
        >
          <div className="flex flex-col space-y-0.5">
            <div className="w-4 h-0.5 bg-gray-400 group-hover:bg-gray-600 transition-colors rounded"></div>
            <div className="w-4 h-0.5 bg-gray-400 group-hover:bg-gray-600 transition-colors rounded"></div>
            <div className="w-4 h-0.5 bg-gray-400 group-hover:bg-gray-600 transition-colors rounded"></div>
          </div>
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-gray-900">{group.name}</h4>
          <p className="text-sm text-gray-500">
            {group.selection_type === 'SINGLE' ? 'Single' : 'Multiple'} • 
            {group.min_selection}-{group.max_selection} 선택
          </p>
        </div>
      </div>
      {isConnected && (
        <CheckCircle className="text-green-500 w-5 h-5" />
      )}
    </div>
  );
};

// 드롭 가능한 카테고리 컴포넌트
const DroppableCategory: React.FC<{
  category: Category;
  connectedModifiers: ModifierGroup[];
  onConnect: (categoryId: number, modifierGroupId: number) => Promise<void>;
  onDisconnect: (categoryId: number, modifierGroupId: number) => Promise<void>;
}> = ({ category, connectedModifiers, onConnect, onDisconnect }) => {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `category-${category.category_id}`,
    data: { type: 'category', category },
  });

  const isModifierBeingDragged = active?.data.current?.type === 'modifier';
  const draggedModifier = active?.data.current?.group as ModifierGroup;

  return (
    <div
      ref={setNodeRef}
      className={`
        p-4 rounded-lg border-2 transition-all duration-200
        ${isOver && isModifierBeingDragged 
          ? 'border-blue-400 bg-blue-50 shadow-lg scale-105' 
          : 'border-gray-200 bg-white'
        }
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
        {isOver && isModifierBeingDragged && (
          <div className="flex items-center space-x-2 text-blue-600">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">연결하기</span>
          </div>
        )}
      </div>

      {/* 연결된 모디파이어 목록 */}
      <div className="space-y-2">
        {connectedModifiers.length === 0 ? (
          <p className="text-sm text-gray-500 italic">연결된 모디파이어가 없습니다</p>
        ) : (
          connectedModifiers.map((modifier) => (
            <div
              key={modifier.group_id}
              className="flex items-center justify-between p-2 bg-gray-50 rounded border"
            >
              <div>
                <span className="text-sm font-medium text-gray-900">{modifier.name}</span>
                <span className="text-xs text-gray-500 ml-2">
                  {modifier.selection_type === 'SINGLE' ? 'Single' : 'Multiple'}
                </span>
              </div>
              <button
                onClick={() => onDisconnect(category.category_id, modifier.group_id)}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const CategoryModifierConnector: React.FC<CategoryModifierConnectorProps> = ({ menuId }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [connections, setConnections] = useState<Map<number, ModifierGroup[]>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // 데이터 로드
  useEffect(() => {
    loadData();
  }, [menuId]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // 카테고리 로드
      const categoriesResponse = await fetch(`${API_URL}/menu/categories?menu_id=${menuId}`);
      const categoriesData = await categoriesResponse.json();

      // 모디파이어 그룹 로드
      const modifiersResponse = await fetch(`${API_URL}/modifiers/groups`);
      const modifiersData = await modifiersResponse.json();

      setCategories(categoriesData);
      setModifierGroups(modifiersData);

      // 기존 연결 로드
      const connectionsMap = new Map<number, ModifierGroup[]>();
      for (const category of categoriesData) {
        try {
          const connectionsResponse = await fetch(`${API_URL}/menu/categories/${category.category_id}/modifiers`);
          const connectionsData = await connectionsResponse.json();
          connectionsMap.set(category.category_id, connectionsData);
        } catch (error) {
          console.error(`Failed to load connections for category ${category.category_id}:`, error);
          connectionsMap.set(category.category_id, []);
        }
      }
      setConnections(connectionsMap);

    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 드래그 시작
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  // 드래그 종료
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId.startsWith('modifier-') && overId.startsWith('category-')) {
      const modifierId = parseInt(activeId.replace('modifier-', ''));
      const categoryId = parseInt(overId.replace('category-', ''));

      await connectModifierToCategory(categoryId, modifierId);
    }
  };

  // 모디파이어를 카테고리에 연결
  const connectModifierToCategory = async (categoryId: number, modifierGroupId: number) => {
    setIsConnecting(true);
    try {
      const response = await fetch(`${API_URL}/menu/categories/${categoryId}/modifiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modifier_group_id: modifierGroupId }),
      });

      if (response.ok) {
        // 연결 상태 업데이트
        const modifierGroup = modifierGroups.find(g => g.group_id === modifierGroupId);
        if (modifierGroup) {
          setConnections(prev => {
            const newConnections = new Map(prev);
            const currentConnections = newConnections.get(categoryId) || [];
            newConnections.set(categoryId, [...currentConnections, modifierGroup]);
            return newConnections;
          });
        }
      } else {
        const error = await response.json();
        alert(`연결 실패: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to connect modifier:', error);
      alert('연결 중 오류가 발생했습니다.');
    } finally {
      setIsConnecting(false);
    }
  };

  // 모디파이어 연결 해제
  const disconnectModifierFromCategory = async (categoryId: number, modifierGroupId: number) => {
    try {
      const response = await fetch(`${API_URL}/menu/categories/${categoryId}/modifiers/${modifierGroupId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // 연결 상태 업데이트
        setConnections(prev => {
          const newConnections = new Map(prev);
          const currentConnections = newConnections.get(categoryId) || [];
          newConnections.set(categoryId, currentConnections.filter(m => m.group_id !== modifierGroupId));
          return newConnections;
        });
      } else {
        const error = await response.json();
        alert(`연결 해제 실패: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to disconnect modifier:', error);
      alert('연결 해제 중 오류가 발생했습니다.');
    }
  };

  // 모디파이어가 특정 카테고리에 연결되어 있는지 확인
  const isModifierConnected = (modifierGroupId: number, categoryId: number) => {
    const categoryConnections = connections.get(categoryId) || [];
    return categoryConnections.some(m => m.group_id === modifierGroupId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">데이터를 불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            카테고리-모디파이어 연결 관리
          </h1>
          <p className="text-gray-600">
            모디파이어 그룹을 드래그하여 카테고리에 연결하세요.
          </p>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 모디파이어 그룹 목록 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                모디파이어 그룹
              </h2>
              <div className="space-y-2">
                {modifierGroups.map((group) => (
                  <DraggableModifierGroup
                    key={group.group_id}
                    group={group}
                    isConnected={Array.from(connections.values()).some(conns => 
                      conns.some(m => m.group_id === group.group_id)
                    )}
                  />
                ))}
              </div>
            </div>

            {/* 카테고리 목록 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                카테고리
              </h2>
              <div className="space-y-4">
                {categories.map((category) => (
                  <DroppableCategory
                    key={category.category_id}
                    category={category}
                    connectedModifiers={connections.get(category.category_id) || []}
                    onConnect={connectModifierToCategory}
                    onDisconnect={disconnectModifierFromCategory}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 드래그 오버레이 */}
          <DragOverlay>
            {activeId && activeId.startsWith('modifier-') && (
              <div className="bg-white p-3 rounded-lg shadow-lg border-2 border-blue-400">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded bg-gray-100 border border-gray-300">
                    <div className="flex flex-col space-y-0.5">
                      <div className="w-4 h-0.5 bg-gray-600 rounded"></div>
                      <div className="w-4 h-0.5 bg-gray-600 rounded"></div>
                      <div className="w-4 h-0.5 bg-gray-600 rounded"></div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">
                      {modifierGroups.find(g => `modifier-${g.group_id}` === activeId)?.name}
                    </h4>
                    <p className="text-sm text-gray-500">드래그하여 연결</p>
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* 연결 중 로딩 오버레이 */}
        {isConnecting && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center space-x-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-gray-700">연결 중...</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryModifierConnector; 