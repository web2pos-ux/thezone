const express = require('express');
const router = express.Router();
const { getLocalDatetimeString } = require('../utils/datetimeUtils');

// 메인 DB를 전달받아 사용
module.exports = (db) => {
  // Helper function
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

  // 테이블 생성 (없는 경우)
  const initTable = async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS order_page_setups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_type TEXT NOT NULL UNIQUE,
        menu_id INTEGER NOT NULL,
        menu_name TEXT NOT NULL,
        price_type TEXT DEFAULT 'price',
        created_at TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add price_type column if it doesn't exist (for existing tables)
    try {
      await dbRun(`ALTER TABLE order_page_setups ADD COLUMN price_type TEXT DEFAULT 'price'`);
      console.log('[order-page-setups] Added price_type column');
    } catch (err) {
      // Column already exists, ignore error
    }
    
    console.log('[order-page-setups] Table initialized');
  };

  initTable().catch(err => console.error('Failed to init order_page_setups table:', err));

  // GET: 저장된 설정 목록 조회
  router.get('/', async (req, res) => {
    try {
      const rows = await dbAll(`
        SELECT id, order_type, menu_id, menu_name, price_type, created_at, updated_at
        FROM order_page_setups
        ORDER BY created_at DESC
      `);

      res.json({
        success: true,
        data: rows.map(row => ({
          id: row.id,
          orderType: row.order_type,
          menuId: row.menu_id,
          menuName: row.menu_name,
          priceType: row.price_type === 'price1' ? 'price' : (row.price_type || 'price'),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      });
    } catch (err) {
      console.error('Error fetching order page setups:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch order page setups',
        details: err.message 
      });
    }
  });

  // GET: 특정 설정 조회
  router.get('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
      const row = await dbGet(`
        SELECT id, order_type, menu_id, menu_name, price_type, created_at, updated_at
        FROM order_page_setups
        WHERE id = ?
      `, [id]);

      if (!row) {
        return res.status(404).json({ 
          success: false, 
          error: 'Order page setup not found' 
        });
      }

      res.json({
        success: true,
        data: {
          id: row.id,
          orderType: row.order_type,
          menuId: row.menu_id,
          menuName: row.menu_name,
          priceType: row.price_type === 'price1' ? 'price' : (row.price_type || 'price'),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      });
    } catch (err) {
      console.error('Error fetching order page setup:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch order page setup',
        details: err.message 
      });
    }
  });

  // POST: 새로운 설정 저장 (같은 order_type이 있으면 업데이트)
  router.post('/', async (req, res) => {
    const { orderType, menuId, menuName, priceType } = req.body;

    if (!orderType || !menuId || !menuName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderType, menuId, menuName'
      });
    }

    const createdAt = getLocalDatetimeString();
    const validPriceType = priceType === 'price2' ? 'price2' : 'price';
    
    try {
      // UPSERT: 같은 order_type이 있으면 업데이트, 없으면 삽입
      await dbRun(`
        INSERT INTO order_page_setups (order_type, menu_id, menu_name, price_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_type) DO UPDATE SET
          menu_id = excluded.menu_id,
          menu_name = excluded.menu_name,
          price_type = excluded.price_type,
          updated_at = excluded.updated_at
      `, [orderType, menuId, menuName, validPriceType, createdAt, createdAt]);

      // 저장된 설정 조회
      const saved = await dbGet(`
        SELECT id, order_type, menu_id, menu_name, price_type, created_at, updated_at
        FROM order_page_setups
        WHERE order_type = ?
      `, [orderType]);

      res.status(201).json({
        success: true,
        message: 'Order page setup saved successfully',
        data: {
          id: saved.id,
          orderType: saved.order_type,
          menuId: saved.menu_id,
          menuName: saved.menu_name,
          priceType: saved.price_type === 'price1' ? 'price' : (saved.price_type || 'price'),
          createdAt: saved.created_at,
          updatedAt: saved.updated_at
        }
      });
    } catch (err) {
      console.error('Error saving order page setup:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to save order page setup',
        details: err.message 
      });
    }
  });

  // PUT: 기존 설정 업데이트
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { orderType, menuId, menuName, priceType } = req.body;

    if (!orderType || !menuId || !menuName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderType, menuId, menuName'
      });
    }

    const updatedAt = getLocalDatetimeString();
    const validPriceType = priceType === 'price2' ? 'price2' : 'price';
    
    try {
      const result = await dbRun(`
        UPDATE order_page_setups 
        SET order_type = ?, menu_id = ?, menu_name = ?, price_type = ?, updated_at = ?
        WHERE id = ?
      `, [orderType, menuId, menuName, validPriceType, updatedAt, id]);

      if (result.changes === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Order page setup not found' 
        });
      }

      res.json({
        success: true,
        message: 'Order page setup updated successfully',
        data: {
          id: parseInt(id),
          orderType,
          menuId,
          menuName,
          priceType: validPriceType,
          updatedAt
        }
      });
    } catch (err) {
      console.error('Error updating order page setup:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to update order page setup',
        details: err.message 
      });
    }
  });

  // DELETE: 설정 삭제
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
      const result = await dbRun(`DELETE FROM order_page_setups WHERE id = ?`, [id]);

      if (result.changes === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Order page setup not found' 
        });
      }

      res.json({
        success: true,
        message: 'Order page setup deleted successfully'
      });
    } catch (err) {
      console.error('Error deleting order page setup:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to delete order page setup',
        details: err.message 
      });
    }
  });

  // GET: 특정 주문 타입의 설정 조회
  router.get('/type/:orderType', async (req, res) => {
    const { orderType } = req.params;
    
    try {
      const rows = await dbAll(`
        SELECT id, order_type, menu_id, menu_name, price_type, created_at, updated_at
        FROM order_page_setups
        WHERE order_type = ?
        ORDER BY created_at DESC
      `, [orderType]);

      res.json({
        success: true,
        data: rows.map(row => ({
          id: row.id,
          orderType: row.order_type,
          menuId: row.menu_id,
          menuName: row.menu_name,
          priceType: row.price_type === 'price1' ? 'price' : (row.price_type || 'price'),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      });
    } catch (err) {
      console.error('Error fetching order page setups by type:', err);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch order page setups by type',
        details: err.message 
      });
    }
  });

  return router;
};
