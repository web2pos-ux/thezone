const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Users/User/Thezone/Menus/Sushiharbour/web2pos.db', sqlite3.OPEN_READONLY);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}
function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
}

async function analyze() {
  // 1. Z-Report fallback simulation: active taxes
  console.log('=== ACTIVE TAXES ===');
  const activeTaxes = await query(`
    SELECT DISTINCT t.name, t.rate FROM taxes t
    JOIN tax_group_links tgl ON tgl.tax_id = t.tax_id
    JOIN tax_groups tg ON tg.tax_group_id = tgl.tax_group_id AND COALESCE(tg.is_deleted, 0) = 0
    WHERE COALESCE(t.is_deleted, 0) = 0
    ORDER BY t.rate ASC
  `);
  activeTaxes.forEach(t => console.log(`  ${t.name}: ${t.rate}%`));

  const gstRate = (activeTaxes || []).find(t => /gst/i.test(t.name))?.rate || 0;
  const pstRates = (activeTaxes || []).filter(t => /pst/i.test(t.name)).map(t => Number(t.rate));
  const mainPstRate = pstRates.length > 0 ? Math.min(...pstRates) : 0;
  console.log(`\n  GST rate: ${gstRate}%, Main PST rate: ${mainPstRate}%`);

  // 2. Simulate fallback for March 2026
  console.log('\n=== FALLBACK GST/PST SPLIT (March 2026) ===');
  const orders = await query(`
    SELECT o.id, o.order_number, o.subtotal, o.tax, o.total, o.adjustments_json
    FROM orders o
    WHERE o.created_at >= '2026-03-01' AND o.created_at < '2026-04-01'
    AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
    AND COALESCE(o.tax, 0) > 0
  `);

  let gstTotal = 0, pstTotal = 0;
  let gstOnlyCount = 0, gstPstCount = 0, otherCount = 0;

  orders.forEach(o => {
    const sub = Number(o.subtotal || 0);
    const totalTax = Number(o.tax || 0);
    if (sub <= 0 || totalTax <= 0) return;
    const effRate = (totalTax / sub) * 100;

    if (effRate <= gstRate + 0.5) {
      gstTotal += totalTax;
      gstOnlyCount++;
    } else if (mainPstRate > 0) {
      const combinedRate = gstRate + mainPstRate;
      gstTotal += (gstRate / combinedRate) * totalTax;
      pstTotal += (mainPstRate / combinedRate) * totalTax;
      gstPstCount++;
    } else {
      gstTotal += totalTax;
      otherCount++;
    }
  });

  console.log(`  Total orders with tax: ${orders.length}`);
  console.log(`  GST-only orders (rate <= ${gstRate + 0.5}%): ${gstOnlyCount}`);
  console.log(`  GST+PST orders (rate > ${gstRate + 0.5}%): ${gstPstCount}`);
  console.log(`  Other: ${otherCount}`);
  console.log(`  GST Total: $${gstTotal.toFixed(2)}`);
  console.log(`  PST Total: $${pstTotal.toFixed(2)}`);
  console.log(`  Combined: $${(gstTotal + pstTotal).toFixed(2)}`);

  // 3. Compare with actual total tax
  const totalTaxRow = await queryOne(`
    SELECT ROUND(SUM(tax), 2) as total_tax
    FROM orders
    WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'
    AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
  `);
  console.log(`  DB Total Tax: $${totalTaxRow.total_tax}`);

  // 4. Check effective rate distribution
  console.log('\n=== EFFECTIVE TAX RATE DISTRIBUTION ===');
  const rateDist = {};
  orders.forEach(o => {
    const sub = Number(o.subtotal || 0);
    const totalTax = Number(o.tax || 0);
    if (sub <= 0) return;
    const effRate = Math.round((totalTax / sub) * 1000) / 10;
    const bucket = `${effRate}%`;
    rateDist[bucket] = (rateDist[bucket] || 0) + 1;
  });
  Object.entries(rateDist).sort((a, b) => b[1] - a[1]).forEach(([rate, cnt]) => {
    console.log(`  ${rate}: ${cnt} orders`);
  });

  // 5. Void totals
  console.log('\n=== VOID SUMMARY (March) ===');
  const voids = await query(`
    SELECT COUNT(*) as cnt, ROUND(SUM(grand_total), 2) as total
    FROM voids
    WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'
  `);
  voids.forEach(v => console.log(`  Voids: ${v.cnt} items, total=$${v.total}`));

  // 6. Discount summary
  console.log('\n=== DISCOUNT SUMMARY (March) ===');
  const discounts = await query(`
    SELECT id, order_number, adjustments_json, subtotal, tax, total
    FROM orders
    WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01'
    AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
    AND adjustments_json IS NOT NULL AND adjustments_json != '' AND adjustments_json != '[]'
  `);
  let totalDiscountAmount = 0;
  discounts.forEach(d => {
    try {
      const adj = JSON.parse(d.adjustments_json);
      adj.forEach(a => {
        if (a.amount < 0) totalDiscountAmount += Math.abs(a.amount);
        console.log(`  Order #${d.order_number}: ${a.label}, amount=${a.amount}`);
      });
    } catch(e) {}
  });
  console.log(`  Total discount amount: $${totalDiscountAmount.toFixed(2)}`);

  // 7. Check if Z-Report daily closings already have GST/PST
  console.log('\n=== DAILY CLOSINGS - check for tax breakdown ===');
  const dcSchema = await query("PRAGMA table_info(daily_closings)");
  const hasGst = dcSchema.some(c => c.name === 'gst_total');
  const hasPst = dcSchema.some(c => c.name === 'pst_total');
  console.log(`  daily_closings has gst_total column: ${hasGst}`);
  console.log(`  daily_closings has pst_total column: ${hasPst}`);

  // 8. Check daily_closings_v2
  console.log('\n=== DAILY_CLOSINGS_V2 SCHEMA ===');
  const dc2Schema = await query("PRAGMA table_info(daily_closings_v2)");
  dc2Schema.forEach(c => console.log(`  ${c.name} (${c.type})`));

  db.close();
  console.log('\nDone.');
}

analyze().catch(e => { console.error(e); db.close(); });
