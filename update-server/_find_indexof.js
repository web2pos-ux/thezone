const fs = require('fs');
const js = fs.readFileSync('c:/Users/Luckyhan/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.js', 'utf8');

// Find the exact upload function area
const excelSheets = js.indexOf('Excel sheets:');
console.log('Upload function starts around:', excelSheets);

// Get a large chunk of the upload function
const chunk = js.substring(excelSheets - 500, excelSheets + 10000);

// Find ALL .indexOf calls in this area
const indexOfPattern = /\.indexOf\(/g;
let match;
const results = [];
while ((match = indexOfPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 80);
  const end = Math.min(chunk.length, match.index + 50);
  results.push({
    offset: match.index,
    context: chunk.substring(start, end)
  });
}
console.log(`Found ${results.length} .indexOf calls in upload area:`);
results.forEach((r, i) => {
  console.log(`\n--- #${i + 1} at offset ${r.offset} ---`);
  console.log(r.context);
});

// Also find .includes() which internally calls indexOf
const includesPattern = /\.includes\(/g;
const includesResults = [];
while ((match = includesPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 80);
  const end = Math.min(chunk.length, match.index + 50);
  includesResults.push({
    offset: match.index,
    context: chunk.substring(start, end)
  });
}
console.log(`\n\nFound ${includesResults.length} .includes calls:`);
includesResults.forEach((r, i) => {
  console.log(`\n--- #${i + 1} at offset ${r.offset} ---`);
  console.log(r.context);
});

// Also find .toLowerCase() which could fail on non-strings
const toLowerPattern = /\.toLowerCase\(\)/g;
const toLowerResults = [];
while ((match = toLowerPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 100);
  const end = Math.min(chunk.length, match.index + 20);
  toLowerResults.push({
    offset: match.index,
    context: chunk.substring(start, end)
  });
}
console.log(`\n\nFound ${toLowerResults.length} .toLowerCase() calls:`);
toLowerResults.forEach((r, i) => {
  console.log(`\n--- #${i + 1} at offset ${r.offset} ---`);
  console.log(r.context);
});

// Check .split calls
const splitPattern = /\.split\(/g;
const splitResults = [];
while ((match = splitPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 80);
  const end = Math.min(chunk.length, match.index + 30);
  splitResults.push({
    offset: match.index,
    context: chunk.substring(start, end)
  });
}
console.log(`\n\nFound ${splitResults.length} .split() calls:`);
splitResults.forEach((r, i) => {
  console.log(`\n--- #${i + 1} at offset ${r.offset} ---`);
  console.log(r.context);
});

// Also check .match() calls
const matchPattern = /\.match\(/g;
const matchResults = [];
while ((match = matchPattern.exec(chunk)) !== null) {
  const start = Math.max(0, match.index - 80);
  const end = Math.min(chunk.length, match.index + 30);
  matchResults.push({
    offset: match.index,
    context: chunk.substring(start, end)
  });
}
console.log(`\n\nFound ${matchResults.length} .match() calls:`);
matchResults.forEach((r, i) => {
  console.log(`\n--- #${i + 1} at offset ${r.offset} ---`);
  console.log(r.context);
});
