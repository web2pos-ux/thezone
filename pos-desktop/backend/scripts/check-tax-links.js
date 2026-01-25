const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../db/web2pos.db');

console.log('=== 세금 연결 테이블 확인 ===\n');

// tax_group_links 스키마
db.all("PRAGMA table_info(tax_group_links)", [], (e, cols) => {
  console.log('tax_group_links 컬럼:', cols.map(c => c.name).join(', '));
  
  // tax_group_links 데이터
  db.all(`
    SELECT tgl.*, tg.name as group_name, t.name as tax_name, t.rate
    FROM tax_group_links tgl
    JOIN tax_groups tg ON tgl.group_id = tg.id
    JOIN taxes t ON tgl.tax_id = t.id
    ORDER BY tg.name
  `, [], (e, rows) => {
    if (e) {
      console.log('쿼리 오류:', e.message);
      db.close();
      return;
    }
    console.log('\n세금 그룹 - 세금 연결:');
    
    const byGroup = {};
    rows.forEach(r => {
      if (!byGroup[r.group_name]) {
        byGroup[r.group_name] = [];
      }
      byGroup[r.group_name].push({ name: r.tax_name, rate: r.rate });
    });
    
    Object.entries(byGroup).forEach(([group, taxes]) => {
      const totalRate = taxes.reduce((sum, t) => sum + t.rate, 0);
      console.log(`\n  ${group}:`);
      taxes.forEach(t => console.log(`    - ${t.name}: ${t.rate}%`));
      console.log(`    총 세율: ${totalRate}%`);
    });
    
    // 연결이 없는 그룹 확인
    db.all(`
      SELECT tg.id, tg.name, tg.firebase_id
      FROM tax_groups tg
      WHERE tg.id NOT IN (SELECT DISTINCT group_id FROM tax_group_links)
      AND tg.is_active = 1
    `, [], (e, orphans) => {
      if (orphans && orphans.length > 0) {
        console.log('\n\n⚠️ 세금 연결이 없는 그룹:');
        orphans.forEach(o => console.log(`  - ${o.name} (ID: ${o.id})`));
      }
      
      db.close();
    });
  });
});
