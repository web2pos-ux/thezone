const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 === ID 18 중복 확인 ===\n');

// ID 18이 이미 존재하는지 확인
db.get('SELECT * FROM table_map_elements WHERE element_id = 18', (err, row) => {
  if (err) {
    console.error('❌ 조회 오류:', err.message);
  } else if (row) {
    console.log('⚠️ ID 18이 이미 존재합니다:');
    console.log(`  - ID: ${row.element_id}`);
    console.log(`  - 층: ${row.floor}`);
    console.log(`  - 타입: ${row.type}`);
    console.log(`  - 위치: (${row.x_pos}, ${row.y_pos})`);
    console.log(`  - 생성일: ${row.created_at}`);
  } else {
    console.log('✅ ID 18은 존재하지 않습니다.');
  }

  // 전체 ID 목록 확인
  db.all('SELECT element_id, floor, type FROM table_map_elements ORDER BY element_id', (err, rows) => {
    if (err) {
      console.error('❌ 전체 조회 오류:', err.message);
    } else {
      console.log('\n📋 전체 요소 ID 목록:');
      rows.forEach(r => console.log(`  - ID: ${r.element_id}, 층: ${r.floor}, 타입: ${r.type}`));
    }

    db.close();
    console.log('\n✅ 확인 완료');
  });
}); 
