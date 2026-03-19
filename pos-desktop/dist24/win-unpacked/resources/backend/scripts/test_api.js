const http = require('http');

// Test Tax API
async function testTaxAPI() {
  console.log('=== Tax API 테스트 ===\n');
  
  // POST /api/taxes
  const taxData = JSON.stringify({ name: 'Test GST', rate: 5.0 });
  
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3177,
      path: '/api/taxes',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': taxData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('POST /api/taxes 응답:', res.statusCode);
        console.log('Data:', data);
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.log('Error:', e.message);
      resolve();
    });
    
    req.write(taxData);
    req.end();
  });
}

// Test Printer API
async function testPrinterAPI() {
  console.log('\n=== Printer API 테스트 ===\n');
  
  // POST /api/printers/batch
  const printerData = JSON.stringify({ 
    printers: [
      { name: 'Test Printer 1', type: 'receipt', selectedPrinter: 'Microsoft Print to PDF', sortOrder: 0 }
    ] 
  });
  
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3177,
      path: '/api/printers/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(printerData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('POST /api/printers/batch 응답:', res.statusCode);
        console.log('Data:', data);
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.log('Error:', e.message);
      resolve();
    });
    
    req.write(printerData);
    req.end();
  });
}

// GET Printers
async function getPrinters() {
  console.log('\n=== GET Printers ===\n');
  
  return new Promise((resolve) => {
    http.get('http://localhost:3177/api/printers', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('GET /api/printers 응답:', res.statusCode);
        console.log('Data:', data);
        resolve();
      });
    }).on('error', (e) => {
      console.log('Error:', e.message);
      resolve();
    });
  });
}

async function run() {
  await testTaxAPI();
  await testPrinterAPI();
  await getPrinters();
}

run();

