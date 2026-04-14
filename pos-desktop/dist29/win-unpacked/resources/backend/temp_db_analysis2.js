const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Users/User/Thezone/Menus/Sushiharbour/web2pos.db', sqlite3.OPEN_READONLY);

function query(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

async function analyze() {
  // 1. taxes table
  console.log('=== TAXES TABLE ===');
  try {
    const schema = await query("PRAGMA table_info(taxes)");
    schema.forEach(c => console.log(`  [schema] ${c.name} (${c.type})`));
    const data = await query("SELECT * FROM taxes");
    data.forEach(t => console.log(`  [data] ${JSON.stringify(t)}`));
  } catch(e) { console.log('  error:', e.message); }

  // 2. tax_group_links
  console.log('\n=== TAX_GROUP_LINKS ===');
  try {
    const schema = await query("PRAGMA table_info(tax_group_links)");
    schema.forEach(c => console.log(`  [schema] ${c.name} (${c.type})`));
    const data = await query("SELECT * FROM tax_group_links LIMIT 20");
    data.forEach(t => console.log(`  [data] ${JSON.stringify(t)}`));
  } catch(e) { console.log('  error:', e.message); }

  // 3. orders.tax_breakdown sample
  console.log('\n=== ORDERS TAX_BREAKDOWN SAMPLES ===');
  try {
    const data = await query("SELECT id, order_number, tax_breakdown, tax, total, subtotal FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND tax_breakdown IS NOT NULL AND tax_breakdown != '' LIMIT 5");
    data.forEach(o => console.log(JSON.stringify(o)));
  } catch(e) { console.log('  error:', e.message); }

  // 4. How tax is stored - check orders.tax vs sum of items
  console.log('\n=== TAX COMPARISON: orders.tax vs SUM(order_items.tax) ===');
  try {
    const data = await query(`
      SELECT o.id, o.order_number, o.tax as order_tax, o.subtotal, o.total, o.tax_rate as order_tax_rate,
             ROUND(SUM(oi.tax),2) as items_tax_sum,
             ROUND(SUM(oi.price * oi.quantity),2) as items_price_sum
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_at >= '2026-03-01' AND o.created_at < '2026-04-01'
      AND o.status = 'PAID'
      GROUP BY o.id
      LIMIT 10
    `);
    data.forEach(o => console.log(JSON.stringify(o)));
  } catch(e) { console.log('  error:', e.message); }

  // 5. Check orders.tax_rate distribution
  console.log('\n=== ORDERS TAX_RATE DISTRIBUTION (March PAID) ===');
  try {
    const data = await query("SELECT tax_rate, COUNT(*) as cnt FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND status IN ('PAID','PICKED_UP') GROUP BY tax_rate");
    data.forEach(r => console.log(`  rate=${r.tax_rate}, count=${r.cnt}`));
  } catch(e) { console.log('  error:', e.message); }

  // 6. Payments summary for March
  console.log('\n=== PAYMENTS SUMMARY (March) ===');
  try {
    const data = await query(`
      SELECT p.payment_method, COUNT(*) as cnt, ROUND(SUM(p.amount),2) as total_amount, ROUND(SUM(p.tip),2) as total_tip
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= '2026-03-01' AND o.created_at < '2026-04-01'
      AND o.status IN ('PAID','PICKED_UP')
      GROUP BY p.payment_method
    `);
    data.forEach(r => console.log(`  ${r.payment_method}: ${r.cnt} payments, amount=$${r.total_amount}, tip=$${r.total_tip}`));
  } catch(e) { console.log('  error:', e.message); }

  // 7. Adjustments analysis
  console.log('\n=== ALL ADJUSTMENTS IN MARCH ===');
  try {
    const data = await query("SELECT id, order_number, adjustments_json, total, subtotal, tax, status FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND adjustments_json IS NOT NULL AND adjustments_json != '' AND adjustments_json != '[]'");
    data.forEach(a => console.log(JSON.stringify(a)));
  } catch(e) { console.log('  error:', e.message); }

  // 8. Check if tax is calculated as percentage of subtotal
  console.log('\n=== TAX RATE CHECK (tax/subtotal ratio for PAID orders) ===');
  try {
    const data = await query(`
      SELECT ROUND(tax/subtotal*100, 2) as calc_rate, COUNT(*) as cnt
      FROM orders
      WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'
      AND status IN ('PAID','PICKED_UP')
      AND subtotal > 0
      GROUP BY ROUND(tax/subtotal*100, 2)
      ORDER BY cnt DESC
      LIMIT 10
    `);
    data.forEach(r => console.log(`  rate=${r.calc_rate}%, count=${r.cnt}`));
  } catch(e) { console.log('  error:', e.message); }

  // 9. Check PICKED_UP orders (online orders)
  console.log('\n=== PICKED_UP ORDERS SAMPLE ===');
  try {
    const data = await query("SELECT id, order_number, order_type, channel, subtotal, tax, total, adjustments_json, order_source FROM orders WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND status = 'PICKED_UP' LIMIT 5");
    data.forEach(o => console.log(JSON.stringify(o)));
  } catch(e) { console.log('  error:', e.message); }

  // 10. Total summary for March
  console.log('\n=== MARCH TOTAL SUMMARY (PAID + PICKED_UP) ===');
  try {
    const data = await query(`
      SELECT
        COUNT(*) as order_count,
        ROUND(SUM(subtotal),2) as gross_subtotal,
        ROUND(SUM(tax),2) as total_tax,
        ROUND(SUM(total),2) as total_amount,
        ROUND(SUM(CASE WHEN adjustments_json IS NOT NULL AND adjustments_json != '' AND adjustments_json != '[]' THEN 1 ELSE 0 END)) as orders_with_adjustments
      FROM orders
      WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'
      AND status IN ('PAID','PICKED_UP')
    `);
    data.forEach(r => console.log(JSON.stringify(r)));
  } catch(e) { console.log('  error:', e.message); }

  // 11. Daily closings for March
  console.log('\n=== DAILY CLOSINGS IN MARCH ===');
  try {
    const data = await query("SELECT date, total_sales, tax_total, discount_total, void_total, refund_total, tip_total, order_count FROM daily_closings WHERE date >= '2026-03-01' AND date < '2026-04-01' ORDER BY date");
    data.forEach(d => console.log(JSON.stringify(d)));
  } catch(e) { console.log('  error:', e.message); }

  // 12. Refunds table
  console.log('\n=== REFUNDS IN MARCH ===');
  try {
    const schema = await query("PRAGMA table_info(refunds)");
    schema.forEach(c => console.log(`  [schema] ${c.name} (${c.type})`));
    const data = await query("SELECT * FROM refunds WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'");
    if (data.length === 0) console.log('  None');
    data.forEach(r => console.log(JSON.stringify(r)));
  } catch(e) { console.log('  error:', e.message); }

  // 13. Voids table
  console.log('\n=== VOIDS IN MARCH ===');
  try {
    const schema = await query("PRAGMA table_info(voids)");
    schema.forEach(c => console.log(`  [schema] ${c.name} (${c.type})`));
    const data = await query("SELECT * FROM voids WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'");
    if (data.length === 0) console.log('  None');
    data.forEach(r => console.log(JSON.stringify(r)));
  } catch(e) { console.log('  error:', e.message); }

  db.close();
  console.log('\nDone.');
}

analyze().catch(e => { console.error(e); db.close(); });
