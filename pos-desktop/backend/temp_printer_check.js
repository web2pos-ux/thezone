const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/Users/User/Thezone/web2pos/db/web2pos.db', sqlite3.OPEN_READONLY);

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

async function check() {
  console.log('=== PRINTERS ===');
  try {
    const printers = await query("SELECT printer_id, name, is_active, selected_printer, graphic_scale FROM printers");
    printers.forEach(p => console.log(JSON.stringify(p)));
  } catch(e) { console.log('error:', e.message); }

  console.log('\n=== FRONT PRINTER ===');
  try {
    const front = await query("SELECT selected_printer, graphic_scale FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
    if (front.length === 0) console.log('  NOT FOUND');
    front.forEach(p => console.log(JSON.stringify(p)));
  } catch(e) { console.log('error:', e.message); }

  console.log('\n=== ANY ACTIVE PRINTER ===');
  try {
    const any = await query("SELECT selected_printer, graphic_scale FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1");
    if (any.length === 0) console.log('  NOT FOUND');
    any.forEach(p => console.log(JSON.stringify(p)));
  } catch(e) { console.log('error:', e.message); }

  console.log('\n=== PRINTER LAYOUT SETTINGS ===');
  try {
    const layout = await query("SELECT * FROM printer_layout_settings WHERE id = 1");
    if (layout.length === 0) console.log('  NOT FOUND');
    layout.forEach(l => console.log(JSON.stringify(l)));
  } catch(e) { console.log('error:', e.message); }

  db.close();
}

check().catch(e => { console.error(e); db.close(); });
