const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.all('PRAGMA table_info(orders)', [], (e, cols) => {
  console.log(cols.map((x) => x.name).join('\n'));
  db.close();
});
