const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./pos-desktop/db/web2pos.db');
db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
  if (err) { console.error('ERROR:', err); }
  else { console.log('Tables in bundled DB:'); rows.forEach(r => console.log(' -', r.name)); }
  
  // Check modifier-related tables specifically
  const checkTables = ['modifier_groups', 'modifiers', 'modifier_group_links', 'modifier_labels'];
  let checked = 0;
  checkTables.forEach(t => {
    db.get("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='" + t + "'", (e, r) => {
      if (r && r.cnt > 0) console.log('  [OK]', t);
      else console.log('  [MISSING]', t);
      checked++;
      if (checked === checkTables.length) db.close();
    });
  });
});
