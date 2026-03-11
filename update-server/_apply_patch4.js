const fs = require('fs');
let js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', 'utf8');

let changes = 0;

// Fix: parseModifierDisplayName - wrap input with String()
const oldZe = 'ze=e=>{const t=e.match(/^(.+?)\\s*\\((.+)\\)$/);return t?{name:t[1].trim(),label:t[2].trim()}:{name:e.trim(),label:""}}';
const newZe = 'ze=e=>{e=String(e||"");const t=e.match(/^(.+?)\\s*\\((.+)\\)$/);return t?{name:t[1].trim(),label:t[2].trim()}:{name:e.trim(),label:""}}';
if (js.includes(oldZe)) {
  js = js.replace(oldZe, newZe);
  console.log('Fix: parseModifierDisplayName String() wrap');
  changes++;
} else {
  console.log('ze function pattern not found, trying simpler pattern');
  // Try simpler match
  const old2 = 'ze=e=>{const t=e.match(';
  const new2 = 'ze=e=>{e=String(e||"");const t=e.match(';
  if (js.includes(old2)) {
    js = js.replace(old2, new2);
    console.log('Fix: parseModifierDisplayName (simple) patched');
    changes++;
  }
}

// Fix: Wrap ALL Excel cell reads with String() to prevent type errors
// Category: e=n.Category||n["Category Name"]||""  -> String(...)
const oldCatRead = 'e=n.Category||n["Category Name"]||""';
const newCatRead = 'e=String(n.Category||n["Category Name"]||"")';
if (js.includes(oldCatRead)) {
  js = js.replace(oldCatRead, newCatRead);
  console.log('Fix: Category String() wrap');
  changes++;
}

// Item Name: r=n["Item Name"]||n.Name||""
const oldItemRead = 'r=n["Item Name"]||n.Name||""';
const newItemRead = 'r=String(n["Item Name"]||n.Name||"")';
if (js.includes(oldItemRead)) {
  js = js.replace(oldItemRead, newItemRead);
  console.log('Fix: Item Name String() wrap');
  changes++;
}

// ShortName
const oldShortRead = 'n.ShortName||n["Short Name"]||n["Display Name (Korean)"]||""';
const newShortRead = 'String(n.ShortName||n["Short Name"]||n["Display Name (Korean)"]||"")';
if (js.includes(oldShortRead)) {
  js = js.replace(oldShortRead, newShortRead);
  console.log('Fix: ShortName String() wrap');
  changes++;
}

// Description
const oldDescRead = 'i=n.Description||""';
if (js.includes(oldDescRead)) {
  js = js.replace(oldDescRead, 'i=String(n.Description||"")');
  console.log('Fix: Description String() wrap');
  changes++;
}

// Modifiers, Taxes, Printers strings
const oldModRead = 'd=n.Modifiers||""';
if (js.includes(oldModRead)) {
  js = js.replace(oldModRead, 'd=String(n.Modifiers||"")');
  console.log('Fix: Modifiers String() wrap');
  changes++;
}

const oldTaxRead = 'u=n.Taxes||""';
if (js.includes(oldTaxRead)) {
  js = js.replace(oldTaxRead, 'u=String(n.Taxes||"")');
  console.log('Fix: Taxes String() wrap');
  changes++;
}

const oldPrintRead = 'p=n.Printers||""';
if (js.includes(oldPrintRead)) {
  js = js.replace(oldPrintRead, 'p=String(n.Printers||"")');
  console.log('Fix: Printers String() wrap');
  changes++;
}

// Modifier Group row values
const oldMgName = 'e=t.GroupName||t["Group Name"]||""';
if (js.includes(oldMgName)) {
  js = js.replace(oldMgName, 'e=String(t.GroupName||t["Group Name"]||"")');
  console.log('Fix: Modifier GroupName String() wrap');
  changes++;
}

const oldMgLabel = 'r=t.Label||""';
if (js.includes(oldMgLabel)) {
  js = js.replace(oldMgLabel, 'r=String(t.Label||"")');
  console.log('Fix: Modifier Label String() wrap');
  changes++;
}

const oldMgOpt = 't.OptionName||t["Option Name"]||""';
if (js.includes(oldMgOpt)) {
  js = js.replace(oldMgOpt, 'String(t.OptionName||t["Option Name"]||"")');
  console.log('Fix: OptionName String() wrap');
  changes++;
}

// Tax row values
const oldTgName = 'e=t.GroupName||t["Group Name"]||""';  // second occurrence
// Find in tax context
const taxAreaStart = js.indexOf('Tax Name');
if (taxAreaStart > 0) {
  const taxChunk = js.substring(taxAreaStart - 200, taxAreaStart + 300);
  console.log('\nTax area context:', taxChunk.substring(0, 100));
  
  // Find GroupName in tax area
  const tgIdx = taxChunk.indexOf('t.GroupName||t["Group Name"]||""');
  if (tgIdx >= 0) {
    console.log('Tax GroupName found in tax area');
  }
}

const oldTaxName = 'r=t.TaxName||t["Tax Name"]||""';
if (js.includes(oldTaxName)) {
  js = js.replace(oldTaxName, 'r=String(t.TaxName||t["Tax Name"]||"")');
  console.log('Fix: TaxName String() wrap');
  changes++;
}

// Printer row values
const oldPgType = 'r=n.Type||"kitchen"';
if (js.includes(oldPgType)) {
  js = js.replace(oldPgType, 'r=String(n.Type||"kitchen")');
  console.log('Fix: Printer Type String() wrap');
  changes++;
}

// Printer GroupName in printer section (uses n not t)
const oldPgName = 'e=n.GroupName||n["Group Name"]||""';
if (js.includes(oldPgName)) {
  js = js.replace(oldPgName, 'e=String(n.GroupName||n["Group Name"]||"")');
  console.log('Fix: Printer GroupName String() wrap');
  changes++;
}

fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', js, 'utf8');
console.log('\nTotal additional changes:', changes);
