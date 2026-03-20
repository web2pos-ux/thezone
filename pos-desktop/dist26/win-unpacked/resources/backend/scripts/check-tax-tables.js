const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../db/web2pos.db');

console.log('=== 세금 관련 테이블 확인 ===\n');

// 1. 세금 관련 테이블 목록
db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tax%'", [], (e, tables) => {
  console.log('세금 관련 테이블:', tables.map(t => t.name).join(', '));
  
  // 2. tax_groups 테이블 스키마
  db.all("PRAGMA table_info(tax_groups)", [], (e, cols) => {
    console.log('\ntax_groups 컬럼:', cols.map(c => c.name).join(', '));
    
    // 3. tax_groups 데이터
    db.all("SELECT * FROM tax_groups", [], (e, rows) => {
      console.log('\ntax_groups 데이터:');
      rows.forEach(r => console.log('  ', r));
      
      // 4. taxes 테이블 확인
      db.all("PRAGMA table_info(taxes)", [], (e, taxCols) => {
        console.log('\ntaxes 컬럼:', taxCols ? taxCols.map(c => c.name).join(', ') : 'N/A');
        
        db.all("SELECT * FROM taxes", [], (e, taxRows) => {
          console.log('\ntaxes 데이터:');
          if (taxRows) {
            taxRows.forEach(r => console.log('  ', r));
          }
          
          // 5. tax_group_taxes 테이블 확인 (연결 테이블)
          db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tax_group%'", [], (e, linkTables) => {
            console.log('\n세금 연결 테이블:', linkTables ? linkTables.map(t => t.name).join(', ') : 'N/A');
            
            // tax_group_taxes 스키마 확인
            db.all("PRAGMA table_info(tax_group_taxes)", [], (e, linkCols) => {
              if (linkCols && linkCols.length > 0) {
                console.log('\ntax_group_taxes 컬럼:', linkCols.map(c => c.name).join(', '));
                
                db.all("SELECT * FROM tax_group_taxes", [], (e, linkRows) => {
                  console.log('\ntax_group_taxes 데이터:');
                  linkRows.forEach(r => console.log('  ', r));
                  db.close();
                });
              } else {
                console.log('\ntax_group_taxes 테이블 없음');
                db.close();
              }
            });
          });
        });
      });
    });
  });
});
