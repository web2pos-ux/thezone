/**
 * POS SQLite vs Firebase 전체 스키마 비교 분석
 * 
 * 분석 대상:
 * 1. menu_items
 * 2. menu_categories  
 * 3. modifier_groups
 * 4. modifiers
 * 5. tax_groups
 * 6. printer_groups
 */

console.log('='.repeat(100));
console.log('🔍 POS ↔ Firebase 스키마 비교 분석 보고서');
console.log('='.repeat(100));

// ============================================
// 1. MENU ITEMS
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📦 1. MENU ITEMS 비교');
console.log('═'.repeat(100));

const menuItemsComparison = {
  sqliteColumns: [
    'item_id (INTEGER) - PK',
    'name (TEXT)',
    'description (TEXT)', 
    'price (REAL)',        // ⚠️ SQLite: price
    'price2 (REAL)',
    'category_id (INTEGER)',
    'sort_order (INTEGER)',
    'short_name (TEXT)',
    'menu_id (INTEGER)',
    'image_url (TEXT)',
    'is_open_price (INTEGER)',
    'firebase_id (TEXT)'
  ],
  firebaseFields: [
    'posId (number) - POS item_id 매핑',
    'name (string)',
    'description (string)',
    'price1 (number)',     // ⚠️ Firebase: price1 (불일치!)
    'price2 (number)',
    'categoryId (string) - Firebase category doc ID',
    'sortOrder (number)',
    'shortName (string)',
    'restaurantId (string)',
    'imageUrl (string)',
    'isAvailable (boolean)',
    'modifierGroupIds (string[])',
    'taxGroupIds (string[])',
    'printerGroupIds (string[])',
    'options (array)',
    'createdAt (timestamp)',
    'updatedAt (timestamp)'
  ],
  tzoTypeFields: [
    'id (string | number)',
    'name (string)',
    'description (string)',
    'price (number)',      // ⚠️ TZO 타입: price (불일치!)
    'price2 (number)',
    'categoryId (string)',
    'category_id (number | string)',
    'sortOrder (number)',
    'sort_order (number)',
    'shortName (string)',
    'short_name (string)',
    'imageUrl (string)',
    'image_url (string)',
    'isAvailable (boolean)',
    'isPopular (boolean)',
    'options (MenuOption[])',
    'modifierGroupIds (string[])',
    'taxGroupIds (string[])',
    'printerGroupIds (string[])'
  ]
};

console.log('\n📋 SQLite 컬럼:');
menuItemsComparison.sqliteColumns.forEach(c => console.log('  ' + c));

console.log('\n🔥 Firebase 필드:');
menuItemsComparison.firebaseFields.forEach(c => console.log('  ' + c));

console.log('\n📝 TZO 타입 정의:');
menuItemsComparison.tzoTypeFields.forEach(c => console.log('  ' + c));

console.log('\n' + '─'.repeat(100));
console.log('⚠️  불일치 발견:');
console.log('─'.repeat(100));
console.log('  🔴 CRITICAL: Firebase에 "price1"으로 저장 → TZO OrderPage에서 "price"로 읽음');
console.log('     → 온라인 주문 페이지에서 가격이 undefined 또는 0으로 표시될 수 있음!');
console.log('  🟡 WARNING: Firebase "isAvailable" vs SQLite 해당 컬럼 없음 (is_active 사용?)');

// ============================================
// 2. MENU CATEGORIES
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📦 2. MENU CATEGORIES 비교');
console.log('═'.repeat(100));

const categoriesComparison = {
  sqliteColumns: [
    'category_id (INTEGER) - PK',
    'name (TEXT)',
    'sort_order (INTEGER)',
    'menu_id (INTEGER)',
    'image_url (TEXT)',
    'firebase_id (TEXT)'
  ],
  firebaseFields: [
    'posId (number) - POS category_id 매핑',
    'name (string)',
    'sortOrder (number)',
    'restaurantId (string)',
    'imageUrl (string)',
    'isActive (boolean)',
    'createdAt (timestamp)',
    'updatedAt (timestamp)'
  ],
  tzoTypeFields: [
    'id (string)',
    'category_id (number)',
    'name (string)',
    'sortOrder (number)',
    'sort_order (number)',
    'restaurantId (string)',
    'menu_id (number)',
    'imageUrl (string)',
    'image_url (string)',
    'is_active (number)',
    'isActive (boolean)'
  ]
};

console.log('\n📋 SQLite 컬럼:');
categoriesComparison.sqliteColumns.forEach(c => console.log('  ' + c));

console.log('\n🔥 Firebase 필드:');
categoriesComparison.firebaseFields.forEach(c => console.log('  ' + c));

