import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit, Trash2, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import DynamicPrinterForm, { PrinterRowData } from './DynamicPrinterForm';

const API_URL = 'http://localhost:3177/api';

interface Printer {
  printer_id: number;
  name: string;
  type: string;
  ip_address?: string;
}

interface PrinterGroup {
  id: number;
  name: string;
  printers: Printer[];
}

const PrinterGroupEditor: React.FC<{
  group?: PrinterGroup | null;
  onSave: (group: { name: string, type: string, printers: Omit<PrinterRowData, 'id'>[] }) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}> = ({ group, onSave, onCancel, isSaving }) => {
  const [name, setName] = useState(group?.name || '');
  const [type, setType] = useState('ORDER');
  const nameInputRef = useRef<HTMLInputElement>(null);
  
  // Auto-focus on Group Name input when creating new group
  useEffect(() => {
    if (!group && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [group]);
  
  // Auto-capitalize first letter and after spaces
  const capitalizeInput = (value: string): string => {
    return value.replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const capitalizedValue = capitalizeInput(e.target.value);
    setName(capitalizedValue);
  };
  
  const handleSave = (printers: Omit<PrinterRowData, 'id'>[]) => {
    if (!name.trim()) {
      alert('Group name is required.');
      return;
    }
    onSave({ name: name.trim(), type, printers });
  };

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm mt-4">
      <h3 className="text-lg font-semibold mb-3">{group ? 'Edit' : 'Create New'} Printer Group</h3>
      <div className="mb-4 flex gap-2 items-end">
        <div className="flex-1">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
              <input
                ref={nameInputRef}
                id="group-name"
                type="text"
                value={name}
                onChange={handleNameChange}
                placeholder="e.g., Order Printers"
                className="p-2 border rounded-md w-full"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="group-type" className="block text-sm font-medium text-gray-700 mb-1">Printer Type</label>
              <select
                id="group-type"
                value={type}
                onChange={e => setType(e.target.value)}
                className="p-2 border rounded-md min-w-[120px]"
              >
                <option value="ORDER">ORDER</option>
                <option value="RECEIPT">RECEIPT</option>
                <option value="KDS">KDS</option>
                <option value="LABEL">LABEL</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <DynamicPrinterForm
        initialData={group?.printers || []}
        onSave={handleSave}
        isLoading={isSaving}
        onCancel={onCancel}
      />
    </div>
  );
};


const PrinterGroupManager: React.FC<{ menuId?: number }> = ({ menuId }) => {
  const [printerGroups, setPrinterGroups] = useState<PrinterGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PrinterGroup | null | 'new'>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const fetchPrinterGroups = async () => {
    setIsLoading(true);
    try {
      const url = menuId ? `${API_URL}/printers/groups?menu_id=${menuId}` : `${API_URL}/printers/groups`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch printer groups');
      const groupsData = await response.json();
      setPrinterGroups(groupsData);
    } catch (error) {
      console.error(error);
      alert(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPrinterGroups();
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

  const handleSave = async (groupData: { name: string, type: string, printers: Omit<PrinterRowData, 'id'>[] }) => {
    setIsSaving(true);
    const isNew = editingGroup === 'new';
    const url = isNew ? `${API_URL}/printers/groups` : `${API_URL}/printers/groups/${(editingGroup as PrinterGroup).id}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
      // 각 프린터에 그룹 type을 포함시켜 전송
      const printersWithType = groupData.printers.map(printer => ({ ...printer, type: groupData.type }));
      const requestBody = menuId ? { ...groupData, printers: printersWithType, menu_id: menuId } : { ...groupData, printers: printersWithType };
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) throw new Error(`Failed to ${isNew ? 'create' : 'update'} printer group`);
      
      await fetchPrinterGroups(); // Refresh list
      setEditingGroup(null);
    } catch (error) {
      console.error(error);
      alert(String(error));
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleDelete = async (groupId: number) => {
    try {
      const response = await fetch(`${API_URL}/printers/groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete printer group');
      await fetchPrinterGroups(); // Refresh list
    } catch (error) {
      console.error(error);
      alert(String(error));
    }
  };

  if (isLoading) return <p>Loading printer groups...</p>;

  if (editingGroup) {
    return (
      <PrinterGroupEditor
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
          + Add Printer Group
        </button>
      </div>

      <div className="space-y-0.5 pr-2">
        {printerGroups.map(group => (
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
                  {group.printers.length} printer{group.printers.length !== 1 ? 's' : ''}
                </span>
                <button onClick={() => setEditingGroup(group)} className="p-1 hover:bg-gray-200 rounded-full invisible group-hover:visible"><Edit size={18} /></button>
                <button onClick={() => handleDelete(group.id)} className="p-1 text-red-500 hover:bg-red-100 rounded-full invisible group-hover:visible"><Trash2 size={18} /></button>
              </div>
            </div>
            {expandedGroups.has(group.id) && (
              <div className="mt-0 space-y-0 pl-4 pr-24 py-0">
                {group.printers.map(printer => (
                  <div key={printer.printer_id} className="flex justify-between items-center text-xs py-0">
                    <div className="flex flex-col">
                      <span className="text-gray-600">{printer.name}</span>
                    </div>
                    <div className="flex flex-col items-end min-w-[80px]">
                      <span>[{printer.type}]</span>
                      {printer.ip_address && (
                        <span className="text-gray-500 text-xs">{printer.ip_address}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {printerGroups.length === 0 && (
          <p className="text-gray-500 text-center py-8">No printer groups found. Click 'Add New Group' to create one.</p>
        )}
      </div>
    </div>
  );
};

export { PrinterGroupEditor };
export default PrinterGroupManager; 