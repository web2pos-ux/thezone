const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.all('SELECT * FROM orders WHERE id=194', [], (e, r) => {
  console.log(JSON.stringify(r, null, 2));
  db.close();
});
