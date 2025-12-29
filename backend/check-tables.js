const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./web2pos.db');

console.log('🔍 데이터베이스의 모든 테이블을 확인합니다...\n');

// 모든 테이블 목록 조회
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
  if (err) {
    console.error('❌ 오류 발생:', err);
  } else {
    if (rows.length === 0) {
      console.log('📭 데이터베이스에 테이블이 없습니다.');
    } else {
      console.log(`📊 데이터베이스에 ${rows.length}개의 테이블이 있습니다:\n`);
      rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.name}`);
      });
      console.log('');
      
      // table_map_elements와 유사한 이름의 테이블이 있는지 확인
      const tableMapTables = rows.filter(row => 
        row.name.toLowerCase().includes('table') || 
        row.name.toLowerCase().includes('map') || 
        row.name.toLowerCase().includes('element')
      );
      
      if (tableMapTables.length > 0) {
        console.log('🔍 table_map_elements와 유사한 테이블들:');
        tableMapTables.forEach(table => {
          console.log(`- ${table.name}`);
        });
        console.log('');
      }
    }
  }
  
  // 데이터베이스 연결 종료
  db.close();
  console.log('✅ 데이터베이스 연결이 종료되었습니다.');
}); 