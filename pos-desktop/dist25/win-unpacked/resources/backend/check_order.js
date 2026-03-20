const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');

console.log('DB Path:', dbPath);
console.log('DB exists:', fs.existsSync(dbPath));

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('DB Connection Error:', err);
    return;
  }
  console.log('DB Connected');
  
  const orderNumber = 'ORD-20251207-1765156870394';
  let output = 'DB Path: ' + dbPath + '\n\n';

  db.get(`SELECT * FROM orders WHERE order_number = ?`, [orderNumber], (err, order) => {
    if (err) {
      output += 'Error: ' + err + '\n';
      fs.writeFileSync(path.join(__dirname, 'order_check_result.txt'), output);
      db.close();
      return;
    }
    
    output += '=== ORDER ===\n';
    output += JSON.stringify(order, null, 2) + '\n';
    
    if (!order) {
      output += 'Order not found\n';
      fs.writeFileSync(path.join(__dirname, 'order_check_result.txt'), output);
      db.close();
      return;
    }
    
    db.all(`SELECT id, name, quantity, price FROM order_items WHERE order_id = ?`, [order.id], (err2, items) => {
      output += '\n=== ORDER ITEMS ===\n';
      output += JSON.stringify(items, null, 2) + '\n';
      
      db.all(`SELECT * FROM order_adjustments WHERE order_id = ?`, [order.id], (err3, adjustments) => {
        output += '\n=== ORDER ADJUSTMENTS (Discounts) ===\n';
        output += JSON.stringify(adjustments, null, 2) + '\n';
        
        db.all(`SELECT * FROM payments WHERE order_id = ?`, [order.id], (err4, payments) => {
          output += '\n=== PAYMENTS ===\n';
          output += JSON.stringify(payments, null, 2) + '\n';
          
          const resultPath = path.join(__dirname, 'order_check_result.txt');
          fs.writeFileSync(resultPath, output);
          console.log('Result written to:', resultPath);
          db.close();
        });
      });
    });
  });
});



