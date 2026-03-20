const http = require('http');
const fs = require('fs');
const path = require('path');

const orderNumber = 'ORD-20251207-1765156870394';

// First, get paid orders to find the order ID
const getPaidOrders = () => {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3177/api/refunds/paid-orders?date=2025-12-07', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
};

// Get order details
const getOrderDetails = (orderId) => {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3177/api/refunds/order/${orderId}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
};

async function main() {
  let output = '';
  
  try {
    // Get paid orders
    const paidOrdersResult = await getPaidOrders();
    output += '=== PAID ORDERS ===\n';
    
    if (paidOrdersResult.success && paidOrdersResult.orders) {
      // Find the specific order
      const targetOrder = paidOrdersResult.orders.find(o => o.order_number === orderNumber);
      
      if (targetOrder) {
        output += `Found order: ${orderNumber}\n`;
        output += `Order ID: ${targetOrder.id}\n`;
        output += `Paid Amount: ${targetOrder.paid_amount}\n`;
        output += `Payment Methods: ${targetOrder.payment_methods}\n\n`;
        
        // Get detailed order info
        const orderDetails = await getOrderDetails(targetOrder.id);
        
        output += '=== ORDER DETAILS ===\n';
        output += JSON.stringify(orderDetails, null, 2);
      } else {
        output += `Order ${orderNumber} not found in paid orders\n`;
        output += 'Available orders:\n';
        paidOrdersResult.orders.slice(0, 5).forEach(o => {
          output += `  - ${o.order_number}: $${o.paid_amount}\n`;
        });
      }
    } else {
      output += 'No orders found or error\n';
      output += JSON.stringify(paidOrdersResult, null, 2);
    }
  } catch (e) {
    output += 'Error: ' + e.message + '\n';
  }
  
  const resultPath = path.join(__dirname, 'order_api_result.txt');
  fs.writeFileSync(resultPath, output);
  console.log('Result saved to:', resultPath);
}

main();