console.log('\n📝 TZO 타입 정의:');
categoriesComparison.tzoTypeFields.forEach(c => console.log('  ' + c));

console.log('\n' + '─'.repeat(100));
console.log('✅ 상태: 양호 (호환 필드 사용)');
console.log('─'.repeat(100));

// ============================================
// 3. MODIFIER GROUPS
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📦 3. MODIFIER GROUPS 비교');
console.log('═'.repeat(100));

const modifierGroupsComparison = {
  sqliteColumns: [
    'group_id (INTEGER) - PK',
    'name (TEXT)',
    'selection_type (TEXT) - SINGLE/MULTIPLE',
    'min_selection (INTEGER)',
    'max_selection (INTEGER)',
    'menu_id (INTEGER)',
    'is_deleted (INTEGER)',
    'firebase_id (TEXT)'
  ],
  firebaseFields: [
    'posGroupId (number) - POS group_id 매핑',
    'name (string)',
    'selectionType (string)',    // ⚠️ camelCase
    'minSelection (number)',     // ⚠️ camelCase  
    'maxSelection (number)',     // ⚠️ camelCase
    'restaurantId (string)',
    'modifiers (array)',         // ⚠️ 모디파이어가 그룹 안에 포함됨
    'createdAt (timestamp)',
    'updatedAt (timestamp)'
  ],
  tzoTypeFields: [
    'id (string)',
    'restaurantId (string)',
    'name (string)',
    'label (string)',
    'min_selection (number)',    // ⚠️ snake_case
    'max_selection (number)',    // ⚠️ snake_case
    'modifiers (ModifierItem[])',
    'posGroupId (number)'
  ]
};

console.log('\n📋 SQLite 컬럼:');
modifierGroupsComparison.sqliteColumns.forEach(c => console.log('  ' + c));

console.log('\n🔥 Firebase 필드:');
modifierGroupsComparison.firebaseFields.forEach(c => console.log('  ' + c));

console.log('\n📝 TZO 타입 정의:');
modifierGroupsComparison.tzoTypeFields.forEach(c => console.log('  ' + c));

console.log('\n' + '─'.repeat(100));
console.log('⚠️  불일치 발견:');
console.log('─'.repeat(100));
console.log('  🟡 WARNING: Firebase "minSelection/maxSelection" vs TZO "min_selection/max_selection"');
console.log('  🟡 WARNING: SQLite는 modifiers가 별도 테이블, Firebase는 그룹 안에 배열로 포함');

// ============================================
// 4. MODIFIERS (개별 옵션)
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📦 4. MODIFIERS 비교');
console.log('═'.repeat(100));

const modifiersComparison = {
  sqliteColumns: [
    'modifier_id (INTEGER) - PK',
    'name (TEXT)',
    'price_delta (REAL)',        // ⚠️ price_delta
    'price_delta2 (REAL)',
    'type (TEXT)',
    'is_deleted (INTEGER)',
    'sort_order (INTEGER)'
  ],
  firebaseFields: [
    '- Firebase에서는 modifierGroups 내 modifiers 배열에 포함',
    'id (string)',
    'name (string)',
    'priceAdjustment (number)',  // ⚠️ priceAdjustment
    'priceAdjustment2 (number)',
    'isDefault (boolean)',
    'sortOrder (number)'
  ],
  tzoTypeFields: [
    'id (string)',
    'name (string)',
    'price_adjustment (number)', // ⚠️ price_adjustment (snake_case)
    'price_adjustment_2 (number)',
    'is_default (boolean)',
    'sort_order (number)'
  ]
};

console.log('\n📋 SQLite 컬럼:');
modifiersComparison.sqliteColumns.forEach(c => console.log('  ' + c));

console.log('\n🔥 Firebase 필드:');
modifiersComparison.firebaseFields.forEach(c => console.log('  ' + c));

console.log('\n📝 TZO 타입 정의:');
modifiersComparison.tzoTypeFields.forEach(c => console.log('  ' + c));

console.log('\n' + '─'.repeat(100));
console.log('⚠️  불일치 발견:');
console.log('─'.repeat(100));
console.log('  🟡 WARNING: SQLite "price_delta" vs Firebase "priceAdjustment" vs TZO "price_adjustment"');
console.log('  🟡 WARNING: 3곳 모두 다른 필드명 사용!');

// ============================================
// 5. TAX GROUPS
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📦 5. TAX GROUPS 비교');
console.log('═'.repeat(100));

