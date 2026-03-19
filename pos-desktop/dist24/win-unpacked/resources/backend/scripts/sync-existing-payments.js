// Sync existing payments to Firebase
// Run this once to populate Firebase with historical data

require('dotenv').config({ path: './.env' });
require('dotenv').config({ path: '../.env' });

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const admin = require('firebase-admin');

// Initialize Firebase
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, '../config/firebase-service-account.json')))
  });
}
const firestore = admin.firestore();

// Initialize SQLite
const dbPath = path.resolve(__dirname, '../../db/web2pos.db');
console.log('Using DB:', dbPath);

const db = new sqlite3.Database(dbPath);

const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
if (!restaurantId) {
  console.error('❌ FIREBASE_RESTAURANT_ID not set in .env');
  process.exit(1);
}

console.log('Restaurant ID:', restaurantId);

async function syncPayments() {
  console.log('\n=== Syncing Existing Payments to Firebase ===\n');

  return new Promise((resolve, reject) => {
    // Get all completed payments
    const query = `
      SELECT 
        p.id as payment_id,
        p.order_id,
        p.amount,
        p.tip,
        p.method,
        p.created_at,
        o.order_type,
        o.total,
        o.status as order_status
      FROM payments p
      LEFT JOIN orders o ON p.order_id = o.id
      WHERE p.status = 'APPROVED' OR p.status = 'COMPLETED' OR p.amount > 0
      ORDER BY p.created_at ASC
    `;

    db.all(query, async (err, payments) => {
      if (err) {
        console.error('DB Error:', err);
        reject(err);
        return;
      }

      console.log(`Found ${payments.length} payments to sync\n`);

      if (payments.length === 0) {
        console.log('No payments found. Checking payments table structure...');
        db.all("PRAGMA table_info(payments)", (err, cols) => {
          if (err) {
            console.log('Error reading payments table:', err);
          } else {
            console.log('Payments table columns:', cols.map(c => c.name).join(', '));
          }
          resolve();
        });
        return;
      }

      const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
      const dailySalesMap = new Map();
      const monthlySalesMap = new Map();
      const itemSalesMap = new Map();

      for (const payment of payments) {
        const createdAt = new Date(payment.created_at);
        const dateStr = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
        const monthStr = dateStr.substring(0, 7); // YYYY-MM
        const hourStr = String(createdAt.getHours()).padStart(2, '0');

        const amount = parseFloat(payment.amount) || 0;
        const tip = parseFloat(payment.tip) || 0;
        const paymentMethod = (payment.method || 'CASH').toUpperCase();
        const orderType = (payment.order_type || 'DINE-IN').toUpperCase();

        // Aggregate daily sales
        if (!dailySalesMap.has(dateStr)) {
          dailySalesMap.set(dateStr, {
            date: dateStr,
            totalSales: 0,
            totalTips: 0,
            orderCount: 0,
            paymentMethods: {},
            orderTypes: {},
            hourlySales: {}
          });
        }
        const daily = dailySalesMap.get(dateStr);
        daily.totalSales += amount;
        daily.totalTips += tip;
        daily.orderCount += 1;
        daily.paymentMethods[paymentMethod] = (daily.paymentMethods[paymentMethod] || 0) + amount;
        daily.orderTypes[orderType] = (daily.orderTypes[orderType] || 0) + amount;
        daily.hourlySales[hourStr] = (daily.hourlySales[hourStr] || 0) + amount;

        // Aggregate monthly sales
        if (!monthlySalesMap.has(monthStr)) {
          monthlySalesMap.set(monthStr, {
            month: monthStr,
            totalSales: 0,
            totalTips: 0,
            orderCount: 0,
            dailySales: {}
          });
        }
        const monthly = monthlySalesMap.get(monthStr);
        monthly.totalSales += amount;
        monthly.totalTips += tip;
        monthly.orderCount += 1;
        monthly.dailySales[dateStr] = (monthly.dailySales[dateStr] || 0) + amount;
      }

      // Write daily sales to Firebase
      console.log(`Writing ${dailySalesMap.size} daily sales records...`);
      for (const [dateStr, data] of dailySalesMap) {
        try {
          await restaurantRef.collection('dailySales').doc(dateStr).set({
            ...data,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`  ✅ ${dateStr}: $${data.totalSales.toFixed(2)} (${data.orderCount} orders)`);
        } catch (error) {
          console.error(`  ❌ ${dateStr}:`, error.message);
        }
      }

      // Write monthly sales to Firebase
      console.log(`\nWriting ${monthlySalesMap.size} monthly sales records...`);
      for (const [monthStr, data] of monthlySalesMap) {
        try {
          await restaurantRef.collection('monthlySales').doc(monthStr).set({
            ...data,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`  ✅ ${monthStr}: $${data.totalSales.toFixed(2)} (${data.orderCount} orders)`);
        } catch (error) {
          console.error(`  ❌ ${monthStr}:`, error.message);
        }
      }

      // Sync order items for menu analysis
      console.log('\n--- Syncing Order Items ---');
      
      db.all(`
        SELECT 
          oi.order_id,
          oi.menu_item_id,
          oi.item_name,
          oi.quantity,
          oi.unit_price,
          o.created_at
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status = 'COMPLETED' OR o.status = 'PAID'
        ORDER BY o.created_at ASC
      `, async (err, items) => {
        if (err) {
          console.log('Order items error:', err.message);
          resolve();
          return;
        }

        console.log(`Found ${items.length} order items`);

        const itemsByDate = new Map();

        for (const item of items) {
          const createdAt = new Date(item.created_at);
          const dateStr = createdAt.toISOString().split('T')[0];
          
          if (!itemsByDate.has(dateStr)) {
            itemsByDate.set(dateStr, {});
          }
          const dayItems = itemsByDate.get(dateStr);
          
          const itemId = String(item.menu_item_id || 'unknown');
          if (!dayItems[itemId]) {
            dayItems[itemId] = {
              name: item.item_name || 'Unknown Item',
              quantity: 0,
              sales: 0
            };
          }
          dayItems[itemId].quantity += (item.quantity || 1);
          dayItems[itemId].sales += (item.quantity || 1) * (parseFloat(item.unit_price) || 0);
        }

        console.log(`Writing ${itemsByDate.size} daily item sales records...`);
        for (const [dateStr, items] of itemsByDate) {
          try {
            await restaurantRef.collection('dailyItemSales').doc(dateStr).set({
              date: dateStr,
              items: items,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`  ✅ ${dateStr}: ${Object.keys(items).length} items`);
          } catch (error) {
            console.error(`  ❌ ${dateStr}:`, error.message);
          }
        }

        console.log('\n=== Sync Complete! ===');
        console.log('Refresh the TZO app to see the reports.');
        resolve();
      });
    });
  });
}

syncPayments()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('Sync failed:', err);
    db.close();
    process.exit(1);
  });
