const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 실행앱이 사용하는 DB 경로
const dbPath = path.join(process.env.APPDATA, 'thezonepos', 'web2pos.db');
console.log('Checking DB at:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
  if (err) {
    console.error('Query error:', err.message);
    db.close();
    return;
  }
  
  console.log('\nTables in user DB (' + rows.length + ' total):');
  rows.forEach(r => console.log(' -', r.name));
  
  // Check modifier_labels specifically
  const hasModifierLabels = rows.some(r => r.name === 'modifier_labels');
  console.log('\n[modifier_labels]:', hasModifierLabels ? 'EXISTS' : 'MISSING ❌');
  
  db.close();
});
