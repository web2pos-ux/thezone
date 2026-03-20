const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

db.all(
  'SELECT printer_id, name, selected_printer, COALESCE(graphic_scale, 1.0) AS graphic_scale FROM printers WHERE is_active = 1 ORDER BY name',
  (err, rows) => {
    if (err) {
      console.error(err);
      db.close();
      process.exit(1);
    }
    console.log('DB:', dbPath);
    console.log('ACTIVE PRINTERS (graphic_scale):');
    for (const r of rows) {
      console.log(`${r.printer_id}\t${r.name}\t${r.selected_printer}\tgraphic_scale=${r.graphic_scale}`);
    }
    db.close();
  }
);

