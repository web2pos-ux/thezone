import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import DynamicInputForm, { RowData } from './DynamicInputForm';
import { API_URL } from '../config/constants';

interface Tax {
  tax_id: number;
  name: string;
  rate: number;
}

interface TaxGroup {
  id: number;
  name: string;
  taxes: Tax[];
}

const TaxGroupEditor: React.FC<{
  group?: TaxGroup | null;
  onSave: (group: { name: string, taxes: Omit<RowData, 'id'>[] }) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}> = ({ group, onSave, onCancel, isSaving }) => {
  const [name, setName] = useState(group?.name || '');
  const nameInputRef = useRef<HTMLInputElement>(null);
  
  // Function to capitalize first letter of each word
  const capitalizeInput = (value: string): string => {
    return value.replace(/\b[a-z]/g, char => char.toUpperCase());
  };
  
  // Auto-focus on Group Name input when creating new group
  useEffect(() => {
    if (!group && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [group]);
  
  const handleSave = (taxes: Omit<RowData, 'id'>[]) => {
    if (!name.trim()) {
      alert('Group name is required.');
      return;
    }
    onSave({ name: name.trim(), taxes });
  };

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm mt-4">
      <h3 className="text-lg font-semibold mb-3">{group ? 'Edit' : 'Create New'} Tax Group</h3>
      <div className="mb-4">
        <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
        <input
          ref={nameInputRef}
          id="group-name"
          type="text"
          value={name}
          onChange={(e) => setName(capitalizeInput(e.target.value))}
          placeholder="e.g., GST + PST Liquor"
          className="p-2 border rounded-md w-full"
        />
      </div>
      <DynamicInputForm
        initialData={group?.taxes || []}
        onSave={handleSave}
        isLoading={isSaving}
        onCancel={onCancel}
        minRows={2}
      />
    </div>
  );
};


const TaxGroupManager: React.FC<{ menuId?: number }> = ({ menuId }) => {
  const [taxGroups, setTaxGroups] = useState<TaxGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaxGroup | null | 'new'>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const fetchTaxGroups = async () => {
    setIsLoading(true);
    try {
      const url = menuId ? `${API_URL}/tax-groups?menu_id=${menuId}` : `${API_URL}/tax-groups`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch tax groups');
      const data = await response.json();
      setTaxGroups(data);
    } catch (error) {
      console.error(error);
      alert(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTaxGroups();
  }, [menuId]); // Add menuId to dependency array

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

  const handleSave = async (groupData: { name: string, taxes: Omit<RowData, 'id'>[] }) => {
    setIsSaving(true);
    const isNew = editingGroup === 'new';
    const url = isNew ? `${API_URL}/tax-groups` : `${API_URL}/tax-groups/${(editingGroup as TaxGroup).id}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
      const requestBody = menuId ? { ...groupData, menu_id: menuId } : groupData;
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) throw new Error(`Failed to ${isNew ? 'create' : 'update'} tax group`);
      
      await fetchTaxGroups(); // Refresh list
      setEditingGroup(null);
    } catch (error) {
      console.error(error);
      alert(String(error));
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleDelete = async (groupId: number) => {
    if (!window.confirm('Are you sure you want to delete this tax group?')) return;
    
    try {
      const response = await fetch(`${API_URL}/tax-groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete tax group');
      await fetchTaxGroups(); // Refresh list
    } catch (error) {
      console.error(error);
      alert(String(error));
    }
  };

  if (isLoading) return <p>Loading tax groups...</p>;

  if (editingGroup) {
    return (
      <TaxGroupEditor
        group={editingGroup === 'new' ? null : editingGroup}
        onSave={handleSave}
        onCancel={() => setEditingGroup(null)}
        isSaving={isSaving}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-end items-center mb-4">
        <button
          onClick={() => setEditingGroup('new')}
          className="w-48 px-3 py-2 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
        >
          + New Tax Group
        </button>
      </div>

      <div className="space-y-0.5 pr-2">
        {taxGroups.map(group => (
          <div key={group.id} className="group p-1 border border-gray-400 rounded-md bg-gray-50">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-semibold text-slate-800">{group.name}</h2>
                <button onClick={() => toggleGroup(group.id)} className="p-2 hover:bg-gray-200 rounded-full">
                  {expandedGroups.has(group.id) ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
              <div className="flex items-center space-x-0">
                <span className="text-base font-semibold text-slate-800">
                  {group.taxes.reduce((sum, tax) => sum + tax.rate, 0).toFixed(2)}%
                </span>
                <button onClick={() => setEditingGroup(group)} className="p-1 hover:bg-gray-200 rounded-full invisible group-hover:visible"><Edit size={18} /></button>
                <button onClick={() => handleDelete(group.id)} className="p-1 text-red-500 hover:bg-red-100 rounded-full invisible group-hover:visible"><Trash2 size={18} /></button>
              </div>
            </div>
            {expandedGroups.has(group.id) && (
              <div className="mt-0 space-y-0 pl-4 pr-24 py-0">
                {group.taxes.map(tax => (
                  <div key={tax.tax_id} className="flex justify-between items-center text-xs py-0">
                    <span className="text-gray-600">{tax.name}</span>
                    <span className="font-semibold text-slate-800">{tax.rate}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {taxGroups.length === 0 && (
          <p className="text-gray-500 text-center py-8">No tax groups found. Click 'New Tax Group' to create one.</p>
        )}
      </div>
    </div>
  );
};

export { TaxGroupEditor };
export default TaxGroupManager;
