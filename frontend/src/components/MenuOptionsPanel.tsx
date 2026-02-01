import React, { useState, useEffect, useMemo } from 'react';
import ModifierGroupManager from './ModifierGroupManager';


interface MenuData {
  name: string;
  description?: string | null;
  channel_type?: string | null;
  menu_id?: number;
}

interface ModifierGroup {
  group_id: number;
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
}

interface Modifier {
  modifier_id: number;
  group_id: number;
  name: string;
  price_delta: number;
  sort_order: number;
}

interface ModifierMenuLink {
  link_id: number;
  item_id: number;
  modifier_group_id: number;
  is_active: number;
  sort_order: number;
}

interface MenuOptionsPanelProps {
  menu: MenuData | null;
  onSaveModifierOverride?: (itemId: number, modifierGroupId: number, isActive: boolean) => Promise<void>;
}

import { API_URL } from '../config/constants';

const MenuOptionsPanel: React.FC<MenuOptionsPanelProps> = ({
  menu,
  onSaveModifierOverride,
}) => {
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [modifierLinks, setModifierLinks] = useState<ModifierMenuLink[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. 데이터 fetch
  useEffect(() => {
    if (menu?.menu_id) {
      fetchModifiers();
    }
  }, [menu?.menu_id]);

  const fetchModifiers = async () => {
    if (!menu?.menu_id) return;
    setLoading(true);
    try {
      const groupsResponse = await fetch(`${API_URL}/modifiers/groups`);
      const groupsData = await groupsResponse.json();
      setModifierGroups(groupsData);

      const modifiersResponse = await fetch(`${API_URL}/modifiers`);
      const modifiersData = await modifiersResponse.json();
      setModifiers(modifiersData);

      const linksResponse = await fetch(`${API_URL}/menu/modifier-links?menu_id=${menu.menu_id}`);
      const linksData = await linksResponse.json();
      setModifierLinks(linksData);
    } catch (error) {
      console.error('Failed to fetch modifiers:', error);
    } finally {
      setLoading(false);
    }
  };

  // 2. 병합된 modifier 데이터 생성
  const mergedModifierData = useMemo(() => {
    if (!menu) return [];
    return modifierLinks.map(link => {
      const group = modifierGroups.find(g => g.group_id === link.modifier_group_id);
      const groupModifiers = modifiers.filter(m => m.group_id === group?.group_id);

      return {
        ...link,
        group,
        modifiers: groupModifiers,
        isActive: link.is_active,
      };
    });
  }, [modifierLinks, modifierGroups, modifiers, menu]);

  // 3. UI 렌더링
  if (!menu) {
    return (
      <div className="bg-white rounded-lg shadow-md h-full flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold text-slate-800">Menu Options</h2>
        </div>
        <div className="p-4">
          <p className="text-slate-500">Loading menu data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md h-full flex flex-col">
      <div className="flex justify-between items-center p-4 border-b">
        <h2 className="text-lg font-semibold text-slate-800">Modifiers (병합 상태)</h2>
      </div>
      <div className="p-4 space-y-4">
        {/* Menu Information */}
        <div className="space-y-2">
          <h3 className="text-md font-medium text-slate-700">Menu Information</h3>
          <div className="text-sm text-slate-600">
            <p><strong>Name:</strong> {menu.name}</p>
            {menu.description && <p><strong>Description:</strong> {menu.description}</p>}
            {menu.channel_type && <p><strong>Channel:</strong> {menu.channel_type}</p>}
          </div>
        </div>

        {/* Modifiers Section */}
        <div className="space-y-2">
          <h3 className="text-md font-medium text-slate-700">Modifiers</h3>
          <ModifierGroupManager menuId={menu.menu_id} />
          {loading ? (
            <p className="text-sm text-slate-500">Loading modifiers...</p>
          ) : mergedModifierData.length === 0 ? (
            <p className="text-sm text-slate-500">No modifiers found for this menu.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-3">
              {mergedModifierData.map(link => (
                <div
                  key={link.link_id}
                  className="border rounded-lg p-3 bg-slate-50"
                >
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium">
                      {link.group?.name}
                    </h4>
                  </div>
                  <div className="space-y-1">
                    {link.modifiers.map(modifier => (
                      <div key={modifier.modifier_id} className="flex justify-between items-center text-xs">
                        <span
                          className={
                            link.isActive
                              ? 'text-slate-700'
                              : 'line-through text-slate-400'
                          }
                        >
                          {modifier.name}
                        </span>
                        <span className="text-slate-500">
                          {modifier.price_delta > 0
                            ? `+${modifier.price_delta}`
                            : modifier.price_delta < 0
                            ? `-${Math.abs(modifier.price_delta)}`
                            : 'No charge'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MenuOptionsPanel;