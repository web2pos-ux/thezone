import React, { useState } from 'react';
import { Menu } from '../types';
import { ArrowLeft } from 'lucide-react';

interface MenuSidebarProps {
  menus: Menu[];
  selectedMenuId: number | null;
  onSelectMenu: (id: number) => void;
  onAddMenu: (name: string, description: string) => void;
  onBackToList?: () => void;
  editingMode?: boolean;
}

const MenuSidebar: React.FC<MenuSidebarProps> = ({
  menus,
  selectedMenuId,
  onSelectMenu,
  onAddMenu,
  onBackToList,
  editingMode = false
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuDescription, setNewMenuDescription] = useState('');

  const handleSave = () => {
    if (newMenuName.trim()) {
      onAddMenu(newMenuName.trim(), newMenuDescription.trim());
      setNewMenuName('');
      setNewMenuDescription('');
      setIsAdding(false);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setNewMenuName('');
    setNewMenuDescription('');
  };

  const selectedMenu = menus.find(menu => menu.menu_id === selectedMenuId);

  return (
    <aside className="h-full bg-white rounded-lg shadow-md flex flex-col overflow-hidden w-[320px] flex-shrink-0">
      <div className="p-4 border-b">
        {editingMode && onBackToList ? (
          <div className="flex items-center space-x-3">
            <button 
              onClick={onBackToList}
              className="p-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft size={20} className="text-slate-600" />
            </button>
            <h2 className="text-lg font-semibold text-slate-800">편집: {selectedMenu?.name}</h2>
          </div>
        ) : (
          <h2 className="text-lg font-semibold text-slate-800">Menus</h2>
        )}
      </div>
      
      {editingMode ? (
        // 편집 모드: 선택된 메뉴 정보 표시
        selectedMenu && (
          <div className="p-4 bg-blue-50 border-b">
            <h3 className="font-semibold text-blue-800">{selectedMenu.name}</h3>
            <p className="text-sm text-blue-600 mt-1">{selectedMenu.description}</p>
            <p className="text-xs text-blue-500 mt-2">
              생성일: {new Date(selectedMenu.created_at).toLocaleDateString()}
            </p>
          </div>
        )
      ) : (
        // 일반 모드: 새 메뉴 추가 버튼
        <div className="p-4 bg-slate-50 shrink-0 border-b">
          {isAdding ? (
            <div className="space-y-2">
              <input
                type="text"
                value={newMenuName}
                onChange={(e) => setNewMenuName(e.target.value)}
                placeholder="새 메뉴 이름 (예: Summer 2024)"
                className="w-full px-3 py-2 border rounded-md"
                autoFocus
              />
              <textarea
                value={newMenuDescription}
                onChange={(e) => setNewMenuDescription(e.target.value)}
                placeholder="설명 (선택사항)"
                className="w-full px-3 py-2 border rounded-md"
                rows={2}
              />
              <div className="flex justify-end space-x-2">
                <button onClick={handleCancel} className="px-3 py-1 text-slate-600 bg-slate-200 rounded-md hover:bg-slate-300">
                  취소
                </button>
                <button onClick={handleSave} className="px-3 py-1 text-white bg-blue-500 rounded-md hover:bg-blue-600">
                  저장
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setIsAdding(true)} 
              className="w-full px-3 py-2 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
            >
              + 새 Menu 만들기
            </button>
          )}
        </div>
      )}

      {!editingMode && (
        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {menus.map(menu => (
            <div
              key={menu.menu_id}
                              onClick={() => onSelectMenu(menu.menu_id)}
              className="p-3 rounded-md cursor-pointer mb-2 transition-colors hover:bg-slate-100 border border-slate-200"
            >
              <h3 className="font-semibold">{menu.name}</h3>
              <p className="text-sm text-slate-500">{menu.description}</p>
              <p className="text-xs text-slate-400 mt-1">
                {new Date(menu.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};

export default MenuSidebar; 