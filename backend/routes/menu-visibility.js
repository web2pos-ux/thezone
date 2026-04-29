/**
 * Menu Visibility API
 * 메뉴 아이템의 온라인/딜리버리 표시 여부 관리
 * Firebase 실시간 동기화 지원
 */

const express = require('express');
const router = express.Router();
const { syncMenuItemVisibility, syncCategoryVisibility, getMenuVisibilityFromFirebase } = require('../services/firebaseService');
const IdMapperService = require('../services/idMapperService');

module.exports = (db) => {
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // ===== 카테고리 목록 조회 =====
  // GET /api/menu-visibility/categories
  router.get('/categories', async (req, res) => {
    try {
      const { menu_id } = req.query;
      
      let query = `
        SELECT 
          mc.category_id,
          mc.name,
          mc.menu_id,
          COUNT(mi.item_id) as item_count,
          SUM(CASE WHEN mi.online_visible = 0 THEN 1 ELSE 0 END) as hidden_online_count,
          SUM(CASE WHEN mi.delivery_visible = 0 THEN 1 ELSE 0 END) as hidden_delivery_count
        FROM menu_categories mc
        LEFT JOIN menu_items mi ON mc.category_id = mi.category_id
        WHERE mc.name != 'Open Price'
      `;
      
      const params = [];
      if (menu_id) {
        query += ' AND mc.menu_id = ?';
        params.push(menu_id);
      }
      
      query += ' GROUP BY mc.category_id ORDER BY mc.sort_order, mc.name';
      
      const categories = await dbAll(query, params);
      res.json({ success: true, categories });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Categories error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 카테고리별 메뉴 아이템 조회 =====
  // GET /api/menu-visibility/items/:categoryId
  router.get('/items/:categoryId', async (req, res) => {
    try {
      const { categoryId } = req.params;
      
      const items = await dbAll(`
        SELECT 
          item_id,
          name,
          price,
          category_id,
          COALESCE(online_visible, 1) as online_visible,
          COALESCE(delivery_visible, 1) as delivery_visible,
          COALESCE(online_hide_type, 'visible') as online_hide_type,
          online_available_until,
          online_available_from,
          COALESCE(delivery_hide_type, 'visible') as delivery_hide_type,
          delivery_available_until,
          delivery_available_from
        FROM menu_items
        WHERE category_id = ?
        ORDER BY sort_order, name
      `, [categoryId]);
      
      res.json({ success: true, items });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Items error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 숨겨진 메뉴 아이템 목록 조회 =====
  // GET /api/menu-visibility/hidden
  router.get('/hidden', async (req, res) => {
    try {
      const items = await dbAll(`
        SELECT 
          mi.item_id,
          mi.name,
          mi.price,
          mi.category_id,
          mc.name as category_name,
          COALESCE(mi.online_visible, 1) as online_visible,
          COALESCE(mi.delivery_visible, 1) as delivery_visible
        FROM menu_items mi
        LEFT JOIN menu_categories mc ON mi.category_id = mc.category_id
        WHERE mi.online_visible = 0 OR mi.delivery_visible = 0
        ORDER BY mc.name, mi.name
      `);
      
      res.json({ success: true, items });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Hidden items error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 메뉴 아이템 visibility 업데이트 =====
  // PUT /api/menu-visibility/item/:itemId
  // hide_type: 'visible' | 'permanent' | 'time_limited'
  // available_until: 'HH:MM' 형식 (time_limited인 경우)
  router.put('/item/:itemId', async (req, res) => {
    try {
      const { itemId } = req.params;
      const { 
        online_visible, delivery_visible,
        online_hide_type, online_available_until, online_available_from,
        delivery_hide_type, delivery_available_until, delivery_available_from
      } = req.body;
      
      // 업데이트할 필드만 처리
      const updates = [];
      const params = [];
      
      // Online visibility
      if (typeof online_visible === 'number' || typeof online_visible === 'boolean') {
        updates.push('online_visible = ?');
        params.push(online_visible ? 1 : 0);
      }
      if (online_hide_type) {
        updates.push('online_hide_type = ?');
        params.push(online_hide_type);
        // hide_type에 따라 online_visible 자동 설정
        if (online_hide_type === 'visible') {
          updates.push('online_visible = 1');
        } else if (online_hide_type === 'permanent') {
          updates.push('online_visible = 0');
        }
        // time_limited는 visible = 1 유지 (시간 체크는 프론트에서)
      }
      if (online_available_until !== undefined) {
        updates.push('online_available_until = ?');
        params.push(online_available_until || null);
      }
      if (online_available_from !== undefined) {
        updates.push('online_available_from = ?');
        params.push(online_available_from || null);
      }
      
      // Delivery visibility
      if (typeof delivery_visible === 'number' || typeof delivery_visible === 'boolean') {
        updates.push('delivery_visible = ?');
        params.push(delivery_visible ? 1 : 0);
      }
      if (delivery_hide_type) {
        updates.push('delivery_hide_type = ?');
        params.push(delivery_hide_type);
        if (delivery_hide_type === 'visible') {
          updates.push('delivery_visible = 1');
        } else if (delivery_hide_type === 'permanent') {
          updates.push('delivery_visible = 0');
        }
      }
      if (delivery_available_until !== undefined) {
        updates.push('delivery_available_until = ?');
        params.push(delivery_available_until || null);
      }
      if (delivery_available_from !== undefined) {
        updates.push('delivery_available_from = ?');
        params.push(delivery_available_from || null);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No visibility fields provided' });
      }
      
      params.push(itemId);
      
      await dbRun(`UPDATE menu_items SET ${updates.join(', ')} WHERE item_id = ?`, params);
      
      // Firebase 자동 동기화 - business_profile에서 Firebase Restaurant ID 조회
      const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
      const restaurantId = restaurantIdRow?.firebase_restaurant_id;
      
      if (restaurantId) {
        try {
          // IdMapperService로 Firebase ID 조회
          const firebaseItemId = await IdMapperService.localToFirebase('menu_item', itemId);
          
          if (firebaseItemId) {
            // 현재 아이템의 visibility 상태 조회 (세부 필드 포함)
            const currentItem = await dbGet(`
              SELECT online_visible, delivery_visible, 
                     online_hide_type, online_available_until, online_available_from,
                     delivery_hide_type, delivery_available_until, delivery_available_from 
              FROM menu_items WHERE item_id = ?
            `, [itemId]);
            
            await syncMenuItemVisibility(
              restaurantId,
              null, // categoryId는 menuItems 컬렉션에서 불필요
              firebaseItemId,
              {
                onlineVisible: currentItem?.online_visible === 1,
                deliveryVisible: currentItem?.delivery_visible === 1,
                onlineHideType: currentItem?.online_hide_type || 'visible',
                onlineAvailableUntil: currentItem?.online_available_until || null,
                onlineAvailableFrom: currentItem?.online_available_from || null,
                deliveryHideType: currentItem?.delivery_hide_type || 'visible',
                deliveryAvailableUntil: currentItem?.delivery_available_until || null,
                deliveryAvailableFrom: currentItem?.delivery_available_from || null
              }
            );
            console.log(`[MENU-VISIBILITY] Firebase sync: ${itemId} → ${firebaseItemId}`);
          } else {
            console.log(`[MENU-VISIBILITY] No Firebase mapping for item ${itemId}`);
          }
        } catch (firebaseError) {
          console.warn('[MENU-VISIBILITY] Firebase sync failed (non-blocking):', firebaseError.message);
        }
      }
      
      console.log(`[MENU-VISIBILITY] Updated item ${itemId}: online=${online_visible}, delivery=${delivery_visible}`);
      res.json({ success: true, message: 'Visibility updated', itemId, firebaseSynced: !!restaurantId });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Update error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 여러 아이템 visibility 일괄 업데이트 =====
  // PUT /api/menu-visibility/bulk
  router.put('/bulk', async (req, res) => {
    try {
      const { items } = req.body;
      
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Items array is required' });
      }
      
      let updatedCount = 0;
      
      for (const item of items) {
        const { itemId, online_visible, delivery_visible } = item;
        
        if (!itemId) continue;
        
        const updates = [];
        const params = [];
        
        if (typeof online_visible === 'number' || typeof online_visible === 'boolean') {
          updates.push('online_visible = ?');
          params.push(online_visible ? 1 : 0);
        }
        
        if (typeof delivery_visible === 'number' || typeof delivery_visible === 'boolean') {
          updates.push('delivery_visible = ?');
          params.push(delivery_visible ? 1 : 0);
        }
        
        if (updates.length > 0) {
          params.push(itemId);
          await dbRun(`UPDATE menu_items SET ${updates.join(', ')} WHERE item_id = ?`, params);
          updatedCount++;
        }
      }
      
      console.log(`[MENU-VISIBILITY] Bulk updated ${updatedCount} items`);
      res.json({ success: true, message: `${updatedCount} items updated` });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Bulk update error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 카테고리 전체 visibility 업데이트 =====
  // PUT /api/menu-visibility/category/:categoryId
  router.put('/category/:categoryId', async (req, res) => {
    try {
      const { categoryId } = req.params;
      const { online_visible, delivery_visible } = req.body;
      
      const updates = [];
      const params = [];
      
      if (typeof online_visible === 'number' || typeof online_visible === 'boolean') {
        updates.push('online_visible = ?');
        params.push(online_visible ? 1 : 0);
      }
      
      if (typeof delivery_visible === 'number' || typeof delivery_visible === 'boolean') {
        updates.push('delivery_visible = ?');
        params.push(delivery_visible ? 1 : 0);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No visibility fields provided' });
      }
      
      params.push(categoryId);
      
      const result = await dbRun(`UPDATE menu_items SET ${updates.join(', ')} WHERE category_id = ?`, params);
      
      // Firebase 자동 동기화 - business_profile에서 Firebase Restaurant ID 조회
      const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
      const restaurantId = restaurantIdRow?.firebase_restaurant_id;
      
      if (restaurantId) {
        try {
          // IdMapperService로 Firebase Category ID 조회
          const firebaseCategoryId = await IdMapperService.localToFirebase('category', categoryId);
          
          if (firebaseCategoryId) {
            await syncCategoryVisibility(
              restaurantId,
              firebaseCategoryId,
              typeof online_visible === 'boolean' || typeof online_visible === 'number' 
                ? (online_visible ? true : false) : undefined,
              typeof delivery_visible === 'boolean' || typeof delivery_visible === 'number'
                ? (delivery_visible ? true : false) : undefined
            );
            console.log(`[MENU-VISIBILITY] Firebase category sync: ${categoryId} → ${firebaseCategoryId}`);
          }
        } catch (firebaseError) {
          console.warn('[MENU-VISIBILITY] Firebase category sync failed (non-blocking):', firebaseError.message);
        }
      }
      
      console.log(`[MENU-VISIBILITY] Updated category ${categoryId}: ${result.changes} items`);
      res.json({ success: true, message: `${result.changes} items updated`, categoryId, firebaseSynced: !!restaurantId });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Category update error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 아이템 visibility 리셋 (모두 보이게) =====
  // POST /api/menu-visibility/reset
  router.post('/reset', async (req, res) => {
    try {
      const { itemIds, categoryId } = req.body;
      
      let result;
      
      if (categoryId) {
        result = await dbRun(
          'UPDATE menu_items SET online_visible = 1, delivery_visible = 1 WHERE category_id = ?',
          [categoryId]
        );
      } else if (Array.isArray(itemIds) && itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',');
        result = await dbRun(
          `UPDATE menu_items SET online_visible = 1, delivery_visible = 1 WHERE item_id IN (${placeholders})`,
          itemIds
        );
      } else {
        return res.status(400).json({ success: false, error: 'itemIds or categoryId is required' });
      }
      
      console.log(`[MENU-VISIBILITY] Reset ${result.changes} items to visible`);
      res.json({ success: true, message: `${result.changes} items reset to visible` });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Reset error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== Firebase에서 visibility 동기화 (POS ← Firebase) =====
  // POST /api/menu-visibility/sync-from-firebase
  router.post('/sync-from-firebase', async (req, res) => {
    try {
      const { restaurantId } = req.body;
      
      if (!restaurantId) {
        return res.status(400).json({ success: false, error: 'restaurantId is required' });
      }
      
      // Firebase에서 visibility 정보 가져오기
      const firebaseItems = await getMenuVisibilityFromFirebase(restaurantId);
      
      let updatedCount = 0;
      for (const item of firebaseItems) {
        // 아이템 이름으로 POS의 item_id 찾기
        const posItem = await dbGet(
          'SELECT item_id FROM menu_items WHERE name = ?',
          [item.itemName]
        );
        
        if (posItem) {
          await dbRun(
            'UPDATE menu_items SET online_visible = ?, delivery_visible = ? WHERE item_id = ?',
            [item.onlineVisible ? 1 : 0, item.deliveryVisible ? 1 : 0, posItem.item_id]
          );
          updatedCount++;
        }
      }
      
      console.log(`[MENU-VISIBILITY] Synced ${updatedCount} items from Firebase`);
      res.json({ success: true, message: `${updatedCount} items synced from Firebase`, firebaseItems: firebaseItems.length });
    } catch (error) {
      console.error('[MENU-VISIBILITY] Firebase sync error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
