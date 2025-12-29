const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 데이터베이스 파일 경로
const dbPath = path.join(__dirname, 'web2pos.db');

// 데이터베이스 연결
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('데이터베이스 연결 오류:', err.message);
    return;
  }
  console.log('데이터베이스에 연결되었습니다:', dbPath);
});

// 테이블 생성
db.serialize(() => {
  // 테이블 맵 요소 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS table_map_elements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      size_width REAL NOT NULL,
      size_height REAL NOT NULL,
      rotation REAL DEFAULT 0,
      text TEXT DEFAULT '',
      fontSize REAL DEFAULT 16,
      color TEXT DEFAULT '#3B82F6',
      status TEXT DEFAULT 'Available',
      floor TEXT DEFAULT '1F',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('table_map_elements 테이블 생성 오류:', err.message);
    } else {
      console.log('table_map_elements 테이블이 생성되었습니다.');
    }
  });

  // 화면 설정 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS screen_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      scale REAL DEFAULT 1.0,
      floor TEXT DEFAULT '1F',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('screen_settings 테이블 생성 오류:', err.message);
    } else {
      console.log('screen_settings 테이블이 생성되었습니다.');
    }
  });

  // 기본 화면 크기 설정 추가
  db.run(`
    INSERT OR IGNORE INTO screen_settings (width, height, scale, floor)
    VALUES (1920, 1080, 1.0, '1F')
  `, (err) => {
    if (err) {
      console.error('기본 화면 크기 설정 추가 오류:', err.message);
    } else {
      console.log('기본 화면 크기 설정이 추가되었습니다.');
    }
  });

  // 샘플 테이블 요소 추가 (테스트용)
  const sampleElements = [
    {
      id: 'table-1',
      type: 'rounded-rectangle',
      position_x: 100,
      position_y: 100,
      size_width: 120,
      size_height: 80,
      text: 'Table 1',
      color: '#3B82F6',
      status: 'Available'
    },
    {
      id: 'table-2',
      type: 'rounded-rectangle',
      position_x: 300,
      position_y: 100,
      size_width: 120,
      size_height: 80,
      text: 'Table 2',
      color: '#10B981',
      status: 'Occupied'
    },
    {
      id: 'entrance-1',
      type: 'entrance',
      position_x: 50,
      position_y: 50,
      size_width: 100,
      size_height: 60,
      text: 'Entrance'
    },
    {
      id: 'counter-1',
      type: 'counter',
      position_x: 500,
      position_y: 50,
      size_width: 200,
      size_height: 60,
      text: 'Counter'
    }
  ];

  sampleElements.forEach(element => {
    db.run(`
      INSERT OR IGNORE INTO table_map_elements (
        id, type, position_x, position_y, size_width, size_height, 
        text, color, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      element.id, element.type, element.position_x, element.position_y,
      element.size_width, element.size_height, element.text, element.color, element.status
    ], (err) => {
      if (err) {
        console.error(`샘플 요소 ${element.id} 추가 오류:`, err.message);
      } else {
        console.log(`샘플 요소 ${element.id}이 추가되었습니다.`);
      }
    });
  });
});

// 데이터베이스 연결 종료
db.close((err) => {
  if (err) {
    console.error('데이터베이스 연결 종료 오류:', err.message);
  } else {
    console.log('데이터베이스 연결이 종료되었습니다.');
  }
}); 