/* eslint-disable no-console */
/**
 * Validate "golden" print presets are present and identical.
 *
 * Usage (from repo root):
 *   node tools/validate-print-presets.js
 *
 * Exit codes:
 * - 0: OK
 * - 1: validation failed
 */

const fs = require('fs');
const path = require('path');

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = stableSortObject(value[k]);
  }
  return out;
}

function loadJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function validatePresetShape(preset, label) {
  assert(preset && typeof preset === 'object', `${label}: not an object`);
  assert(preset.presetId === 'clean_v1', `${label}: presetId must be clean_v1`);
  assert(Number(preset.version) >= 1, `${label}: version must be >= 1`);

  const requiredKeys = [
    'storeName',
    'storeAddress',
    'storePhone',
    'orderType',
    'items',
    'modifiers',
    'subtotal',
    'taxGST',
    'taxPST',
    'total',
    'paymentMethod',
    'paymentDetails',
    'changeAmount',
    'greeting',
    'dateTime',
  ];

  for (const k of requiredKeys) {
    assert(preset[k] && typeof preset[k] === 'object', `${label}: missing key "${k}"`);
    const fs = Number(preset[k].fontSize);
    assert(Number.isFinite(fs) && fs >= 6 && fs <= 200, `${label}: invalid fontSize for "${k}"`);
    if ('visible' in preset[k]) assert(typeof preset[k].visible === 'boolean', `${label}: "${k}.visible" must be boolean`);
  }
}

function main() {
  const backendPresetPath = path.join(__dirname, '..', 'backend', 'printer-presets', 'clean_v1.json');
  const posDesktopPresetPath = path.join(__dirname, '..', 'pos-desktop', 'backend', 'printer-presets', 'clean_v1.json');

  assert(fs.existsSync(backendPresetPath), `Missing preset: ${backendPresetPath}`);
  assert(fs.existsSync(posDesktopPresetPath), `Missing preset: ${posDesktopPresetPath}`);

  const backendPreset = loadJson(backendPresetPath);
  const posPreset = loadJson(posDesktopPresetPath);

  validatePresetShape(backendPreset, 'backend preset');
  validatePresetShape(posPreset, 'pos-desktop preset');

  const a = JSON.stringify(stableSortObject(backendPreset));
  const b = JSON.stringify(stableSortObject(posPreset));
  assert(a === b, 'Presets differ between backend and pos-desktop. Keep them identical.');

  console.log('OK: print presets validated (clean_v1).');
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e && e.message ? e.message : e);
  process.exit(1);
}

