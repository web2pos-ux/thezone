const fs = require('fs');
let js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', 'utf8');

// Backup original
fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js.backup', js, 'utf8');
console.log('Backup created');

let changes = 0;

// Fix 1: Sheet name compatibility - support both "Modifier Groups"/"Modifiers", "Tax Groups"/"Taxes", "Printer Groups"/"Printers"
const oldSheets = 'i=e.Sheets.Modifiers,c=e.Sheets.Taxes,u=e.Sheets.Printers';
const newSheets = 'i=e.Sheets["Modifier Groups"]||e.Sheets.Modifiers,c=e.Sheets["Tax Groups"]||e.Sheets.Taxes,u=e.Sheets["Printer Groups"]||e.Sheets.Printers';
if (js.includes(oldSheets)) {
  js = js.replace(oldSheets, newSheets);
  console.log('Fix 1: Sheet names patched');
  changes++;
} else {
  console.log('Fix 1: Pattern not found!');
}

// Fix 2: Column name compatibility for Menu Items - support "Item Name" in addition to "Name"  
// Original: const r=n.Name||""
// We need to find the exact pattern. Let's look at the chunk
const excelSheets = js.indexOf('Excel sheets:');
const chunk = js.substring(excelSheets, excelSheets + 8000);

// Find pattern for item name extraction
const namePatternIdx = chunk.indexOf('n.Name||""');
console.log('n.Name||"" at offset:', namePatternIdx);
if (namePatternIdx >= 0) {
  console.log('Context:', JSON.stringify(chunk.substring(namePatternIdx - 30, namePatternIdx + 50)));
}

// Fix 2a: Support "Item Name" column (Export format) for item name
const oldItemName = 'n.Name||""';
const newItemName = 'n["Item Name"]||n.Name||""';
if (chunk.includes(oldItemName)) {
  js = js.replace(
    'r=n.Name||""', // specific context: const r=n.Name||""
    'r=n["Item Name"]||n.Name||""'
  );
  console.log('Fix 2a: Item Name column patched');
  changes++;
}

// Fix 2b: Support "Category Name" column (from Categories sheet used as category reference)
// The category field: e=n.Category||""
const oldCategory = 'e=n.Category||""';
const newCategory = 'e=n.Category||n["Category Name"]||""';
if (js.includes(oldCategory)) {
  js = js.replace(oldCategory, newCategory);
  console.log('Fix 2b: Category Name column patched');
  changes++;
}

// Fix 2c: Support "Price 1" and "Price 2" columns (with space)
const oldPrice1 = 'n.Price1||n["Price 1"]';
const oldPrice1b = 'parseFloat(n.Price1||';
console.log('Price1 pattern check:', js.includes(oldPrice1), js.includes(oldPrice1b));

// Find actual price pattern
const priceIdx = chunk.indexOf('Price1');
if (priceIdx >= 0) {
  console.log('Price1 context:', JSON.stringify(chunk.substring(priceIdx - 30, priceIdx + 80)));
}
const priceIdx2 = chunk.indexOf('Price 1');
if (priceIdx2 >= 0) {
  console.log('Price 1 context:', JSON.stringify(chunk.substring(priceIdx2 - 30, priceIdx2 + 80)));
}

// Fix 2d: Support "Active" column (Export) in addition to "Available"
// Original: (n.Available||"Yes").toLowerCase()
// The minified version: (n.Available||"Yes").toLowerCase()
const oldAvailable = '(n.Available||"Yes").toLowerCase()';
const newAvailable = '(String(n.Active||n.Available||"Yes")).toLowerCase()';
if (js.includes(oldAvailable)) {
  js = js.replace(oldAvailable, newAvailable);
  console.log('Fix 2d: Active/Available column patched');
  changes++;
}

// Fix 3: Type safety - wrap .split(",") calls with String()
// Pattern: d.split(",") where d could be non-string
// Find all .split(",") in the upload function area
const uploadStart = js.indexOf('Excel sheets:');
const uploadEnd = uploadStart + 8000;
const uploadChunk = js.substring(uploadStart, uploadEnd);

// Count split patterns
const splitMatches = uploadChunk.match(/\.split\(","\)/g);
console.log('split(",") occurrences:', splitMatches ? splitMatches.length : 0);

