const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

// Check tax-related tables
db.all("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%tax%' OR name LIKE '%Tax%')", [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('=== Tax 관련 테이블 ===');
    rows.forEach(r => console.log(' -', r.name));
  }
  
  // Check existing taxes
  db.all("SELECT * FROM taxes WHERE is_active = 1", [], (err, taxes) => {
    if (err) {
      console.log('\ntaxes 테이블 없음 또는 오류:', err.message);
    } else {
      console.log('\n=== 저장된 세금 ===');
      taxes.forEach(t => console.log(` - ${t.name}: ${t.rate}%`));
    }
    
    // Check existing tax groups
    db.all("SELECT * FROM tax_groups WHERE is_active = 1", [], (err, groups) => {
      if (err) {
        console.log('\ntax_groups 테이블 없음 또는 오류:', err.message);
      } else {
        console.log('\n=== 저장된 세금 그룹 ===');
        groups.forEach(g => console.log(` - ${g.name}`));
      }
      
      db.close();
    });
  });
});


















