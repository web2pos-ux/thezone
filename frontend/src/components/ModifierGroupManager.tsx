import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Loader2, X, ChevronDown, ChevronUp, Search, Copy, Square, CheckCircle } from 'lucide-react';
import DynamicModifierForm, { ModifierRowData } from './DynamicModifierForm';

const API_URL = 'http://localhost:3177/api';

interface ModifierOption {
  option_id: number;
  name: string;
  price_adjustment: number;
  price_adjustment_2?: number;
}

interface ModifierGroup {
  id: number;
  name: string;
  selection_type: string;
  min_selections: number;
  max_selections: number;
  modifiers: ModifierOption[];
  labels?: { label_id: number; name: string }[];
}

const ModifierGroupEditor: React.FC<{
  group?: ModifierGroup | null;
  onSave: (group: { name: string, min_selections: number, max_selections: number, modifiers: { name: string, price_adjustment: number, price_adjustment_2?: number }[], label?: string }) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}> = ({ group, onSave, onCancel, isSaving }) => {
  const [name, setName] = useState('');
  const [minSelections, setMinSelections] = useState(0);
  const [maxSelections, setMaxSelections] = useState(0);
  const [label, setLabel] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<{ triggerSave: () => void }>(null);

  // Auto-focus on Group Name input when creating new group
  useEffect(() => {
    if (!group && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [group]);

  // Update all states when group changes (for editing existing groups)
  useEffect(() => {
    if (group) {
      setName(group.name || '');
      setMinSelections(group.min_selections || 0);
      setMaxSelections(group.max_selections || 0);
      setLabel(group.labels?.[0]?.name || '');
      console.log('🔍 기존 그룹 편집 - Min/Max 설정:', { 
        min: group.min_selections || 0, 
        max: group.max_selections || 0 
      });
    } else {
      // Reset for new group - Min과 Max를 0으로 초기화
      setName('');
      setMinSelections(0);  // 1 → 0으로 복원
      setMaxSelections(0);  // 1 → 0으로 복원
      setLabel('');
      console.log('🔍 새 그룹 생성 - Min/Max 초기값:', { min: 0, max: 0 });
    }
  }, [group]);

  // Handle Enter key press to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSaving) {
      e.preventDefault();
      if (formRef.current) {
        formRef.current.triggerSave();
      }
    }
  };

  // Auto-capitalize first letter and after spaces
  const capitalizeInput = (value: string): string => {
    return value.replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const capitalizedValue = capitalizeInput(e.target.value);
    setName(capitalizedValue);
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const capitalizedValue = capitalizeInput(e.target.value);
    setLabel(capitalizedValue);
  };



  const handleSave = (options: Omit<ModifierRowData, 'id'>[]) => {
    if (!name.trim()) {
      alert('Group name is required.');
      return;
    }
    
    // Min/Max 값 검증
    if (minSelections < 0 || maxSelections < 0) {
      alert('Min과 Max 값은 0 이상이어야 합니다.');
      return;
    }
    
    if (minSelections > maxSelections) {
      alert('Min 값은 Max 값보다 클 수 없습니다.');
      return;
    }
    
    // Convert rate to price_adjustment - allow 0 as valid value
    const convertedOptions = options.map(option => ({
      name: option.name,
      price_adjustment: typeof option.rate === 'string' ? parseFloat(option.rate) || 0 : option.rate,
      price_adjustment_2: typeof (option as any).rate2 === 'string' ? parseFloat((option as any).rate2) || 0 : ((option as any).rate2 || 0)
    }));
    
    const saveData = { 
      name: name.trim(), 
      min_selections: minSelections,
      max_selections: maxSelections,
      modifiers: convertedOptions,
      label: label.trim() || undefined
    };
    
    // 디버깅 로그 추가
    console.log('🔍 ModifierGroupEditor - 저장할 데이터:', saveData);
    console.log('🔍 Min/Max 값:', { min: minSelections, max: maxSelections });
    console.log('🔍 Min/Max 타입:', { 
      min_type: typeof minSelections, 
      max_type: typeof maxSelections 
    });
    
    onSave(saveData);
  };

  // Min/Max 변경 시 자동으로 Required/Optional 상태 계산
  const getSelectionStatus = (min: number, max: number): { type: 'OPTIONAL' | 'REQUIRED', description: string } => {
    if (min === 0 && max === 0) {
      return { type: 'OPTIONAL', description: '선택하지 않아도 됨' };
    } else if (min === 1 && max === 1) {
      return { type: 'REQUIRED', description: '1개 선택 필수' };
    } else if (min > 0 && max > 0) {
      return { type: 'REQUIRED', description: `${min}-${max}개 선택 필수` };
    } else if (min === 0 && max > 0) {
      return { type: 'OPTIONAL', description: `최대 ${max}개 선택 가능` };
    } else {
      return { type: 'REQUIRED', description: `${min}-${max}개 선택 필수` };
    }
  };

  const handleMinSelectionsChange = (value: number) => {
    console.log('🔍 Min 값 변경:', { 이전값: minSelections, 새값: value });
    setMinSelections(value);
  };

  const handleMaxSelectionsChange = (value: number) => {
    console.log('🔍 Max 값 변경:', { 이전값: maxSelections, 새값: value });
    setMaxSelections(value);
  };

  const selectionStatus = getSelectionStatus(minSelections, maxSelections);

  return (
    <div className="p-3 border rounded-lg bg-white shadow-sm mt-2">
      <h3 className="text-lg font-semibold mb-3">{group ? 'Edit' : 'Option'} Group</h3>
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
          <input
            ref={nameInputRef}
            id="group-name"
            type="text"
            value={name}
            onChange={handleNameChange}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Size Selection"
            className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label htmlFor="group-label" className="block text-sm font-medium text-gray-700 mb-1">Label</label>
          <input
            id="group-label"
            type="text"
            value={label}
            onChange={handleLabelChange}
            onKeyDown={handleKeyDown}
            placeholder="Filter label"
            className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-16">
          <label htmlFor="min-selections" className="block text-sm font-medium text-gray-700 mb-1">Min</label>
          <input
            id="min-selections"
            type="number"
            value={minSelections}
            onChange={(e) => {
              const newValue = parseInt(e.target.value) || 0;
              console.log('🔍 Min 입력 필드 변경:', { 
                입력값: e.target.value, 
                파싱된값: newValue, 
                현재상태: minSelections 
              });
              handleMinSelectionsChange(newValue);
            }}
            onKeyDown={handleKeyDown}
            min="0"
            className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-16">
          <label htmlFor="max-selections" className="block text-sm font-medium text-gray-700 mb-1">Max</label>
          <input
            id="max-selections"
            type="number"
            value={maxSelections}
            onChange={(e) => {
              const newValue = parseInt(e.target.value) || 0;
              console.log('🔍 Max 입력 필드 변경:', { 
                입력값: e.target.value, 
                파싱된값: newValue, 
                현재상태: maxSelections 
              });
              handleMaxSelectionsChange(newValue);
            }}
            onKeyDown={handleKeyDown}
            min="0"
            className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      
      {/* Required/Optional 상태 표시 */}
      <div className="mb-3 p-2 rounded-md border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Selection Status:</span>
          <div className={`flex items-center space-x-2 px-2 py-1 rounded-full ${
            selectionStatus.type === 'OPTIONAL' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-red-100 text-red-700'
          }`}>
            {selectionStatus.type === 'OPTIONAL' ? (
              <Square size={14} className="text-green-500" />
            ) : (
              <CheckCircle size={14} className="text-red-500" />
            )}
            <span className="text-xs font-medium">{selectionStatus.type}</span>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-1">{selectionStatus.description}</p>
      </div>
      
      <DynamicModifierForm
        ref={formRef}
        initialData={group?.modifiers.map(option => ({
          name: option.name,
          rate: option.price_adjustment,
          rate2: option.price_adjustment_2 || 0
        })) || []}
        onSave={handleSave}
        isLoading={isSaving}
        fieldConfig={{
          nameLabel: 'Option Name',
          rateLabel: 'Price'
        }}
        onCancel={onCancel}
      />
    </div>
  );
};

