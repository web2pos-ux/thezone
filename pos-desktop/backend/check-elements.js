const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 19개 요소의 출처 확인\n');

// 1. 층별 요소 개수
db.all('SELECT floor, COUNT(*) as count FROM table_map_elements GROUP BY floor', (err, floors) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('📊 층별 요소 개수:');
    floors.forEach(f => console.log(`  ${f.floor}: ${f.count}개`));
  }

  // 2. 전체 개수
  db.get('SELECT COUNT(*) as total FROM table_map_elements', (err, result) => {
    if (err) {
      console.error('Error:', err);
    } else {
      console.log(`\n📈 전체 요소 개수: ${result.total}개`);
    }

    // 3. 샘플 데이터 (타입별)
    db.all('SELECT type, COUNT(*) as count FROM table_map_elements GROUP BY type', (err, types) => {
      if (err) {
        console.error('Error:', err);
      } else {
        console.log('\n🏷️ 타입별 요소 개수:');
        types.forEach(t => console.log(`  ${t.type}: ${t.count}개`));
      }

      // 4. 최근 생성된 요소들
      db.all('SELECT element_id, floor, type, created_at FROM table_map_elements ORDER BY created_at DESC LIMIT 5', (err, recent) => {
        if (err) {
          console.error('Error:', err);
        } else {
          console.log('\n🕒 최근 생성된 요소들:');
          recent.forEach(r => console.log(`  ID: ${r.element_id}, 층: ${r.floor}, 타입: ${r.type}, 생성: ${r.created_at}`));
        }

        db.close();
        console.log('\n✅ 확인 완료');
      });
    });
  });
}); 