const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

db.run("ALTER TABLE menus ADD COLUMN sales_channels TEXT DEFAULT '[]'", function(err) {
  if (err) {
    if (err.message.includes('duplicate column')) {
      console.log('sales_channels 컬럼이 이미 존재합니다.');
    } else {
      console.log('Error:', err.message);
    }
  } else {
    console.log('✅ sales_channels 컬럼 추가 완료!');
  }
  
  // 테이블 구조 확인
  db.all('PRAGMA table_info(menus)', [], (err, cols) => {
    console.log('\n=== menus 테이블 컬럼 ===');
    cols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
    
    // 메뉴 데이터 확인
    db.all('SELECT menu_id, name, sales_channels FROM menus', [], (err, rows) => {
      console.log('\n=== 저장된 메뉴 ===');
      if (err) {
        console.log('Error:', err.message);
      } else {
        rows.forEach(r => console.log(`  - ${r.name}: ${r.sales_channels || '[]'}`));
      }
      db.close();
    });
  });
});


















