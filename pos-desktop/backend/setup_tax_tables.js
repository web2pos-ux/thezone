// This script is for one-time use to set up the necessary tax-related database tables.
require('dotenv').config({ path: '../.env' });
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '..', process.env.DB_PATH);
const schemaPath = path.resolve(__dirname, '..', 'db/add_tax_tables.sql');

console.log(`Connecting to database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
    return;
  }
  console.log('Database connected successfully.');
});

console.log(`Reading schema from: ${schemaPath}`);
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

db.exec(schemaSql, (err) => {
  if (err) {
    console.error('Error applying schema:', err.message);
  } else {
    console.log('Tax tables schema applied successfully.');
    console.log('You can now restart your backend server.');
  }
  
  db.close((err) => {
    if (err) {
      console.error('Error closing database', err.message);
    } else {
      console.log('Database connection closed.');
    }
  });
}); 