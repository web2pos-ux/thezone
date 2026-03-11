// backend/routes/menu-sync.js
// Firebase ↔ POS 메뉴 동기화 API

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const firebaseService = require('../services/firebaseService');
const { SyncLogService, SYNC_STATUS, SYNC_DIRECTION, SYNC_TYPE } = require('../services/syncLogService');
const idMapperService = require('../services/idMapperService');

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원)
const { db, dbRun, dbAll, dbGet } = require('../db');

// 백업 디렉토리 경로 (환경 변수 BACKUPS_PATH 사용, 빌드된 앱 호환)
function getBackupDir(subDir = 'pos-menu') {
  const backupsBase = process.env.BACKUPS_PATH || path.resolve(__dirname, '..', '..', 'backups');
  const backupDir = path.join(backupsBase, subDir);
  return backupDir;
}

// 동기화에 필요한 컬럼이 없는 테이블에 자동 추가
let syncColumnsEnsured = false;
async function ensureSyncColumns() {
  if (syncColumnsEnsured) return;
  // firebase_id 컬럼 추가 (6개 테이블)
  const firebaseIdTables = ['menus', 'menu_categories', 'menu_items', 'modifier_groups', 'tax_groups', 'printer_groups'];
  for (const table of firebaseIdTables) {
    try {
      await dbRun(`ALTER TABLE ${table} ADD COLUMN firebase_id TEXT`);
      console.log(`✅ ${table}에 firebase_id 컬럼 추가됨`);
    } catch (e) {
      // 이미 존재하면 무시
    }
  }
  // menu_categories에 description 컬럼 추가 (Firebase 동기화 호환)
  try {
    await dbRun(`ALTER TABLE menu_categories ADD COLUMN description TEXT DEFAULT ''`);
    console.log(`✅ menu_categories에 description 컬럼 추가됨`);
  } catch (e) {
    // 이미 존재하면 무시
  }
  // sync_logs, sync_log_details, id_mappings 테이블 생성 (없으면)
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS sync_logs (
      sync_id TEXT PRIMARY KEY,
      sync_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      status TEXT DEFAULT 'running',
      total_items INTEGER DEFAULT 0,
      created_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      deleted_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      errors TEXT,
      initiated_by TEXT,
      employee_id TEXT,
      device_id TEXT
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS sync_log_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT NOT NULL,
      entity_type TEXT,
      local_id TEXT,
      firebase_id TEXT,
      action TEXT,
      status TEXT,
      old_data TEXT,
      new_data TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sync_id) REFERENCES sync_logs(sync_id)
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS id_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      local_id TEXT NOT NULL,
      firebase_id TEXT,
      uuid TEXT NOT NULL,
      external_ids TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_type, local_id)
    )`);
  } catch (e) {
    console.error('동기화 테이블 생성 실패:', e.message);
  }
  syncColumnsEnsured = true;
}
// 모듈 로드 시 실행
ensureSyncColumns().catch(e => console.error('동기화 컬럼 확인 실패:', e));

// Simple role guard
function requireManager(req, res, next) {
  try {
    const role = String(req.headers['x-role'] || '').toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER') return next();
  } catch {}
  return res.status(403).json({ error: 'Forbidden: Manager or Admin required' });
}

// Firebase 레스토랑 정보 가져오기
router.get('/firebase-restaurant/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    console.log(`🔍 Looking for restaurant: ${restaurantId}`);
    
    const firestore = firebaseService.getFirestore();
    
    // 먼저 모든 레스토랑 목록 조회 (디버깅용)
    const allRestaurants = await firestore.collection('restaurants').limit(5).get();
    console.log(`📋 Total restaurants in collection: ${allRestaurants.size}`);
    allRestaurants.forEach(doc => {
      console.log(`  - ID: ${doc.id}, Name: ${doc.data().name}`);
    });
    
    // 특정 레스토랑 조회
    const doc = await firestore.collection('restaurants').doc(restaurantId).get();
    console.log(`📄 Document exists: ${doc.exists}`);
    
    if (!doc.exists) {
      // 혹시 slug로 저장되어 있는지 확인
      const bySlug = await firestore.collection('restaurants')
        .where('slug', '==', restaurantId.toLowerCase())
        .limit(1)
        .get();
      
      if (!bySlug.empty) {
        const restaurant = { id: bySlug.docs[0].id, ...bySlug.docs[0].data() };
        console.log(`✅ Found by slug: ${restaurant.name}`);
        return res.json({ success: true, restaurant, foundBySlug: true });
      }
      
      return res.status(404).json({ 
        error: 'Restaurant not found in Firebase',
        searchedId: restaurantId,
        availableRestaurants: allRestaurants.docs.map(d => ({ id: d.id, name: d.data().name }))
      });
    }
    
    const restaurant = { id: doc.id, ...doc.data() };
    console.log(`✅ Found restaurant: ${restaurant.name}`);
    res.json({ success: true, restaurant });
  } catch (e) {
    console.error('Error fetching Firebase restaurant:', e);
    res.status(500).json({ error: e.message });
  }
});

// Firebase에서 메뉴 가져오기
router.get('/firebase-menu/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { menuId } = req.query; // 쿼리 파라미터에서 menuId 가져오기
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // 카테고리 가져오기 (서브컬렉션에서)
    const categoriesSnapshot = await restaurantRef
      .collection('menuCategories')
      .get();
    
    const categories = [];
    categoriesSnapshot.forEach(doc => {
      categories.push({ id: doc.id, ...doc.data() });
    });
    categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    // 메뉴 아이템 가져오기 (서브컬렉션에서)
    const itemsSnapshot = await restaurantRef
      .collection('menuItems')
      .get();
    
    const items = [];
    itemsSnapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });
    items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    res.json({ 
      success: true, 
      categories, 
      items,
      summary: {
        categoryCount: categories.length,
        itemCount: items.length
      }
    });
  } catch (e) {
    console.error('Error fetching Firebase menu:', e);
    res.status(500).json({ error: e.message });
  }
});

// Firebase → POS 메뉴 동기화 (전체 덮어쓰기)
router.post('/sync-from-firebase', requireManager, async (req, res) => {
  try {
    const { restaurantId, skipImages = false } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const firestore = firebaseService.getFirestore();
    
    console.log(`🔄 Firebase → POS 메뉴 동기화 시작: ${restaurantId}`);
    
    // 0. 기존 POS 메뉴 백업 생성
    console.log('💾 POS 메뉴 백업 시작...');
    const backupData = {
      timestamp: new Date().toISOString(),
      restaurantId: restaurantId,
      backupType: 'pre_download',
      categories: [],
      items: [],
      modifierGroups: [],
      taxGroups: [],
      printerGroups: []
    };
    
    // 카테고리 백업
    const posCategoriesBackup = await dbAll('SELECT * FROM menu_categories');
    backupData.categories = posCategoriesBackup;
    
    // 메뉴 아이템 백업
    const posItemsBackup = await dbAll('SELECT * FROM menu_items');
    backupData.items = posItemsBackup;
    
    // 모디파이어 그룹 백업
    const posModifierGroupsBackup = await dbAll('SELECT * FROM modifier_groups WHERE is_deleted = 0');
    backupData.modifierGroups = posModifierGroupsBackup;
    
    // 세금 그룹 백업
    const posTaxGroupsBackup = await dbAll('SELECT * FROM tax_groups');
    backupData.taxGroups = posTaxGroupsBackup;
    
    // 프린터 그룹 백업
    const posPrinterGroupsBackup = await dbAll('SELECT * FROM printer_groups WHERE is_active = 1');
    backupData.printerGroups = posPrinterGroupsBackup;
    
    // 백업 디렉토리 생성 (Electron 앱 호환)
    const backupDir = getBackupDir('pos-menu');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // 백업 파일 저장
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `pos_menu_backup_${restaurantId}_${timestamp}.json`;
    const backupPath = path.join(backupDir, backupFilename);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    
    console.log(`✅ POS 메뉴 백업 완료: ${backupFilename}`);
    console.log(`   - 카테고리: ${backupData.categories.length}개`);
    console.log(`   - 메뉴 아이템: ${backupData.items.length}개`);
    console.log(`   - 모디파이어 그룹: ${backupData.modifierGroups.length}개`);
    console.log(`   - 세금 그룹: ${backupData.taxGroups.length}개`);
    console.log(`   - 프린터 그룹: ${backupData.printerGroups.length}개`);
    
    // 1. Firebase에서 카테고리/아이템 가져오기 (menuId 우선, 없으면 전체/메뉴 하위 컬렉션 fallback)
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    const { menuId } = req.body || {};
    
    const loadFirebaseMenusList = async () => {
      const menusSnapshot = await restaurantRef.collection('menus').get();
      const menus = [];
      menusSnapshot.forEach(doc => menus.push({ id: doc.id, ...doc.data() }));
      return menus;
    };
    
    const fetchCategoriesAndItems = async (targetMenuId = null) => {
      let categoriesSnapshot;
      let itemsSnapshot;
      
      if (targetMenuId) {
        categoriesSnapshot = await restaurantRef.collection('menuCategories').where('menuId', '==', targetMenuId).get();
        itemsSnapshot = await restaurantRef.collection('menuItems').where('menuId', '==', targetMenuId).get();
      } else {
        categoriesSnapshot = await restaurantRef.collection('menuCategories').get();
        itemsSnapshot = await restaurantRef.collection('menuItems').get();
      }
      
      const categories = [];
      categoriesSnapshot.forEach(doc => categories.push({ id: doc.id, ...doc.data() }));
      const items = [];
      itemsSnapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      
      return { categories, items };
    };
    
    const fetchFromMenuSubcollections = async (targetMenuId) => {
      const menuRef = restaurantRef.collection('menus').doc(targetMenuId);
      const categoriesSnapshot = await menuRef.collection('menuCategories').get();
      const itemsSnapshot = await menuRef.collection('menuItems').get();
      const categories = [];
      categoriesSnapshot.forEach(doc => categories.push({ id: doc.id, ...doc.data() }));
      const items = [];
      itemsSnapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      return { categories, items };
    };
    
    let firebaseCategories = [];
    let firebaseItems = [];
    
    if (menuId) {
      ({ categories: firebaseCategories, items: firebaseItems } = await fetchCategoriesAndItems(menuId));
      if (firebaseCategories.length === 0 && firebaseItems.length === 0) {
        ({ categories: firebaseCategories, items: firebaseItems } = await fetchFromMenuSubcollections(menuId));
      }
    } else {
      ({ categories: firebaseCategories, items: firebaseItems } = await fetchCategoriesAndItems(null));
      if (firebaseCategories.length === 0 && firebaseItems.length === 0) {
        const menus = await loadFirebaseMenusList();
        const fallbackMenuId = menus[0]?.id || null;
        if (fallbackMenuId) {
          ({ categories: firebaseCategories, items: firebaseItems } = await fetchFromMenuSubcollections(fallbackMenuId));
        }
      }
    }
    
    // 클라이언트 측에서 정렬
    firebaseCategories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    firebaseItems.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    console.log(`📦 Firebase 카테고리: ${firebaseCategories.length}개, 아이템: ${firebaseItems.length}개`);
    
    // Debug: 이미지 URL이 있는 아이템 확인
    const itemsWithImages = firebaseItems.filter(item => item.imageUrl || item.image_url);
    const catsWithImages = firebaseCategories.filter(cat => cat.imageUrl || cat.image_url);
    console.log(`🖼️ 이미지가 있는 카테고리: ${catsWithImages.length}개`);
    console.log(`🖼️ 이미지가 있는 아이템: ${itemsWithImages.length}개`);
    if (itemsWithImages.length > 0) {
      console.log(`🖼️ 이미지 샘플:`, itemsWithImages.slice(0, 3).map(i => ({ name: i.name, imageUrl: i.imageUrl, image_url: i.image_url })));
    }
    if (firebaseItems.length > 0) {
      console.log(`📋 첫번째 아이템 필드 목록:`, Object.keys(firebaseItems[0]));
    }
    
    // 3. 테이블에 firebase_id 컬럼 추가 (없으면)
    try {
      await dbRun("ALTER TABLE menu_categories ADD COLUMN firebase_id TEXT");
      console.log('✅ menu_categories에 firebase_id 컬럼 추가됨');
    } catch (e) {
      // 이미 존재하면 무시
    }
    
    // 4. POS의 실제 menu_id 동적으로 조회 (하드코딩 방지)
    const posMenuRow = await dbGet('SELECT menu_id FROM menus ORDER BY menu_id LIMIT 1');
    const posDefaultMenuId = posMenuRow ? posMenuRow.menu_id : 200000;
    console.log(`📋 POS 기본 menu_id: ${posDefaultMenuId}`);
    
    // ★ 안전장치: SQLite 트랜잭션 시작 (실패 시 ROLLBACK으로 POS 원래 상태 복원)
    await dbRun('BEGIN TRANSACTION');
    let transactionActive = true;
    
    try {
    // 카테고리 동기화
    const categoryMapping = {}; // firebase_id -> pos_category_id
    
    for (const fbCat of firebaseCategories) {
      // 기존 매핑된 카테고리 찾기
      let posCategory = await dbGet(
        'SELECT * FROM menu_categories WHERE firebase_id = ?', 
        [fbCat.id]
      );
      
      if (posCategory) {
        // 업데이트
        const catImageValue = skipImages ? (posCategory.image_url || '') : (fbCat.imageUrl || fbCat.image_url || '');
        await dbRun(
          `UPDATE menu_categories SET 
            name = ?, 
            sort_order = ?,
            description = ?,
            image_url = ?
          WHERE category_id = ?`,
          [
            fbCat.name,
            fbCat.sortOrder || fbCat.sort_order || 0,
            fbCat.description || '',
            catImageValue,
            posCategory.category_id
          ]
        );
        categoryMapping[fbCat.id] = posCategory.category_id;
        
        // id_mappings 테이블 업데이트
        await idMapperService.ensureMapping('category', posCategory.category_id, fbCat.id);
        
        console.log(`✅ 카테고리 업데이트: ${fbCat.name}`);
      } else {
        // 이름으로 찾기 (firebase_id 조건 제거 - 기존 카테고리와 매칭)
        posCategory = await dbGet(
          'SELECT * FROM menu_categories WHERE name = ? AND menu_id = ?',
          [fbCat.name, posDefaultMenuId]
        );
        
        if (posCategory) {
          // 기존 카테고리와 연결/업데이트
          const catImageValue = skipImages ? (posCategory.image_url || '') : (fbCat.imageUrl || fbCat.image_url || '');
          await dbRun(
            `UPDATE menu_categories SET 
              firebase_id = ?, 
              sort_order = ?,
              description = ?,
              image_url = ?
            WHERE category_id = ?`,
            [
              fbCat.id, 
              fbCat.sortOrder || fbCat.sort_order || 0, 
              fbCat.description || '',
              catImageValue,
              posCategory.category_id
            ]
          );
          categoryMapping[fbCat.id] = posCategory.category_id;
          
          // id_mappings 테이블 업데이트
          await idMapperService.ensureMapping('category', posCategory.category_id, fbCat.id);
          
          console.log(`🔗 카테고리 연결: ${fbCat.name}`);
        } else {
          // 새 카테고리 생성 (category_id는 INTEGER AUTOINCREMENT)
          // menu_id는 POS의 실제 menu_id 사용
          const catImageValue = skipImages ? '' : (fbCat.imageUrl || fbCat.image_url || '');
          const result = await dbRun(
            `INSERT INTO menu_categories (name, sort_order, firebase_id, menu_id, description, image_url) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              fbCat.name, 
              fbCat.sortOrder || fbCat.sort_order || 0, 
              fbCat.id, 
              posDefaultMenuId,
              fbCat.description || '',
              catImageValue
            ]
          );
          categoryMapping[fbCat.id] = result.lastID;
          
          // id_mappings 테이블 업데이트
          await idMapperService.ensureMapping('category', result.lastID, fbCat.id);
          
          console.log(`➕ 새 카테고리 생성: ${fbCat.name} (ID: ${result.lastID})`);
        }
      }
    }
    
    // 5. 메뉴 아이템 동기화
    let createdItems = 0;
    let updatedItems = 0;
    
    for (const fbItem of firebaseItems) {
      const posCategoryId = categoryMapping[fbItem.categoryId];
      
      if (!posCategoryId) {
        console.warn(`⚠️ 카테고리 매핑 없음: ${fbItem.name} (categoryId: ${fbItem.categoryId})`);
        continue;
      }
      
      // 기존 매핑된 아이템 찾기
      let posItem = await dbGet(
        'SELECT * FROM menu_items WHERE firebase_id = ?',
        [fbItem.id]
      );
      
      if (posItem) {
        // 업데이트 (menu_items 테이블에 is_active 컬럼 없음 - 제외)
        const itemImageValue = skipImages ? (posItem.image_url || '') : (fbItem.imageUrl || fbItem.image_url || '');
        await dbRun(
          `UPDATE menu_items SET
            name = ?,
            short_name = ?,
            price = ?,
            price2 = ?,
            category_id = ?,
            description = ?,
            image_url = ?,
            sort_order = ?,
            is_open_price = ?
          WHERE item_id = ?`,
          [
            fbItem.name,
            fbItem.shortName || fbItem.short_name || '',
            fbItem.price || fbItem.price1 || 0,
            fbItem.price2 || 0,
            posCategoryId,
            fbItem.description || '',
            itemImageValue,
            fbItem.sortOrder || fbItem.sort_order || 0,
            fbItem.isOpenPrice || fbItem.is_open_price || 0,
            posItem.item_id
          ]
        );
        
        // id_mappings 테이블 업데이트
        await idMapperService.ensureMapping('menu_item', posItem.item_id, fbItem.id);
        
        updatedItems++;
      } else {
        // 이름으로 찾기 (firebase_id 조건 제거 - 기존 아이템과 매칭)
        posItem = await dbGet(
          'SELECT * FROM menu_items WHERE name = ? AND menu_id = ?',
          [fbItem.name, posDefaultMenuId]
        );
        
        if (posItem) {
          // 기존 아이템과 연결 및 업데이트 (is_active 컬럼 없음 - 제외)
          const itemImageValue = skipImages ? (posItem.image_url || '') : (fbItem.imageUrl || fbItem.image_url || '');
          await dbRun(
            `UPDATE menu_items SET
              firebase_id = ?,
              short_name = ?,
              price = ?,
              price2 = ?,
              category_id = ?,
              description = ?,
              image_url = ?,
              sort_order = ?,
              is_open_price = ?
            WHERE item_id = ?`,
            [
              fbItem.id,
              fbItem.shortName || fbItem.short_name || '',
              fbItem.price || fbItem.price1 || 0,
              fbItem.price2 || 0,
              posCategoryId,
              fbItem.description || '',
              itemImageValue,
              fbItem.sortOrder || fbItem.sort_order || 0,
              fbItem.isOpenPrice || fbItem.is_open_price || 0,
              posItem.item_id
            ]
          );
          
          // id_mappings 테이블 업데이트
          await idMapperService.ensureMapping('menu_item', posItem.item_id, fbItem.id);
          
          updatedItems++;
          console.log(`🔗 아이템 연결: ${fbItem.name}`);
        } else {
          // 새 아이템 생성 (item_id는 INTEGER AUTOINCREMENT)
          // menu_id는 POS의 실제 menu_id 사용
          const itemImageValue = skipImages ? '' : (fbItem.imageUrl || fbItem.image_url || '');
          const result = await dbRun(
            `INSERT INTO menu_items (
              name, short_name, price, price2, category_id, menu_id, description, image_url, 
              sort_order, firebase_id, is_open_price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              fbItem.name,
              fbItem.shortName || fbItem.short_name || '',
              fbItem.price || fbItem.price1 || 0,
              fbItem.price2 || 0,
              posCategoryId,
              posDefaultMenuId, // POS 실제 메뉴 ID
              fbItem.description || '',
              itemImageValue,
              fbItem.sortOrder || fbItem.sort_order || 0,
              fbItem.id,
              fbItem.isOpenPrice || fbItem.is_open_price || 0
            ]
          );
          
          // id_mappings 테이블 업데이트
          await idMapperService.ensureMapping('menu_item', result.lastID, fbItem.id);
          
          createdItems++;
          console.log(`➕ 새 아이템 생성: ${fbItem.name} (ID: ${result.lastID})`);
        }
      }
    }
    
    // 6. Firebase에 없는 POS 아이템 비활성화 (선택적)
    // 이 부분은 주석 처리 - 필요 시 활성화
    /*
    const fbItemIds = firebaseItems.map(i => i.id);
    await dbRun(
      `UPDATE menu_items SET is_active = 0 
       WHERE firebase_id IS NOT NULL AND firebase_id NOT IN (${fbItemIds.map(() => '?').join(',')})`,
      fbItemIds
    );
    */
    
    // 7. 옵션 연결 동기화 (모디파이어, 세금, 프린터 그룹)
    console.log('🔗 옵션 연결 동기화 시작...');
    let modifierLinksCreated = 0;
    let taxLinksCreated = 0;
    let printerLinksCreated = 0;
    
    // Firebase 그룹들 가져오기 (서브컬렉션에서)
    const [modifierGroupsSnapshot, taxGroupsSnapshot, printerGroupsSnapshot] = await Promise.all([
      restaurantRef.collection('modifierGroups').get(),
      restaurantRef.collection('taxGroups').get(),
      restaurantRef.collection('printerGroups').get()
    ]);
    
    const firebaseModifierGroups = {};
    modifierGroupsSnapshot.forEach(doc => {
      firebaseModifierGroups[doc.id] = doc.data();
    });
    
    const firebaseTaxGroups = {};
    taxGroupsSnapshot.forEach(doc => {
      firebaseTaxGroups[doc.id] = doc.data();
    });
    
    const firebasePrinterGroups = {};
    printerGroupsSnapshot.forEach(doc => {
      firebasePrinterGroups[doc.id] = doc.data();
    });
    
    // POS 그룹들 가져오기 (이름 → ID 매핑)
    const [posModifierGroups, posTaxGroups, posPrinterGroups] = await Promise.all([
      dbAll('SELECT modifier_group_id as id, name FROM modifier_groups WHERE is_deleted = 0'),
      dbAll('SELECT tax_group_id as id, name FROM tax_groups WHERE is_deleted = 0'),
      dbAll('SELECT printer_group_id as id, name FROM printer_groups WHERE is_active = 1')
    ]);
    
    const modifierGroupNameToId = {};
    for (const mg of posModifierGroups) {
      modifierGroupNameToId[mg.name.toLowerCase()] = mg.id;
    }
    
    const taxGroupNameToId = {};
    for (const tg of posTaxGroups) {
      taxGroupNameToId[tg.name.toLowerCase()] = tg.id;
    }
    
    const printerGroupNameToId = {};
    for (const pg of posPrinterGroups) {
      printerGroupNameToId[pg.name.toLowerCase()] = pg.id;
    }
    
    // 메뉴 아이템 옵션 연결 동기화
    for (const fbItem of firebaseItems) {
      // POS 아이템 ID 찾기
      const posItem = await dbGet('SELECT item_id FROM menu_items WHERE firebase_id = ?', [fbItem.id]);
      if (!posItem) continue;
      
      // 기존 연결 삭제
      await Promise.all([
        dbRun('DELETE FROM menu_modifier_links WHERE item_id = ?', [posItem.item_id]),
        dbRun('DELETE FROM menu_tax_links WHERE item_id = ?', [posItem.item_id]).catch(() => {}),
        dbRun('DELETE FROM menu_printer_links WHERE item_id = ?', [posItem.item_id])
      ]);
      
      // 모디파이어 그룹 연결
      const fbModifierGroupIds = fbItem.modifierGroupIds || [];
      for (const fbMgId of fbModifierGroupIds) {
        const fbMg = firebaseModifierGroups[fbMgId];
        if (!fbMg) continue;
        
        const posMgId = modifierGroupNameToId[fbMg.name.toLowerCase()];
        if (posMgId) {
          await dbRun(
            'INSERT OR IGNORE INTO menu_modifier_links (item_id, modifier_group_id) VALUES (?, ?)',
            [posItem.item_id, posMgId]
          );
          modifierLinksCreated++;
          console.log(`🔗 아이템-모디파이어 연결: ${fbItem.name} → ${fbMg.name}`);
      }
    }
    
      // 세금 그룹 연결
      const fbTaxGroupIds = fbItem.taxGroupIds || [];
      for (const fbTgId of fbTaxGroupIds) {
        const fbTg = firebaseTaxGroups[fbTgId];
        if (!fbTg) continue;
        
        const posTgId = taxGroupNameToId[fbTg.name.toLowerCase()];
        if (posTgId) {
          // menu_tax_links 테이블에 삽입
          await dbRun(
            'INSERT OR IGNORE INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)',
            [posItem.item_id, posTgId]
          ).catch(e => {
            console.warn(`⚠️ 세금 그룹 연결 삽입 실패: ${e.message}`);
          });
          taxLinksCreated++;
          console.log(`🔗 아이템-세금 연결: ${fbItem.name} → ${fbTg.name}`);
        }
      }
      
      // 프린터 그룹 연결
      const fbPrinterGroupIds = fbItem.printerGroupIds || [];
      for (const fbPgId of fbPrinterGroupIds) {
        const fbPg = firebasePrinterGroups[fbPgId];
        if (!fbPg) continue;
        
        const posPgId = printerGroupNameToId[fbPg.name.toLowerCase()];
        if (posPgId) {
          await dbRun(
            'INSERT OR IGNORE INTO menu_printer_links (item_id, printer_group_id) VALUES (?, ?)',
            [posItem.item_id, posPgId]
          );
          printerLinksCreated++;
          console.log(`🔗 아이템-프린터 연결: ${fbItem.name} → ${fbPg.name}`);
        }
      }
    }
    
    // 8. 카테고리 레벨 링크 동기화 (모디파이어, 세금)
    console.log('🔗 카테고리 레벨 링크 동기화 시작...');
    let categoryModifierLinksCreated = 0;
    let categoryTaxLinksCreated = 0;
    
    // 원래 POS category_id → 현재 POS category_id 매핑 생성
    // (업로드 시 posId로 저장된 원래 ID가 다운로드 후 변경될 수 있음)
    const oldPosIdToNewPosId = {};
    for (const fbCat of firebaseCategories) {
      const oldPosId = fbCat.posId;
      const newPosId = categoryMapping[fbCat.id]; // firebase_id → 현재 pos_category_id
      if (oldPosId && newPosId) {
        oldPosIdToNewPosId[String(oldPosId)] = newPosId;
      }
    }
    
    // 동기화 대상 카테고리의 기존 링크 정리
    const syncedCategoryIds = Object.values(categoryMapping).filter(id => id);
    for (const catId of syncedCategoryIds) {
      await dbRun('DELETE FROM category_modifier_links WHERE category_id = ?', [catId]).catch(() => {});
      await dbRun('DELETE FROM category_tax_links WHERE category_id = ?', [catId]).catch(() => {});
    }
    
    // Firebase에서 카테고리-모디파이어 연결 가져오기
    try {
      const catModLinksSnapshot = await restaurantRef.collection('categoryModifierLinks').get();
      for (const doc of catModLinksSnapshot.docs) {
        const linkData = doc.data();
        // 원래 POS ID → 현재 POS ID로 변환 (없으면 원래 ID 사용)
        const posCategoryId = oldPosIdToNewPosId[linkData.categoryId] || parseInt(linkData.categoryId);
        if (!posCategoryId) continue;
        
        // Firebase 모디파이어 그룹 ID → POS 모디파이어 그룹 ID (이름 매칭)
        const fbMg = firebaseModifierGroups[linkData.modifierGroupId];
        if (!fbMg) continue;
        
        const posMgId = modifierGroupNameToId[fbMg.name.toLowerCase()];
        if (posMgId) {
          await dbRun(
            'INSERT OR IGNORE INTO category_modifier_links (category_id, modifier_group_id) VALUES (?, ?)',
            [posCategoryId, posMgId]
          ).catch(() => {});
          categoryModifierLinksCreated++;
        }
      }
    } catch (e) {
      console.warn('⚠️ 카테고리-모디파이어 연결 동기화 실패:', e.message);
    }
    
    // Firebase에서 카테고리-세금 연결 가져오기
    try {
      const catTaxLinksSnapshot = await restaurantRef.collection('categoryTaxLinks').get();
      for (const doc of catTaxLinksSnapshot.docs) {
        const linkData = doc.data();
        // 원래 POS ID → 현재 POS ID로 변환
        const posCategoryId = oldPosIdToNewPosId[linkData.categoryId] || parseInt(linkData.categoryId);
        if (!posCategoryId) continue;
        
        // Firebase 세금 그룹 ID → POS 세금 그룹 ID (이름 매칭)
        const fbTg = firebaseTaxGroups[linkData.taxGroupId];
        if (!fbTg) continue;
        
        const posTgId = taxGroupNameToId[fbTg.name.toLowerCase()];
        if (posTgId) {
          await dbRun(
            'INSERT OR IGNORE INTO category_tax_links (category_id, tax_group_id) VALUES (?, ?)',
            [posCategoryId, posTgId]
          ).catch(() => {});
          categoryTaxLinksCreated++;
        }
      }
    } catch (e) {
      console.warn('⚠️ 카테고리-세금 연결 동기화 실패:', e.message);
    }
    
    // Firebase에서 카테고리-프린터 연결 가져오기
    let categoryPrinterLinksCreated = 0;
    try {
      // 동기화 대상 카테고리의 기존 프린터 링크 정리
      for (const catId of syncedCategoryIds) {
        await dbRun('DELETE FROM category_printer_links WHERE category_id = ?', [catId]).catch(() => {});
      }
      
      const catPrinterLinksSnapshot = await restaurantRef.collection('categoryPrinterLinks').get();
      for (const doc of catPrinterLinksSnapshot.docs) {
        const linkData = doc.data();
        // 원래 POS ID → 현재 POS ID로 변환
        const posCategoryId = oldPosIdToNewPosId[linkData.categoryId] || parseInt(linkData.categoryId);
        if (!posCategoryId) continue;
        
        // Firebase 프린터 그룹 ID → POS 프린터 그룹 ID (이름 매칭)
        const fbPg = firebasePrinterGroups[linkData.printerGroupId];
        if (!fbPg) continue;
        
        const posPgId = printerGroupNameToId[fbPg.name.toLowerCase()];
        if (posPgId) {
          await dbRun(
            'INSERT OR IGNORE INTO category_printer_links (category_id, printer_group_id) VALUES (?, ?)',
            [posCategoryId, posPgId]
          ).catch(() => {});
          categoryPrinterLinksCreated++;
        }
      }
    } catch (e) {
      console.warn('⚠️ 카테고리-프린터 연결 동기화 실패:', e.message);
    }
    
    // 9. 세금 미연결 아이템/카테고리에 기본 세금 그룹 자동 연결
    try {
      const defaultFoodGroup = await dbGet(
        `SELECT tg.tax_group_id FROM tax_groups tg
         JOIN tax_group_links tgl ON tg.tax_group_id = tgl.tax_group_id
         JOIN taxes t ON tgl.tax_id = t.tax_id AND t.is_deleted = 0
         WHERE tg.is_deleted = 0
         GROUP BY tg.tax_group_id
         HAVING COUNT(t.tax_id) = 1
         ORDER BY tg.tax_group_id LIMIT 1`
      );
      const defaultDrinkGroup = await dbGet(
        `SELECT tg.tax_group_id FROM tax_groups tg
         JOIN tax_group_links tgl ON tg.tax_group_id = tgl.tax_group_id
         JOIN taxes t ON tgl.tax_id = t.tax_id AND t.is_deleted = 0
         WHERE tg.is_deleted = 0
         GROUP BY tg.tax_group_id
         HAVING COUNT(t.tax_id) >= 2
         ORDER BY tg.tax_group_id LIMIT 1`
      );
      const foodGid = defaultFoodGroup?.tax_group_id;
      const drinkGid = defaultDrinkGroup?.tax_group_id || foodGid;

      if (foodGid) {
        const unlinkedCats = await dbAll(
          `SELECT c.category_id, c.name FROM menu_categories c
           WHERE c.category_id NOT IN (SELECT category_id FROM category_tax_links)`
        );
        let autoLinkedCats = 0;
        for (const cat of unlinkedCats) {
          const gid = /drink|beverage|beer|wine|liquor/i.test(cat.name) ? drinkGid : foodGid;
          await dbRun('INSERT OR IGNORE INTO category_tax_links (category_id, tax_group_id) VALUES (?, ?)', [cat.category_id, gid]);
          autoLinkedCats++;
        }

        const unlinkedItems = await dbAll(
          `SELECT mi.item_id, mi.category_id FROM menu_items mi
           WHERE mi.item_id NOT IN (SELECT item_id FROM menu_tax_links)`
        );
        let autoLinkedItems = 0;
        for (const item of unlinkedItems) {
          const catLink = await dbGet('SELECT tax_group_id FROM category_tax_links WHERE category_id = ?', [item.category_id]);
          const gid = catLink?.tax_group_id || foodGid;
          await dbRun('INSERT OR IGNORE INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)', [item.item_id, gid]);
          autoLinkedItems++;
        }

        if (autoLinkedCats > 0 || autoLinkedItems > 0) {
          console.log(`🔗 기본 세금 자동 연결: 카테고리 ${autoLinkedCats}개, 아이템 ${autoLinkedItems}개`);
        }
      }
    } catch (e) {
      console.warn('⚠️ 기본 세금 자동 연결 실패:', e.message);
    }

    console.log(`✅ 동기화 완료 - 생성: ${createdItems}, 업데이트: ${updatedItems}, 모디파이어연결: ${modifierLinksCreated}, 세금연결: ${taxLinksCreated}, 프린터연결: ${printerLinksCreated}, 카테고리-모디파이어: ${categoryModifierLinksCreated}, 카테고리-세금: ${categoryTaxLinksCreated}, 카테고리-프린터: ${categoryPrinterLinksCreated}`);
    
    // ★ 트랜잭션 커밋 - 모든 POS 변경사항 확정
    await dbRun('COMMIT');
    transactionActive = false;
    console.log('✅ SQLite 트랜잭션 커밋 완료');
    
    res.json({
      success: true,
      message: 'Menu synchronized from Firebase',
      backup: {
        filename: backupFilename,
        path: backupPath,
        categoriesBackedUp: backupData.categories.length,
        itemsBackedUp: backupData.items.length,
        modifierGroupsBackedUp: backupData.modifierGroups.length,
        taxGroupsBackedUp: backupData.taxGroups.length,
        printerGroupsBackedUp: backupData.printerGroups.length
      },
      summary: {
        categoriesProcessed: firebaseCategories.length,
        itemsCreated: createdItems,
        itemsUpdated: updatedItems,
        modifierLinksCreated: modifierLinksCreated,
        taxLinksCreated: taxLinksCreated,
        printerLinksCreated: printerLinksCreated,
        categoryModifierLinksCreated: categoryModifierLinksCreated,
        categoryTaxLinksCreated: categoryTaxLinksCreated,
        categoryPrinterLinksCreated: categoryPrinterLinksCreated
      }
    });
    } catch (txErr) {
      // ★ 트랜잭션 롤백 - POS 데이터를 동기화 이전 상태로 복원
      if (transactionActive) {
        try {
          await dbRun('ROLLBACK');
          console.log('🔄 SQLite 트랜잭션 롤백 완료 - POS 데이터가 원래 상태로 복원됨');
        } catch (rollbackErr) {
          console.error('❌ SQLite 롤백 실패:', rollbackErr.message);
        }
      }
      throw txErr; // 외부 catch로 전달
    }
  } catch (e) {
    console.error('❌ 메뉴 동기화 실패:', e);
    res.status(500).json({ 
      error: e.message,
      rolledBack: true,
      message: 'Sync failed. POS data has been rolled back to previous state.',
      backup: {
        filename: typeof backupFilename !== 'undefined' ? backupFilename : null,
        hint: 'If rollback failed, use the backup file to manually restore.'
      }
    });
  }
});

// 기존 Firebase 메뉴 백업
router.get('/backup-firebase/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const firestore = firebaseService.getFirestore();
    
    console.log(`💾 Firebase 메뉴 백업 시작: ${restaurantId}`);
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // 카테고리 가져오기 (서브컬렉션에서)
    const categoriesSnapshot = await restaurantRef
      .collection('menuCategories')
      .get();
    
    const categories = [];
    categoriesSnapshot.forEach(doc => {
      categories.push({ id: doc.id, ...doc.data() });
    });
    
    // 메뉴 아이템 가져오기 (서브컬렉션에서)
    const itemsSnapshot = await restaurantRef
      .collection('menuItems')
      .get();
    
    const items = [];
    itemsSnapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });
    
    const backup = {
      restaurantId,
      backupDate: new Date().toISOString(),
      categories,
      items,
      summary: {
        categoryCount: categories.length,
        itemCount: items.length
      }
    };
    
    console.log(`✅ 백업 완료 - 카테고리: ${categories.length}, 아이템: ${items.length}`);
    
    res.json({
      success: true,
      backup
    });
  } catch (e) {
    console.error('❌ 백업 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// POS → Firebase 메뉴 업로드
router.post('/sync-to-firebase', requireManager, async (req, res) => {
  try {
    const { restaurantId, menuId, skipImages = false } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    console.log(`🔄 POS → Firebase 메뉴 업로드 시작: ${restaurantId}, Menu: ${menuId || 'All'}`);
    
    // 0. 기존 메뉴 백업 (menuId 기준)
    const existingCatsBackup = menuId
      ? await restaurantRef.collection('menuCategories').where('menuId', '==', menuId).get()
      : await restaurantRef.collection('menuCategories').get();
    
    const existingItemsBackup = menuId
      ? await restaurantRef.collection('menuItems').where('menuId', '==', menuId).get()
      : await restaurantRef.collection('menuItems').get();
    
    const backupCategories = [];
    existingCatsBackup.forEach(doc => {
      backupCategories.push({ id: doc.id, ...doc.data() });
    });
    
    const backupItems = [];
    existingItemsBackup.forEach(doc => {
      backupItems.push({ id: doc.id, ...doc.data() });
    });
    
    // 백업을 Firebase의 menuBackups 컬렉션에 저장
    const backupRef = await firestore.collection('menuBackups').add({
      restaurantId,
      backupDate: new Date(),
      categories: backupCategories,
      items: backupItems,
      categoryCount: backupCategories.length,
      itemCount: backupItems.length
    });
    
    console.log(`💾 기존 메뉴 백업 완료 (ID: ${backupRef.id}) - 카테고리: ${backupCategories.length}, 아이템: ${backupItems.length}`);

    // skipImages: 기존 Firebase 이미지를 보존하기 위해 posId 기준으로 이미지 맵 구축
    const fbCatImageMap = {};
    const fbItemImageMap = {};
    if (skipImages) {
      for (const cat of backupCategories) {
        const imgUrl = cat.imageUrl || cat.image_url || '';
        if (imgUrl && cat.posId) {
          fbCatImageMap[cat.posId] = imgUrl;
        }
      }
      for (const item of backupItems) {
        const imgUrl = item.imageUrl || item.image_url || '';
        if (imgUrl && item.posId) {
          fbItemImageMap[item.posId] = imgUrl;
        }
      }
      console.log(`🖼️ skipImages=true: 기존 Firebase 이미지 보존 (카테고리: ${Object.keys(fbCatImageMap).length}개, 아이템: ${Object.keys(fbItemImageMap).length}개)`);
    }

    // 1. POS 카테고리 가져오기 (menuId가 있으면 해당 메뉴의 카테고리만)
    let posCategories;
    let posItems;
    
    if (menuId) {
      // 특정 메뉴의 카테고리만 가져오기
      posCategories = await dbAll(
        'SELECT * FROM menu_categories WHERE menu_id = ? ORDER BY sort_order',
        [menuId]
      );
      // 해당 카테고리에 속한 아이템만 가져오기
      const categoryIds = posCategories.map(c => c.category_id);
      if (categoryIds.length > 0) {
        const placeholders = categoryIds.map(() => '?').join(',');
        posItems = await dbAll(
          `SELECT * FROM menu_items WHERE category_id IN (${placeholders}) ORDER BY category_id, sort_order`,
          categoryIds
        );
      } else {
        posItems = [];
      }
    } else {
      // 모든 카테고리 가져오기
      posCategories = await dbAll('SELECT * FROM menu_categories ORDER BY sort_order');
      posItems = await dbAll('SELECT * FROM menu_items ORDER BY category_id, sort_order');
    }
    
    console.log(`📦 POS 카테고리: ${posCategories.length}개, 아이템: ${posItems.length}개`);
    
    // 3. 기존 Firebase 메뉴 삭제 (menuId 기준, 중복 방지)
    const deleteByMenuId = async (targetMenuId) => {
      const existingCats = await restaurantRef.collection('menuCategories')
        .where('menuId', '==', targetMenuId)
        .get();
      for (const doc of existingCats.docs) {
        await doc.ref.delete();
      }
      
      const existingItems = await restaurantRef.collection('menuItems')
        .where('menuId', '==', targetMenuId)
        .get();
      for (const doc of existingItems.docs) {
        await doc.ref.delete();
      }
      
      const existingMenus = await restaurantRef.collection('menus')
        .where('posId', '==', targetMenuId)
        .get();
      for (const doc of existingMenus.docs) {
        await doc.ref.delete();
      }
      
      console.log(`🗑️ 기존 Firebase 메뉴 삭제 완료 (menuId: ${targetMenuId})`);
    };
    
    if (menuId) {
      const candidates = [menuId];
      const numericId = Number(menuId);
      if (!Number.isNaN(numericId) && String(numericId) !== String(menuId)) {
        candidates.push(numericId);
      }
      for (const targetId of candidates) {
        await deleteByMenuId(targetId);
      }
    }
    
    // 5. 카테고리 업로드 (서브컬렉션에)
    const categoryMapping = {}; // pos_category_id -> firebase_category_id
    
    for (let i = 0; i < posCategories.length; i++) {
      const cat = posCategories[i];
      const catImageUrl = skipImages && fbCatImageMap[cat.category_id] ? fbCatImageMap[cat.category_id] : (cat.image_url || '');
      const docRef = await restaurantRef.collection('menuCategories').add({
        restaurantId,
        menuId: menuId || undefined,
        name: cat.name,
        description: cat.description || '',
        imageUrl: catImageUrl,
        sortOrder: cat.sort_order || i,
        isActive: true,
        posId: cat.category_id,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      categoryMapping[cat.category_id] = docRef.id;
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE menu_categories SET firebase_id = ? WHERE category_id = ?',
        [docRef.id, cat.category_id]
      );
      
      console.log(`✅ 카테고리 업로드: ${cat.name}`);
    }
    
    // 6. 메뉴 아이템 업로드
    let uploadedItems = 0;
    
    for (let i = 0; i < posItems.length; i++) {
      const item = posItems[i];
      const firebaseCategoryId = categoryMapping[item.category_id];
      
      if (!firebaseCategoryId) {
        console.warn(`⚠️ 카테고리 매핑 없음: ${item.name}`);
        continue;
      }
      
      // 아이템에 연결된 모디파이어 그룹 ID들 가져오기
      const modifierGroupIds = await dbAll(
        'SELECT modifier_group_id FROM menu_modifier_links WHERE item_id = ?',
        [item.item_id]
      ).then(rows => rows.map(r => r.modifier_group_id)).catch(() => []);
      
      // 아이템에 연결된 세금 그룹 ID들 가져오기 (menu_tax_links)
      let taxGroupIds = [];
      try {
        const taxRows = await dbAll(
          'SELECT tax_group_id FROM menu_tax_links WHERE item_id = ?',
          [item.item_id]
        );
        taxGroupIds = taxRows.map(r => r.tax_group_id);
      } catch (e) {
        console.warn(`⚠️ 세금 그룹 연결 조회 실패: ${item.name}`);
      }
      
      // 아이템에 연결된 프린터 그룹 ID들 가져오기
      const printerGroupIds = await dbAll(
        'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
        [item.item_id]
      ).then(rows => rows.map(r => r.printer_group_id)).catch(() => []);
      
      // Firebase Modifier Groups에서 POS group_id로 찾은 Firebase ID들로 변환 (서브컬렉션에서)
      const firebaseModifierGroupIds = [];
      for (const posModGroupId of modifierGroupIds) {
        // Firebase 서브컬렉션에서 posGroupId로 찾기
        const fbModGroup = await restaurantRef
          .collection('modifierGroups')
          .where('posGroupId', '==', posModGroupId)
          .limit(1)
          .get();
        if (!fbModGroup.empty) {
          firebaseModifierGroupIds.push(fbModGroup.docs[0].id);
        }
      }
      
      // Firebase Tax Groups에서 POS group_id로 찾은 Firebase ID들로 변환 (서브컬렉션에서)
      const firebaseTaxGroupIds = [];
      for (const posTaxGroupId of taxGroupIds) {
        // Firebase 서브컬렉션에서 posGroupId로 찾기
        const fbTaxGroup = await restaurantRef
          .collection('taxGroups')
          .where('posGroupId', '==', posTaxGroupId)
          .limit(1)
          .get();
        if (!fbTaxGroup.empty) {
          firebaseTaxGroupIds.push(fbTaxGroup.docs[0].id);
        }
      }
      
      // Firebase Printer Groups에서 POS group_id로 찾은 Firebase ID들로 변환 (서브컬렉션에서)
      const firebasePrinterGroupIds = [];
      for (const posPrinterGroupId of printerGroupIds) {
        // Firebase 서브컬렉션에서 posGroupId로 찾기
        const fbPrinterGroup = await restaurantRef
          .collection('printerGroups')
          .where('posGroupId', '==', posPrinterGroupId)
          .limit(1)
          .get();
        if (!fbPrinterGroup.empty) {
          firebasePrinterGroupIds.push(fbPrinterGroup.docs[0].id);
        }
      }
      
      const itemImageUrl = skipImages && fbItemImageMap[item.item_id] ? fbItemImageMap[item.item_id] : (item.image_url || '');
      const docRef = await restaurantRef.collection('menuItems').add({
        restaurantId,
        menuId: menuId || undefined,
        categoryId: firebaseCategoryId,
        name: item.name,
        shortName: item.short_name || '',
        description: item.description || '',
        price: item.price || 0,
        price2: item.price2 || 0,
        imageUrl: itemImageUrl,
        isOpenPrice: item.is_open_price || 0,
        isAvailable: true,
        sortOrder: item.sort_order || i,
        posId: item.item_id,
        modifierGroupIds: firebaseModifierGroupIds,
        taxGroupIds: firebaseTaxGroupIds,
        printerGroupIds: firebasePrinterGroupIds,
        options: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE menu_items SET firebase_id = ? WHERE item_id = ?',
        [docRef.id, item.item_id]
      );
      
      uploadedItems++;
    }
    
    // 7. 카테고리 레벨 링크 업로드 (sync-from-firebase 다운로드 시 필요)
    let catModLinksUploaded = 0;
    let catTaxLinksUploaded = 0;
    let catPrinterLinksUploaded = 0;
    
    // 기존 카테고리 레벨 링크 삭제
    const [existCatModLinks, existCatTaxLinks, existCatPrinterLinks] = await Promise.all([
      restaurantRef.collection('categoryModifierLinks').get(),
      restaurantRef.collection('categoryTaxLinks').get(),
      restaurantRef.collection('categoryPrinterLinks').get()
    ]);
    for (const doc of existCatModLinks.docs) await doc.ref.delete();
    for (const doc of existCatTaxLinks.docs) await doc.ref.delete();
    for (const doc of existCatPrinterLinks.docs) await doc.ref.delete();
    
    for (const cat of posCategories) {
      const fbCatId = categoryMapping[cat.category_id];
      if (!fbCatId) continue;
      
      // 카테고리-모디파이어 링크
      const catModLinks = await dbAll(
        'SELECT modifier_group_id FROM category_modifier_links WHERE category_id = ?',
        [cat.category_id]
      ).catch(() => []);
      
      for (const link of catModLinks) {
        // Firebase에서 POS modifier_group_id로 Firebase ID 찾기
        const fbMgSnap = await restaurantRef.collection('modifierGroups')
          .where('posGroupId', '==', link.modifier_group_id).limit(1).get();
        if (!fbMgSnap.empty) {
          const linkId = `${cat.category_id}_${link.modifier_group_id}`;
          await restaurantRef.collection('categoryModifierLinks').doc(linkId).set({
            id: linkId,
            categoryId: String(cat.category_id),
            modifierGroupId: fbMgSnap.docs[0].id,
            created_at: new Date()
          });
          catModLinksUploaded++;
        }
      }
      
      // 카테고리-세금 링크
      const catTaxLinks = await dbAll(
        'SELECT tax_group_id FROM category_tax_links WHERE category_id = ?',
        [cat.category_id]
      ).catch(() => []);
      
      for (const link of catTaxLinks) {
        const fbTgSnap = await restaurantRef.collection('taxGroups')
          .where('posGroupId', '==', link.tax_group_id).limit(1).get();
        if (!fbTgSnap.empty) {
          const linkId = `${cat.category_id}_${link.tax_group_id}`;
          await restaurantRef.collection('categoryTaxLinks').doc(linkId).set({
            id: linkId,
            categoryId: String(cat.category_id),
            taxGroupId: fbTgSnap.docs[0].id,
            created_at: new Date()
          });
          catTaxLinksUploaded++;
        }
      }
      
      // 카테고리-프린터 링크
      const catPrinterLinks = await dbAll(
        'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
        [cat.category_id]
      ).catch(() => []);
      
      for (const link of catPrinterLinks) {
        const fbPgSnap = await restaurantRef.collection('printerGroups')
          .where('posGroupId', '==', link.printer_group_id).limit(1).get();
        if (!fbPgSnap.empty) {
          const linkId = `${cat.category_id}_${link.printer_group_id}`;
          await restaurantRef.collection('categoryPrinterLinks').doc(linkId).set({
            id: linkId,
            categoryId: String(cat.category_id),
            printerGroupId: fbPgSnap.docs[0].id,
            created_at: new Date()
          });
          catPrinterLinksUploaded++;
        }
      }
    }
    
    console.log(`✅ 업로드 완료 - 카테고리: ${posCategories.length}, 아이템: ${uploadedItems}, 카테고리링크: 모디파이어(${catModLinksUploaded}), 세금(${catTaxLinksUploaded}), 프린터(${catPrinterLinksUploaded})`);
    
    res.json({
      success: true,
      message: 'Menu uploaded to Firebase',
      summary: {
        categoriesUploaded: posCategories.length,
        itemsUploaded: uploadedItems,
        categoryModifierLinksUploaded: catModLinksUploaded,
        categoryTaxLinksUploaded: catTaxLinksUploaded,
        categoryPrinterLinksUploaded: catPrinterLinksUploaded
      },
      backup: {
        id: backupRef.id,
        categoriesBackedUp: backupCategories.length,
        itemsBackedUp: backupItems.length
      }
    });
  } catch (e) {
    console.error('❌ Firebase 업로드 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// 백업 목록 조회
router.get('/backups/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const firestore = firebaseService.getFirestore();
    
    const backupsSnapshot = await firestore
      .collection('menuBackups')
      .where('restaurantId', '==', restaurantId)
      .orderBy('backupDate', 'desc')
      .limit(10)
      .get();
    
    const backups = [];
    backupsSnapshot.forEach(doc => {
      const data = doc.data();
      backups.push({
        id: doc.id,
        backupDate: data.backupDate?.toDate?.() || data.backupDate,
        categoryCount: data.categoryCount,
        itemCount: data.itemCount
      });
    });
    
    res.json({ success: true, backups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 백업에서 복원
router.post('/restore-backup', requireManager, async (req, res) => {
  try {
    const { backupId, restaurantId } = req.body;
    
    if (!backupId || !restaurantId) {
      return res.status(400).json({ error: 'Backup ID and Restaurant ID are required' });
    }
    
    const firestore = firebaseService.getFirestore();
    
    // 백업 데이터 가져오기
    const backupDoc = await firestore.collection('menuBackups').doc(backupId).get();
    
    if (!backupDoc.exists) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    
    const backup = backupDoc.data();
    
    if (backup.restaurantId !== restaurantId) {
      return res.status(403).json({ error: 'Backup does not belong to this restaurant' });
    }
    
    console.log(`🔄 백업 복원 시작: ${backupId}`);
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // 현재 메뉴 삭제 (서브컬렉션에서)
    const currentCats = await restaurantRef
      .collection('menuCategories')
      .get();
    
    const deleteBatch1 = firestore.batch();
    currentCats.forEach(doc => deleteBatch1.delete(doc.ref));
    await deleteBatch1.commit();
    
    const currentItems = await restaurantRef
      .collection('menuItems')
      .get();
    
    const deleteBatch2 = firestore.batch();
    currentItems.forEach(doc => deleteBatch2.delete(doc.ref));
    await deleteBatch2.commit();
    
    // 백업에서 복원 (서브컬렉션에)
    for (const cat of backup.categories || []) {
      const { id, ...catData } = cat;
      await restaurantRef.collection('menuCategories').doc(id).set(catData);
    }
    
    for (const item of backup.items || []) {
      const { id, ...itemData } = item;
      await restaurantRef.collection('menuItems').doc(id).set(itemData);
    }
    
    console.log(`✅ 복원 완료 - 카테고리: ${backup.categoryCount}, 아이템: ${backup.itemCount}`);
    
    res.json({
      success: true,
      message: 'Backup restored successfully',
      restored: {
        categories: backup.categoryCount,
        items: backup.itemCount
      }
    });
  } catch (e) {
    console.error('❌ 복원 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// 동기화 상태 확인 (마지막 동기화 시간 등)
router.get('/sync-status', async (req, res) => {
  try {
    // 카테고리 및 아이템 수 조회
    const categoryCount = await dbGet('SELECT COUNT(*) as count FROM menu_categories WHERE firebase_id IS NOT NULL AND firebase_id != ""');
    const itemCount = await dbGet('SELECT COUNT(*) as count FROM menu_items WHERE firebase_id IS NOT NULL AND firebase_id != ""');
    const totalCategories = await dbGet('SELECT COUNT(*) as count FROM menu_categories');
    const totalItems = await dbGet('SELECT COUNT(*) as count FROM menu_items');
    
    res.json({
      success: true,
      stats: {
        linkedCategories: categoryCount?.count || 0,
        totalCategories: totalCategories?.count || 0,
        linkedItems: itemCount?.count || 0,
        totalItems: totalItems?.count || 0
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 온라인 주문 아이템을 POS 아이템으로 변환
router.post('/convert-online-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }
    
    // Firebase에서 주문 가져오기
    const order = await firebaseService.getOrderById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found in Firebase' });
    }
    
    console.log(`🔄 온라인 주문 변환 시작: ${order.orderNumber || orderId}`);
    
    const convertedItems = [];
    const unmatchedItems = [];
    
    for (const item of (order.items || [])) {
      // firebase_id로 POS 아이템 찾기
      let posItem = null;
      
      if (item.menuItemId) {
        posItem = await dbGet(
          'SELECT * FROM menu_items WHERE firebase_id = ?',
          [item.menuItemId]
        );
      }
      
      // 이름으로 찾기 (fallback)
      if (!posItem && item.name) {
        posItem = await dbGet(
          'SELECT * FROM menu_items WHERE name = ?',
          [item.name]
        );
      }
      
      if (posItem) {
        convertedItems.push({
          item_id: posItem.item_id,
          name: posItem.name,
          price: posItem.price,
          quantity: item.quantity || 1,
          firebase_item: item,
          options: item.options || [],
          subtotal: (posItem.price * (item.quantity || 1))
        });
        console.log(`✅ 매칭: ${item.name} → ${posItem.item_id}`);
      } else {
        // 매칭 실패 - 원본 데이터 사용
        unmatchedItems.push({
          name: item.name,
          price: item.price || 0,
          quantity: item.quantity || 1,
          firebase_item: item,
          options: item.options || [],
          subtotal: item.subtotal || (item.price * (item.quantity || 1))
        });
        console.warn(`⚠️ 매칭 실패: ${item.name}`);
      }
    }
    
    res.json({
      success: true,
      order: {
        firebaseOrderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        orderType: order.orderType,
        status: order.status,
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
        notes: order.notes,
        createdAt: order.createdAt?.toDate?.() || order.createdAt
      },
      convertedItems,
      unmatchedItems,
      summary: {
        totalItems: (order.items || []).length,
        matched: convertedItems.length,
        unmatched: unmatchedItems.length
      }
    });
  } catch (e) {
    console.error('❌ 온라인 주문 변환 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// POS 메뉴 아이템과 Firebase 아이템 매칭 조회
router.get('/menu-mapping', async (req, res) => {
  try {
    const items = await dbAll(`
      SELECT item_id, name, price, firebase_id, category_id 
      FROM menu_items 
      ORDER BY name
    `);
    
    const linkedCount = items.filter(i => i.firebase_id).length;
    
    res.json({
      success: true,
      items,
      summary: {
        total: items.length,
        linked: linkedCount,
        unlinked: items.length - linkedCount
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 프린터 그룹 이름을 Firebase에 업로드
// ============================================
router.post('/upload-printer-groups', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    console.log(`📤 Uploading printer groups to Firebase for restaurant: ${restaurantId}`);

    // POS에서 프린터 그룹 가져오기
    const printerGroups = await dbAll(`
      SELECT printer_group_id as id, name FROM printer_groups WHERE is_active = 1 ORDER BY name
    `);

    console.log(`Found ${printerGroups.length} printer groups in POS`);

    // Firebase에서 기존 프린터 그룹 삭제 (서브컬렉션에서)
    const existingGroups = await restaurantRef
      .collection('printerGroups')
      .get();

    const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    console.log(`Deleted ${existingGroups.size} existing printer groups from Firebase`);

    // 새 프린터 그룹 업로드 (서브컬렉션에)
    const uploadedGroups = [];
    for (const group of printerGroups) {
      const docRef = await restaurantRef.collection('printerGroups').add({
        restaurantId,
        name: group.name,
        type: 'kitchen',
        printers: [],
        posGroupId: group.id,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE printer_groups SET firebase_id = ? WHERE printer_group_id = ?',
        [docRef.id, group.id]
      );
      
      uploadedGroups.push({ id: docRef.id, name: group.name, posGroupId: group.id });
    }

    console.log(`✅ Uploaded ${uploadedGroups.length} printer groups to Firebase`);

    res.json({
      success: true,
      message: `Uploaded ${uploadedGroups.length} printer groups`,
      uploadedGroups
    });
  } catch (e) {
    console.error('❌ Failed to upload printer groups:', e);
    res.status(500).json({ error: e.message });
  }
});

// 프린터 그룹 목록 조회 (Firebase 서브컬렉션에서)
router.get('/printer-groups/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    const snapshot = await restaurantRef
      .collection('printerGroups')
      .get();

    const groups = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ success: true, groups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 프린터 그룹 다운로드 (Firebase → POS)
// ============================================
router.post('/download-printer-groups', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    console.log(`📥 Downloading printer groups from Firebase for restaurant: ${restaurantId}`);

    // Firebase에서 프린터 그룹 가져오기 (서브컬렉션에서)
    const snapshot = await restaurantRef
      .collection('printerGroups')
      .get();

    const firebasePrinterGroups = [];
    snapshot.forEach(doc => {
      firebasePrinterGroups.push({ id: doc.id, ...doc.data() });
    });

    console.log(`Found ${firebasePrinterGroups.length} printer groups in Firebase`);

    let createdGroups = 0;
    let updatedGroups = 0;

    for (const fbGroup of firebasePrinterGroups) {
      // POS에서 같은 이름의 프린터 그룹 찾기
      let posGroup = await dbGet(
        'SELECT printer_group_id as id, name FROM printer_groups WHERE name = ? AND is_active = 1',
        [fbGroup.name]
      );

      if (!posGroup) {
        // 새 프린터 그룹 생성
        const result = await dbRun(
          'INSERT INTO printer_groups (name, is_active, firebase_id) VALUES (?, 1, ?)',
          [fbGroup.name, fbGroup.id]
        );
        posGroup = { id: result.lastID, name: fbGroup.name };
        createdGroups++;
        console.log(`➕ Created printer group: ${fbGroup.name}`);
      } else {
        // firebase_id 업데이트
        await dbRun('UPDATE printer_groups SET firebase_id = ? WHERE printer_group_id = ?', [fbGroup.id, posGroup.id]);
        updatedGroups++;
        console.log(`🔄 Found existing printer group: ${fbGroup.name}`);
      }
      
      // id_mappings 업데이트
      await idMapperService.ensureMapping('printer_group', posGroup.id, fbGroup.id);
    }

    console.log(`✅ Download complete - Groups: ${createdGroups} created, ${updatedGroups} updated`);

    res.json({
      success: true,
      message: 'Printer groups downloaded from Firebase',
      summary: {
        groupsCreated: createdGroups,
        groupsUpdated: updatedGroups,
        totalGroups: firebasePrinterGroups.length
      }
    });
  } catch (e) {
    console.error('❌ Failed to download printer groups:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 세금 그룹 업로드 (POS → Firebase)
// ============================================
router.post('/upload-tax-groups', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    console.log(`📤 Uploading tax groups to Firebase for restaurant: ${restaurantId}`);

    // POS에서 세금 그룹 가져오기 (개별 세금 포함)
    const taxGroups = await dbAll(`
      SELECT tax_group_id as id, name FROM tax_groups WHERE is_deleted = 0 ORDER BY name
    `);

    // 각 그룹의 개별 세금 정보 가져오기
    for (const group of taxGroups) {
      const taxes = await dbAll(`
        SELECT t.tax_id as id, t.name, t.rate 
        FROM tax_group_links tgl 
        JOIN taxes t ON tgl.tax_id = t.tax_id 
        WHERE tgl.tax_group_id = ? AND t.is_deleted = 0
      `, [group.id]);
      group.taxes = taxes;
    }

    console.log(`Found ${taxGroups.length} tax groups in POS`);

    // Firebase에서 기존 세금 그룹 삭제 (서브컬렉션에서)
    const existingGroups = await restaurantRef
      .collection('taxGroups')
      .get();

    const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    console.log(`Deleted ${existingGroups.size} existing tax groups from Firebase`);

    // 새 세금 그룹 업로드 (서브컬렉션에)
    const uploadedGroups = [];
    for (const group of taxGroups) {
      const docRef = await restaurantRef.collection('taxGroups').add({
        restaurantId,
        name: group.name,
        taxes: group.taxes.map(t => ({ name: t.name, rate: t.rate })),
        posGroupId: group.id,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE tax_groups SET firebase_id = ? WHERE tax_group_id = ?',
        [docRef.id, group.id]
      );
      
      uploadedGroups.push({ id: docRef.id, name: group.name, taxCount: group.taxes.length });
    }

    console.log(`✅ Uploaded ${uploadedGroups.length} tax groups to Firebase`);

    res.json({
      success: true,
      message: `Uploaded ${uploadedGroups.length} tax groups`,
      uploadedGroups
    });
  } catch (e) {
    console.error('❌ Failed to upload tax groups:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 세금 그룹 다운로드 (Firebase → POS)
// ============================================
router.post('/download-tax-groups', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    console.log(`📥 Downloading tax groups from Firebase for restaurant: ${restaurantId}`);

    // Firebase에서 세금 그룹 가져오기 (서브컬렉션에서)
    const snapshot = await restaurantRef
      .collection('taxGroups')
      .get();

    const firebaseTaxGroups = [];
    snapshot.forEach(doc => {
      firebaseTaxGroups.push({ id: doc.id, ...doc.data() });
    });

    console.log(`Found ${firebaseTaxGroups.length} tax groups in Firebase`);

    let createdGroups = 0;
    let updatedGroups = 0;
    let createdTaxes = 0;

    for (const fbGroup of firebaseTaxGroups) {
      // POS에서 같은 이름의 세금 그룹 찾기
      let posGroup = await dbGet(
        'SELECT tax_group_id as id, name FROM tax_groups WHERE name = ? AND is_deleted = 0',
        [fbGroup.name]
      );

      if (!posGroup) {
        // 새 세금 그룹 생성
        const result = await dbRun(
          'INSERT INTO tax_groups (name, is_deleted, firebase_id) VALUES (?, 0, ?)',
          [fbGroup.name, fbGroup.id]
        );
        posGroup = { id: result.lastID, name: fbGroup.name };
        createdGroups++;
        console.log(`➕ Created tax group: ${fbGroup.name}`);
      } else {
        // firebase_id 업데이트
        await dbRun('UPDATE tax_groups SET firebase_id = ? WHERE tax_group_id = ?', [fbGroup.id, posGroup.id]);
        updatedGroups++;
        console.log(`🔄 Found existing tax group: ${fbGroup.name}`);
      }
      
      // id_mappings 업데이트
      await idMapperService.ensureMapping('tax_group', posGroup.id, fbGroup.id);

      // 기존 링크 삭제
      await dbRun('DELETE FROM tax_group_links WHERE tax_group_id = ?', [posGroup.id]);

      // 개별 세금 처리
      for (const fbTax of (fbGroup.taxes || [])) {
        // POS에서 같은 이름의 세금 찾기
        let posTax = await dbGet(
          'SELECT tax_id as id FROM taxes WHERE name = ? AND is_deleted = 0',
          [fbTax.name]
        );

        if (!posTax) {
          // 새 세금 생성
          const result = await dbRun(
            'INSERT INTO taxes (name, rate, is_deleted) VALUES (?, ?, 0)',
            [fbTax.name, fbTax.rate || 0]
          );
          posTax = { id: result.lastID };
          createdTaxes++;
          console.log(`➕ Created tax: ${fbTax.name} (${fbTax.rate}%)`);
        } else {
          // 기존 세금 업데이트
          await dbRun(
            'UPDATE taxes SET rate = ? WHERE tax_id = ?',
            [fbTax.rate || 0, posTax.id]
          );
        }

        // 그룹에 세금 연결
        await dbRun(
          'INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)',
          [posGroup.id, posTax.id]
        );
      }
    }

    console.log(`✅ Download complete - Groups: ${createdGroups} created, ${updatedGroups} updated, Taxes: ${createdTaxes} created`);

    res.json({
      success: true,
      message: 'Tax groups downloaded from Firebase',
      summary: {
        groupsCreated: createdGroups,
        groupsUpdated: updatedGroups,
        taxesCreated: createdTaxes,
        totalGroups: firebaseTaxGroups.length
      }
    });
  } catch (e) {
    console.error('❌ Failed to download tax groups:', e);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// MODIFIER GROUP SYNC APIs (POS ↔ Firebase)
// =====================================================

// Upload Modifier Groups (POS → Firebase)
router.post('/upload-modifier-groups', requireManager, async (req, res) => {
  try {
    const { restaurantId, menuId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    const admin = require('firebase-admin');
    
    console.log(`📤 Uploading Modifier Groups to Firebase: ${restaurantId}`);
    
    // 1. POS에서 Modifier 그룹 가져오기
    let posModifierGroups;
    if (menuId) {
      posModifierGroups = await dbAll(
        'SELECT * FROM modifier_groups WHERE menu_id = ? AND is_deleted = 0 ORDER BY name',
        [menuId]
      );
    } else {
      posModifierGroups = await dbAll(
        'SELECT * FROM modifier_groups WHERE is_deleted = 0 ORDER BY name'
      );
    }
    
    // 2. 각 그룹의 옵션(modifiers) 가져오기
    for (const group of posModifierGroups) {
      const modifiers = await dbAll(
        `SELECT m.modifier_id, m.name, m.price_delta as price_adjustment, m.price_delta2 as price_adjustment_2, m.sort_order
         FROM modifiers m
         JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
         WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
         ORDER BY m.sort_order`,
        [group.modifier_group_id]
      );
      group.modifiers = modifiers;
      
      // 라벨 가져오기
      const labels = await dbAll(
        'SELECT label_id, label_name as name FROM modifier_labels WHERE modifier_group_id = ?',
        [group.modifier_group_id]
      );
      group.labels = labels;
    }
    
    console.log(`📦 POS Modifier Groups: ${posModifierGroups.length}`);
    
    // 3. 기존 Firebase Modifier 그룹 삭제 (서브컬렉션에서)
    const existingGroups = await restaurantRef
      .collection('modifierGroups')
      .get();
    
    const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    console.log(`🗑️ Deleted ${existingGroups.size} existing Firebase Modifier Groups`);
    
    // 4. 새 Modifier 그룹 업로드 (서브컬렉션에)
    const uploadedGroups = [];
    for (const group of posModifierGroups) {
      const docRef = await restaurantRef.collection('modifierGroups').add({
        restaurantId,
        name: group.name,
        label: group.labels && group.labels.length > 0 ? group.labels[0].name : '',
        min_selection: group.min_selection || 0,
        max_selection: group.max_selection || 0,
        selection_type: group.selection_type || 'OPTIONAL',
        modifiers: group.modifiers.map((m, idx) => ({
          id: `mod-${Date.now()}-${idx}`,
          name: m.name,
          price_adjustment: m.price_adjustment || 0,
          price_adjustment_2: m.price_adjustment_2 || 0
        })),
        posGroupId: group.modifier_group_id,
        sortOrder: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE modifier_groups SET firebase_id = ? WHERE modifier_group_id = ?',
        [docRef.id, group.modifier_group_id]
      );
      
      uploadedGroups.push({ id: docRef.id, name: group.name, modifierCount: group.modifiers.length });
      console.log(`✅ Uploaded Modifier Group: ${group.name} (${group.modifiers.length} modifiers)`);
    }
    
    res.json({
      success: true,
      message: `Uploaded ${uploadedGroups.length} Modifier Groups to Firebase`,
      uploadedGroups
    });
  } catch (e) {
    console.error('❌ Failed to upload modifier groups:', e);
    res.status(500).json({ error: e.message });
  }
});

// Download Modifier Groups (Firebase → POS)
router.post('/download-modifier-groups', requireManager, async (req, res) => {
  try {
    const { restaurantId, menuId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    const { generateNextId, ID_RANGES } = require('../utils/idGenerator');
    
    console.log(`📥 Downloading Modifier Groups from Firebase: ${restaurantId}`);
    
    // 1. Firebase에서 Modifier 그룹 가져오기 (서브컬렉션에서)
    const snapshot = await restaurantRef
      .collection('modifierGroups')
      .get();
    
    const firebaseModifierGroups = [];
    snapshot.forEach(doc => {
      firebaseModifierGroups.push({ id: doc.id, ...doc.data() });
    });
    
    console.log(`📦 Firebase Modifier Groups: ${firebaseModifierGroups.length}`);
    
    let createdGroups = 0;
    let updatedGroups = 0;
    let createdModifiers = 0;
    
    for (const fbGroup of firebaseModifierGroups) {
      // POS에서 기존 그룹 찾기 (이름 + 라벨로 매칭)
      const searchLabel = fbGroup.label || '';
      let posGroup;
      
      if (searchLabel) {
        // 라벨이 있으면 이름 + 라벨로 찾기
        posGroup = await dbGet(`
          SELECT mg.* FROM modifier_groups mg
          LEFT JOIN modifier_labels ml ON mg.modifier_group_id = ml.modifier_group_id
          WHERE mg.name = ? AND ml.label_name = ? AND mg.is_deleted = 0
        `, [fbGroup.name, searchLabel]);
      } else {
        // 라벨이 없으면 이름으로만 찾기
        posGroup = await dbGet(
          'SELECT * FROM modifier_groups WHERE name = ? AND is_deleted = 0',
          [fbGroup.name]
        );
      }
      
      const targetMenuId = menuId || 200000;
      
      if (posGroup) {
        // 기존 그룹 업데이트
        await dbRun(
          `UPDATE modifier_groups SET 
            selection_type = ?, min_selection = ?, max_selection = ?, firebase_id = ?
          WHERE modifier_group_id = ?`,
          [fbGroup.selection_type || 'OPTIONAL', fbGroup.min_selection || 0, fbGroup.max_selection || 0, fbGroup.id, posGroup.modifier_group_id]
        );
        
        // modifier_labels 갱신 (Firebase 라벨 → POS 라벨 동기화)
        const fbLabel = fbGroup.label || '';
        // 기존 라벨 삭제 후 새 라벨 삽입 (라벨이 있는 경우)
        await dbRun('DELETE FROM modifier_labels WHERE modifier_group_id = ?', [posGroup.modifier_group_id]).catch(() => {});
        if (fbLabel) {
          const { generateNextId, ID_RANGES } = require('../utils/idGenerator');
          const newLabelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
          await dbRun(
            'INSERT INTO modifier_labels (label_id, modifier_group_id, label_name) VALUES (?, ?, ?)',
            [newLabelId, posGroup.modifier_group_id, fbLabel]
          );
        }
        
        // 기존 모디파이어를 is_deleted = 1로 마킹 (고아 데이터 방지)
        const oldLinks = await dbAll('SELECT modifier_id FROM modifier_group_links WHERE modifier_group_id = ?', [posGroup.modifier_group_id]);
        for (const oldLink of oldLinks) {
          await dbRun('UPDATE modifiers SET is_deleted = 1 WHERE modifier_id = ?', [oldLink.modifier_id]);
        }
        
        // 기존 옵션 링크 삭제
        await dbRun('DELETE FROM modifier_group_links WHERE modifier_group_id = ?', [posGroup.modifier_group_id]);
        
        // 새 옵션 추가
        for (let i = 0; i < (fbGroup.modifiers || []).length; i++) {
          const mod = fbGroup.modifiers[i];
          const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
          
          await dbRun(
            'INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [newModifierId, mod.name, mod.price_adjustment || 0, mod.price_adjustment_2 || 0, 'OPTION', i + 1]
          );
          
          await dbRun(
            'INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)',
            [posGroup.modifier_group_id, newModifierId]
          );
          createdModifiers++;
        }
        
        // id_mappings 업데이트
        await idMapperService.ensureMapping('modifier_group', posGroup.modifier_group_id, fbGroup.id);
        
        updatedGroups++;
        console.log(`✅ Updated Modifier Group: ${fbGroup.name}`);
      } else {
        // 새 그룹 생성
        const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
        
        await dbRun(
          'INSERT INTO modifier_groups (modifier_group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted, firebase_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
          [newGroupId, fbGroup.name, fbGroup.selection_type || 'OPTIONAL', fbGroup.min_selection || 0, fbGroup.max_selection || 0, targetMenuId, fbGroup.id]
        );
        
        // 라벨 추가
        if (fbGroup.label) {
          const labelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
          await dbRun(
            'INSERT INTO modifier_labels (label_id, modifier_group_id, label_name) VALUES (?, ?, ?)',
            [labelId, newGroupId, fbGroup.label]
          );
        }
        
        // 옵션 추가
        for (let i = 0; i < (fbGroup.modifiers || []).length; i++) {
          const mod = fbGroup.modifiers[i];
          const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
          
          await dbRun(
            'INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [newModifierId, mod.name, mod.price_adjustment || 0, mod.price_adjustment_2 || 0, 'OPTION', i + 1]
          );
          
          await dbRun(
            'INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)',
            [newGroupId, newModifierId]
          );
          createdModifiers++;
        }
        
        // id_mappings 업데이트
        await idMapperService.ensureMapping('modifier_group', newGroupId, fbGroup.id);
        
        createdGroups++;
        console.log(`➕ Created Modifier Group: ${fbGroup.name}`);
      }
    }
    
    console.log(`✅ Download complete - Groups: ${createdGroups} created, ${updatedGroups} updated, Modifiers: ${createdModifiers} created`);
    
    res.json({
      success: true,
      message: 'Modifier groups downloaded from Firebase',
      summary: {
        groupsCreated: createdGroups,
        groupsUpdated: updatedGroups,
        modifiersCreated: createdModifiers,
        totalGroups: firebaseModifierGroups.length
      }
    });
  } catch (e) {
    console.error('❌ Failed to download modifier groups:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// POS → Firebase 전체 메뉴 동기화 (TZO Cloud 형식)
// ============================================
// 업로드 순서:
// 1. 모디파이어 그룹  2. 세금 그룹  3. 프린터 그룹
// 4. 카테고리  5. 메뉴 아이템
// 6. 카테고리-모디파이어 연결  7. 아이템-모디파이어 연결
// 8. 카테고리-세금 연결  9. 아이템-세금 연결
// 10. 카테고리-프린터 연결  11. 아이템-프린터 연결
router.post('/full-sync-to-firebase', requireManager, async (req, res) => {
  let syncId = null;
  const syncStats = {
    totalItems: 0,
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    errorCount: 0,
    errors: []
  };
  
  try {
    const { restaurantId, menuId, deleteExisting = true, skipImages = false } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    if (!menuId) {
      return res.status(400).json({ error: 'Menu ID is required' });
    }
    
    // 동기화 로그 시작
    syncId = await SyncLogService.startSync({
      syncType: SYNC_TYPE.FULL,
      direction: SYNC_DIRECTION.UPLOAD,
      entityType: 'all',
      initiatedBy: 'user'
    });
    
    const firestore = firebaseService.getFirestore();
    
    console.log(`🔄 POS → Firebase 전체 동기화 시작 [${syncId.substring(0, 8)}...]`);
    console.log(`   Restaurant: ${restaurantId}`);
    console.log(`   Menu ID: ${menuId}`);
    
    // 0. 기존 항목에 UUID 매핑 생성 (없는 경우)
    await idMapperService.syncExistingItems();
    
    // 1. POS에서 메뉴 정보 가져오기
    const posMenu = await dbGet('SELECT * FROM menus WHERE menu_id = ?', [menuId]);
    if (!posMenu) {
      return res.status(404).json({ error: 'Menu not found in POS' });
    }
    
    console.log(`📦 POS 메뉴: ${posMenu.name}`);
    
    // 2. POS 카테고리 가져오기
    const posCategories = await dbAll(
      'SELECT * FROM menu_categories WHERE menu_id = ? ORDER BY sort_order',
      [menuId]
    );
    
    // 3. POS 아이템 가져오기
    const categoryIds = posCategories.map(c => c.category_id);
    let posItems = [];
    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map(() => '?').join(',');
      posItems = await dbAll(
        `SELECT * FROM menu_items WHERE category_id IN (${placeholders}) ORDER BY category_id, sort_order`,
        categoryIds
      );
    }
    
    console.log(`📦 POS 카테고리: ${posCategories.length}개, 아이템: ${posItems.length}개`);
    
    // 4. Firebase에서 기존 데이터 백업 및 삭제 (옵션)
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // ★ 안전장치: Firebase 기존 데이터 백업 (실패 시 복원용)
    let firebaseBackupRef = null;
    const firebaseBackupData = { restaurantId, backupDate: new Date(), categories: [], items: [], menus: [] };
    try {
      const [catSnap, itemSnap, menuSnap] = await Promise.all([
        restaurantRef.collection('menuCategories').get(),
        restaurantRef.collection('menuItems').get(),
        restaurantRef.collection('menus').get()
      ]);
      catSnap.forEach(doc => firebaseBackupData.categories.push({ id: doc.id, ...doc.data() }));
      itemSnap.forEach(doc => firebaseBackupData.items.push({ id: doc.id, ...doc.data() }));
      menuSnap.forEach(doc => firebaseBackupData.menus.push({ id: doc.id, ...doc.data() }));
      
      firebaseBackupRef = await firestore.collection('menuBackups').add({
        ...firebaseBackupData,
        backupType: 'pre_full_sync',
        categoryCount: firebaseBackupData.categories.length,
        itemCount: firebaseBackupData.items.length,
        menuCount: firebaseBackupData.menus.length
      });
      console.log(`💾 Firebase 기존 데이터 백업 완료 (ID: ${firebaseBackupRef.id}) - 카테고리: ${firebaseBackupData.categories.length}, 아이템: ${firebaseBackupData.items.length}, 메뉴: ${firebaseBackupData.menus.length}`);
    } catch (backupErr) {
      console.warn('⚠️ Firebase 백업 생성 실패 (동기화는 계속 진행):', backupErr.message);
    }

    // skipImages: 기존 Firebase 이미지를 보존하기 위해 posId 기준으로 이미지 맵 구축
    const fbCatImageMap = {};
    const fbItemImageMap = {};
    if (skipImages) {
      for (const cat of firebaseBackupData.categories) {
        const imgUrl = cat.imageUrl || cat.image_url || '';
        if (imgUrl && cat.posId) {
          fbCatImageMap[cat.posId] = imgUrl;
        }
      }
      for (const item of firebaseBackupData.items) {
        const imgUrl = item.imageUrl || item.image_url || '';
        if (imgUrl && item.posId) {
          fbItemImageMap[item.posId] = imgUrl;
        }
      }
      console.log(`🖼️ skipImages=true: 기존 Firebase 이미지 보존 (카테고리: ${Object.keys(fbCatImageMap).length}개, 아이템: ${Object.keys(fbItemImageMap).length}개)`);
    }
    
    if (deleteExisting) {
      // Hard reset: remove all menus/categories/items in TZO Cloud to avoid duplication
      const purgeCollection = async (collectionName) => {
        const snap = await restaurantRef.collection(collectionName).get();
        for (const doc of snap.docs) {
          await doc.ref.delete();
        }
        console.log(`🗑️ ${collectionName} 전체 삭제: ${snap.size}개`);
      };
      
      await purgeCollection('menuCategories');
      await purgeCollection('menuItems');
      await purgeCollection('menus');

      const candidateMenuIdValues = new Set();
      const addCandidate = (value) => {
        if (value === undefined || value === null || value === '') return;
        candidateMenuIdValues.add(value);
      };
      addCandidate(menuId);
      const numericMenuId = Number(menuId);
      if (!Number.isNaN(numericMenuId)) addCandidate(numericMenuId);
      if (posMenu?.firebase_id) addCandidate(posMenu.firebase_id);
      
      const deleteMenuDocAndChildren = async (menuDoc) => {
        console.log(`🗑️ 기존 메뉴 삭제: ${menuDoc.data().name}`);
        
        const existingCats = await restaurantRef.collection('menuCategories')
          .where('menuId', '==', menuDoc.id)
          .get();
        for (const catDoc of existingCats.docs) {
          await catDoc.ref.delete();
        }
        
        const existingItems = await restaurantRef.collection('menuItems')
          .where('menuId', '==', menuDoc.id)
          .get();
        for (const itemDoc of existingItems.docs) {
          await itemDoc.ref.delete();
        }
        
        await menuDoc.ref.delete();
      };
      
      const menuDocs = new Map();
      const posIdQueries = [
        restaurantRef.collection('menus').where('posId', '==', menuId),
        restaurantRef.collection('menus').where('posId', '==', Number(menuId))
      ];
      for (const q of posIdQueries) {
        const snap = await q.get();
        snap.docs.forEach(doc => menuDocs.set(doc.id, doc));
      }
      
      const nameSnap = await restaurantRef.collection('menus')
        .where('name', '==', posMenu.name)
        .get();
      nameSnap.docs.forEach(doc => menuDocs.set(doc.id, doc));
      
      for (const menuDoc of menuDocs.values()) {
        await deleteMenuDocAndChildren(menuDoc);
        addCandidate(menuDoc.id);
      }
      
      // Delete menu docs by known IDs (firebase_id or previous ids)
      for (const candidateId of candidateMenuIdValues) {
        if (typeof candidateId !== 'string') continue;
        const menuDoc = await restaurantRef.collection('menus').doc(candidateId).get();
        if (menuDoc.exists) {
          await deleteMenuDocAndChildren(menuDoc);
        }
      }
      
      // Legacy cleanup: menuId stored as POS menuId or previous firebase_id
      for (const candidateId of candidateMenuIdValues) {
        const legacyCats = await restaurantRef.collection('menuCategories')
          .where('menuId', '==', candidateId)
          .get();
        for (const catDoc of legacyCats.docs) {
          await catDoc.ref.delete();
        }
        
        const legacyItems = await restaurantRef.collection('menuItems')
          .where('menuId', '==', candidateId)
          .get();
        for (const itemDoc of legacyItems.docs) {
          await itemDoc.ref.delete();
        }
      }
    }
    
    // 5. Firebase에 메뉴 생성
    const menuDocRef = await restaurantRef.collection('menus').add({
      name: posMenu.name,
      description: posMenu.description || '',
      sales_channels: JSON.parse(posMenu.sales_channels || '["thezoneorder"]'),
      is_active: posMenu.is_active === 1 ? 1 : 0,
      posId: menuId, // POS 메뉴 ID 저장
      created_at: new Date(),
      updated_at: new Date()
    });
    
    const firebaseMenuId = menuDocRef.id;
    console.log(`✅ Firebase 메뉴 생성: ${posMenu.name} (ID: ${firebaseMenuId})`);
    
    // POS에 firebase_menu_id 저장
    await dbRun(
      'UPDATE menus SET firebase_id = ? WHERE menu_id = ?',
      [firebaseMenuId, menuId]
    );
    
    // 5.5. 모디파이어 그룹 업로드 (서브컬렉션에 저장)
    console.log(`📤 모디파이어 그룹 업로드 중...`);
    const modifierGroupMapping = {}; // pos_group_id -> firebase_group_id
    
    // 기존 modifierGroups 삭제
    const existingModGroups = await restaurantRef.collection('modifierGroups').get();
    for (const doc of existingModGroups.docs) {
      await doc.ref.delete();
    }
    
    // POS에서 모디파이어 그룹 가져오기 (테이블이 없을 수 있음)
    let posModifierGroups = [];
    try {
      posModifierGroups = await dbAll(
        'SELECT * FROM modifier_groups WHERE menu_id = ? AND is_deleted = 0 ORDER BY name',
        [menuId]
      );
    } catch (e) {
      console.log(`   ⚠️ modifier_groups 테이블 없음 - 건너뜀`);
    }
    
    console.log(`   📋 POS 모디파이어 그룹: ${posModifierGroups.length}개`);
    
    for (const group of posModifierGroups) {
      if (!group.modifier_group_id) {
        console.log(`   ⚠️ modifier_group_id 없음, 건너뜀:`, group.name);
        continue;
      }
      
      // 각 그룹의 모디파이어(옵션) 가져오기
      let modifiers = [];
      try {
        modifiers = await dbAll(
          `SELECT m.modifier_id, m.name, m.price_delta as price_adjustment, m.price_delta2 as price_adjustment_2, m.sort_order
           FROM modifiers m
           JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
           WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
           ORDER BY m.sort_order`,
          [group.modifier_group_id]
        );
      } catch (e) {
        console.log(`   ⚠️ modifiers 테이블 없음`);
      }
      
      // 실제 modifier_labels 테이블에서 라벨 조회
      let groupLabel = '';
      try {
        const labelRow = await dbGet(
          'SELECT label_name FROM modifier_labels WHERE modifier_group_id = ? LIMIT 1',
          [group.modifier_group_id]
        );
        groupLabel = labelRow ? labelRow.label_name : '';
      } catch (e) {
        // modifier_labels 테이블 없으면 무시
      }
      
      const modGroupDocRef = await restaurantRef.collection('modifierGroups').add({
        name: group.name || 'Unknown',
        label: groupLabel,
        min_selection: group.min_selection || 0,
        max_selection: group.max_selection || 0,
        selection_type: group.selection_type || 'OPTIONAL',
        modifiers: modifiers.map((m) => ({
          id: `mod-${m.modifier_id || 0}`,
          name: m.name || '',
          price_adjustment: m.price_adjustment || 0,
          price_adjustment_2: m.price_adjustment_2 || 0
        })),
        posGroupId: group.modifier_group_id,
        sortOrder: 0,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE modifier_groups SET firebase_id = ? WHERE modifier_group_id = ?',
        [modGroupDocRef.id, group.modifier_group_id]
      );
      
      modifierGroupMapping[group.modifier_group_id] = modGroupDocRef.id;
      console.log(`  ✅ 모디파이어 그룹: ${group.name} (${modifiers.length}개 옵션)`);
    }
    
    // 6. 세금 그룹 업로드
    console.log(`📤 세금 그룹 업로드 중...`);
    const taxGroupMapping = {}; // pos_tax_group_id -> firebase_tax_group_id
    
    // 기존 taxGroups 삭제
    const existingTaxGroups = await restaurantRef.collection('taxGroups').get();
    for (const doc of existingTaxGroups.docs) {
      await doc.ref.delete();
    }
    
    // tax_groups 테이블에서 세금 그룹 가져오기
    const posTaxGroups = await dbAll(
      'SELECT * FROM tax_groups WHERE is_deleted = 0 ORDER BY name'
    ).catch(() => []);
    
    // 디버깅: 첫 번째 세금 그룹 구조 확인
    if (posTaxGroups.length > 0) {
      console.log(`   📋 첫 번째 세금 그룹 데이터:`, posTaxGroups[0]);
    }
    
    for (const taxGroup of posTaxGroups) {
      // tax_group_id가 undefined인 경우 건너뛰기
      if (!taxGroup.tax_group_id) {
        console.log(`  ⚠️ 세금 그룹 ID 없음: ${taxGroup.name}`);
        continue;
      }
      
      // 세금 그룹에 연결된 세금 항목들 가져오기
      // tax_group_links 테이블: tax_group_id, tax_id
      // taxes 테이블: tax_id, name, rate
      const taxes = await dbAll(
        `SELECT t.* FROM taxes t
         JOIN tax_group_links tgl ON t.tax_id = tgl.tax_id
         WHERE tgl.tax_group_id = ? AND t.is_deleted = 0
         ORDER BY t.name`,
        [taxGroup.tax_group_id]
      ).catch(() => []);
      
      // 총 세율 계산
      const totalRate = taxes.reduce((sum, t) => sum + (t.rate || 0), 0);
      console.log(`   📋 세금 그룹 ${taxGroup.name}: ${taxes.length}개 세금, 총 ${totalRate}%`);
      
      const docRef = await restaurantRef.collection('taxGroups').add({
        name: taxGroup.name || 'Unknown',
        description: '',
        rate: totalRate,
        taxes: taxes.map(t => ({
          id: t.tax_id || 0,
          name: t.name || '',
          displayName: t.name || '',
          rate: t.rate || 0,
          type: 'percentage'
        })),
        posGroupId: taxGroup.tax_group_id,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE tax_groups SET firebase_id = ? WHERE tax_group_id = ?',
        [docRef.id, taxGroup.tax_group_id]
      );
      
      taxGroupMapping[taxGroup.tax_group_id] = docRef.id;
      console.log(`  ✅ 세금 그룹: ${taxGroup.name} (${totalRate}%)`);
    }
    console.log(`   📋 POS 세금 그룹: ${posTaxGroups.length}개`);
    
    // 6.5. 프린터 그룹 업로드
    console.log(`📤 프린터 그룹 업로드 중...`);
    const printerGroupMapping = {}; // pos_printer_group_id -> firebase_printer_group_id
    
    // 기존 printerGroups 삭제
    const existingPrinterGroups = await restaurantRef.collection('printerGroups').get();
    for (const doc of existingPrinterGroups.docs) {
      await doc.ref.delete();
    }
    
    // printer_groups 테이블에서 프린터 그룹 가져오기 (is_active = 1)
    const posPrinterGroups = await dbAll(
      'SELECT * FROM printer_groups WHERE is_active = 1 ORDER BY name'
    ).catch(() => []);
    
    // 디버깅: 첫 번째 프린터 그룹 구조 확인
    if (posPrinterGroups.length > 0) {
      console.log(`   📋 첫 번째 프린터 그룹 데이터:`, posPrinterGroups[0]);
    }
    
    for (const printerGroup of posPrinterGroups) {
      // printer_group_id가 undefined인 경우 건너뛰기
      if (!printerGroup.printer_group_id) {
        console.log(`  ⚠️ 프린터 그룹 ID 없음: ${printerGroup.name}`);
        continue;
      }
      
      const docRef = await restaurantRef.collection('printerGroups').add({
        name: printerGroup.name,
        printerType: 'kitchen',
        posGroupId: printerGroup.printer_group_id,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE printer_groups SET firebase_id = ? WHERE printer_group_id = ?',
        [docRef.id, printerGroup.printer_group_id]
      );
      
      printerGroupMapping[printerGroup.printer_group_id] = docRef.id;
      console.log(`  ✅ 프린터 그룹: ${printerGroup.name}`);
    }
    console.log(`   📋 POS 프린터 그룹: ${posPrinterGroups.length}개`);
    
    // 7. 카테고리 업로드
    const categoryMapping = {}; // pos_category_id -> firebase_category_id
    
    for (let i = 0; i < posCategories.length; i++) {
      const cat = posCategories[i];
      const catImageUrl = skipImages && fbCatImageMap[cat.category_id] ? fbCatImageMap[cat.category_id] : (cat.image_url || '');
      const catDocRef = await restaurantRef.collection('menuCategories').add({
        menuId: firebaseMenuId,
        name: cat.name,
        description: cat.description || '',
        imageUrl: catImageUrl,
        image_url: catImageUrl,
        sort_order: cat.sort_order || i,
        sortOrder: cat.sort_order || i, // 호환성
        is_active: 1,
        isActive: true,
        posId: cat.category_id, // POS 카테고리 ID 저장
        created_at: new Date(),
        updated_at: new Date()
      });
      
      categoryMapping[cat.category_id] = catDocRef.id;
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE menu_categories SET firebase_id = ? WHERE category_id = ?',
        [catDocRef.id, cat.category_id]
      );
      
      // id_mappings 테이블 업데이트
      await idMapperService.updateFirebaseId('category', cat.category_id, catDocRef.id);
      
      console.log(`  ✅ 카테고리: ${cat.name}`);
    }
    
    // 7. 아이템 업로드
    let uploadedItems = 0;
    
    for (let i = 0; i < posItems.length; i++) {
      const item = posItems[i];
      const firebaseCategoryId = categoryMapping[item.category_id];
      
      if (!firebaseCategoryId) {
        console.warn(`⚠️ 카테고리 매핑 없음: ${item.name}`);
        continue;
      }
      
      // 아이템에 연결된 모디파이어 그룹 가져오기 (테이블이 없을 수 있음)
      let modifierLinks = [];
      try {
        modifierLinks = await dbAll(
          'SELECT modifier_group_id FROM menu_modifier_links WHERE item_id = ?',
          [item.item_id]
        );
      } catch (e) {
        // 테이블 없음
      }
      
      // modifierGroupMapping에서 직접 Firebase ID 조회
      const firebaseModifierGroupIds = modifierLinks
        .map(link => modifierGroupMapping[link.modifier_group_id])
        .filter(id => id);
      
      // 아이템에 연결된 프린터 그룹 가져오기 (테이블이 없을 수 있음)
      let printerLinks = [];
      try {
        printerLinks = await dbAll(
          'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
          [item.item_id]
        );
      } catch (e) {
        // 테이블 없음
      }
      
      // printerGroupMapping에서 직접 Firebase ID 조회
      const firebasePrinterGroupIds = printerLinks
        .map(link => printerGroupMapping[link.printer_group_id])
        .filter(id => id);
      
      // 아이템에 연결된 세금 그룹 가져오기 (테이블이 없을 수 있음)
      let taxLinks = [];
      try {
        taxLinks = await dbAll(
          'SELECT tax_group_id FROM menu_tax_links WHERE item_id = ?',
          [item.item_id]
        );
      } catch (e) {
        // 테이블 없음
      }
      
      // 카테고리 세금도 포함 (아이템에 직접 세금이 없는 경우)
      let itemTaxGroupIds = taxLinks.map(link => link.tax_group_id);
      if (itemTaxGroupIds.length === 0) {
        const catTaxLinks = await dbAll(
          'SELECT tax_group_id FROM category_tax_links WHERE category_id = ?',
          [item.category_id]
        ).catch(() => []);
        itemTaxGroupIds = catTaxLinks.map(l => l.tax_group_id);
      }
      
      // taxGroupMapping에서 직접 Firebase ID 조회
      const firebaseTaxGroupIds = itemTaxGroupIds
        .map(id => taxGroupMapping[id])
        .filter(id => id);
      
      // 아이템 생성
      const itemImageUrl = skipImages && fbItemImageMap[item.item_id] ? fbItemImageMap[item.item_id] : (item.image_url || '');
      const itemDocRef = await restaurantRef.collection('menuItems').add({
        menuId: firebaseMenuId,
        categoryId: firebaseCategoryId,
        name: item.name,
        shortName: item.short_name || '',
        short_name: item.short_name || '',
        description: item.description || '',
        price: parseFloat(item.price) || 0,
        price2: parseFloat(item.price2) || 0,
        imageUrl: itemImageUrl,
        image_url: itemImageUrl,
        isOpenPrice: item.is_open_price || 0,
        is_open_price: item.is_open_price || 0,
        isAvailable: true,
        is_active: 1,
        sortOrder: item.sort_order || i,
        sort_order: item.sort_order || i,
        posId: item.item_id, // POS 아이템 ID 저장
        posCategoryId: item.category_id, // POS 카테고리 ID 저장
        modifierGroupIds: firebaseModifierGroupIds,
        taxGroupIds: firebaseTaxGroupIds,
        printerGroupIds: firebasePrinterGroupIds,
        options: [],
        created_at: new Date(),
        updated_at: new Date()
      });
      
      // POS에 firebase_id 저장
      await dbRun(
        'UPDATE menu_items SET firebase_id = ? WHERE item_id = ?',
        [itemDocRef.id, item.item_id]
      );
      
      // id_mappings 테이블 업데이트
      await idMapperService.updateFirebaseId('menu_item', item.item_id, itemDocRef.id);
      
      uploadedItems++;
    }
    
    // 8. 카테고리-모디파이어 연결 업로드 (categoryModifierLinks 컬렉션)
    console.log(`📤 카테고리-모디파이어 연결 업로드 중...`);
    let categoryModifierLinksUploaded = 0;
    
    // 기존 categoryModifierLinks 삭제
    const existingCatModLinks = await restaurantRef.collection('categoryModifierLinks').get();
    for (const doc of existingCatModLinks.docs) {
      await doc.ref.delete();
    }
    
    // POS에서 카테고리-모디파이어 연결 가져오기 (테이블이 없을 수 있음)
    let hasCatModLinkTable = true;
    try {
      const allCatModLinks = await dbAll('SELECT * FROM category_modifier_links LIMIT 1');
      console.log(`   📋 POS category_modifier_links 테이블 존재함`);
    } catch (e) {
      console.log(`   ⚠️ POS category_modifier_links 테이블 없음 - 건너뜀`);
      hasCatModLinkTable = false;
    }
    
    if (hasCatModLinkTable) {
      for (const cat of posCategories) {
        let catModLinks = [];
        try {
          catModLinks = await dbAll(
            'SELECT modifier_group_id FROM category_modifier_links WHERE category_id = ?',
            [cat.category_id]
          );
        } catch (e) {
          // 무시
        }
        
        for (const link of catModLinks) {
          const firebaseModGroupId = modifierGroupMapping[link.modifier_group_id];
          
          if (firebaseModGroupId) {
            const linkId = `${cat.category_id}_${link.modifier_group_id}`;
            await restaurantRef.collection('categoryModifierLinks').doc(linkId).set({
              id: linkId,
              categoryId: String(cat.category_id),
              modifierGroupId: firebaseModGroupId,
              created_at: new Date()
            });
            categoryModifierLinksUploaded++;
          }
        }
      }
    }
    console.log(`   📋 카테고리-모디파이어 연결: ${categoryModifierLinksUploaded}개`)
    
    // 9. 아이템-모디파이어 연결 업로드 (itemModifierLinks 컬렉션)
    console.log(`📤 아이템-모디파이어 연결 업로드 중...`);
    let itemModifierLinksUploaded = 0;
    
    // 기존 itemModifierLinks 삭제
    const existingItemModLinks = await restaurantRef.collection('itemModifierLinks').get();
    for (const doc of existingItemModLinks.docs) {
      await doc.ref.delete();
    }
    
    // POS에서 아이템-모디파이어 연결 가져오기 (테이블이 없을 수 있음)
    let hasItemModLinkTable = true;
    try {
      await dbAll('SELECT * FROM menu_modifier_links LIMIT 1');
      console.log(`   📋 POS menu_modifier_links 테이블 존재함`);
    } catch (e) {
      console.log(`   ⚠️ POS menu_modifier_links 테이블 없음 - 건너뜀`);
      hasItemModLinkTable = false;
    }
    
    if (hasItemModLinkTable) {
      for (const item of posItems) {
        let itemModLinks = [];
        try {
          itemModLinks = await dbAll(
            'SELECT modifier_group_id FROM menu_modifier_links WHERE item_id = ?',
            [item.item_id]
          );
        } catch (e) {
          // 무시
        }
        
        for (const link of itemModLinks) {
          const firebaseModGroupId = modifierGroupMapping[link.modifier_group_id];
          
          if (firebaseModGroupId) {
            const linkId = `${item.item_id}_${link.modifier_group_id}`;
            await restaurantRef.collection('itemModifierLinks').doc(linkId).set({
              id: linkId,
              itemId: String(item.item_id),
              modifierGroupId: firebaseModGroupId,
              created_at: new Date()
            });
            itemModifierLinksUploaded++;
          }
        }
      }
    }
    console.log(`   📋 아이템-모디파이어 연결: ${itemModifierLinksUploaded}개`);
    
    // 12. 카테고리-세금 연결 업로드
    console.log(`📤 카테고리-세금 연결 업로드 중...`);
    let categoryTaxLinksUploaded = 0;
    
    // 기존 categoryTaxLinks 삭제
    const existingCatTaxLinks = await restaurantRef.collection('categoryTaxLinks').get();
    for (const doc of existingCatTaxLinks.docs) {
      await doc.ref.delete();
    }
    
    for (const cat of posCategories) {
      // category_tax_links 테이블에서 세금 그룹 연결 가져오기
      const catTaxLinks = await dbAll(
        'SELECT tax_group_id FROM category_tax_links WHERE category_id = ?',
        [cat.category_id]
      ).catch(() => []);
      
      for (const link of catTaxLinks) {
        const fbTaxGroupId = taxGroupMapping[link.tax_group_id];
        if (fbTaxGroupId) {
          const linkId = `${cat.category_id}_${link.tax_group_id}`;
          await restaurantRef.collection('categoryTaxLinks').doc(linkId).set({
            id: linkId,
            categoryId: String(cat.category_id),
            taxGroupId: fbTaxGroupId,
            created_at: new Date()
          });
          categoryTaxLinksUploaded++;
        }
      }
    }
    console.log(`   ✅ 카테고리-세금 연결: ${categoryTaxLinksUploaded}개`);
    
    // 13. 아이템-세금 연결 업로드 (카테고리 세금도 아이템에 적용)
    console.log(`📤 아이템-세금 연결 업로드 중...`);
    let itemTaxLinksUploaded = 0;
    
    const existingItemTaxLinks = await restaurantRef.collection('itemTaxLinks').get();
    for (const doc of existingItemTaxLinks.docs) {
      await doc.ref.delete();
    }
    
    // 카테고리별 세금 그룹 매핑 생성
    const categoryTaxMap = {};
    for (const cat of posCategories) {
      const catTaxLinks = await dbAll(
        'SELECT tax_group_id FROM category_tax_links WHERE category_id = ?',
        [cat.category_id]
      ).catch(() => []);
      if (catTaxLinks.length > 0) {
        categoryTaxMap[cat.category_id] = catTaxLinks.map(l => l.tax_group_id);
      }
    }
    console.log(`   📋 카테고리별 세금 매핑: ${Object.keys(categoryTaxMap).length}개 카테고리`);
    
    for (const item of posItems) {
      // 1. 아이템 직접 연결 확인 (menu_tax_links)
      const itemLinks = await dbAll(
        'SELECT tax_group_id FROM menu_tax_links WHERE item_id = ?',
        [item.item_id]
      ).catch(() => []);
      
      // 2. 아이템에 직접 연결이 없으면 카테고리 세금 사용
      let taxGroupIds = itemLinks.map(l => l.tax_group_id);
      if (taxGroupIds.length === 0 && categoryTaxMap[item.category_id]) {
        taxGroupIds = categoryTaxMap[item.category_id];
      }
      
      for (const taxGroupId of taxGroupIds) {
        const fbTaxGroupId = taxGroupMapping[taxGroupId];
        if (fbTaxGroupId) {
          const linkId = `${item.item_id}_${taxGroupId}`;
          await restaurantRef.collection('itemTaxLinks').doc(linkId).set({
            id: linkId,
            itemId: String(item.item_id),
            taxGroupId: fbTaxGroupId,
            created_at: new Date()
          });
          itemTaxLinksUploaded++;
        }
      }
    }
    console.log(`   ✅ 아이템-세금 연결: ${itemTaxLinksUploaded}개`);
    
    // 14. 카테고리-프린터 연결 업로드
    console.log(`📤 카테고리-프린터 연결 업로드 중...`);
    let categoryPrinterLinksUploaded = 0;
    
    // 기존 categoryPrinterLinks 삭제
    const existingCatPrinterLinks = await restaurantRef.collection('categoryPrinterLinks').get();
    for (const doc of existingCatPrinterLinks.docs) {
      await doc.ref.delete();
    }
    
    for (const cat of posCategories) {
      const catPrinterLinks = await dbAll(
        'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
        [cat.category_id]
      ).catch(() => []);
      
      for (const link of catPrinterLinks) {
        const fbPrinterGroupId = printerGroupMapping[link.printer_group_id];
        if (fbPrinterGroupId) {
          const linkId = `${cat.category_id}_${link.printer_group_id}`;
          await restaurantRef.collection('categoryPrinterLinks').doc(linkId).set({
            id: linkId,
            categoryId: String(cat.category_id),
            printerGroupId: fbPrinterGroupId,
            created_at: new Date()
          });
          categoryPrinterLinksUploaded++;
        }
      }
    }
    console.log(`   ✅ 카테고리-프린터 연결: ${categoryPrinterLinksUploaded}개`);
    
    // 15. 아이템-프린터 연결 업로드
    console.log(`📤 아이템-프린터 연결 업로드 중...`);
    let itemPrinterLinksUploaded = 0;
    
    const existingItemPrinterLinks = await restaurantRef.collection('itemPrinterLinks').get();
    for (const doc of existingItemPrinterLinks.docs) {
      await doc.ref.delete();
    }
    
    for (const item of posItems) {
      const links = await dbAll(
        'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
        [item.item_id]
      ).catch(() => []);
      
      for (const link of links) {
        const fbPrinterGroupId = printerGroupMapping[link.printer_group_id];
        if (fbPrinterGroupId) {
          const linkId = `${item.item_id}_${link.printer_group_id}`;
          await restaurantRef.collection('itemPrinterLinks').doc(linkId).set({
            id: linkId,
            itemId: String(item.item_id),
            printerGroupId: fbPrinterGroupId,
            created_at: new Date()
          });
          itemPrinterLinksUploaded++;
        }
      }
    }
    console.log(`   ✅ 아이템-프린터 연결: ${itemPrinterLinksUploaded}개`);
    
    // 동기화 통계 업데이트
    syncStats.totalItems = posCategories.length + uploadedItems + posModifierGroups.length + posTaxGroups.length + posPrinterGroups.length;
    syncStats.createdCount = syncStats.totalItems;
    
    console.log(`\n✅ 동기화 완료!`);
    console.log(`   메뉴: ${posMenu.name}`);
    console.log(`   모디파이어 그룹: ${posModifierGroups.length}개`);
    console.log(`   세금 그룹: ${posTaxGroups.length}개`);
    console.log(`   프린터 그룹: ${posPrinterGroups.length}개`);
    console.log(`   카테고리: ${posCategories.length}개`);
    console.log(`   아이템: ${uploadedItems}개`);
    console.log(`   연결: 모디파이어(${categoryModifierLinksUploaded}+${itemModifierLinksUploaded}), 세금(${categoryTaxLinksUploaded}+${itemTaxLinksUploaded}), 프린터(${categoryPrinterLinksUploaded}+${itemPrinterLinksUploaded})`);
    
    // 동기화 로그 완료
    if (syncId) {
      await SyncLogService.completeSync(syncId, {
        status: SYNC_STATUS.COMPLETED,
        ...syncStats
      });
    }
    
    res.json({
      success: true,
      message: 'Full menu sync to Firebase completed',
      syncId,
      summary: {
        menuName: posMenu.name,
        firebaseMenuId: firebaseMenuId,
        modifierGroupsUploaded: posModifierGroups.length,
        taxGroupsUploaded: posTaxGroups.length,
        printerGroupsUploaded: posPrinterGroups.length,
        categoriesUploaded: posCategories.length,
        itemsUploaded: uploadedItems,
        categoryModifierLinksUploaded,
        itemModifierLinksUploaded,
        categoryTaxLinksUploaded,
        itemTaxLinksUploaded,
        categoryPrinterLinksUploaded,
        itemPrinterLinksUploaded
      }
    });
  } catch (e) {
    console.error('❌ Firebase 전체 동기화 실패:', e);
    
    // ★ 안전장치: 실패 시 Firebase 백업에서 자동 복원 시도
    let restored = false;
    if (firebaseBackupRef && firebaseBackupData) {
      try {
        console.log('🔄 Firebase 백업에서 자동 복원 시도...');
        const restaurantRef = firebaseService.getFirestore().collection('restaurants').doc(req.body.restaurantId);
        
        // 메뉴 복원
        for (const menu of (firebaseBackupData.menus || [])) {
          const { id, ...menuData } = menu;
          await restaurantRef.collection('menus').doc(id).set(menuData);
        }
        // 카테고리 복원
        for (const cat of (firebaseBackupData.categories || [])) {
          const { id, ...catData } = cat;
          await restaurantRef.collection('menuCategories').doc(id).set(catData);
        }
        // 아이템 복원
        for (const item of (firebaseBackupData.items || [])) {
          const { id, ...itemData } = item;
          await restaurantRef.collection('menuItems').doc(id).set(itemData);
        }
        
        restored = true;
        console.log(`✅ Firebase 백업 복원 완료 - 메뉴: ${firebaseBackupData.menus.length}, 카테고리: ${firebaseBackupData.categories.length}, 아이템: ${firebaseBackupData.items.length}`);
      } catch (restoreErr) {
        console.error('❌ Firebase 백업 복원 실패:', restoreErr.message);
        console.error('   수동 복원이 필요합니다. 백업 ID:', firebaseBackupRef?.id);
      }
    }
    
    // 동기화 로그 실패
    if (syncId) {
      await SyncLogService.failSync(syncId, e);
    }
    
    res.status(500).json({ 
      error: e.message, 
      syncId, 
      restored,
      backupId: firebaseBackupRef?.id || null,
      message: restored 
        ? 'Sync failed but Firebase data was restored from backup.' 
        : 'Sync failed. Check backup for manual restore if needed.'
    });
  }
});

// POS 메뉴 목록 조회 (동기화용)
router.get('/pos-menus', async (req, res) => {
  try {
    const menus = await dbAll('SELECT * FROM menus ORDER BY name');
    res.json({ success: true, menus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Firebase 메뉴 목록 조회 (restaurants/{restaurantId}/menus)
router.get('/firebase-menus/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const firestore = firebaseService.getFirestore();
    
    const menusSnapshot = await firestore
      .collection('restaurants')
      .doc(restaurantId)
      .collection('menus')
      .get();
    
    const menus = [];
    menusSnapshot.forEach(doc => {
      menus.push({ id: doc.id, ...doc.data() });
    });
    
    res.json({ success: true, menus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Firebase 메뉴 상세 조회 (카테고리 + 아이템 수)
router.get('/firebase-menu-detail/:restaurantId/:menuId', async (req, res) => {
  try {
    const { restaurantId, menuId } = req.params;
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // 메뉴 정보
    const menuDoc = await restaurantRef.collection('menus').doc(menuId).get();
    if (!menuDoc.exists) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    
    // 카테고리 수
    const categoriesSnapshot = await restaurantRef.collection('menuCategories')
      .where('menuId', '==', menuId)
      .get();
    
    // 아이템 수
    const itemsSnapshot = await restaurantRef.collection('menuItems')
      .where('menuId', '==', menuId)
      .get();
    
    // 샘플 아이템 (처음 5개)
    const sampleItems = [];
    itemsSnapshot.docs.slice(0, 5).forEach(doc => {
      sampleItems.push({ id: doc.id, name: doc.data().name, posId: doc.data().posId });
    });
    
    res.json({
      success: true,
      menu: { id: menuDoc.id, ...menuDoc.data() },
      categoryCount: categoriesSnapshot.size,
      itemCount: itemsSnapshot.size,
      sampleItems
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Firebase 메뉴 삭제
router.delete('/firebase-menu/:restaurantId/:menuId', requireManager, async (req, res) => {
  try {
    const { restaurantId, menuId } = req.params;
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // 해당 메뉴의 카테고리 삭제
    const categories = await restaurantRef.collection('menuCategories')
      .where('menuId', '==', menuId)
      .get();
    
    for (const catDoc of categories.docs) {
      await catDoc.ref.delete();
    }
    
    // 해당 메뉴의 아이템 삭제
    const items = await restaurantRef.collection('menuItems')
      .where('menuId', '==', menuId)
      .get();
    
    for (const itemDoc of items.docs) {
      await itemDoc.ref.delete();
    }
    
    // 메뉴 삭제
    await restaurantRef.collection('menus').doc(menuId).delete();
    
    console.log(`🗑️ Firebase 메뉴 삭제 완료: ${menuId}`);
    
    res.json({
      success: true,
      message: 'Menu deleted from Firebase',
      deletedCategories: categories.size,
      deletedItems: items.size
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// 동기화 로그 API
// ============================================

// 최근 동기화 이력 조회
router.get('/sync-logs', async (req, res) => {
  try {
    const { entityType, limit = 20, status } = req.query;
    
    let query = 'SELECT * FROM sync_logs';
    const params = [];
    const conditions = [];
    
    if (entityType) {
      conditions.push('entity_type = ?');
      params.push(entityType);
    }
    
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY started_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const logs = await dbAll(query, params);
    
    // errors 필드 파싱
    const parsedLogs = logs.map(log => ({
      ...log,
      errors: log.errors ? JSON.parse(log.errors) : null
    }));
    
    res.json({
      success: true,
      count: parsedLogs.length,
      logs: parsedLogs
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 특정 동기화 상세 조회
router.get('/sync-logs/:syncId', async (req, res) => {
  try {
    const { syncId } = req.params;
    
    const log = await dbGet('SELECT * FROM sync_logs WHERE sync_id = ?', [syncId]);
    
    if (!log) {
      return res.status(404).json({ error: 'Sync log not found' });
    }
    
    const details = await dbAll(
      'SELECT * FROM sync_log_details WHERE sync_id = ? ORDER BY created_at',
      [syncId]
    );
    
    res.json({
      success: true,
      log: {
        ...log,
        errors: log.errors ? JSON.parse(log.errors) : null
      },
      details
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 동기화 통계 조회
router.get('/sync-stats', async (req, res) => {
  try {
    const stats = await dbGet(`
      SELECT 
        COUNT(*) as total_syncs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
        SUM(created_count) as total_created,
        SUM(updated_count) as total_updated,
        SUM(deleted_count) as total_deleted,
        SUM(error_count) as total_errors
      FROM sync_logs
    `);
    
    const byEntity = await dbAll(`
      SELECT 
        entity_type,
        COUNT(*) as sync_count,
        MAX(started_at) as last_sync,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM sync_logs
      GROUP BY entity_type
    `);
    
    res.json({
      success: true,
      stats: {
        ...stats,
        byEntity
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ID Mappings 조회
router.get('/id-mappings', async (req, res) => {
  try {
    const { entityType, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM id_mappings';
    const params = [];
    
    if (entityType) {
      query += ' WHERE entity_type = ?';
      params.push(entityType);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const mappings = await dbAll(query, params);
    
    // external_ids 필드 파싱
    const parsedMappings = mappings.map(m => ({
      ...m,
      external_ids: m.external_ids ? JSON.parse(m.external_ids) : {}
    }));
    
    res.json({
      success: true,
      count: parsedMappings.length,
      mappings: parsedMappings
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ID Mappings 통계
router.get('/id-mappings/stats', async (req, res) => {
  try {
    const stats = await dbAll(`
      SELECT 
        entity_type,
        COUNT(*) as total,
        SUM(CASE WHEN firebase_id IS NOT NULL THEN 1 ELSE 0 END) as with_firebase,
        SUM(CASE WHEN external_ids != '{}' THEN 1 ELSE 0 END) as with_external
      FROM id_mappings
      GROUP BY entity_type
    `);
    
    res.json({
      success: true,
      stats
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 개별 Modifier Group Firebase 동기화
router.post('/sync-modifiers', async (req, res) => {
  try {
    const { groupId } = req.body;
    
    if (!groupId) {
      return res.status(400).json({ error: 'groupId is required' });
    }
    
    // 레스토랑 ID 가져오기 (req.body에서 받음 - 다른 엔드포인트와 동일 방식)
    const { restaurantId } = req.body;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required for Firebase sync' });
    }
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    
    // SQLite에서 modifier group 정보 가져오기
    const group = await dbGet(`
      SELECT 
        mg.modifier_group_id,
        mg.name,
        mg.selection_type,
        mg.min_selection,
        mg.max_selection
      FROM modifier_groups mg
      WHERE mg.modifier_group_id = ? AND mg.is_deleted = 0
    `, [groupId]);
    
    if (!group) {
      return res.status(404).json({ error: 'Modifier group not found' });
    }
    
    // modifier options 가져오기
    const options = await dbAll(`
      SELECT 
        m.modifier_id,
        m.name,
        m.price_delta,
        m.price_delta2,
        m.sort_order
      FROM modifiers m
      JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
      WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
      ORDER BY m.sort_order, m.name
    `, [groupId]);
    
    // label 가져오기
    const labels = await dbAll('SELECT label_name FROM modifier_labels WHERE modifier_group_id = ?', [groupId]);
    
    // Firebase에서 기존 그룹 찾기 (posGroupId로)
    const existingQuery = await restaurantRef
      .collection('modifierGroups')
      .where('posGroupId', '==', groupId)
      .limit(1)
      .get();
    
    const firebaseData = {
      restaurantId,
      name: group.name,
      label: labels.length > 0 ? labels[0].label_name : '',
      min_selection: group.min_selection || 0,
      max_selection: group.max_selection || 0,
      selection_type: group.selection_type || 'OPTIONAL',
      posGroupId: groupId,
      options: options.map(opt => ({
        name: opt.name,
        price: opt.price_delta || 0,
        price2: opt.price_delta2 || 0,
        posModifierId: opt.modifier_id
      })),
      updatedAt: new Date().toISOString()
    };
    
    let firebaseId;
    if (!existingQuery.empty) {
      // 기존 문서 업데이트
      firebaseId = existingQuery.docs[0].id;
      await restaurantRef.collection('modifierGroups').doc(firebaseId).update(firebaseData);
      console.log(`✅ Firebase Modifier Group 업데이트: ${firebaseId}`);
    } else {
      // 새 문서 생성
      const docRef = await restaurantRef.collection('modifierGroups').add({
        ...firebaseData,
        createdAt: new Date().toISOString()
      });
      firebaseId = docRef.id;
      console.log(`✅ Firebase Modifier Group 생성: ${firebaseId}`);
    }
    
    res.json({
      success: true,
      message: 'Modifier group synced to Firebase',
      groupId,
      firebaseId
    });
    
  } catch (e) {
    console.error('Error syncing modifier to Firebase:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== Order Screen Layout Settings Upload/Download =====

// POST /upload-layout-settings - POS → Firebase
router.post('/upload-layout-settings', requireManager, async (req, res) => {
  try {
    const { restaurantId, layoutSettings } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });
    if (!layoutSettings) return res.status(400).json({ error: 'layoutSettings is required' });

    await ensureSyncColumns();
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);

    // Firebase에 layoutSettings 저장 (단일 문서로 관리)
    await restaurantRef.collection('posSettings').doc('layoutSettings').set({
      settings: JSON.stringify(layoutSettings),
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Layout settings uploaded to Firebase for restaurant: ${restaurantId}`);
    res.json({ success: true, message: 'Layout settings uploaded to Firebase' });
  } catch (e) {
    console.error('❌ Layout settings upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /download-layout-settings - Firebase → POS
router.post('/download-layout-settings', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    await ensureSyncColumns();
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);

    // Firebase에서 layoutSettings 가져오기
    const doc = await restaurantRef.collection('posSettings').doc('layoutSettings').get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'No layout settings found in Firebase' });
    }

    const data = doc.data();
    let layoutSettings;
    try {
      layoutSettings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse layout settings from Firebase' });
    }

    console.log(`✅ Layout settings downloaded from Firebase for restaurant: ${restaurantId}`);
    res.json({ success: true, layoutSettings });
  } catch (e) {
    console.error('❌ Layout settings download error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== Table Map Upload/Download =====

// POST /upload-table-map - POS → Firebase
router.post('/upload-table-map', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    await ensureSyncColumns();
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);

    // 1. POS에서 모든 테이블맵 요소 가져오기
    const elements = await dbAll('SELECT * FROM table_map_elements');
    console.log(`📤 Table map elements to upload: ${elements.length}`);

    // 2. POS에서 스크린 사이즈 설정 가져오기
    let screenSettings = [];
    try {
      screenSettings = await dbAll('SELECT * FROM table_map_screen_settings');
    } catch (e) {
      console.warn('⚠️ table_map_screen_settings 테이블 없음 - 건너뜀');
    }

    // 3. Firebase 기존 데이터 삭제
    const existingElements = await restaurantRef.collection('tableMapElements').get();
    const batch1 = firestore.batch();
    existingElements.docs.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();

    const existingScreenSettings = await restaurantRef.collection('tableMapScreenSettings').get();
    const batch2 = firestore.batch();
    existingScreenSettings.docs.forEach(doc => batch2.delete(doc.ref));
    await batch2.commit();

    // 4. 테이블맵 요소 업로드 (batch로 500개씩)
    let elementsUploaded = 0;
    const BATCH_SIZE = 400;
    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      const chunk = elements.slice(i, i + BATCH_SIZE);
      const batch = firestore.batch();
      for (const el of chunk) {
        const docRef = restaurantRef.collection('tableMapElements').doc(el.element_id);
        batch.set(docRef, {
          element_id: el.element_id,
          floor: el.floor || '1F',
          type: el.type,
          x_pos: el.x_pos,
          y_pos: el.y_pos,
          width: el.width,
          height: el.height,
          rotation: el.rotation || 0,
          name: el.name || '',
          fontSize: el.fontSize || 20,
          color: el.color || '#3B82F6',
          status: el.status || 'Available',
          uploadedAt: new Date().toISOString()
        });
        elementsUploaded++;
      }
      await batch.commit();
    }

    // 5. 스크린 사이즈 설정 업로드
    let screenSettingsUploaded = 0;
    for (const ss of screenSettings) {
      const docRef = restaurantRef.collection('tableMapScreenSettings').doc(ss.floor || '1F');
      await docRef.set({
        floor: ss.floor || '1F',
        width: ss.width || 1024,
        height: ss.height || 768,
        scale: ss.scale || 1,
        uploadedAt: new Date().toISOString()
      });
      screenSettingsUploaded++;
    }

    console.log(`✅ Table map uploaded: ${elementsUploaded} elements, ${screenSettingsUploaded} screen settings`);
    res.json({
      success: true,
      message: 'Table map uploaded to Firebase',
      summary: {
        elementsUploaded,
        screenSettingsUploaded
      }
    });
  } catch (e) {
    console.error('❌ Table map upload error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /download-table-map - Firebase → POS
router.post('/download-table-map', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    await ensureSyncColumns();
    const firestore = firebaseService.getFirestore();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);

    // 1. Firebase에서 테이블맵 요소 가져오기
    const elementsSnapshot = await restaurantRef.collection('tableMapElements').get();
    if (elementsSnapshot.empty) {
      return res.status(404).json({ error: 'No table map data found in Firebase' });
    }

    const firebaseElements = elementsSnapshot.docs.map(doc => doc.data());
    console.log(`📥 Table map elements to download: ${firebaseElements.length}`);

    // 2. Firebase에서 스크린 사이즈 설정 가져오기
    const screenSnapshot = await restaurantRef.collection('tableMapScreenSettings').get();
    const firebaseScreenSettings = screenSnapshot.docs.map(doc => doc.data());

    // 3. POS DB의 기존 테이블맵 요소 삭제
    await dbRun('DELETE FROM table_map_elements');

    // 4. Firebase 데이터를 POS DB에 삽입
    let elementsDownloaded = 0;
    for (const el of firebaseElements) {
      try {
        await dbRun(`
          INSERT INTO table_map_elements (
            element_id, floor, type, x_pos, y_pos, width, height, rotation,
            name, fontSize, color, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          el.element_id,
          el.floor || '1F',
          el.type,
          el.x_pos,
          el.y_pos,
          el.width,
          el.height,
          el.rotation || 0,
          el.name || '',
          el.fontSize || 20,
          el.color || '#3B82F6',
          'Available'  // 다운로드 시 상태는 Available로 초기화
        ]);
        elementsDownloaded++;
      } catch (insertErr) {
        console.warn(`⚠️ 테이블맵 요소 삽입 실패 (${el.element_id}):`, insertErr.message);
      }
    }

    // 5. 스크린 사이즈 설정 업데이트
    let screenSettingsDownloaded = 0;
    for (const ss of firebaseScreenSettings) {
      try {
        await dbRun(`
          INSERT INTO table_map_screen_settings (floor, width, height, scale, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(floor) DO UPDATE SET
            width = excluded.width,
            height = excluded.height,
            scale = excluded.scale,
            updated_at = CURRENT_TIMESTAMP
        `, [
          ss.floor || '1F',
          ss.width || 1024,
          ss.height || 768,
          ss.scale || 1
        ]);
        screenSettingsDownloaded++;
      } catch (ssErr) {
        console.warn(`⚠️ 스크린 사이즈 설정 업데이트 실패 (${ss.floor}):`, ssErr.message);
      }
    }

    console.log(`✅ Table map downloaded: ${elementsDownloaded} elements, ${screenSettingsDownloaded} screen settings`);
    res.json({
      success: true,
      message: 'Table map downloaded from Firebase',
      summary: {
        elementsDownloaded,
        screenSettingsDownloaded
      }
    });
  } catch (e) {
    console.error('❌ Table map download error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

