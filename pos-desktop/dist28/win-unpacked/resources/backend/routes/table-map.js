const express = require('express');

const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db } = require('../db');

// 데이터베이스 연결 함수 (레거시 호환)
const getDatabase = () => db;

// 컬럼 보강(마이그레이션): table_map_elements.current_order_id
(() => {
  try {
    const db = getDatabase();
    db.all(`PRAGMA table_info(table_map_elements)`, [], (err, rows) => {
      if (err) { return; }
      const names = Array.isArray(rows) ? rows.map(r => r.name) : [];
      if (!names.includes('current_order_id')) {
        db.run(`ALTER TABLE table_map_elements ADD COLUMN current_order_id INTEGER`, [], (e) => {
        });
      }
    });
  } catch {}
})();

// 테이블 상태 업데이트: Payment Pending 상태 지원 (New Migration)
(() => {
  try {
    const db = getDatabase();
    
    // Check schema for Payment Pending support
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='table_map_elements'", [], (err, row) => {
       if (err) { 
         return; 
       }
       if (!row) {
         return;
       }
       
       // If 'Payment Pending' is already in the CHECK constraint, skip
       if (row.sql && row.sql.includes("'Payment Pending'")) {
         return;
       }

       console.log('Migrating table_map_elements to support Payment Pending...');
       
       db.serialize(() => {
         // Create new table with updated constraint
         db.run(`CREATE TABLE IF NOT EXISTS table_map_elements_v2 (
          element_id TEXT PRIMARY KEY,
          floor TEXT DEFAULT '1F',
          type TEXT NOT NULL,
          x_pos REAL NOT NULL,
          y_pos REAL NOT NULL,
          width REAL NOT NULL,
          height REAL NOT NULL,
          rotation REAL DEFAULT 0,
          name TEXT DEFAULT '',
          fontSize REAL DEFAULT 20,
          color TEXT DEFAULT '#3B82F6',
          status TEXT DEFAULT 'Available' CHECK(status IN ('Available', 'Occupied', 'Preparing', 'Reserved', 'Hold', 'Payment Pending')),
          current_order_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Copy data
        // Note: We copy status as is. If any invalid status existed, it might fail, but previous schema prevented it.
        db.run(`INSERT OR IGNORE INTO table_map_elements_v2 
          SELECT element_id, floor, type, x_pos, y_pos, width, height, rotation, name, fontSize, color, status, current_order_id, created_at
          FROM table_map_elements`, (err) => {
            if (err) console.error('Copy error during Payment Pending migration:', err);
          });

        // Drop old and Rename new
        db.run(`DROP TABLE table_map_elements`, (err) => {
           if (err) console.error('Drop error during Payment Pending migration:', err);
        });
        db.run(`ALTER TABLE table_map_elements_v2 RENAME TO table_map_elements`, (err) => {
           if (err) {
             console.error('Rename error during Payment Pending migration:', err);
           } else {
             console.log('✅ table_map_elements updated to support Payment Pending.');
           }
        });
       });
    });
  } catch (e) {
    console.error('Payment Pending migration error:', e);
  }
})();

// ===== 테이블 맵 요소 관리 API =====

// 1. 특정 층의 모든 요소 조회
router.get('/elements', (req, res) => {
  const { floor } = req.query;
  
  if (!floor) {
    return res.status(400).json({ error: 'floor 파라미터가 필요합니다' });
  }
  
  // console.log(` ${floor} 요소 조회 API 호출`);
  
  const db = getDatabase();
  
  const query = `
    SELECT 
      t.element_id,
      t.floor,
      t.type,
      t.x_pos,
      t.y_pos,
      t.width,
      t.height,
      t.rotation,
      t.name,
      t.fontSize,
      t.color,
      t.status,
      t.current_order_id,
      t.created_at,
      o.status AS order_status
    FROM table_map_elements t
    LEFT JOIN orders o ON t.current_order_id = o.id
    WHERE t.floor = ?
    ORDER BY t.element_id
  `;
  
  db.all(query, [floor], (err, rows) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    if (err) {
      console.error(`❌ ${floor} 요소 조회 API: 500 (데이터베이스 오류)`, err);
      return res.status(500).json({ error: '데이터베이스 오류' });
    }
    
    // Normalize: never keep Occupied-like status without a valid linked order.
    // If current_order_id is null OR the linked order is missing/closed, force status to Available.
    try {
      (rows || []).forEach((row) => {
        const st = String(row?.status || 'Available');
        const isOccupiedLike = st === 'Occupied' || st === 'Payment Pending';
        const hasOrderId = row?.current_order_id != null && String(row.current_order_id) !== '';
        const orderStatus = String(row?.order_status || '');
        const isClosedOrder = orderStatus && (orderStatus.toUpperCase() === 'PAID' || orderStatus.toUpperCase() === 'VOIDED');
        const isMissingOrder = hasOrderId && !orderStatus; // current_order_id points to non-existing order

        if (isOccupiedLike && (!hasOrderId || isClosedOrder || isMissingOrder)) {
          row.status = 'Available';
          row.current_order_id = null;
          try {
            db.run(
              `UPDATE table_map_elements SET status = 'Available', current_order_id = NULL WHERE element_id = ?`,
              [row.element_id],
              () => {}
            );
          } catch {}
        }
        // Remove legacy 'Preparing' status entirely.
        if (String(row?.status || '') === 'Preparing') {
          row.status = 'Available';
          row.current_order_id = null;
          try {
            db.run(
              `UPDATE table_map_elements SET status = 'Available', current_order_id = NULL WHERE element_id = ?`,
              [row.element_id],
              () => {}
            );
          } catch {}
        }
      });
    } catch {}

    // 데이터 변환: 데이터베이스 컬럼명을 프론트엔드 형식으로
    const elements = rows.map(row => ({
      id: row.element_id,
      floor: row.floor,
      type: row.type,
      position: {
        x: row.x_pos,
        y: row.y_pos
      },
      size: {
        width: row.width,
        height: row.height
      },
      rotation: row.rotation || 0,
      text: row.name || '',
      fontSize: row.fontSize || 20,
      color: row.color || '#3B82F6',
      status: row.status || 'Available',
      current_order_id: row.current_order_id || null
    }));
    
    // console.log(`✅ ${floor} 요소 조회 완료: ${elements.length}개`);
    res.json(elements);
  });
});

// 1-1. 단일 요소 상태 변경
router.patch('/elements/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ error: 'status 값이 필요합니다' });
  }

  const db = getDatabase();
  const statusToSave = String(status) === 'Preparing' ? 'Available' : status;
  
  // Payment Pending 상태 유지를 위한 로직:
  // 클라이언트가 'Occupied'로 변경을 요청할 때, 현재 상태가 'Payment Pending'이면 변경을 무시하거나 Payment Pending으로 유지해야 하는 경우를 체크할 수도 있지만,
  // 여기서는 단순 업데이트만 수행하고 로직 제어는 프론트엔드/비즈니스 로직에서 담당하도록 함.
  // 다만, 실수로 덮어쓰는 것을 방지하기 위해 현재 상태를 체크하는 옵션을 추가할 수 있음 (선택사항)
  
  // Special handling for Payment Pending:
  // If trying to set 'Occupied', check if current is 'Payment Pending'.
  // If so, ONLY allow update if explicitly forced (not implemented here yet) or if business logic handled it.
  // For now, we trust the frontend sends the correct intended status.
  // But to be safe against simple overwrites (like page load refresh):
  // If the new status is 'Occupied' and the current status is 'Payment Pending', we might want to BLOCK it unless it's a 'New Order' action.
  // However, distinguishing 'New Order' action here is hard without extra params.
  // Let's rely on the Frontend sending the correct status.

  const query = 'UPDATE table_map_elements SET status = ? WHERE element_id = ?';
  db.run(query, [statusToSave, id], function(err) {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) {
      console.error('요소 상태 업데이트 오류:', err);
      return res.status(500).json({ error: '요소 상태 업데이트 실패' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: '해당 요소를 찾을 수 없습니다' });
    }
    res.json({ message: '요소 상태 업데이트 성공', elementId: Number(id), status: statusToSave });
  });
});

// 요소 단건 조회
router.get('/elements/:id', (req, res) => {
  const { id } = req.params;
  const db = getDatabase();
  const q = `SELECT element_id, floor, type, x_pos, y_pos, width, height, rotation, name, fontSize, color, status, current_order_id FROM table_map_elements WHERE element_id = ?`;
  db.get(q, [id], (err, row) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) return res.status(500).json({ error: '조회 실패' });
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({
      id: row.element_id,
      floor: row.floor,
      type: row.type,
      position: { x: row.x_pos, y: row.y_pos },
      size: { width: row.width, height: row.height },
      rotation: row.rotation || 0,
      text: row.name || '',
      fontSize: row.fontSize || 20,
      color: row.color || '#3B82F6',
      status: row.status || 'Available',
      current_order_id: row.current_order_id || null
    });
  });
});

// current_order_id 설정/해제
router.patch('/elements/:id/current-order', (req, res) => {
  const { id } = req.params;
  const { orderId } = req.body || {};
  const db = getDatabase();
  const q = 'UPDATE table_map_elements SET current_order_id = ? WHERE element_id = ?';
  db.run(q, [orderId || null, id], function(err){
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) return res.status(500).json({ error: '업데이트 실패' });
    if (this.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ success:true, elementId: Number(id), current_order_id: orderId || null });
  });
});

// 2. 요소 저장 (여러 개) - Promise 기반 간단한 로직
router.post('/elements', async (req, res) => {
  const { elements } = req.body;
  
  console.log('📥 받은 요청 데이터:', JSON.stringify(req.body, null, 2));
  
  if (!Array.isArray(elements)) {
    console.log('❌ elements가 배열이 아님:', typeof elements);
    return res.status(400).json({ error: 'elements 배열이 필요합니다' });
  }

  const floor = req.body.floor || (elements[0] && elements[0].floor) || '1F';

  // 빈 배열: 해당 Floor의 모든 요소 삭제
  if (elements.length === 0) {
    console.log('❌ elements 배열이 비어있음 - 해당 Floor의 모든 요소 삭제');
    try {
      const { dbRun } = require('../db');
      await dbRun('DELETE FROM table_map_elements WHERE floor = ?', [floor]);
      console.log(`✅ ${floor} Floor의 모든 요소 삭제 완료`);
      return res.json({ message: `${floor} Floor의 모든 요소 삭제 완료`, floor });
    } catch (err) {
      console.error('Floor 요소 삭제 오류:', err);
      return res.status(500).json({ error: 'Floor 요소 삭제 실패' });
    }
  }

  // 각 요소의 필수 필드 검증
  const invalidElements = elements.filter(element => {
    if (!element.id || !element.floor || !element.type || !element.position || !element.size) {
      console.log('❌ 필수 필드 누락:', element);
      return true;
    }
    if (element.position.x === undefined || element.position.y === undefined || element.size.width === undefined || element.size.height === undefined) {
      console.log('❌ position 또는 size 필드 누락:', element);
      return true;
    }
    return false;
  });

  if (invalidElements.length > 0) {
    console.log('❌ 유효하지 않은 요소들:', invalidElements);
    return res.status(400).json({ 
      error: `${invalidElements.length}개 요소의 필수 필드가 누락되었습니다`,
      invalidElements 
    });
  }

  console.log(`✅ ${elements.length}개 요소 검증 완료, 저장 시작`);

  // 재시도 로직 포함 트랜잭션 기반 저장
  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { dbRun } = require('../db');
      
      // 트랜잭션 시작 (IMMEDIATE: 쓰기 락을 즉시 획득하여 동시 쓰기 충돌 방지)
      await dbRun('BEGIN IMMEDIATE');
      
      try {
        // 1. 해당 floor의 모든 요소 삭제
        await dbRun('DELETE FROM table_map_elements WHERE floor = ?', [floor]);
        console.log(`✅ ${floor} Floor 기존 요소 삭제 완료`);
        
        // 2. 저장할 요소들의 ID가 다른 floor에 있으면 삭제 (ID 충돌 방지)
        const elementIds = elements.map(el => String(el.id));
        if (elementIds.length > 0) {
          const placeholders = elementIds.map(() => '?').join(',');
          await dbRun(`DELETE FROM table_map_elements WHERE element_id IN (${placeholders})`, elementIds);
          console.log(`✅ 기존 중복 ID 삭제 완료`);
        }
        
        // 3. 새 요소 삽입 (하나씩)
        for (const element of elements) {
          const statusToSave = String(element.status || 'Available') === 'Preparing' ? 'Available' : (element.status || 'Available');
          await dbRun(`
            INSERT INTO table_map_elements (
              element_id, floor, type, x_pos, y_pos, width, height, rotation, 
              name, fontSize, color, status, current_order_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            String(element.id),
            element.floor,
            element.type,
            element.position.x,
            element.position.y,
            element.size.width,
            element.size.height,
            element.rotation || 0,
            element.text || '',
            element.fontSize || 20,
            element.color || '#3B82F6',
            statusToSave,
            element.current_order_id || null
          ]);
        }
        
        // 트랜잭션 커밋
        await dbRun('COMMIT');
        console.log(`✅ ${elements.length}개 요소 저장 완료 (attempt ${attempt})`);
        return res.json({ message: '저장 성공', count: elements.length });
      } catch (innerErr) {
        // 트랜잭션 롤백
        try { await dbRun('ROLLBACK'); } catch (rbErr) { console.error('Rollback error:', rbErr); }
        throw innerErr;
      }
    } catch (err) {
      lastError = err;
      console.error(`요소 저장 오류 (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
      
      // SQLITE_BUSY 에러면 재시도, 아니면 즉시 실패
      if (err.message && (err.message.includes('SQLITE_BUSY') || err.message.includes('database is locked')) && attempt < MAX_RETRIES) {
        const delay = attempt * 500; // 500ms, 1000ms 대기
        console.log(`⏳ ${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      break;
    }
  }

  console.error('요소 저장 최종 실패:', lastError);
  return res.status(500).json({ error: '데이터 저장 실패: ' + (lastError ? lastError.message : 'unknown error') });
});

// ===== Screen Size 설정 API =====

// 테이블 생성 (없으면)
(() => {
  try {
    const db = getDatabase();
    db.run(`CREATE TABLE IF NOT EXISTS table_map_screen_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor TEXT NOT NULL UNIQUE,
      width INTEGER NOT NULL DEFAULT 1024,
      height INTEGER NOT NULL DEFAULT 768,
      scale REAL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
      if (err) console.error('Failed to create table_map_screen_settings:', err);
      // db.close(); // Shared DB 연결은 닫으면 안 됨
    });
  } catch (e) {
    console.error('Error creating table_map_screen_settings:', e);
  }
})();

// GET /api/table-map/screen-size - 화면 크기 조회
router.get('/screen-size', (req, res) => {
  const { floor } = req.query;
  const targetFloor = floor || '1F';
  
  const db = getDatabase();
  
  db.get(
    'SELECT width, height, scale FROM table_map_screen_settings WHERE floor = ?',
    [targetFloor],
    (err, row) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      
      if (err) {
        console.error('Screen size 조회 오류:', err);
        return res.status(500).json({ error: '데이터베이스 오류' });
      }
      
      if (row) {
        res.json({
          floor: targetFloor,
          width: row.width,
          height: row.height,
          scale: row.scale || 1
        });
      } else {
        // 기본값 반환
        res.json({
          floor: targetFloor,
          width: 1024,
          height: 768,
          scale: 1
        });
      }
    }
  );
});

// POST /api/table-map/screen-size - 화면 크기 저장
router.post('/screen-size', (req, res) => {
  const { width, height, scale, floor } = req.body;
  
  if (!width || !height) {
    return res.status(400).json({ error: 'width와 height가 필요합니다' });
  }
  
  const targetFloor = floor || '1F';
  const targetWidth = parseInt(width) || 1024;
  const targetHeight = parseInt(height) || 768;
  const targetScale = parseFloat(scale) || 1;
  
  const db = getDatabase();
  
  // UPSERT: 있으면 업데이트, 없으면 삽입
  db.run(
    `INSERT INTO table_map_screen_settings (floor, width, height, scale, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(floor) DO UPDATE SET
       width = excluded.width,
       height = excluded.height,
       scale = excluded.scale,
       updated_at = CURRENT_TIMESTAMP`,
    [targetFloor, targetWidth, targetHeight, targetScale],
    function(err) {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      
      if (err) {
        console.error('Screen size 저장 오류:', err);
        return res.status(500).json({ error: '데이터베이스 저장 실패' });
      }
      
      console.log(`✅ Screen size saved: ${targetFloor} = ${targetWidth}×${targetHeight}`);
      
      res.json({
        success: true,
        floor: targetFloor,
        width: targetWidth,
        height: targetHeight,
        scale: targetScale
      });
    }
  );
});

// GET /api/table-map/screen-size/all - 모든 Floor의 화면 크기 조회
router.get('/screen-size/all', (req, res) => {
  const db = getDatabase();
  
  db.all(
    'SELECT floor, width, height, scale FROM table_map_screen_settings ORDER BY floor',
    [],
    (err, rows) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      
      if (err) {
        console.error('Screen size 전체 조회 오류:', err);
        return res.status(500).json({ error: '데이터베이스 오류' });
      }
      
      res.json(rows || []);
    }
  );
});

module.exports = router;