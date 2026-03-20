const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

// Check printer-related tables
db.all("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%printer%' OR name LIKE '%Printer%')", [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('=== Printer 관련 테이블 ===');
    if (rows.length === 0) {
      console.log('  (테이블 없음)');
    } else {
      rows.forEach(r => console.log(' -', r.name));
    }
  }
  
  // Check all tables for reference
  db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, allTables) => {
    console.log('\n=== 모든 테이블 목록 ===');
    allTables.forEach(t => console.log(' -', t.name));
    
    // Check if there's printer data in any table
    db.all("SELECT * FROM printers LIMIT 5", [], (err, printers) => {
      if (err) {
        console.log('\n프린터 테이블 없음:', err.message);
      } else {
        console.log('\n=== 저장된 프린터 ===');
        printers.forEach(p => console.log(p));
      }
      
      db.all("SELECT * FROM printer_groups LIMIT 5", [], (err, groups) => {
        if (err) {
          console.log('\n프린터 그룹 테이블 없음:', err.message);
        } else {
          console.log('\n=== 저장된 프린터 그룹 ===');
          groups.forEach(g => console.log(g));
        }
        
        db.close();
      });
    });
  });
});


















