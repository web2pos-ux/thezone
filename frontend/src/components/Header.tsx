import React, { useState, useRef } from 'react';
import { ArrowLeft, Edit2, Check, X } from 'lucide-react';

interface HeaderProps {
  title?: string;
  leftAction?: {
    text: string;
    onClick: () => void;
  };
  rightAction?: {
    text: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  onTitleChange?: (newTitle: string) => void;
  isTitleEditable?: boolean;
  excelAction?: {
    onExport: () => void;
    onImport: (file: File) => void;
    isProcessing?: boolean;
  };
}

const Header: React.FC<HeaderProps> = ({ title, leftAction, rightAction, onTitleChange, isTitleEditable = false, excelAction }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = () => {
    if (!isTitleEditable || !onTitleChange) return;
    setIsEditing(true);
    setEditedTitle(title || '');
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 100);
  };

  const handleSave = () => {
    if (editedTitle.trim() && onTitleChange) {
      onTitleChange(editedTitle.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedTitle(title || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <header className="bg-white shadow-md h-16 grid grid-cols-3 items-center px-6 z-10">
      <div className="flex justify-start">
        {leftAction && (
          <button
            onClick={leftAction.onClick}
            className="flex items-center gap-2 px-4 py-2 bg-brand-orange hover:opacity-90 rounded-lg transition-opacity text-white font-semibold"
            title={leftAction.text}
          >
            <ArrowLeft size={20} />
            <span>{leftAction.text}</span>
          </button>
        )}
      </div>
      
      <div className="text-center flex items-center justify-center gap-2">
        {isEditing ? (
          <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-lg px-3 py-1 shadow-lg">
            <span className="text-sm text-blue-600 font-medium">편집 중:</span>
            <input
              ref={inputRef}
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-xl font-semibold text-gray-800 bg-transparent border-none outline-none focus:ring-0 min-w-[200px]"
              placeholder="메뉴 이름 입력"
            />
            <button
              onClick={handleSave}
              className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors"
              title="저장 (Enter)"
            >
              <Check size={16} />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
              title="취소 (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 
              className={`text-xl font-semibold text-gray-800 ${isTitleEditable && onTitleChange ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}
              onClick={isTitleEditable && onTitleChange ? handleStartEdit : undefined}
              title={isTitleEditable && onTitleChange ? '클릭하여 메뉴 이름 수정' : undefined}
            >
              {title}
            </h1>
            {isTitleEditable && onTitleChange && (
              <button
                onClick={handleStartEdit}
                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors group"
                title="메뉴 이름 수정 (클릭)"
              >
                <Edit2 size={16} className="group-hover:scale-110 transition-transform" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end items-center gap-2">
        {/* Excel Export/Import 버튼들 */}
        {excelAction && (
          <div className="flex gap-1">
            <button
              onClick={() => {
                excelAction.onImport(null as any);
              }}
              disabled={excelAction.isProcessing}
              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
              title="Import from Excel"
            >
              {excelAction.isProcessing ? (
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              ) : (
                <img src="/images/upload.svg" alt="Import" className="w-7 h-7 stroke-2 hover:scale-125 transition-transform duration-200" />
              )}
            </button>
            <button
              onClick={excelAction.onExport}
              disabled={excelAction.isProcessing}
              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
              title="Export to Excel"
            >
              {excelAction.isProcessing ? (
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
              ) : (
                <img src="/images/download.svg" alt="Export" className="w-7 h-7 stroke-2 hover:scale-125 transition-transform duration-300 ease-in-out" />
              )}
            </button>
          </div>
        )}
        
        {rightAction ? (
          <button
            onClick={rightAction.onClick}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors text-white font-semibold"
            title={rightAction.text}
          >
            {rightAction.icon}
            <span>{rightAction.text}</span>
          </button>
        ) : (
          <div className="text-right">
            <p className="text-sm text-gray-600">User: Admin</p>
            <p className="text-xs text-green-500 font-semibold">Online</p>
          </div>
        )}
      </div>


    </header>
  );
};

export default Header; 