const fs = require('fs');
let js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', 'utf8');

// Find upload-related patterns
const patterns = [
  'Importing...',
  'Upload Excel',
  'handleUploadMenu',
  'Excel sheets:',
  'Menu Items',
];

patterns.forEach(p => {
  const idx = js.indexOf(p);
  if (idx >= 0) {
    console.log(`"${p}" found at: ${idx}`);
    console.log('  Context:', JSON.stringify(js.substring(Math.max(0, idx - 100), idx + 100)));
    console.log();
  } else {
    console.log(`"${p}" NOT FOUND`);
  }
});

// Find sheet access pattern
const sheetAccess = js.indexOf('.Sheets.Modifiers');
console.log('.Sheets.Modifiers at:', sheetAccess);
if (sheetAccess >= 0) {
  console.log('  Context:', JSON.stringify(js.substring(sheetAccess - 50, sheetAccess + 100)));
}

const sheetAccess2 = js.indexOf('.Sheets["Modifiers"]');
console.log('.Sheets["Modifiers"] at:', sheetAccess2);

const sheetAccess3 = js.indexOf('Sheets.Modifiers');
console.log('Sheets.Modifiers at:', sheetAccess3);

// Find indexOf usage patterns in the upload area
const excelSheets = js.indexOf('Excel sheets:');
if (excelSheets >= 0) {
  // Extract ~5000 chars around it for the upload function
  const chunk = js.substring(excelSheets, excelSheets + 8000);
  
  // Find .split(",") pattern
  const splitIdx = chunk.indexOf('.split(",")');
  if (splitIdx >= 0) {
    console.log('\n.split(",") found at offset:', splitIdx);
    console.log('  Context:', JSON.stringify(chunk.substring(Math.max(0, splitIdx - 100), splitIdx + 50)));
  }
  
  // Find .toLowerCase() near Available
  const availIdx = chunk.indexOf('Available');
  if (availIdx >= 0) {
    console.log('\nAvailable found at offset:', availIdx);
    console.log('  Context:', JSON.stringify(chunk.substring(Math.max(0, availIdx - 50), availIdx + 150)));
  }
  
  // Write the upload function chunk for analysis
  fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/_upload_chunk.txt', chunk, 'utf8');
  console.log('\nWrote upload chunk to _upload_chunk.txt');
}
