const fetch = require('node-fetch');

async function testOpenPriceSettings() {
  try {
    console.log('Testing Open Price Settings API...');
    
    // Test GET request
    console.log('\n1. Testing GET /api/open-price/settings');
    const getResponse = await fetch('http://localhost:3177/api/open-price/settings');
    console.log('GET Response status:', getResponse.status);
    const getData = await getResponse.json();
    console.log('GET Response data:', getData);
    
    // Test POST request
    console.log('\n2. Testing POST /api/open-price/settings');
    const postResponse = await fetch('http://localhost:3177/api/open-price/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultTaxGroupId: null,
        defaultPrinterGroupId: null
      })
    });
    console.log('POST Response status:', postResponse.status);
    const postData = await postResponse.json();
    console.log('POST Response data:', postData);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testOpenPriceSettings(); 