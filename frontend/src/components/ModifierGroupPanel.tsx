import React, { useState, useEffect } from 'react';
import { Copy } from 'lucide-react';

const API_URL = 'http://localhost:3177/api';

interface ModifierGroup {
  modifier_group_id: number;
  name: string;
  selection_type: string;
  min_selection?: number;
  max_selection?: number;
}

interface ModifierGroupPanelProps {
  menuId: string;
}

const ModifierGroupPanel: React.FC<ModifierGroupPanelProps> = ({ menuId }) => {
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [groupToCopy, setGroupToCopy] = useState<ModifierGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!menuId) return;

    const fetchModifierGroups = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_URL}/modifiers/groups?menu_id=${menuId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch modifier groups');
        }
        const data = await response.json();
        setModifierGroups(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchModifierGroups();
  }, [menuId]);

  const handleCopyClick = (group: ModifierGroup) => {
    setGroupToCopy(group);
    setNewGroupName(`${group.name} Copy`);
    setShowCopyModal(true);
  };

  const handleCopyConfirm = async () => {
    if (!groupToCopy || !newGroupName.trim()) return;

    setCopying(true);
    try {
      const response = await fetch(`${API_URL}/modifier-groups/${groupToCopy.modifier_group_id}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newGroupName.trim().toUpperCase(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to copy modifier group');
      }

      const copiedGroup = await response.json();
      
      // Add the copied group to the list
      const newModifierGroup: ModifierGroup = {
        modifier_group_id: copiedGroup.id,
        name: copiedGroup.name,
        selection_type: copiedGroup.selection_type,
        min_selection: copiedGroup.min_selections,
        max_selection: copiedGroup.max_selections,
      };
      
      setModifierGroups(prev => [...prev, newModifierGroup]);
      setShowCopyModal(false);
      setGroupToCopy(null);
      setNewGroupName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy group');
    } finally {
      setCopying(false);
    }
  };

  const handleCopyCancel = () => {
    setShowCopyModal(false);
    setGroupToCopy(null);
    setNewGroupName('');
  };

  if (loading) {
    return <div>Loading modifiers...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  return (
    <div>
      <h3 className="text-md font-semibold text-slate-700 mb-3">Modifier Groups</h3>
      {modifierGroups.length > 0 ? (
        <ul className="space-y-0.5 pr-2">
          {modifierGroups.map((group) => (
            <li key={group.modifier_group_id} className="p-2.5 border rounded-md bg-slate-50 flex justify-between items-center">
              <span>{group.name} ({group.selection_type})</span>
              <button
                onClick={() => handleCopyClick(group)}
                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                title="Copy modifier group"
              >
                <Copy size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">No modifier groups found for this menu.</p>
      )}

      {/* Copy Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-[90vw]">
            <h3 className="text-lg font-semibold mb-4">Copy Modifier Group</h3>
            <p className="text-gray-600 mb-4">
              Creating a copy of "{groupToCopy?.name}"
            </p>
            <div className="mb-4">
              <label htmlFor="newGroupName" className="block text-sm font-medium text-gray-700 mb-2">
                New Group Name:
              </label>
              <input
                type="text"
                id="newGroupName"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter new group name"
                disabled={copying}
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleCopyCancel}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                disabled={copying}
              >
                Cancel
              </button>
              <button
                onClick={handleCopyConfirm}
                disabled={!newGroupName.trim() || copying}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {copying ? 'Copying...' : 'Copy Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModifierGroupPanel; 