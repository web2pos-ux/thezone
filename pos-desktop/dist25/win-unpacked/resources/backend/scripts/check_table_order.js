const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'db', 'web2pos.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('\n=== menus 테이블 스키마 ===');
  db.all('PRAGMA table_info(menus)', (err, rows) => {
    if (err) console.error('menus error:', err);
    else console.log(JSON.stringify(rows, null, 2));
  });

  console.log('\n=== table_devices 테이블 스키마 ===');
  db.all('PRAGMA table_info(table_devices)', (err, rows) => {
    if (err) console.error('table_devices error:', err);
    else console.log(JSON.stringify(rows, null, 2));
  });

  console.log('\n=== 활성 메뉴 목록 ===');
  db.all('SELECT menu_id, name, is_active FROM menus ORDER BY menu_id LIMIT 5', (err, rows) => {
    if (err) console.error('menus data error:', err);
    else console.log(JSON.stringify(rows, null, 2));
  });

  console.log('\n=== 메뉴 카테고리 (첫 번째 메뉴) ===');
  db.all(`
    SELECT category_id, menu_id, name, is_active 
    FROM menu_categories 
    WHERE is_active = 1 
    ORDER BY menu_id, sort_order 
    LIMIT 10
  `, (err, rows) => {
    if (err) console.error('categories error:', err);
    else console.log(JSON.stringify(rows, null, 2));
  });

  console.log('\n=== 메뉴 아이템 샘플 ===');
  db.all(`
    SELECT item_id, category_id, name, price 
    FROM menu_items 
    WHERE is_active = 1 
    LIMIT 5
  `, (err, rows) => {
    if (err) console.error('items error:', err);
    else console.log(JSON.stringify(rows, null, 2));
    db.close();
  });
});

















