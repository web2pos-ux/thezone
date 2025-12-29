// backend/routes/menu-sync.js
// Firebase ↔ POS 메뉴 동기화 API

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const firebaseService = require('../services/firebaseService');

// Database connection
const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// Helper functions
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

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
    const firestore = firebaseService.getFirestore();
    
    // 카테고리 가져오기 (인덱스 없이)
    const categoriesSnapshot = await firestore
      .collection('menuCategories')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const categories = [];
    categoriesSnapshot.forEach(doc => {
      categories.push({ id: doc.id, ...doc.data() });
    });
    categories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    // 메뉴 아이템 가져오기 (인덱스 없이)
    const itemsSnapshot = await firestore
      .collection('menuItems')
      .where('restaurantId', '==', restaurantId)
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
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const firestore = firebaseService.getFirestore();
    const fs = require('fs');
    const path = require('path');
    
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
    
    // 백업 디렉토리 생성
    const backupDir = path.resolve(__dirname, '..', '..', 'backups', 'pos-menu');
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
    
    // 1. Firebase에서 카테고리 가져오기 (인덱스 없이)
    const categoriesSnapshot = await firestore
      .collection('menuCategories')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const firebaseCategories = [];
    categoriesSnapshot.forEach(doc => {
      firebaseCategories.push({ id: doc.id, ...doc.data() });
    });
    // 클라이언트 측에서 정렬
    firebaseCategories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    // 2. Firebase에서 메뉴 아이템 가져오기 (인덱스 없이)
    const itemsSnapshot = await firestore
      .collection('menuItems')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const firebaseItems = [];
    itemsSnapshot.forEach(doc => {
      firebaseItems.push({ id: doc.id, ...doc.data() });
    });
    // 클라이언트 측에서 정렬
    firebaseItems.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    
    console.log(`📦 Firebase 카테고리: ${firebaseCategories.length}개, 아이템: ${firebaseItems.length}개`);
    
    // 3. 테이블에 firebase_id 컬럼 추가 (없으면)
    try {
      await dbRun("ALTER TABLE menu_categories ADD COLUMN firebase_id TEXT");
      console.log('✅ menu_categories에 firebase_id 컬럼 추가됨');
    } catch (e) {
      // 이미 존재하면 무시
    }
    
    // 4. 카테고리 동기화
    const categoryMapping = {}; // firebase_id -> pos_category_id
    
    for (const fbCat of firebaseCategories) {
      // 기존 매핑된 카테고리 찾기
      let posCategory = await dbGet(
        'SELECT * FROM menu_categories WHERE firebase_id = ?', 
        [fbCat.id]
      );
      
      if (posCategory) {
        // 업데이트
        await dbRun(
          `UPDATE menu_categories SET 
            name = ?, 
            sort_order = ?
          WHERE category_id = ?`,
          [
            fbCat.name,
            fbCat.sortOrder || 0,
            posCategory.category_id
          ]
        );
        categoryMapping[fbCat.id] = posCategory.category_id;
        console.log(`✅ 카테고리 업데이트: ${fbCat.name}`);
      } else {
        // 이름으로 찾기 (최초 동기화 시)
        posCategory = await dbGet(
          'SELECT * FROM menu_categories WHERE name = ? AND (firebase_id IS NULL OR firebase_id = "")',
          [fbCat.name]
        );
        
        if (posCategory) {
          // 기존 카테고리와 연결
          await dbRun(
            'UPDATE menu_categories SET firebase_id = ?, sort_order = ? WHERE category_id = ?',
            [fbCat.id, fbCat.sortOrder || 0, posCategory.category_id]
          );
          categoryMapping[fbCat.id] = posCategory.category_id;
          console.log(`🔗 카테고리 연결: ${fbCat.name}`);
        } else {
          // 새 카테고리 생성 (category_id는 INTEGER AUTOINCREMENT)
          const result = await dbRun(
            `INSERT INTO menu_categories (name, sort_order, firebase_id) 
             VALUES (?, ?, ?)`,
            [fbCat.name, fbCat.sortOrder || 0, fbCat.id]
          );
          categoryMapping[fbCat.id] = result.lastID;
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
        // 업데이트
        await dbRun(
          `UPDATE menu_items SET
            name = ?,
            price = ?,
            category_id = ?,
            description = ?,
            image_url = ?,
            sort_order = ?
          WHERE item_id = ?`,
          [
            fbItem.name,
            fbItem.price || 0,
            posCategoryId,
            fbItem.description || '',
            fbItem.imageUrl || '',
            fbItem.sortOrder || 0,
            posItem.item_id
          ]
        );
        updatedItems++;
      } else {
        // 이름으로 찾기 (최초 동기화 시)
        posItem = await dbGet(
          'SELECT * FROM menu_items WHERE name = ? AND (firebase_id IS NULL OR firebase_id = "")',
          [fbItem.name]
        );
        
        if (posItem) {
          // 기존 아이템과 연결 및 업데이트
          await dbRun(
            `UPDATE menu_items SET
              firebase_id = ?,
              price = ?,
              category_id = ?,
              description = ?,
              image_url = ?,
              sort_order = ?
            WHERE item_id = ?`,
            [
              fbItem.id,
              fbItem.price || 0,
              posCategoryId,
              fbItem.description || '',
              fbItem.imageUrl || '',
              fbItem.sortOrder || 0,
              posItem.item_id
            ]
          );
          updatedItems++;
          console.log(`🔗 아이템 연결: ${fbItem.name}`);
        } else {
          // 새 아이템 생성 (item_id는 INTEGER AUTOINCREMENT)
          const result = await dbRun(
            `INSERT INTO menu_items (
              name, price, category_id, description, image_url, 
              sort_order, firebase_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              fbItem.name,
              fbItem.price || 0,
              posCategoryId,
              fbItem.description || '',
              fbItem.imageUrl || '',
              fbItem.sortOrder || 0,
              fbItem.id
            ]
          );
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
    
    // Firebase 그룹들 가져오기
    const [modifierGroupsSnapshot, taxGroupsSnapshot, printerGroupsSnapshot] = await Promise.all([
      firestore.collection('modifierGroups').where('restaurantId', '==', restaurantId).get(),
      firestore.collection('taxGroups').where('restaurantId', '==', restaurantId).get(),
      firestore.collection('printerGroups').where('restaurantId', '==', restaurantId).get()
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
      dbAll('SELECT group_id as id, name FROM modifier_groups WHERE is_deleted = 0'),
      dbAll('SELECT tax_group_id as id, name FROM tax_groups'),
      dbAll('SELECT id, name FROM printer_groups WHERE is_active = 1')
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
        dbRun('DELETE FROM menu_tax_links WHERE item_id = ?', [posItem.item_id]).catch(() => 
          dbRun('DELETE FROM menu_item_tax_links WHERE item_id = ?', [posItem.item_id])
        ),
        dbRun('DELETE FROM menu_item_printer_links WHERE item_id = ?', [posItem.item_id])
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
          // menu_tax_links 또는 menu_item_tax_links 테이블 사용
          try {
            await dbRun(
              'INSERT OR IGNORE INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)',
              [posItem.item_id, posTgId]
            );
          } catch (e) {
            // menu_item_tax_links 테이블 시도
            await dbRun(
              'INSERT OR IGNORE INTO menu_item_tax_links (item_id, menu_tax_group_id) VALUES (?, ?)',
              [posItem.item_id, posTgId]
            );
          }
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
            'INSERT OR IGNORE INTO menu_item_printer_links (item_id, printer_group_id) VALUES (?, ?)',
            [posItem.item_id, posPgId]
          );
          printerLinksCreated++;
          console.log(`🔗 아이템-프린터 연결: ${fbItem.name} → ${fbPg.name}`);
        }
      }
    }
    
    console.log(`✅ 동기화 완료 - 생성: ${createdItems}, 업데이트: ${updatedItems}, 모디파이어연결: ${modifierLinksCreated}, 세금연결: ${taxLinksCreated}, 프린터연결: ${printerLinksCreated}`);
    
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
        printerLinksCreated: printerLinksCreated
      }
    });
  } catch (e) {
    console.error('❌ 메뉴 동기화 실패:', e);
    res.status(500).json({ error: e.message });
  }
});

// 기존 Firebase 메뉴 백업
router.get('/backup-firebase/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const firestore = firebaseService.getFirestore();
    
    console.log(`💾 Firebase 메뉴 백업 시작: ${restaurantId}`);
    
    // 카테고리 가져오기
    const categoriesSnapshot = await firestore
      .collection('menuCategories')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const categories = [];
    categoriesSnapshot.forEach(doc => {
      categories.push({ id: doc.id, ...doc.data() });
    });
    
    // 메뉴 아이템 가져오기
    const itemsSnapshot = await firestore
      .collection('menuItems')
      .where('restaurantId', '==', restaurantId)
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
    const { restaurantId, menuId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const firestore = firebaseService.getFirestore();
    
    console.log(`🔄 POS → Firebase 메뉴 업로드 시작: ${restaurantId}, Menu: ${menuId || 'All'}`);
    
    // 0. 기존 메뉴 백업
    const existingCatsBackup = await firestore
      .collection('menuCategories')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const existingItemsBackup = await firestore
      .collection('menuItems')
      .where('restaurantId', '==', restaurantId)
      .get();
    
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
    
    // 3. 기존 Firebase 카테고리 삭제 (해당 레스토랑만)
    const existingCats = await firestore
      .collection('menuCategories')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const deleteBatch1 = firestore.batch();
    existingCats.forEach(doc => {
      deleteBatch1.delete(doc.ref);
    });
    await deleteBatch1.commit();
    console.log(`🗑️ 기존 Firebase 카테고리 ${existingCats.size}개 삭제`);
    
    // 4. 기존 Firebase 메뉴 아이템 삭제
    const existingItems = await firestore
      .collection('menuItems')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const deleteBatch2 = firestore.batch();
    existingItems.forEach(doc => {
      deleteBatch2.delete(doc.ref);
    });
    await deleteBatch2.commit();
    console.log(`🗑️ 기존 Firebase 아이템 ${existingItems.size}개 삭제`);
    
    // 5. 카테고리 업로드
    const categoryMapping = {}; // pos_category_id -> firebase_category_id
    
    for (let i = 0; i < posCategories.length; i++) {
      const cat = posCategories[i];
      const docRef = await firestore.collection('menuCategories').add({
        restaurantId,
        name: cat.name,
        description: '',
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
      
      // 아이템에 연결된 세금 그룹 ID들 가져오기 (menu_tax_links 또는 menu_item_tax_links)
      let taxGroupIds = [];
      try {
        const taxRows = await dbAll(
          'SELECT tax_group_id FROM menu_tax_links WHERE item_id = ?',
          [item.item_id]
        );
        taxGroupIds = taxRows.map(r => r.tax_group_id);
      } catch (e) {
        // menu_item_tax_links 테이블 시도
        try {
          const taxRows = await dbAll(
            'SELECT menu_tax_group_id as tax_group_id FROM menu_item_tax_links WHERE item_id = ?',
            [item.item_id]
          );
          taxGroupIds = taxRows.map(r => r.tax_group_id);
        } catch (e2) {
          console.warn(`⚠️ 세금 그룹 연결 조회 실패: ${item.name}`);
        }
      }
      
      // 아이템에 연결된 프린터 그룹 ID들 가져오기
      const printerGroupIds = await dbAll(
        'SELECT printer_group_id FROM menu_item_printer_links WHERE item_id = ?',
        [item.item_id]
      ).then(rows => rows.map(r => r.printer_group_id)).catch(() => []);
      
      // Firebase Modifier Groups에서 POS group_id로 찾은 Firebase ID들로 변환
      const firebaseModifierGroupIds = [];
      for (const posModGroupId of modifierGroupIds) {
        // Firebase에서 posGroupId로 찾기
        const fbModGroup = await firestore
          .collection('modifierGroups')
          .where('restaurantId', '==', restaurantId)
          .where('posGroupId', '==', posModGroupId)
          .limit(1)
          .get();
        if (!fbModGroup.empty) {
          firebaseModifierGroupIds.push(fbModGroup.docs[0].id);
        }
      }
      
      // Firebase Tax Groups에서 POS group_id로 찾은 Firebase ID들로 변환
      const firebaseTaxGroupIds = [];
      for (const posTaxGroupId of taxGroupIds) {
        // Firebase에서 posGroupId로 찾기
        const fbTaxGroup = await firestore
          .collection('taxGroups')
          .where('restaurantId', '==', restaurantId)
          .where('posGroupId', '==', posTaxGroupId)
          .limit(1)
          .get();
        if (!fbTaxGroup.empty) {
          firebaseTaxGroupIds.push(fbTaxGroup.docs[0].id);
        }
      }
      
      // Firebase Printer Groups에서 POS group_id로 찾은 Firebase ID들로 변환
      const firebasePrinterGroupIds = [];
      for (const posPrinterGroupId of printerGroupIds) {
        // Firebase에서 posGroupId로 찾기
        const fbPrinterGroup = await firestore
          .collection('printerGroups')
          .where('restaurantId', '==', restaurantId)
          .where('posGroupId', '==', posPrinterGroupId)
          .limit(1)
          .get();
        if (!fbPrinterGroup.empty) {
          firebasePrinterGroupIds.push(fbPrinterGroup.docs[0].id);
        }
      }
      
      const docRef = await firestore.collection('menuItems').add({
        restaurantId,
        categoryId: firebaseCategoryId,
        name: item.name,
        shortName: item.short_name || '',
        description: item.description || '',
        price: item.price || 0,
        imageUrl: item.image_url || '',
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
    
    console.log(`✅ 업로드 완료 - 카테고리: ${posCategories.length}, 아이템: ${uploadedItems}`);
    
    res.json({
      success: true,
      message: 'Menu uploaded to Firebase',
      summary: {
        categoriesUploaded: posCategories.length,
        itemsUploaded: uploadedItems
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
    
    // 현재 메뉴 삭제
    const currentCats = await firestore
      .collection('menuCategories')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const deleteBatch1 = firestore.batch();
    currentCats.forEach(doc => deleteBatch1.delete(doc.ref));
    await deleteBatch1.commit();
    
    const currentItems = await firestore
      .collection('menuItems')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const deleteBatch2 = firestore.batch();
    currentItems.forEach(doc => deleteBatch2.delete(doc.ref));
    await deleteBatch2.commit();
    
    // 백업에서 복원
    for (const cat of backup.categories || []) {
      const { id, ...catData } = cat;
      await firestore.collection('menuCategories').doc(id).set(catData);
    }
    
    for (const item of backup.items || []) {
      const { id, ...itemData } = item;
      await firestore.collection('menuItems').doc(id).set(itemData);
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
      WHERE is_active = 1
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
    console.log(`📤 Uploading printer groups to Firebase for restaurant: ${restaurantId}`);

    // POS에서 프린터 그룹 가져오기
    const printerGroups = await dbAll(`
      SELECT id, name FROM printer_groups WHERE is_active = 1 ORDER BY name
    `);

    console.log(`Found ${printerGroups.length} printer groups in POS`);

    // Firebase에서 기존 프린터 그룹 삭제
    const existingGroups = await firestore
      .collection('printerGroups')
      .where('restaurantId', '==', restaurantId)
      .get();

    const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    console.log(`Deleted ${existingGroups.size} existing printer groups from Firebase`);

    // 새 프린터 그룹 업로드 (이름만)
    const uploadPromises = printerGroups.map(async (group) => {
      const docRef = await firestore.collection('printerGroups').add({
        restaurantId,
        name: group.name,
        type: 'kitchen',
        printers: [],
        posGroupId: group.id,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return { id: docRef.id, name: group.name, posGroupId: group.id };
    });

    const uploadedGroups = await Promise.all(uploadPromises);
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

// 프린터 그룹 목록 조회 (Firebase용)
router.get('/printer-groups/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const firestore = firebaseService.getFirestore();
    
    const snapshot = await firestore
      .collection('printerGroups')
      .where('restaurantId', '==', restaurantId)
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
    console.log(`📥 Downloading printer groups from Firebase for restaurant: ${restaurantId}`);

    // Firebase에서 프린터 그룹 가져오기
    const snapshot = await firestore
      .collection('printerGroups')
      .where('restaurantId', '==', restaurantId)
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
        'SELECT id, name FROM printer_groups WHERE name = ? AND is_active = 1',
        [fbGroup.name]
      );

      if (!posGroup) {
        // 새 프린터 그룹 생성
        const result = await dbRun(
          'INSERT INTO printer_groups (name, is_active) VALUES (?, 1)',
          [fbGroup.name]
        );
        posGroup = { id: result.lastID, name: fbGroup.name };
        createdGroups++;
        console.log(`➕ Created printer group: ${fbGroup.name}`);
      } else {
        updatedGroups++;
        console.log(`🔄 Found existing printer group: ${fbGroup.name}`);
      }
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
    console.log(`📤 Uploading tax groups to Firebase for restaurant: ${restaurantId}`);

    // POS에서 세금 그룹 가져오기 (개별 세금 포함)
    const taxGroups = await dbAll(`
      SELECT id, name FROM tax_groups WHERE is_active = 1 ORDER BY name
    `);

    // 각 그룹의 개별 세금 정보 가져오기
    for (const group of taxGroups) {
      const taxes = await dbAll(`
        SELECT t.id, t.name, t.rate 
        FROM tax_group_links tgl 
        JOIN taxes t ON tgl.tax_id = t.id 
        WHERE tgl.group_id = ? AND t.is_active = 1
      `, [group.id]);
      group.taxes = taxes;
    }

    console.log(`Found ${taxGroups.length} tax groups in POS`);

    // Firebase에서 기존 세금 그룹 삭제
    const existingGroups = await firestore
      .collection('taxGroups')
      .where('restaurantId', '==', restaurantId)
      .get();

    const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    console.log(`Deleted ${existingGroups.size} existing tax groups from Firebase`);

    // 새 세금 그룹 업로드
    const uploadedGroups = [];
    for (const group of taxGroups) {
      const docRef = await firestore.collection('taxGroups').add({
        restaurantId,
        name: group.name,
        taxes: group.taxes.map(t => ({ name: t.name, rate: t.rate })),
        posGroupId: group.id,
        createdAt: new Date(),
        updatedAt: new Date()
      });
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
    console.log(`📥 Downloading tax groups from Firebase for restaurant: ${restaurantId}`);

    // Firebase에서 세금 그룹 가져오기
    const snapshot = await firestore
      .collection('taxGroups')
      .where('restaurantId', '==', restaurantId)
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
        'SELECT id, name FROM tax_groups WHERE name = ? AND is_active = 1',
        [fbGroup.name]
      );

      if (!posGroup) {
        // 새 세금 그룹 생성
        const result = await dbRun(
          'INSERT INTO tax_groups (name, is_active) VALUES (?, 1)',
          [fbGroup.name]
        );
        posGroup = { id: result.lastID, name: fbGroup.name };
        createdGroups++;
        console.log(`➕ Created tax group: ${fbGroup.name}`);
      } else {
        updatedGroups++;
        console.log(`🔄 Found existing tax group: ${fbGroup.name}`);
      }

      // 기존 링크 삭제
      await dbRun('DELETE FROM tax_group_links WHERE group_id = ?', [posGroup.id]);

      // 개별 세금 처리
      for (const fbTax of (fbGroup.taxes || [])) {
        // POS에서 같은 이름의 세금 찾기
        let posTax = await dbGet(
          'SELECT id FROM taxes WHERE name = ? AND is_active = 1',
          [fbTax.name]
        );

        if (!posTax) {
          // 새 세금 생성
          const result = await dbRun(
            'INSERT INTO taxes (name, rate, is_active) VALUES (?, ?, 1)',
            [fbTax.name, fbTax.rate || 0]
          );
          posTax = { id: result.lastID };
          createdTaxes++;
          console.log(`➕ Created tax: ${fbTax.name} (${fbTax.rate}%)`);
        } else {
          // 기존 세금 업데이트
          await dbRun(
            'UPDATE taxes SET rate = ? WHERE id = ?',
            [fbTax.rate || 0, posTax.id]
          );
        }

        // 그룹에 세금 연결
        await dbRun(
          'INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)',
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
        [group.group_id]
      );
      group.modifiers = modifiers;
      
      // 라벨 가져오기
      const labels = await dbAll(
        'SELECT label_id, label_name as name FROM modifier_labels WHERE group_id = ?',
        [group.group_id]
      );
      group.labels = labels;
    }
    
    console.log(`📦 POS Modifier Groups: ${posModifierGroups.length}`);
    
    // 3. 기존 Firebase Modifier 그룹 삭제
    const existingGroups = await firestore
      .collection('modifierGroups')
      .where('restaurantId', '==', restaurantId)
      .get();
    
    const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    console.log(`🗑️ Deleted ${existingGroups.size} existing Firebase Modifier Groups`);
    
    // 4. 새 Modifier 그룹 업로드
    const uploadedGroups = [];
    for (const group of posModifierGroups) {
      const docRef = await firestore.collection('modifierGroups').add({
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
        posGroupId: group.group_id,
        sortOrder: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
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
    const { generateNextId, ID_RANGES } = require('../utils/idGenerator');
    
    console.log(`📥 Downloading Modifier Groups from Firebase: ${restaurantId}`);
    
    // 1. Firebase에서 Modifier 그룹 가져오기
    const snapshot = await firestore
      .collection('modifierGroups')
      .where('restaurantId', '==', restaurantId)
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
          LEFT JOIN modifier_labels ml ON mg.group_id = ml.group_id
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
            selection_type = ?, min_selection = ?, max_selection = ?
          WHERE group_id = ?`,
          [fbGroup.selection_type || 'OPTIONAL', fbGroup.min_selection || 0, fbGroup.max_selection || 0, posGroup.group_id]
        );
        
        // 기존 옵션 삭제
        await dbRun('DELETE FROM modifier_group_links WHERE modifier_group_id = ?', [posGroup.group_id]);
        
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
            [posGroup.group_id, newModifierId]
          );
          createdModifiers++;
        }
        
        updatedGroups++;
        console.log(`✅ Updated Modifier Group: ${fbGroup.name}`);
      } else {
        // 새 그룹 생성
        const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
        
        await dbRun(
          'INSERT INTO modifier_groups (group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)',
          [newGroupId, fbGroup.name, fbGroup.selection_type || 'OPTIONAL', fbGroup.min_selection || 0, fbGroup.max_selection || 0, targetMenuId]
        );
        
        // 라벨 추가
        if (fbGroup.label) {
          const labelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
          await dbRun(
            'INSERT INTO modifier_labels (label_id, group_id, label_name) VALUES (?, ?, ?)',
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

module.exports = router;

