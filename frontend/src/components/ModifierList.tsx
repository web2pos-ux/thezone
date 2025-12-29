import React from 'react';

interface Modifier {
  modifier_id: number;
  group_id: number;
  name: string;
  price_delta: number;
  sort_order: number;
  is_active?: boolean; // 추가
}

interface ModifierGroup {
  group_id: number;
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
}

interface ModifierListProps {
  modifierGroups: ModifierGroup[];
  modifiers: Modifier[];
  className?: string;
  editable?: boolean; // 읽기/편집 모드 구분
  onToggleActive?: (modifier: Modifier, newActive: boolean) => void; // 토글 콜백
}

const ModifierList: React.FC<ModifierListProps> = ({ modifierGroups, modifiers, className, editable = false, onToggleActive }) => {
  const getModifiersForGroup = (groupId: number) => {
    return modifiers.filter(mod => mod.group_id === groupId);
  };

  if (!modifierGroups || modifierGroups.length === 0) {
    return <div className="text-slate-500 text-sm">No modifiers found.</div>;
  }

  return (
    <div className={(className ? className + ' ' : '') + 'max-h-72 overflow-y-auto'}>
      {modifierGroups.map(group => {
        const groupModifiers = getModifiersForGroup(group.group_id);
        if (groupModifiers.length === 0) return null;
        return (
          <div key={group.group_id} className="border rounded-lg p-3 mb-3 bg-slate-50">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-sm font-medium text-slate-700">{group.name}</h4>
              <span className="text-xs text-slate-500">
                {group.selection_type} ({group.min_selection}-{group.max_selection})
              </span>
            </div>
            <div className="space-y-1">
              {groupModifiers.map(modifier => (
                <div key={modifier.modifier_id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    {editable && typeof modifier.is_active !== 'undefined' && onToggleActive ? (
                      <input
                        type="checkbox"
                        checked={modifier.is_active}
                        onChange={e => onToggleActive(modifier, e.target.checked)}
                        className="accent-blue-500"
                        aria-label={modifier.name + ' 활성/비활성'}
                      />
                    ) : null}
                    <span className={modifier.is_active === false ? 'line-through text-slate-400' : 'text-slate-600'}>{modifier.name}</span>
                  </div>
                  <span className="text-slate-500">
                    {modifier.price_delta > 0 ? `+$${modifier.price_delta.toFixed(2)}` : 
                     modifier.price_delta < 0 ? `-$${Math.abs(modifier.price_delta).toFixed(2)}` : 
                     'No charge'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export {}; 