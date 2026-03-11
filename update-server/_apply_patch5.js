const fs = require('fs');
let js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.v2.js', 'utf8');

let changes = 0;

// Fix 1: modifierGroups update - wrong collection path AND id could be number
// Original: (0,So.mZ)((0,So.H9)($o,"modifierGroups",e.id),{min_selection
// Should be: subcollection path with String(e.id)
const oldModUpdate = '(0,So.H9)($o,"modifierGroups",e.id),{min_selection';
const newModUpdate = '(0,So.H9)($o,"restaurants",t.id,"modifierGroups",String(e.id)),{min_selection';
if (js.includes(oldModUpdate)) {
  js = js.replace(oldModUpdate, newModUpdate);
  console.log('Fix 1: modifierGroups update path + String(id)');
  changes++;
} else {
  console.log('Fix 1: NOT FOUND');
}

// Fix 2: taxGroups update - wrong collection path AND id could be number
// Original: (0,So.H9)($o,"taxGroups",e.id),{taxes
const oldTaxUpdate = '(0,So.H9)($o,"taxGroups",e.id),{taxes';
const newTaxUpdate = '(0,So.H9)($o,"restaurants",t.id,"taxGroups",String(e.id)),{taxes';
if (js.includes(oldTaxUpdate)) {
  js = js.replace(oldTaxUpdate, newTaxUpdate);
  console.log('Fix 2: taxGroups update path + String(id)');
  changes++;
} else {
  console.log('Fix 2: NOT FOUND');
}

// Fix 3: Re-fetch modifierGroups - fix spread order so data().id doesn't overwrite d.id
// Original: {id:e.id},e.data()) for modifierGroups - this is WRONG because e.data() might have numeric id
// Pattern: {id:e.id},e.data())  -- this appears 3 times (mod, tax, printer)
// We need: {...e.data(), id:e.id}  (put id LAST so it keeps the Firestore doc id)
// But in minified form: (0,s.A)({id:e.id},e.data())
// Need to change to: (0,s.A)(e.data(),{id:e.id})

// Find the 3 occurrences near the re-fetch area
const refetchArea = js.indexOf('await Oe();const N=');
if (refetchArea > 0) {
  console.log('Re-fetch area found at:', refetchArea);
  const areaChunk = js.substring(refetchArea, refetchArea + 500);
  console.log('Area:', areaChunk.substring(0, 300));
  
  // Count occurrences of {id:e.id},e.data()
  const pat = '{id:e.id},e.data()';
  let count = 0;
  let idx = 0;
  while ((idx = areaChunk.indexOf(pat, idx)) >= 0) {
    count++;
    idx++;
  }
  console.log(`Found ${count} occurrences of "${pat}" in refetch area`);
}

// Fix by replacing all 3 occurrences
// The pattern in context: .map(e=>(0,s.A)({id:e.id},e.data()))
// Change to: .map(e=>(0,s.A)(e.data(),{id:String(e.id)}))
// This ensures: 1) data spreads first, 2) Firestore doc id (string) overwrites any numeric id from data

// But actually the simpler fix is to just make sure String() is used everywhere
// Let me just wrap all .id references in doc() calls

// Actually the simplest fix: patch the map function to keep Firestore doc id as string
const oldMap = '.map(e=>(0,s.A)({id:e.id},e.data()))';
const newMap = '.map(e=>{const _d=e.data();return{..._d,id:String(e.id)}})';

// Count all occurrences
let mapCount = 0;
let tempJs = js;
while (tempJs.includes(oldMap)) {
  tempJs = tempJs.replace(oldMap, newMap);
  mapCount++;
}
if (mapCount > 0) {
  js = js;
  // Replace all occurrences
  while (js.includes(oldMap)) {
    js = js.replace(oldMap, newMap);
    changes++;
  }
  console.log(`Fix 3: Replaced ${mapCount} map functions to use String(e.id)`);
} else {
  console.log('Fix 3: map pattern not found, trying alternative');
  // Try exact pattern from the output
  const oldMap2 = '{id:e.id},e.data()';
  let count = 0;
  while (js.includes(oldMap2)) {
    // Replace just the first occurrence each time
    js = js.replace(oldMap2, 'e.data(),{id:String(e.id)}');
    count++;
    changes++;
    if (count > 10) break; // safety
  }
  console.log(`Fix 3 alt: Replaced ${count} id spread patterns`);
}

// Fix 4: Also ensure all other doc() calls in the upload area use String() for ids
// menuItems update already has String(v.id) - confirmed good
// menuCategories setDoc uses String(r) - confirmed good
// taxGroups setDoc uses String(e) wrapped in r=String(e) - confirmed good

// Fix 5: printerGroups addDoc doesn't need doc id (auto-generated) - OK

// Fix 6: modifierGroups addDoc - also OK (auto-generated)

// Fix: categoryId:f.id - make sure this is String
const oldCatId = 'categoryId:f.id';
const newCatId = 'categoryId:String(f.id)';
if (js.includes(oldCatId)) {
  // Only replace in the upload area (there could be other uses)
  const uploadStart = js.indexOf('Excel sheets:');
  const uploadEnd = uploadStart + 12000;
  const before = js.substring(0, uploadStart);
  let uploadArea = js.substring(uploadStart, uploadEnd);
  const after = js.substring(uploadEnd);
  
  if (uploadArea.includes(oldCatId)) {
    uploadArea = uploadArea.replace(oldCatId, newCatId);
    js = before + uploadArea + after;
    console.log('Fix 6: categoryId String() wrap');
    changes++;
  }
}

fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.v2.js', js, 'utf8');
console.log('\nTotal changes:', changes);
