const fetch = require('node-fetch');

async function testEmptyArray() {
  try {
    const response = await fetch('http://localhost:3177/api/table-map/elements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        elements: [],
        floor: '1F'
      })
    });
    
    const result = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

testEmptyArray(); 