// Fix 3a: Wrap modifiersStr.split - find pattern like: d.split(",")
// The variables d, u, p are modifiersStr, taxesStr, printersStr
// if(d){const e=d.split(",")
const oldSplit1 = 'if(d){const e=d.split(",")';
const newSplit1 = 'if(d){const e=String(d).split(",")';
if (js.includes(oldSplit1)) {
  js = js.replace(oldSplit1, newSplit1);
  console.log('Fix 3a: modifiers split patched');
  changes++;
}

const oldSplit2 = 'if(u){const e=u.split(",")';
const newSplit2 = 'if(u){const e=String(u).split(",")';
if (js.includes(oldSplit2)) {
  js = js.replace(oldSplit2, newSplit2);
  console.log('Fix 3b: taxes split patched');
  changes++;
}

const oldSplit3 = 'if(p){const e=p.split(",")';
const newSplit3 = 'if(p){const e=String(p).split(",")';
if (js.includes(oldSplit3)) {
  js = js.replace(oldSplit3, newSplit3);
  console.log('Fix 3c: printers split patched');
  changes++;
}

// Fix 4: Modifier sheet column compatibility
// Export uses: "Option Name", "Price Adjustment 1", "Price Adjustment 2"
// Upload expects: "OptionName", "Price1", "PriceAdjustment"
// Find pattern for modifier row parsing
const modOptIdx = chunk.indexOf('OptionName');
if (modOptIdx >= 0) {
  console.log('OptionName context:', JSON.stringify(chunk.substring(modOptIdx - 100, modOptIdx + 100)));
}

// Find in full JS around the modifier processing
const modSheetArea = js.indexOf('e.Sheets["Modifier Groups"]||e.Sheets.Modifiers');
if (modSheetArea < 0) {
  // Already patched, find new location
}
const modArea = js.indexOf('GroupName');
console.log('GroupName at:', modArea);
if (modArea >= 0) {
  console.log('GroupName context:', JSON.stringify(js.substring(modArea - 50, modArea + 200)));
}

// Fix 4a: Support "Option Name" column for modifier options
const oldOptName = 'e.OptionName||e["Option Name"]';
if (js.includes(oldOptName)) {
  console.log('OptionName already supports both');
} else {
  const oldOptSimple = 'e.OptionName||';
  const newOptSimple = 'e.OptionName||e["Option Name"]||';
  if (js.includes(oldOptSimple)) {
    // Already in the code as fallback - check
  }
}

// Fix 4b: Support "Price Adjustment 1" for modifier price
const oldModPrice = 'e.Price1||e.PriceAdjustment||e["Price Adjustment"]';
if (js.includes(oldModPrice)) {
  js = js.replace(oldModPrice, 'e.Price1||e["Price Adjustment 1"]||e.PriceAdjustment||e["Price Adjustment"]');
  console.log('Fix 4b: Modifier price column patched');
  changes++;
}

// Fix 4c: Support "Price Adjustment 2" for modifier price2
const oldModPrice2 = 'e.Price2||0';
// This might match many places, so be specific - find in modifier context
const modPriceArea = js.indexOf('PriceAdjustment');
if (modPriceArea >= 0) {
  console.log('PriceAdjustment context:', JSON.stringify(js.substring(modPriceArea - 50, modPriceArea + 100)));
}

// Fix 5: Support "Tax Rate (%)" for tax rate column
const oldTaxRate = 'e.Rate||0';
// Find in tax processing area
const taxRateIdx = js.indexOf('e.Rate||0');
if (taxRateIdx >= 0) {
  console.log('Tax Rate context:', JSON.stringify(js.substring(taxRateIdx - 50, taxRateIdx + 50)));
  // Replace carefully - only the one in tax context
  js = js.replace('e.Rate||0', 'e.Rate||e["Tax Rate (%)"]||0');
  console.log('Fix 5: Tax rate column patched');
  changes++;
}

// Fix 6: Support "Short Name" / "Display Name (Korean)" for shortName
const shortNameIdx = chunk.indexOf('ShortName');
if (shortNameIdx >= 0) {
  console.log('ShortName context:', JSON.stringify(chunk.substring(shortNameIdx - 30, shortNameIdx + 100)));
}

// Write patched file
fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', js, 'utf8');
console.log('\n=== Total changes:', changes, '===');
console.log('Patched JS saved');
