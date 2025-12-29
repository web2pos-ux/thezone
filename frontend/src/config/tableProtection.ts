// 테이블 보호 설정
export const TABLE_PROTECTION = {
  // ✅ 사용자 수정 가능 (테이블 추가/편집)
  ALLOWED_OPERATIONS: {
    createTable: true,        // 테이블 생성
    editTable: true,          // 테이블 편집 (위치, 크기, 색상, 이름)
    moveTable: true,          // 테이블 이동
    resizeTable: true,        // 테이블 크기 조절
    rotateTable: true,        // 테이블 회전
    changeTableColor: true,   // 테이블 색상 변경
    editTableText: true,      // 테이블 텍스트 편집
    changeTableStatus: true,  // 테이블 상태 변경 (Available, Occupied 등)
  },

  // ❌ 사용자 수정 불가능 (핵심 로직 보호)
  PROTECTED_OPERATIONS: {
    deleteTable: false,       // 테이블 삭제 금지
    modifyCoreLogic: false,   // 핵심 로직 수정 금지
    changeDataStructure: false, // 데이터 구조 변경 금지
    modifySyncLogic: false,   // 동기화 로직 수정 금지
  },

  // 🔒 보호된 핵심 기능들
  PROTECTED_FEATURES: [
    'tableDeletion',
    'dataSynchronization',
    'floorManagement',
    'channelManagement',
    'orderProcessing',
    'autoSaveLogic',
    'historyManagement'
  ],

  // 📝 사용자 커스터마이징 가능한 설정
  CUSTOMIZABLE_SETTINGS: [
    'tableCount',
    'tableNames',
    'tableColors',
    'tablePositions',
    'tableSizes',
    'tableRotations',
    'tableTexts',
    'tableStatuses'
  ]
};

// 보호 레벨 설정
export const PROTECTION_LEVEL = {
  LOW: 'low',           // 기본 보호
  MEDIUM: 'medium',     // 중간 보호 (현재 설정)
  HIGH: 'high',         // 높은 보호
  MAXIMUM: 'maximum'    // 최대 보호
};

// 현재 보호 레벨
export const CURRENT_PROTECTION_LEVEL = PROTECTION_LEVEL.MEDIUM;

// 보호 해제 함수 (관리자용)
export const unlockProtection = (adminKey: string) => {
  if (adminKey === process.env.ADMIN_UNLOCK_KEY) {
    return { unlocked: true, message: '보호가 해제되었습니다.' };
  }
  return { unlocked: false, message: '잘못된 관리자 키입니다.' };
}; 