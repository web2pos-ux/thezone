// Togo 주문의 customer_phone 값 확인
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 루트 DB 사용 (index.js와 동일한 경로)
const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
console.log('Using DB:', dbPath);
const db = new sqlite3.Database(dbPath);

console.log('=== orders 테이블 구조 확인 ===\n');

db.all(`PRAGMA table_info(orders)`, (err, cols) => {
  if (err) {
    console.error('Error:', err);
    db.close();
    return;
  }
  
  console.log('Columns:', cols.map(c => c.name).join(', '));
  
  console.log('\n=== Togo/Pickup 주문 확인 ===\n');
  
  db.all(`
    SELECT id, order_type, customer_phone, customer_name, created_at 
    FROM orders 
    WHERE UPPER(order_type) IN ('TOGO', 'PICKUP', 'TAKEOUT', 'TAKE-OUT')
    ORDER BY id DESC 
    LIMIT 15
  `, (err2, rows) => {
    if (err2) {
      console.error('Error:', err2);
      db.close();
      return;
    }
    
    if (rows.length === 0) {
      console.log('  (No Togo orders found)');
    } else {
      rows.forEach(r => {
        console.log(`  ID: ${r.id} | Type: ${r.order_type} | Phone: "${r.customer_phone || '(empty)'}" | Name: "${r.customer_name || '(empty)'}"`);
      });
    }
    
    console.log('\n=== customer_phone이 있는 주문 ===\n');
    
    db.all(`
      SELECT id, order_type, customer_phone, customer_name 
      FROM orders 
      WHERE customer_phone IS NOT NULL AND customer_phone != ''
      ORDER BY id DESC 
      LIMIT 10
    `, (err3, rows2) => {
      if (err3) {
        console.error('Error:', err3);
        db.close();
        return;
      }
      
      if (rows2.length === 0) {
        console.log('  (No orders with customer_phone found - THIS IS THE PROBLEM!)');
      } else {
        rows2.forEach(r => {
          console.log(`  ID: ${r.id} | Type: ${r.order_type} | Phone: "${r.customer_phone}" | Name: "${r.customer_name || ''}"`);
        });
      }
      
      db.close();
    });
  });
});