const taxGroupsComparison = {
  sqliteColumns: [
    'id (INTEGER) - PK',
    'name (TEXT)',
    'is_active (INTEGER)',
    'created_at (DATETIME)',
    'updated_at (DATETIME)',
    'firebase_id (TEXT)',
    '--- taxes 테이블 (별도) ---',
    'tax_id, tax_group_id, name, rate, ...'
  ],
  firebaseFields: [
    'posGroupId (number)',
    'name (string)',
    'taxes (array) - 세금 목록 포함',
    '  - name (string)',
    '  - rate (number)',
    '  - isActive (boolean)',
    'restaurantId (string)',
    'createdAt (timestamp)',
    'updatedAt (timestamp)'
  ]
};

console.log('\n📋 SQLite 컬럼:');
taxGroupsComparison.sqliteColumns.forEach(c => console.log('  ' + c));

console.log('\n🔥 Firebase 필드:');
taxGroupsComparison.firebaseFields.forEach(c => console.log('  ' + c));

console.log('\n' + '─'.repeat(100));
console.log('✅ 상태: 양호 (구조 차이 있지만 동기화 코드에서 처리)');
console.log('─'.repeat(100));

// ============================================
// 6. PRINTER GROUPS
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📦 6. PRINTER GROUPS 비교');
console.log('═'.repeat(100));

const printerGroupsComparison = {
  sqliteColumns: [
    'id (INTEGER) - PK',
    'name (TEXT)',
    'is_active (INTEGER)',
    'created_at (DATETIME)',
    'updated_at (DATETIME)',
    'firebase_id (TEXT)',
    '--- printer_group_printers 테이블 (별도) ---',
    'printer_group_id, printer_id'
  ],
  firebaseFields: [
    'posGroupId (number)',
    'name (string)',
    'printers (array) - 프린터 목록 포함',
    '  - name (string)',
    '  - ipAddress (string)',
    '  - isActive (boolean)',
    'restaurantId (string)',
    'createdAt (timestamp)',
    'updatedAt (timestamp)'
  ]
};

console.log('\n📋 SQLite 컬럼:');
printerGroupsComparison.sqliteColumns.forEach(c => console.log('  ' + c));

console.log('\n🔥 Firebase 필드:');
printerGroupsComparison.firebaseFields.forEach(c => console.log('  ' + c));

console.log('\n' + '─'.repeat(100));
console.log('✅ 상태: 양호 (구조 차이 있지만 동기화 코드에서 처리)');
console.log('─'.repeat(100));

// ============================================
// 종합 보고서
// ============================================
console.log('\n' + '═'.repeat(100));
console.log('📊 종합 분석 결과');
console.log('═'.repeat(100));

console.log('\n🔴 CRITICAL (즉시 수정 필요):');
console.log('─'.repeat(50));
console.log('  1. menu_items.price1 vs price 불일치');
console.log('     - POS → Firebase: price1으로 업로드');
console.log('     - TZO OrderPage: price로 읽음');
console.log('     - 결과: 온라인 주문에서 가격 표시 안 됨!');
console.log('');
console.log('     해결책 A: Firebase 업로드 시 price1과 price 둘 다 저장');
console.log('     해결책 B: TZO OrderPage에서 price1 || price 사용');

console.log('\n🟡 WARNING (확인 필요):');
console.log('─'.repeat(50));
console.log('  1. modifier 가격 필드명 불일치');
console.log('     - SQLite: price_delta');
console.log('     - Firebase: priceAdjustment');
console.log('     - TZO: price_adjustment');
console.log('');
console.log('  2. selection 필드 케이스 불일치');
console.log('     - SQLite: min_selection, max_selection');
console.log('     - Firebase: minSelection, maxSelection');
console.log('     - TZO: min_selection, max_selection');

console.log('\n🟢 양호:');
console.log('─'.repeat(50));
console.log('  1. menu_categories - 호환 필드 사용');
console.log('  2. tax_groups - 구조 차이 있지만 동기화 코드에서 처리');
console.log('  3. printer_groups - 구조 차이 있지만 동기화 코드에서 처리');
console.log('  4. ID 매핑 - posId/firebase_id 양방향 저장됨');

console.log('\n' + '═'.repeat(100));
console.log('💡 권장 조치');
console.log('═'.repeat(100));
console.log('');
console.log('1. [CRITICAL] Firebase 업로드 시 price 필드도 함께 저장');
console.log('   price1: item.price,');
console.log('   price: item.price,  // ← 추가');
console.log('');
console.log('2. [RECOMMENDED] TZO OrderPage에서 가격 읽기 수정');
console.log('   price: data.price ?? data.price1 ?? 0');
console.log('');
console.log('3. [OPTIONAL] 필드명 통일 (장기적)');
console.log('   - 모든 시스템에서 동일한 필드명 사용');
console.log('   - camelCase vs snake_case 통일');
console.log('');
