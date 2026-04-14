const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = 'c:/Users/User/Thezone/Menus/Sushiharbour/web2pos.db';
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error('DB open error:', err); process.exit(1); }
});

function query(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function analyze() {
  // 1. Tables
  console.log('=== TABLES ===');
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  tables.forEach(t => console.log(t.name));

  // 2. Orders schema
  console.log('\n=== ORDERS SCHEMA ===');
  const ordersInfo = await query("PRAGMA table_info(orders)");
  ordersInfo.forEach(c => console.log(`  ${c.name} (${c.type})`));

  // 3. Order items schema
  console.log('\n=== ORDER_ITEMS SCHEMA ===');
  try {
    const itemsInfo = await query("PRAGMA table_info(order_items)");
    itemsInfo.forEach(c => console.log(`  ${c.name} (${c.type})`));
  } catch(e) { console.log('  not found'); }

  // 4. Payments schema
  console.log('\n=== PAYMENTS SCHEMA ===');
  try {
    const paymentsInfo = await query("PRAGMA table_info(payments)");
    paymentsInfo.forEach(c => console.log(`  ${c.name} (${c.type})`));
  } catch(e) { console.log('  not found'); }

  // 5. Tax groups
  console.log('\n=== TAX_GROUPS ===');
  try {
    const tgSchema = await query("PRAGMA table_info(tax_groups)");
    tgSchema.forEach(c => console.log(`  [schema] ${c.name} (${c.type})`));
    const tgData = await query("SELECT * FROM tax_groups");
    tgData.forEach(t => console.log(`  [data] ${JSON.stringify(t)}`));
  } catch(e) { console.log('  not found'); }

  // 6. Tax rates
  console.log('\n=== TAX_RATES ===');
  try {
    const trSchema = await query("PRAGMA table_info(tax_rates)");
    trSchema.forEach(c => console.log(`  [schema] ${c.name} (${c.type})`));
    const trData = await query("SELECT * FROM tax_rates");
    trData.forEach(t => console.log(`  [data] ${JSON.stringify(t)}`));
  } catch(e) { console.log('  not found'); }

  // 7. Settings (tax related)
  console.log('\n=== SETTINGS (tax) ===');
  try {
    const settings = await query("SELECT key, value FROM settings WHERE key LIKE '%tax%'");
    settings.forEach(s => console.log(`  ${s.key} = ${s.value}`));
  } catch(e) { console.log('  not found'); }

  // 8. March 2026 order counts
  console.log('\n=== MARCH 2026 ORDER COUNTS ===');
  try {
    const counts = await query("SELECT status, COUNT(*) as cnt, ROUND(SUM(total),2) as total_sum FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' GROUP BY status");
    counts.forEach(c => console.log(`  ${c.status}: ${c.cnt} orders, total=$${c.total_sum}`));
  } catch(e) { console.log('  error:', e.message); }

  // 9. Sample orders
  console.log('\n=== SAMPLE MARCH ORDERS (first 3) ===');
  try {
    const orders = await query("SELECT id, order_number, status, total, subtotal, tax, order_type, adjustments_json, created_at FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' ORDER BY created_at LIMIT 3");
    orders.forEach(o => console.log(JSON.stringify(o)));
  } catch(e) { console.log('  error:', e.message); }

  // 10. Sample order items with tax info
  console.log('\n=== SAMPLE ORDER_ITEMS (first 5 from March) ===');
  try {
    const items = await query("SELECT oi.* FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.created_at >= '2026-03-01' AND o.created_at < '2026-04-01' LIMIT 5");
    items.forEach(i => console.log(JSON.stringify(i)));
  } catch(e) { console.log('  error:', e.message); }

  // 11. Orders with adjustments (D/C, void etc)
  console.log('\n=== ORDERS WITH ADJUSTMENTS (March, first 5) ===');
  try {
    const adj = await query("SELECT id, order_number, adjustments_json, total, subtotal, tax, status FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND adjustments_json IS NOT NULL AND adjustments_json != '' AND adjustments_json != '[]' LIMIT 5");
    adj.forEach(a => console.log(JSON.stringify(a)));
  } catch(e) { console.log('  error:', e.message); }

  // 12. Void/refund in March
  console.log('\n=== VOID/REFUND IN MARCH ===');
  try {
    const voids = await query("SELECT status, COUNT(*) as cnt, ROUND(SUM(total),2) as total_amt FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND (LOWER(status) LIKE '%void%' OR LOWER(status) LIKE '%refund%' OR LOWER(status) LIKE '%cancel%') GROUP BY status");
    if (voids.length === 0) console.log('  None found');
    voids.forEach(v => console.log(`  ${v.status}: ${v.cnt} orders, $${v.total_amt}`));
  } catch(e) { console.log('  error:', e.message); }

  // 13. Daily closings schema
  console.log('\n=== DAILY_CLOSINGS SCHEMA ===');
  try {
    const dcInfo = await query("PRAGMA table_info(daily_closings)");
    dcInfo.forEach(c => console.log(`  ${c.name} (${c.type})`));
  } catch(e) { console.log('  not found'); }

  // 14. Check tax in order_items columns
  console.log('\n=== ORDER_ITEMS TAX SAMPLE ===');
  try {
    const taxSample = await query("SELECT oi.id, oi.name, oi.price, oi.tax_rate, oi.tax, oi.tax_group_id FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.created_at >= '2026-03-01' AND o.created_at < '2026-04-01' AND oi.tax_rate > 0 LIMIT 5");
    taxSample.forEach(t => console.log(JSON.stringify(t)));
  } catch(e) { console.log('  error:', e.message); }

  // 15. Distinct tax rates used in March
  console.log('\n=== DISTINCT TAX RATES IN MARCH ===');
  try {
    const rates = await query("SELECT DISTINCT oi.tax_rate, oi.tax_group_id, COUNT(*) as cnt FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.created_at >= '2026-03-01' AND o.created_at < '2026-04-01' GROUP BY oi.tax_rate, oi.tax_group_id ORDER BY oi.tax_rate");
    rates.forEach(r => console.log(`  rate=${r.tax_rate}, group_id=${r.tax_group_id}, count=${r.cnt}`));
  } catch(e) { console.log('  error:', e.message); }

  db.close();
  console.log('\nDone.');
}

analyze().catch(e => { console.error(e); db.close(); });
