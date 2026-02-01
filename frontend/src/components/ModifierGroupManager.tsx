import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Loader2, X, ChevronDown, ChevronUp, Search, Copy, Square, CheckCircle } from 'lucide-react';
import DynamicModifierForm, { ModifierRowData } from './DynamicModifierForm';

import { API_URL } from '../config/constants';

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
      console.log('🔍 Editing group - Min/Max settings:', { 
        min: group.min_selections || 0, 
        max: group.max_selections || 0 
      });
    } else {
      // Reset for new group
      setName('');
      setMinSelections(0);
      setMaxSelections(0);
      setLabel('');
      console.log('🔍 Creating new group - Initial Min/Max:', { min: 0, max: 0 });
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
    
    // Min/Max value validation
    if (minSelections < 0 || maxSelections < 0) {
      alert('Min and Max values must be 0 or greater.');
      return;
    }
    
    if (minSelections > maxSelections) {
      alert('Min value cannot be greater than Max value.');
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
    
    console.log('🔍 ModifierGroupEditor - Save data:', saveData);
    
    onSave(saveData);
  };

  // Auto-calculate Required/Optional status when Min/Max changes
  const getSelectionStatus = (min: number, max: number): { type: 'OPTIONAL' | 'REQUIRED', description: string } => {
    if (min === 0 && max === 0) {
      return { type: 'OPTIONAL', description: 'No selection required' };
    } else if (min === 1 && max === 1) {
      return { type: 'REQUIRED', description: 'Must select 1' };
    } else if (min > 0 && max > 0) {
      return { type: 'REQUIRED', description: `Must select ${min}-${max}` };
    } else if (min === 0 && max > 0) {
      return { type: 'OPTIONAL', description: `Select up to ${max}` };
    } else {
      return { type: 'REQUIRED', description: `Must select ${min}-${max}` };
    }
  };

  const handleMinSelectionsChange = (value: number) => {
    setMinSelections(value);
  };

  const handleMaxSelectionsChange = (value: number) => {
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
            onChange={(e) => handleMinSelectionsChange(parseInt(e.target.value) || 0)}
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
            onChange={(e) => handleMaxSelectionsChange(parseInt(e.target.value) || 0)}
            onKeyDown={handleKeyDown}
            min="0"
            className="p-2 border rounded-md w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      
      {/* Required/Optional status display */}
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
    
    if (min_selections === 0 && max_selections === 0) {
      return (
        <div title="Optional - No selection required" className="flex items-center space-x-1">
          <Square size={16} className="text-green-500" />
          <span className="text-xs text-green-600 font-medium">Optional</span>
        </div>
      );
    } 
    else if (min_selections === 1 && max_selections === 1) {
      return (
        <div title="Required - Must select 1" className="flex items-center space-x-1">
          <CheckCircle size={16} className="text-red-500" />
          <span className="text-xs text-red-600 font-medium">Required (1)</span>
        </div>
      );
    } 
    else if (min_selections > 0 && max_selections > 0) {
      return (
        <div title={`Required - Select ${min_selections}-${max_selections}`} className="flex items-center space-x-1">
          <CheckCircle size={16} className="text-red-500" />
          <span className="text-xs text-red-600 font-medium">Required ({min_selections}-{max_selections})</span>
        </div>
      );
    } 
    else if (min_selections === 0 && max_selections > 0) {
      return (
        <div title={`Optional - Select up to ${max_selections}`} className="flex items-center space-x-1">
          <Square size={16} className="text-green-500" />
          <span className="text-xs text-green-600 font-medium">Optional (Max {max_selections})</span>
        </div>
      );
    } 
    else {
      return (
        <div title={`Required - Select ${min_selections}-${max_selections}`} className="flex items-center space-x-1">
          <CheckCircle size={16} className="text-red-500" />
          <span className="text-xs text-red-600 font-medium">Required ({min_selections}-{max_selections})</span>
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
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to ${isNew ? 'create' : 'update'} modifier group: ${errorData.error || response.statusText}`);
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

      await fetchModifierGroups();
      alert('Settings updated successfully!');
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Failed to update settings. Please try again.');
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
        {filteredGroups.map(group => (
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
                          Required (1)
                        </span>
                      );
                    } else if (min_selections > 0 && max_selections > 0) {
                      return (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          Required ({min_selections}-{max_selections})
                        </span>
                      );
                    } else if (min_selections === 0 && max_selections > 0) {
                      return (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Optional (Max {max_selections})
                        </span>
                      );
                    } else {
                      return (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          Required ({min_selections}-{max_selections})
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
                {/* Update Min/Max Settings Section */}
                <div className="mb-3 p-2 bg-gray-50 rounded border">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-xs font-medium text-gray-700">Update Min/Max Settings:</span>
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
                      title="Save Settings"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-xs text-gray-600">
                    Min: Minimum selection required, Max: Maximum selection allowed
                  </p>
                </div>
                
                {/* Header - Price_Modi1 & Price_Modi2 */}
                {group.modifiers.length > 0 && (
                  <div className="flex justify-between items-center text-xs py-1 border-b border-gray-200 mb-1">
                    <span className="text-gray-500 font-medium">Option</span>
                    <div className="flex gap-3">
                      <span className="text-gray-500 font-medium min-w-[60px] text-right">Price_Modi1</span>
                      <span className="text-green-500 font-medium min-w-[60px] text-right">Price_Modi2</span>
                    </div>
                  </div>
                )}
                {/* Modifier options */}
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
        ))}
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
