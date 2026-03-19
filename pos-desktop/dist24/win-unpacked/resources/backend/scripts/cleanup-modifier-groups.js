/**
 * 중복/미사용 modifier_groups 정리
 * - firebase_id가 없고 중복된 이름의 그룹 정리
 * - 유효한 그룹만 유지
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

async function cleanup() {
  console.log('='.repeat(60));
  console.log('🧹 Modifier Groups 정리');
  console.log('='.repeat(60));
  
  // 1. 현재 상태 확인
  const allGroups = await dbAll('SELECT * FROM modifier_groups');
  const withFirebaseId = allGroups.filter(g => g.firebase_id);
  const withoutFirebaseId = allGroups.filter(g => !g.firebase_id);
  
  console.log(`\n[현재 상태]`);
  console.log(`  - 전체: ${allGroups.length}개`);
  console.log(`  - firebase_id 있음: ${withFirebaseId.length}개`);
  console.log(`  - firebase_id 없음: ${withoutFirebaseId.length}개`);
  
  // 2. firebase_id가 있는 그룹 확인
  console.log(`\n[유효한 Modifier Groups (firebase_id 있음)]`);
  withFirebaseId.forEach(g => {
    console.log(`  - ${g.group_id}: ${g.name}`);
  });
  
  // 3. firebase_id 없는 그룹 중 테스트 데이터 식별
  console.log(`\n[삭제 대상 (firebase_id 없고 중복/테스트)]`);
  
  // 테스트 데이터 패턴 (한 글자, 의미없는 이름)
  const testPatterns = ['Q', 'Qq', 'E', 'F', 'Ss', 'H', 'Sdf', 'Ret', 'Fs', 'Sdfs', 'Sdfdsf', 'Gh'];
  
  const toDelete = withoutFirebaseId.filter(g => {
    // 테스트 패턴에 해당하는 경우
    if (testPatterns.includes(g.name)) return true;
    // 1-3글자 짧은 이름
    if (g.name.length <= 3 && !['Age', 'Eda'].includes(g.name)) return true;
    return false;
  });
  
  console.log(`  - 테스트 데이터: ${toDelete.length}개`);
  
  // 4. 삭제 실행 여부 확인
  if (toDelete.length > 0) {
    console.log(`\n[삭제 진행]`);
    const deleteIds = toDelete.map(g => g.group_id);
    
    // 연관된 modifiers 먼저 삭제 (modifier_options 대신 modifiers 테이블)
    try {
      const result1 = await dbRun(`DELETE FROM modifiers WHERE group_id IN (${deleteIds.join(',')})`);
      console.log(`  - modifiers 삭제: ${result1.changes}개`);
    } catch (e) {
      console.log(`  - modifiers 테이블 없음 (skip)`);
    }
    
    // modifier_groups 삭제
    const result2 = await dbRun(`DELETE FROM modifier_groups WHERE group_id IN (${deleteIds.join(',')}) AND firebase_id IS NULL`);
    console.log(`  - modifier_groups 삭제: ${result2.changes}개`);
  }
  
  // 5. 중복 확인 (같은 이름, firebase_id 없음)
  console.log(`\n[중복 그룹 정리]`);
  const remaining = await dbAll('SELECT * FROM modifier_groups WHERE firebase_id IS NULL');
  
  const nameCount = {};
  remaining.forEach(g => {
    nameCount[g.name] = (nameCount[g.name] || 0) + 1;
  });
  
  const duplicateNames = Object.entries(nameCount).filter(([_, count]) => count > 1);
  console.log(`  - 중복 이름: ${duplicateNames.length}개`);
  
  // 중복 그룹 중 가장 오래된 것만 유지
  for (const [name, count] of duplicateNames) {
    const groups = remaining.filter(g => g.name === name).sort((a, b) => a.group_id - b.group_id);
    const toDeleteDups = groups.slice(1); // 첫 번째 제외하고 모두 삭제
    
    if (toDeleteDups.length > 0) {
      const dupIds = toDeleteDups.map(g => g.group_id);
      try {
        await dbRun(`DELETE FROM modifiers WHERE group_id IN (${dupIds.join(',')})`);
      } catch (e) { /* ignore */ }
      await dbRun(`DELETE FROM modifier_groups WHERE group_id IN (${dupIds.join(',')}) AND firebase_id IS NULL`);
      console.log(`  - ${name}: ${count}개 → 1개 (${count - 1}개 삭제)`);
    }
  }
  
  // 6. 최종 상태
  const finalGroups = await dbAll('SELECT * FROM modifier_groups');
  console.log(`\n[최종 상태]`);
  console.log(`  - 전체: ${finalGroups.length}개`);
  console.log(`  - firebase_id 있음: ${finalGroups.filter(g => g.firebase_id).length}개`);
  console.log(`  - firebase_id 없음: ${finalGroups.filter(g => !g.firebase_id).length}개`);
  
  db.close();
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  db.close();
});
