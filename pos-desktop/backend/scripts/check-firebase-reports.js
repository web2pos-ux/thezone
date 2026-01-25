// Check Firebase Reports Structure
const admin = require('firebase-admin');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, '../config/firebase-service-account.json')))
  });
}
const db = admin.firestore();

async function checkReports() {
  console.log('=== Firebase Reports Structure ===\n');
  
  // 1. stores collection
  const storesSnap = await db.collection('stores').get();
  console.log('[stores] collection:', storesSnap.size, 'docs\n');
  
  for (const storeDoc of storesSnap.docs) {
    console.log('  Store ID:', storeDoc.id);
    
    // reports subcollection
    const reportsSnap = await db.collection('stores').doc(storeDoc.id).collection('reports').get();
    if (reportsSnap.size > 0) {
      console.log('    [reports]:', reportsSnap.size, 'types');
      for (const reportDoc of reportsSnap.docs) {
        console.log('      -', reportDoc.id);
        
        // monthly subcollections
        const monthCols = await reportDoc.ref.listCollections();
        for (const monthCol of monthCols.slice(0, 3)) {
          const monthSnap = await monthCol.get();
          console.log('        ', monthCol.id, ':', monthSnap.size, 'records');
        }
      }
    } else {
      console.log('    (no reports)');
    }
  }
  
  // 2. restaurants collection
  const restSnap = await db.collection('restaurants').limit(5).get();
  console.log('\n[restaurants] collection (top 5):');
  
  for (const restDoc of restSnap.docs) {
    const data = restDoc.data();
    console.log('  Restaurant:', restDoc.id, '|', data.name || 'N/A');
    
    // reports subcollection
    const reportsSnap = await db.collection('restaurants').doc(restDoc.id).collection('reports').get();
    if (reportsSnap.size > 0) {
      console.log('    [reports]:', reportsSnap.size, 'types');
      reportsSnap.docs.slice(0, 5).forEach(d => console.log('      -', d.id));
    }
    
    // dailyReports
    const dailySnap = await db.collection('restaurants').doc(restDoc.id).collection('dailyReports').limit(5).get();
    if (dailySnap.size > 0) {
      console.log('    [dailyReports]:', dailySnap.size, 'records');
      dailySnap.docs.forEach(d => console.log('      -', d.id));
    }
    
    // salesSummary
    const salesSnap = await db.collection('restaurants').doc(restDoc.id).collection('salesSummary').limit(5).get();
    if (salesSnap.size > 0) {
      console.log('    [salesSummary]:', salesSnap.size, 'records');
    }
  }
  
  // 3. Global reports collection
  const globalReports = await db.collection('reports').limit(10).get();
  console.log('\n[reports] global collection:', globalReports.size, 'docs');
  if (globalReports.size > 0) {
    globalReports.docs.forEach(d => {
      const data = d.data();
      console.log('  -', d.id, '| type:', data.reportId || data.type || 'N/A');
    });
  }
  
  // 4. Check for any report-related collections
  console.log('\n=== Searching for report-related data ===');
  
  // Check specific restaurant (Sushi Harbour)
  const sushiRef = db.collection('restaurants').doc('tQcGkoSoKcwKdvL7WLiQ');
  const sushiDoc = await sushiRef.get();
  if (sushiDoc.exists) {
    console.log('\nSushi Harbour Port Hardy:');
    const collections = await sushiRef.listCollections();
    console.log('  Subcollections:', collections.map(c => c.id).join(', '));
  }
  
  console.log('\n=== Check Complete ===');
}

checkReports().catch(console.error).finally(() => process.exit(0));
