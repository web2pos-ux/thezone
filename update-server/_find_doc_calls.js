const fs = require('fs');
const js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.v2.js', 'utf8');

// Find the upload function area - much larger scope
const excelSheets = js.indexOf('Excel sheets:');
const chunk = js.substring(excelSheets - 500, excelSheets + 12000);

// Find ALL potential Firestore doc() calls - they use $o or So references
// Look for patterns like: doc(..., someVar.id) or doc(..., someId)
const docPattern = /\b(?:So|Qo|\$o)\.(?:H9|mZ|hJ)\b/g;
let match;
while ((match = docPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 10);
  const end = Math.min(chunk.length, match.index + 150);
  console.log(`Firestore call at offset ${match.index}:`);
  console.log(chunk.substring(start, end));
  console.log('---');
}

// Also find patterns with "doc(" or "updateDoc" or "setDoc" or "addDoc"
// These are imported as modular functions
// Look for specific patterns in the chunk
const patterns = ['updateDoc', 'setDoc', 'addDoc', 'doc('];
patterns.forEach(p => {
  let idx = 0;
  while ((idx = chunk.indexOf(p, idx)) >= 0) {
    console.log(`\n"${p}" at offset ${idx}:`);
    console.log(chunk.substring(Math.max(0, idx - 20), idx + 120));
    console.log('---');
    idx++;
  }
});

// Look for .id references that could be numbers
console.log('\n\n=== .id references ===');
const idPattern = /\.id[,\)]/g;
while ((match = idPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 60);
  const end = Math.min(chunk.length, match.index + 20);
  console.log(`\n.id at offset ${match.index}:`);
  console.log(chunk.substring(start, end));
}
