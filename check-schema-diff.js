const sqlite3 = require('sqlite3').verbose();
const devDb = new sqlite3.Database('./db/web2pos.db');
const buildDb = new sqlite3.Database('./pos-desktop/db/web2pos.db');

devDb.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, tables) => {
  let pending = tables.length;
  const diffs = [];
  tables.forEach(t => {
    const name = t.name;
    devDb.all("PRAGMA table_info(" + name + ")", (e1, devCols) => {
      buildDb.all("PRAGMA table_info(" + name + ")", (e2, buildCols) => {
        if (e2 || !buildCols || buildCols.length === 0) {
          diffs.push('MISSING TABLE: ' + name);
        } else {
          const devNames = devCols.map(c => c.name);
          const buildNames = new Set(buildCols.map(c => c.name));
          const missing = devNames.filter(n => !buildNames.has(n));
          if (missing.length > 0) diffs.push(name + ': MISSING columns: ' + missing.join(', '));
        }
        pending--;
        if (pending === 0) {
          if (diffs.length === 0) console.log('ALL TABLES MATCH');
          else diffs.forEach(d => console.log(d));
          devDb.close();
          buildDb.close();
        }
      });
    });
  });
});
