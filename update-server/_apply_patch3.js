const fs = require('fs');
let js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', 'utf8');

// Fix: Tax Rate column - the variable is t, not e
const oldTaxRate = 'parseFloat(t.Rate||0)';
const newTaxRate = 'parseFloat(t.Rate||t["Tax Rate (%)"]||0)';
if (js.includes(oldTaxRate)) {
  js = js.replace(oldTaxRate, newTaxRate);
  console.log('Fix: Tax Rate (%) patched');
} else {
  console.log('Tax rate pattern not found');
}

// Final verification
console.log('\nFinal verification:');
const checks = [
  ['Sheet names', 'e.Sheets["Modifier Groups"]||e.Sheets.Modifiers'],
  ['Item Name', 'n["Item Name"]||n.Name'],
  ['Category Name', 'n.Category||n["Category Name"]'],
  ['Active/Available', 'String(n.Active||n.Available||"Yes")'],
  ['Split safety (mod)', 'String(d).split(",")'],
  ['Split safety (tax)', 'String(u).split(",")'],
  ['Split safety (printer)', 'String(p).split(",")'],
  ['Tax Rate (%)', 't.Rate||t["Tax Rate (%)"]'],
  ['Price Adj 1', 't["Price Adjustment 1"]'],
  ['Price Adj 2', 't["Price Adjustment 2"]'],
  ['Display Name Korean', 'Display Name (Korean)'],
];
checks.forEach(([name, pattern]) => {
  console.log(`  ${name}: ${js.includes(pattern) ? '✅' : '❌'}`);
});

fs.writeFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', js, 'utf8');
console.log('\nAll patches applied and saved!');
