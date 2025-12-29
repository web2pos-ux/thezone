const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();
const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');

// 데이터베이스 연결 함수
const connectDB = () => {
  return new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
    }
  });
};

// 레이아웃 설정 테이블 생성 (테이블이 없을 경우)
const initializeLayoutSettingsTable = () => {
  const db = connectDB();
  
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS layout_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settings_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  db.run(createTableSQL, (err) => {
    if (err) {
      console.error('Error creating layout_settings table:', err.message);
    } else {
      console.log('Layout settings table initialized successfully');
    }
  });
  
  db.close();
};

// 테이블 초기화 실행
initializeLayoutSettingsTable();

// POST /api/layout-settings - 레이아웃 설정 저장
router.post('/', (req, res) => {
  const db = connectDB();
  const settingsData = JSON.stringify(req.body);
  
  console.log('💾 Saving layout settings to database:', req.body);
  
  // 기존 설정이 있는지 확인
  const checkSQL = 'SELECT id FROM layout_settings LIMIT 1';
  
  db.get(checkSQL, (err, row) => {
    if (err) {
      console.error('Error checking existing settings:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    
    if (row) {
      // 기존 설정 업데이트
      const updateSQL = `
        UPDATE layout_settings 
        SET settings_data = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `;
      
      db.run(updateSQL, [settingsData, row.id], function(err) {
        if (err) {
          console.error('Error updating layout settings:', err.message);
          return res.status(500).json({ error: 'Failed to update settings', details: err.message });
        }
        
        console.log('✅ Layout settings updated successfully');
        res.json({ 
          success: true, 
          message: 'Layout settings updated successfully',
          id: row.id
        });
      });
    } else {
      // 새 설정 삽입
      const insertSQL = `
        INSERT INTO layout_settings (settings_data) 
        VALUES (?)
      `;
      
      db.run(insertSQL, [settingsData], function(err) {
        if (err) {
          console.error('Error inserting layout settings:', err.message);
          return res.status(500).json({ error: 'Failed to save settings', details: err.message });
        }
        
        console.log('✅ Layout settings saved successfully');
        res.json({ 
          success: true, 
          message: 'Layout settings saved successfully',
          id: this.lastID
        });
      });
    }
    
    db.close();
  });
});

// GET /api/layout-settings - 레이아웃 설정 불러오기
router.get('/', (req, res) => {
  const db = connectDB();
  
  console.log('📥 Loading layout settings from database');
  
  const selectSQL = `
    SELECT settings_data, updated_at 
    FROM layout_settings 
    ORDER BY updated_at DESC 
    LIMIT 1
  `;
  
  db.get(selectSQL, (err, row) => {
    if (err) {
      console.error('Error loading layout settings:', err.message);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }
    
    if (row) {
      try {
        const settings = JSON.parse(row.settings_data);
        console.log('✅ Layout settings loaded successfully');
        res.json({
          success: true,
          data: settings,
          updated_at: row.updated_at
        });
      } catch (parseErr) {
        console.error('Error parsing settings data:', parseErr.message);
        res.status(500).json({ error: 'Failed to parse settings data', details: parseErr.message });
      }
    } else {
      console.log('📭 No layout settings found');
      res.json({ 
        success: true, 
        data: null,
        message: 'No layout settings found' 
      });
    }
    
    db.close();
  });
});

// DELETE /api/layout-settings - 레이아웃 설정 초기화
router.delete('/', (req, res) => {
  const db = connectDB();
  
  console.log('🗑️ Deleting all layout settings');
  
  const deleteSQL = 'DELETE FROM layout_settings';
  
  db.run(deleteSQL, function(err) {
    if (err) {
      console.error('Error deleting layout settings:', err.message);
      return res.status(500).json({ error: 'Failed to delete settings', details: err.message });
    }
    
    console.log('✅ Layout settings deleted successfully');
    res.json({ 
      success: true, 
      message: 'Layout settings deleted successfully',
      deletedCount: this.changes
    });
    
    db.close();
  });
});

module.exports = router; 