interface ModifierGroupManagerProps {
  menuId?: number;
}

const ModifierGroupManager: React.FC<ModifierGroupManagerProps> = ({ menuId }) => {
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | 'new' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copying, setCopying] = useState<number | null>(null);

  const fetchModifierGroups = async () => {
    try {
      const url = menuId ? `${API_URL}/modifier-groups?menu_id=${menuId}` : `${API_URL}/modifier-groups`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch modifier groups');
      const data = await response.json();
      
      // 디버깅 로그 추가
      console.log('🔍 fetchModifierGroups - 받은 데이터:', data);
      console.log('🔍 첫 번째 그룹의 Min/Max:', data[0] ? {
        name: data[0].name,
        min_selections: data[0].min_selections,
        max_selections: data[0].max_selections,
        selection_type: data[0].selection_type
      } : '데이터 없음');
      
      setModifierGroups(data);
    } catch (error) {
      console.error('Error fetching modifier groups:', error);
    }
  };

  useEffect(() => {
    fetchModifierGroups();
  }, []);

  const toggleGroup = (groupId: number) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const getSelectionRuleText = (group: ModifierGroup): React.ReactNode => {
    const { min_selections, max_selections } = group;
    
    // Min = 0, Max = 0이면 Optional
    if (min_selections === 0 && max_selections === 0) {
      return (
        <div title="Optional - 선택하지 않아도 됨" className="flex items-center space-x-1">
          <Square size={16} className="text-green-500" />
          <span className="text-xs text-green-600 font-medium">Optional</span>
        </div>
      );
    } 
    // Min = 1, Max = 1이면 Required Single
    else if (min_selections === 1 && max_selections === 1) {
      return (
        <div title="Required - 1개 선택 필수" className="flex items-center space-x-1">
          <CheckCircle size={16} className="text-red-500" />
          <span className="text-xs text-red-600 font-medium">Required (1개)</span>
        </div>
      );
    } 
    // Min > 0, Max > 0이면 Required Multiple
    else if (min_selections > 0 && max_selections > 0) {
      return (
        <div title={`Required - ${min_selections}-${max_selections}개 선택`} className="flex items-center space-x-1">
          <CheckCircle size={16} className="text-red-500" />
          <span className="text-xs text-red-600 font-medium">Required ({min_selections}-{max_selections}개)</span>
        </div>
      );
    } 
    // Min = 0, Max > 0이면 Optional Multiple
    else if (min_selections === 0 && max_selections > 0) {
      return (
        <div title={`Optional - 최대 ${max_selections}개 선택 가능`} className="flex items-center space-x-1">
          <Square size={16} className="text-green-500" />
          <span className="text-xs text-green-600 font-medium">Optional (최대 {max_selections}개)</span>
        </div>
      );
    } 
    // 기타 경우
    else {
      return (
        <div title={`Required - ${min_selections}-${max_selections}개 선택`} className="flex items-center space-x-1">
          <CheckCircle size={16} className="text-red-500" />
          <span className="text-xs text-red-600 font-medium">Required ({min_selections}-{max_selections}개)</span>
        </div>
      );
    }
  };

  const handleSave = async (groupData: { name: string, min_selections: number, max_selections: number, modifiers: { name: string, price_adjustment: number, price_adjustment_2?: number }[], label?: string }) => {
    setIsSaving(true);
    try {
      const isNew = editingGroup === 'new';
      const url = isNew ? `${API_URL}/modifier-groups` : `${API_URL}/modifier-groups/${(editingGroup as ModifierGroup).id}`;
      const method = isNew ? 'POST' : 'PUT';
      
      const requestBody = menuId ? { ...groupData, menu_id: menuId } : groupData;
      console.log('🔍 ModifierGroupManager - API 요청:', { url, method, body: requestBody });
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ API 응답 오류:', errorData);
        throw new Error(`Failed to ${isNew ? 'create' : 'update'} modifier group: ${errorData.error || response.statusText}`);
      }

      const savedData = await response.json();
      console.log('✅ SQLite 저장 완료:', savedData);

      // Firebase 동기화 시도
      try {
        const syncResponse = await fetch(`${API_URL}/menu-sync/sync-modifiers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: savedData.id }),
        });
        if (syncResponse.ok) {
          console.log('✅ Firebase 동기화 완료');
        } else {
          console.warn('⚠️ Firebase 동기화 실패 (SQLite는 저장됨)');
        }
      } catch (syncError) {
        console.warn('⚠️ Firebase 동기화 오류 (SQLite는 저장됨):', syncError);
      }

      await fetchModifierGroups();
      setEditingGroup(null);
    } catch (error) {
      console.error('Error saving modifier group:', error);
      alert('Failed to save modifier group. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSettings = async (groupId: number, minSelections: number, maxSelections: number) => {
    try {
      const response = await fetch(`${API_URL}/modifier-groups/${groupId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ min_selections: minSelections, max_selections: maxSelections })
      });

      if (!response.ok) {
        throw new Error('Failed to update settings');
      }

      const result = await response.json();
      console.log('Settings updated:', result);
      
      // Refresh the modifier groups list
      await fetchModifierGroups();
      
      alert('설정이 성공적으로 업데이트되었습니다!');
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('설정 업데이트에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleDelete = async (groupId: number) => {
    if (!window.confirm('Are you sure you want to delete this modifier group?')) return;
    
    try {
      const response = await fetch(`${API_URL}/modifier-groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete modifier group');
      await fetchModifierGroups();
    } catch (error) {
      console.error('Error deleting modifier group:', error);
      alert('Failed to delete modifier group. Please try again.');
    }
  };

  const handleCopyClick = async (group: ModifierGroup) => {
    setCopying(group.id);
    
    try {
      const newGroupName = `${group.name} COPY`;
      const response = await fetch(`${API_URL}/modifier-groups/${group.id}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newGroupName,
          menu_id: menuId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to copy modifier group');
      }

      await fetchModifierGroups();
    } catch (err) {
      console.error('Failed to copy group:', err);
      alert('Failed to copy modifier group. Please try again.');
    } finally {
      setCopying(null);
    }
  };

  // Enhanced search to include labels
  const filteredGroups = modifierGroups.filter(group => {
    const searchLower = searchTerm.toLowerCase();
    const nameMatch = group.name.toLowerCase().includes(searchLower);
    const labelMatch = group.labels?.some(label => 
      label.name.toLowerCase().includes(searchLower)
    ) || false;
    return nameMatch || labelMatch;
  });

  if (editingGroup) {
    return (
      <ModifierGroupEditor
        group={editingGroup === 'new' ? null : editingGroup}
        onSave={handleSave}
        onCancel={() => setEditingGroup(null)}
        isSaving={isSaving}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="flex-1 max-w-md relative">
          <input
            type="text"
            placeholder="Search groups and labels..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <Search className="w-4 h-4 text-gray-400" />
          </div>
        </div>
        <button
          onClick={() => setEditingGroup('new')}
          className="ml-3 px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
        >
          Make Option Group
        </button>
      </div>

      <div className="space-y-0.5">
        {filteredGroups.map(group => {
          // 디버깅 로그 추가
          console.log('🔍 렌더링 중인 그룹:', {
            id: group.id,
            name: group.name,
            min_selections: group.min_selections,
            max_selections: group.max_selections,
            selection_type: group.selection_type
          });
          
          return (
            <div key={group.id} className="group p-2 border border-gray-400 rounded-md bg-gray-50">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2 flex-1 min-w-0 mr-2">
                <h2 className="text-base font-semibold text-slate-800 truncate flex-1">{group.name}</h2>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">
                    Min: {group.min_selections}, Max: {group.max_selections}
                  </span>
                  {(() => {
                    const { min_selections, max_selections } = group;
                    if (min_selections === 0 && max_selections === 0) {
                      return (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Optional
                        </span>
                      );
                    } else if (min_selections === 1 && max_selections === 1) {
                      return (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          Required (1개)
                        </span>
                      );
                    } else if (min_selections > 0 && max_selections > 0) {
                      return (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          Required ({min_selections}-{max_selections}개)
                        </span>
                      );
                    } else if (min_selections === 0 && max_selections > 0) {
                      return (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Optional (최대 {max_selections}개)
                        </span>
                      );
                    } else {
                      return (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          Required ({min_selections}-{max_selections}개)
                        </span>
                      );
                    }
                  })()}
                </div>
                <button onClick={() => toggleGroup(group.id)} className="p-1 hover:bg-gray-200 rounded-full flex-shrink-0">
                  {expandedGroups.has(group.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
              <div className="flex items-center flex-shrink-0 space-x-1">
                {group.labels && group.labels.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                    {group.labels[0].name}
                  </span>
                )}
                <div className="ml-1">
                  {getSelectionRuleText(group)}
                </div>
                <div className="flex items-center space-x-0.5 ml-1">
                  <button onClick={() => handleDelete(group.id)} className="p-0.5 text-red-500 hover:bg-red-100 rounded invisible group-hover:visible"><Trash2 size={14} /></button>
                  <button 
                    onClick={() => handleCopyClick(group)} 
                    disabled={copying === group.id}
                    className="p-0.5 text-blue-600 hover:bg-blue-100 rounded invisible group-hover:visible disabled:opacity-50" 
                    title="Copy modifier group"
                  >
                    {copying === group.id ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                  </button>
                  <button onClick={() => setEditingGroup(group)} className="p-0.5 hover:bg-gray-200 rounded invisible group-hover:visible"><Edit size={14} /></button>
                </div>
              </div>
            </div>
            {expandedGroups.has(group.id) && (
              <div className="mt-0 space-y-0 pl-4 pr-24 py-0">
                {/* Min/Max 설정 수정 섹션 */}
                <div className="mb-3 p-2 bg-gray-50 rounded border">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-xs font-medium text-gray-700">Min/Max 설정 수정:</span>
                    <input
                      type="number"
                      min="0"
                      value={group.min_selections}
                      onChange={(e) => {
                        const newMin = parseInt(e.target.value) || 0;
                        const newMax = Math.max(newMin, group.max_selections);
                        handleUpdateSettings(group.id, newMin, newMax);
                      }}
                      className="w-16 px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Min"
                    />
                    <span className="text-xs text-gray-500">~</span>
                    <input
                      type="number"
                      min="0"
                      value={group.max_selections}
                      onChange={(e) => {
                        const newMax = parseInt(e.target.value) || 0;
                        const newMin = Math.min(newMax, group.min_selections);
                        handleUpdateSettings(group.id, newMin, newMax);
                      }}
                      className="w-16 px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Max"
                    />
                    <button
                      onClick={() => handleUpdateSettings(group.id, group.min_selections, group.max_selections)}
                      className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                      title="설정 저장"
                    >
                      저장
                    </button>
                  </div>
                  <p className="text-xs text-gray-600">
                    Min: 최소 선택 개수, Max: 최대 선택 개수
                  </p>
                </div>
                
                {/* 헤더 - Price_Modi1 & Price_Modi2 */}
                {group.modifiers.length > 0 && (
                  <div className="flex justify-between items-center text-xs py-1 border-b border-gray-200 mb-1">
                    <span className="text-gray-500 font-medium">Option</span>
                    <div className="flex gap-3">
                      <span className="text-gray-500 font-medium min-w-[60px] text-right">Price_Modi1</span>
                      <span className="text-green-500 font-medium min-w-[60px] text-right">Price_Modi2</span>
                    </div>
                  </div>
                )}
                {/* 모디파이어 옵션들 */}
                {group.modifiers.map(option => {
                  const p1 = option.price_adjustment || 0;
                  const p2 = option.price_adjustment_2 || 0;
                  return (
                    <div key={option.option_id} className="flex justify-between items-center text-xs py-0.5">
                      <span className="text-gray-600">{option.name}</span>
                      <div className="flex gap-3">
                        <span className="font-semibold text-slate-800 min-w-[60px] text-right">
                          {p1 === 0 ? 'Free' : `${p1 >= 0 ? '+' : ''}$${p1.toFixed(2)}`}
                        </span>
                        <span className="font-semibold text-green-600 min-w-[60px] text-right">
                          {p2 === 0 ? 'Free' : `${p2 >= 0 ? '+' : ''}$${p2.toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
        {filteredGroups.length === 0 && modifierGroups.length > 0 && (
          <p className="text-gray-500 text-center py-8 text-sm">No modifier groups found matching "{searchTerm}"</p>
        )}
        {modifierGroups.length === 0 && (
          <p className="text-gray-500 text-center py-8 text-sm">No modifier groups found. Click 'Make Option Group' to create one.</p>
        )}
      </div>


    </div>
  );
};

export { ModifierGroupEditor };
export default ModifierGroupManager; 