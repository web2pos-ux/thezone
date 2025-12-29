import React, { useState, useEffect } from 'react';
import { TABLE_PROTECTION, PROTECTION_LEVEL, unlockProtection } from '../config/tableProtection';

interface ProtectedTableManagerProps {
  children: React.ReactNode;
  onProtectionChange?: (level: string) => void;
}

const ProtectedTableManager: React.FC<ProtectedTableManagerProps> = ({ 
  children, 
  onProtectionChange 
}) => {
  const [currentProtection, setCurrentProtection] = useState(PROTECTION_LEVEL.MEDIUM);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [showUnlockForm, setShowUnlockForm] = useState(false);

  // 보호 레벨 변경
  const changeProtectionLevel = (level: string) => {
    if (isUnlocked) {
      setCurrentProtection(level);
      onProtectionChange?.(level);
    }
  };

  // 관리자 잠금 해제
  const handleUnlock = () => {
    const result = unlockProtection(adminKey);
    if (result.unlocked) {
      setIsUnlocked(true);
      setShowUnlockForm(false);
      alert('보호가 해제되었습니다. 모든 기능을 수정할 수 있습니다.');
    } else {
      alert(result.message);
    }
  };

  // 보호 상태 확인
  const checkOperationAllowed = (operation: string): boolean => {
    if (isUnlocked) return true;
    
    if (operation === 'deleteTable') {
      return TABLE_PROTECTION.PROTECTED_OPERATIONS.deleteTable;
    }
    
    return TABLE_PROTECTION.ALLOWED_OPERATIONS[operation as keyof typeof TABLE_PROTECTION.ALLOWED_OPERATIONS] || false;
  };

  // 보호 경고 표시
  const showProtectionWarning = (operation: string) => {
    if (!checkOperationAllowed(operation)) {
      alert(`⚠️ 보호된 기능입니다: ${operation}\n\n이 기능을 수정하려면 관리자 권한이 필요합니다.`);
      return false;
    }
    return true;
  };

  return (
    <div className="protected-table-manager">
      {/* 보호 상태 표시 */}
      <div className="protection-status-bar bg-yellow-100 border-b border-yellow-300 p-2 text-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="font-semibold">🔒 보호 상태:</span>
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              currentProtection === PROTECTION_LEVEL.LOW ? 'bg-green-200 text-green-800' :
              currentProtection === PROTECTION_LEVEL.MEDIUM ? 'bg-yellow-200 text-yellow-800' :
              currentProtection === PROTECTION_LEVEL.HIGH ? 'bg-orange-200 text-orange-800' :
              'bg-red-200 text-red-800'
            }`}>
              {currentProtection === PROTECTION_LEVEL.LOW ? '낮음' :
               currentProtection === PROTECTION_LEVEL.MEDIUM ? '중간' :
               currentProtection === PROTECTION_LEVEL.HIGH ? '높음' :
               '최대'}
            </span>
            {isUnlocked && <span className="text-green-600 font-medium">🔓 잠금 해제됨</span>}
          </div>
          
          <button
            onClick={() => setShowUnlockForm(!showUnlockForm)}
            className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
          >
            {isUnlocked ? '보호 설정' : '관리자 잠금 해제'}
          </button>
        </div>
      </div>

      {/* 관리자 잠금 해제 폼 */}
      {showUnlockForm && (
        <div className="admin-unlock-form bg-gray-50 border border-gray-200 p-4 m-2 rounded">
          <h3 className="font-semibold mb-2">🔑 관리자 권한으로 잠금 해제</h3>
          <div className="flex space-x-2">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="관리자 키를 입력하세요"
              className="flex-1 px-3 py-2 border border-gray-300 rounded"
            />
            <button
              onClick={handleUnlock}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              잠금 해제
            </button>
            <button
              onClick={() => setShowUnlockForm(false)}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 보호 레벨 선택 (관리자만) */}
      {isUnlocked && (
        <div className="protection-level-selector bg-blue-50 border border-blue-200 p-3 m-2 rounded">
          <h3 className="font-semibold mb-2">⚙️ 보호 레벨 설정</h3>
          <div className="flex space-x-2">
            {Object.values(PROTECTION_LEVEL).map((level) => (
              <button
                key={level}
                onClick={() => changeProtectionLevel(level)}
                className={`px-3 py-1 rounded text-xs font-medium ${
                  currentProtection === level 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-white text-blue-600 border border-blue-300 hover:bg-blue-50'
                }`}
              >
                {level === PROTECTION_LEVEL.LOW ? '낮음' :
                 level === PROTECTION_LEVEL.MEDIUM ? '중간' :
                 level === PROTECTION_LEVEL.HIGH ? '높음' :
                 '최대'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 보호된 컨텐츠 */}
      <div className="protected-content">
        {children}
      </div>

      {/* 보호 정보 표시 */}
      <div className="protection-info bg-gray-50 border-t border-gray-200 p-3 text-xs text-gray-600">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="font-semibold mb-1">✅ 허용된 작업:</h4>
            <ul className="space-y-1">
              {Object.entries(TABLE_PROTECTION.ALLOWED_OPERATIONS)
                .filter(([_, allowed]) => allowed)
                .map(([operation, _]) => (
                  <li key={operation}>• {operation}</li>
                ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1">❌ 보호된 작업:</h4>
            <ul className="space-y-1">
              {Object.entries(TABLE_PROTECTION.PROTECTED_OPERATIONS)
                .filter(([_, isProtected]) => !isProtected)
                .map(([operation, _]) => (
                  <li key={operation}>• {operation}</li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProtectedTableManager; 