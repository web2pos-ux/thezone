/**
 * Firebase Full Sync - price field update
 */

const fetch = require('node-fetch');

async function fullSync() {
  console.log('Starting Firebase Full Sync...');
  
  try {
    const response = await fetch('http://localhost:3177/api/menu-sync/full-sync-to-firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menuId: 200005 })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('SUCCESS! Full Sync completed!');
      console.log('Summary:', JSON.stringify(result.summary, null, 2));
      if (result.backup) {
        console.log('Backup:', JSON.stringify(result.backup, null, 2));
      }
    } else {
      console.log('FAILED:', result.error || result.message);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    console.log('Make sure the backend server is running on port 3177');
  }
}

fullSync();
