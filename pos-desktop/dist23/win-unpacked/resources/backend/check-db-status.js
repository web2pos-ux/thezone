const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 데이터베이스 경로 - 상위 디렉토리의 db 폴더
const dbPath = path.join(__dirname, '..', 'db', 'web2pos.db');
console.log('🔍 데이터베이스 경로:', dbPath);

// 데이터베이스 연결
const db = new sqlite3.Database(dbPath);

console.log('\n📊 === 데이터베이스 상태 확인 ===');

// 1. 테이블 목록 확인
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) {
    console.error('❌ 테이블 목록 조회 실패:', err.message);
  } else {
    console.log('\n📋 테이블 목록:');
    tables.forEach(table => console.log(`  - ${table.name}`));
  }

  // 2. table_map_elements 테이블 구조 확인
  db.all("PRAGMA table_info(table_map_elements)", (err, columns) => {
    if (err) {
      console.error('❌ 테이블 구조 조회 실패:', err.message);
    } else {
      console.log('\n🏗️ table_map_elements 테이블 구조:');
      columns.forEach(col => console.log(`  - ${col.name} (${col.type})`));
    }

    // 3. 각 층별 요소 개수 확인
    db.all("SELECT floor, COUNT(*) as count FROM table_map_elements GROUP BY floor", (err, floors) => {
      if (err) {
        console.error('❌ 층별 요소 개수 조회 실패:', err.message);
      } else {
        console.log('\n🏢 층별 요소 개수:');
        if (floors.length === 0) {
          console.log('  - 데이터가 없습니다');
        } else {
          floors.forEach(floor => console.log(`  - ${floor.floor}: ${floor.count}개`));
        }
      }

      // 4. 전체 요소 개수 확인
      db.get("SELECT COUNT(*) as total FROM table_map_elements", (err, result) => {
        if (err) {
          console.error('❌ 전체 요소 개수 조회 실패:', err.message);
        } else {
          console.log(`\n📈 전체 요소 개수: ${result.total}개`);
        }

        // 5. 샘플 데이터 확인 (최대 3개)
        db.all("SELECT element_id, floor, type, x_pos, y_pos FROM table_map_elements LIMIT 3", (err, samples) => {
          if (err) {
            console.error('❌ 샘플 데이터 조회 실패:', err.message);
          } else {
            console.log('\n🔍 샘플 데이터 (최대 3개):');
            if (samples.length === 0) {
              console.log('  - 데이터가 없습니다');
            } else {
              samples.forEach(sample => {
                console.log(`  - ID: ${sample.element_id}, 층: ${sample.floor}, 타입: ${sample.type}, 위치: (${sample.x_pos}, ${sample.y_pos})`);
              });
            }
          }

          console.log('\n✅ 데이터베이스 상태 확인 완료');
          db.close();
        });
      });
    });
  });
}); 
