const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const menuChannelMapping = [
  { name: 'Sushitown Togo', channels: ['togo'] },
  { name: 'Sushitown-Dine-in', channels: ['dine-in'] },
  { name: '202507 Dine In', channels: ['dine-in'] },
];

const updateMenuChannels = () => {
  console.log('Updating menu sales channels...');
  
  menuChannelMapping.forEach(({ name, channels }) => {
    const channelsJson = JSON.stringify(channels);
    db.run(
      'UPDATE menus SET sales_channels = ? WHERE name = ?',
      [channelsJson, name],
      function(err) {
        if (err) {
          console.error(`Error updating "${name}":`, err.message);
        } else if (this.changes > 0) {
          console.log(`✓ Updated "${name}" with channels: ${channels.join(', ')}`);
        } else {
          console.log(`⚠ Menu "${name}" not found`);
        }
      }
    );
  });
};

db.serialize(() => {
  updateMenuChannels();
});

// Close after a short delay to allow all updates to complete
setTimeout(() => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('\nDatabase closed. Migration complete.');
    }
  });
}, 1000);


















