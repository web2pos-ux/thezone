const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async () => {
  const dbPath = path.resolve(__dirname, '..', 'web2pos.db');
  const db = new sqlite3.Database(dbPath);

  const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const schema = `
  CREATE TABLE IF NOT EXISTS OpenPrice_Settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    default_tax_group_id INTEGER,
    default_printer_group_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (default_tax_group_id) REFERENCES TaxGroups(id),
    FOREIGN KEY (default_printer_group_id) REFERENCES printer_groups(group_id)
  );
  `;

  try {
    console.log('Creating OpenPrice_Settings table at:', dbPath);
    await exec(schema);
    console.log('OpenPrice_Settings table created successfully.');
  } catch (e) {
    console.error('Failed to create OpenPrice_Settings table:', e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})(); 