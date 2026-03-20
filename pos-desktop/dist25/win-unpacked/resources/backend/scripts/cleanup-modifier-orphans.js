const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./web2pos.db');

console.log('🧹 Cleaning up orphaned modifier records...\n');

db.serialize(() => {
  // 1. modifier_group_links에서 존재하지 않는 modifier_group 참조 삭제
  db.run(`DELETE FROM modifier_group_links WHERE modifier_group_id NOT IN (SELECT modifier_group_id FROM modifier_groups)`, function(err) {
    if (err) console.error('Error:', err);
    else console.log('✅ Cleaned orphaned modifier_group_links (missing group):', this.changes, 'rows');
  });
  
  // 2. modifier_group_links에서 존재하지 않는 modifier 참조 삭제
  db.run(`DELETE FROM modifier_group_links WHERE modifier_id NOT IN (SELECT modifier_id FROM modifiers)`, function(err) {
    if (err) console.error('Error:', err);
    else console.log('✅ Cleaned orphaned modifier_group_links (missing modifier):', this.changes, 'rows');
  });
  
  // 3. 현재 상태 확인
  db.all(`SELECT * FROM modifier_group_links WHERE modifier_group_id = 340000`, (err, rows) => {
    console.log('\n📊 Links for group 340000:', rows || []);
  });
  
  db.get(`SELECT * FROM modifier_groups WHERE modifier_group_id = 340000`, (err, row) => {
    console.log('📊 Group 340000:', row || 'NOT FOUND');
  });
  
  db.get(`SELECT * FROM modifiers WHERE modifier_id = 300001`, (err, row) => {
    console.log('📊 Modifier 300001:', row || 'NOT FOUND');
    
    console.log('\n✅ Cleanup complete! Try creating modifier group again.');
    db.close();
  });
});
