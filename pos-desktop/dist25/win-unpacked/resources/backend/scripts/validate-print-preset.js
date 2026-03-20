/**
 * Validate locked print preset JSON structure.
 *
 * Usage:
 *   node scripts/validate-print-preset.js clean_v1
 *
 * Exit code:
 *   0 on success, 1 on validation failure.
 */

const fs = require('fs');
const path = require('path');

function die(msg) {
  console.error('[validate-print-preset] ' + msg);
  process.exit(1);
}

const id = (process.argv[2] || '').trim();
if (!id) die('Missing preset id. Example: node scripts/validate-print-preset.js clean_v1');

const presetPath = path.join(__dirname, '..', 'printer-presets', `${id}.json`);
if (!fs.existsSync(presetPath)) die(`Preset file not found: ${presetPath}`);

let preset;
try {
  preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
} catch (e) {
  die(`Invalid JSON: ${e?.message || e}`);
}

if (!preset || typeof preset !== 'object') die('Preset JSON must be an object');
if (preset.presetId !== id) die(`presetId mismatch: expected "${id}", got "${preset.presetId}"`);

const locked = preset.lockedSettings;
if (!locked || typeof locked !== 'object') die('Missing lockedSettings object');

function checkNum(name, v, min = 0, max = 120) {
  const n = Number(v);
  if (!Number.isFinite(n)) die(`${name} must be a number, got ${v}`);
  if (n < min || n > max) die(`${name} out of range: ${n} (expected ${min}..${max})`);
}

// Receipt/Bill meta
checkNum('lockedSettings.receiptLayout.topMargin', locked?.receiptLayout?.topMargin);
checkNum('lockedSettings.billLayout.topMargin', locked?.billLayout?.topMargin);

// Kitchen meta
const sections = ['dineInKitchen', 'externalKitchen', 'deliveryKitchen'];
const printers = ['kitchenPrinter', 'waitressPrinter'];
for (const sec of sections) {
  for (const p of printers) {
    checkNum(`lockedSettings.${sec}.${p}.topMargin`, locked?.[sec]?.[p]?.topMargin);
  }
}

console.log('[validate-print-preset] OK:', id);
