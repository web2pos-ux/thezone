// 글로벌 컬렉션 삭제 스크립트
// 서브컬렉션으로 이전 완료 후 기존 글로벌 컬렉션 데이터를 삭제합니다.
// 사용법: node scripts/delete-global-collections.js

const path = require('path');
const admin = require('firebase-admin');

// Firebase 초기화
const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

if (!admin.apps.length) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase 초기화 완료\n');
  } catch (error) {
    console.error('❌ Firebase 초기화 실패:', error.message);
    process.exit(1);
  }
}

const db = admin.firestore();

// 삭제할 글로벌 컬렉션 목록
const GLOBAL_COLLECTIONS = [
  'menuCategories',
  'menuItems',
  'modifierGroups',
  'taxGroups',
  'printerGroups'
];

async function deleteCollection(collectionName) {
  console.log(`\n🗑️ Deleting global collection: ${collectionName}`);
  
  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.get();
  
  if (snapshot.empty) {
    console.log(`   ⚪ Collection is empty - nothing to delete`);
    return 0;
  }
  
  console.log(`   📦 Found ${snapshot.size} documents to delete`);
  
  // Batch delete (최대 500개씩)
  const batchSize = 500;
  let deleted = 0;
  
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + batchSize);
    
    chunk.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    deleted += chunk.length;
    console.log(`   ✅ Deleted ${deleted}/${docs.length} documents`);
  }
  
  return deleted;
}

async function main() {
  console.log('='.repeat(60));
  console.log('🗑️ 글로벌 컬렉션 삭제 스크립트');
  console.log('='.repeat(60));
  console.log('\n⚠️ 다음 글로벌 컬렉션을 삭제합니다:');
  GLOBAL_COLLECTIONS.forEach(c => console.log(`   - ${c}`));
  console.log('\n📌 서브컬렉션 (restaurants/{id}/...) 은 유지됩니다.');
  
  // 삭제 전 현황 확인
  console.log('\n' + '-'.repeat(60));
  console.log('📊 삭제 전 현황:');
  
  for (const collectionName of GLOBAL_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    console.log(`   ${collectionName}: ${snapshot.size} documents`);
  }
  
  // 삭제 실행
  console.log('\n' + '-'.repeat(60));
  console.log('🚀 삭제 시작...');
  
  const results = {};
  for (const collectionName of GLOBAL_COLLECTIONS) {
    results[collectionName] = await deleteCollection(collectionName);
  }
  
  // 결과 요약
  console.log('\n' + '='.repeat(60));
  console.log('📊 삭제 완료 요약:');
  console.log('='.repeat(60));
  
  let totalDeleted = 0;
  for (const [collection, count] of Object.entries(results)) {
    console.log(`   ${collection}: ${count} documents deleted`);
    totalDeleted += count;
  }
  
  console.log(`\n✅ 총 ${totalDeleted}개 문서 삭제 완료!`);
  console.log('\n📌 서브컬렉션 데이터는 그대로 유지됩니다.');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});





