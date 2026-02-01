const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.resolve(__dirname, '..', 'db', 'web2pos.db'));

console.log('🔍 Patio 층의 테이블 맵 요소들을 확인합니다...\n');

// Patio 층의 모든 요소 조회
db.all('SELECT * FROM table_map_elements WHERE floor = ?', ['Patio'], (err, rows) => {
  if (err) {
    console.error('❌ 오류 발생:', err);
  } else {
    if (rows.length === 0) {
      console.log('📭 Patio 층에는 테이블 맵 요소가 없습니다.');
    } else {
      console.log(`📊 Patio 층에 ${rows.length}개의 요소가 있습니다:\n`);
      rows.forEach((row, index) => {
        console.log(`--- 요소 ${index + 1} ---`);
        console.log(`ID: ${row.element_id}`);
        console.log(`타입: ${row.type}`);
        console.log(`위치: x=${row.position_x}, y=${row.position_y}`);
        console.log(`크기: width=${row.size_width}, height=${row.size_height}`);
        console.log(`회전: ${row.rotation}도`);
        console.log(`텍스트: ${row.text || '없음'}`);
        console.log(`색상: ${row.color || '기본값'}`);
        console.log(`상태: ${row.status || 'Available'}`);
        console.log(`층: ${row.floor}`);
        console.log('');
      });
    }
  }
  
  // 1F 층도 함께 확인
  console.log('🔍 1F 층의 테이블 맵 요소들도 확인합니다...\n');
  db.all('SELECT * FROM table_map_elements WHERE floor = ?', ['1F'], (err2, rows2) => {
    if (err2) {
      console.error('❌ 1F 층 조회 오류:', err2);
    } else {
      if (rows2.length === 0) {
        console.log('📭 1F 층에는 테이블 맵 요소가 없습니다.');
      } else {
        console.log(`📊 1F 층에 ${rows2.length}개의 요소가 있습니다:\n`);
        rows2.forEach((row, index) => {
          console.log(`--- 요소 ${index + 1} ---`);
          console.log(`ID: ${row.element_id}`);
          console.log(`타입: ${row.type}`);
          console.log(`위치: x=${row.position_x}, y=${row.position_y}`);
          console.log(`크기: width=${row.size_width}, height=${row.size_height}`);
          console.log(`회전: ${row.rotation}도`);
          console.log(`텍스트: ${row.text || '없음'}`);
          console.log(`색상: ${row.color || '기본값'}`);
          console.log(`상태: ${row.status || 'Available'}`);
          console.log(`층: ${row.floor}`);
          console.log('');
        });
      }
    }
    
    // 데이터베이스 연결 종료
    db.close();
    console.log('✅ 데이터베이스 연결이 종료되었습니다.');
  });
}); 
