const fs = require('fs');
let js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', 'utf8');

let changes = 0;

// Fix 4b: Support "Price Adjustment 1" for modifier price in upload
const oldModPrice = 't.Price1||t.PriceAdjustment||t["Price Adjustment"]||0';
const newModPrice = 't.Price1||t["Price Adjustment 1"]||t.PriceAdjustment||t["Price Adjustment"]||0';
if (js.includes(oldModPrice)) {
  js = js.replace(oldModPrice, newModPrice);
  console.log('Fix: Modifier Price Adjustment 1 patched');
  changes++;
}

// Fix 4c: Support "Price Adjustment 2" for modifier price2
const oldModPrice2 = 'parseFloat(t.Price2||0)';
if (js.includes(oldModPrice2)) {
  js = js.replace(oldModPrice2, 'parseFloat(t.Price2||t["Price Adjustment 2"]||0)');
  console.log('Fix: Modifier Price Adjustment 2 patched');
  changes++;
}

// Fix: Support "Display Name (Korean)" as shortName fallback
const oldShort = 'n.ShortName||n["Short Name"]||""';
const newShort = 'n.ShortName||n["Short Name"]||n["Display Name (Korean)"]||""';
if (js.includes(oldShort)) {
  js = js.replace(oldShort, newShort);
  console.log('Fix: Display Name (Korean) shortName fallback patched');
  changes++;
}

// Fix: Wrap all remaining .toLowerCase() that might get non-string values
// Specifically, the category name, item name etc could be numbers from Excel
// Pattern: e.toLowerCase() where e = n.Category etc.
// Wrap n.Category with String()
const oldCat = 'r=n["Item Name"]||n.Name||""';
if (js.includes(oldCat)) {
  // Already string, good
  console.log('Item Name already patched');
}

// Verify all patches
console.log('\nVerification:');
console.log('Sheet names:', js.includes('e.Sheets["Modifier Groups"]||e.Sheets.Modifiers') ? 'OK' : 'MISSING');
console.log('Item Name:', js.includes('n["Item Name"]||n.Name') ? 'OK' : 'MISSING');
console.log('Category Name:', js.includes('n.Category||n["Category Name"]') ? 'OK' : 'MISSING');
console.log('Active/Available:', js.includes('String(n.Active||n.Available||"Yes")') ? 'OK' : 'MISSING');
console.log('Split safety:', js.includes('String(d).split(",")') ? 'OK' : 'MISSING');
console.log('Tax Rate:', js.includes('e.Rate||e["Tax Rate (%)"]') ? 'OK' : 'MISSING');
console.log('Price Adj 1:', js.includes('t["Price Adjustment 1"]') ? 'OK' : 'MISSING');
console.log('Price Adj 2:', js.includes('t["Price Adjustment 2"]') ? 'OK' : 'MISSING');
console.log('Display Name Korean:', js.includes('Display Name (Korean)') ? 'OK' : 'MISSING');

fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', js, 'utf8');
console.log('\nTotal additional changes:', changes);
console.log('Patched JS saved');
