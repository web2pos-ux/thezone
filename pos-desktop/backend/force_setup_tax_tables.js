// This script forcefully drops and recreates tax-related tables.
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '..', process.env.DB_PATH);
const schemaPath = path.resolve(__dirname, '..', 'db/add_tax_tables.sql');

console.log(`Connecting to database at: ${dbPath}`);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    return console.error('Error opening database', err.message);
  }
  console.log('Database connected successfully.');
  runScript();
});

const runScript = () => {
  const dropStatements = [
    'DROP TABLE IF EXISTS Menu_TaxGroups;',
    'DROP TABLE IF EXISTS TaxGroup_Items;',
    'DROP TABLE IF EXISTS TaxGroups;',
    'DROP TABLE IF EXISTS Taxes;'
  ].join(' ');

  console.log('Forcefully dropping existing tax tables (if any)...');
  db.exec(dropStatements, (err) => {
    if (err) {
      return console.error('Error dropping tables:', err.message);
    }
    console.log('Old tax tables dropped successfully.');
    
    console.log(`Reading schema from: ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Applying new tax tables schema...');
    db.exec(schemaSql, (err) => {
      if (err) {
        return console.error('Error applying schema:', err.message);
      }
      
      console.log('✅ Tax tables created successfully!');
      console.log('Database is now ready. Please restart your backend server.');
      
      db.close((err) => {
        if (err) {
          console.error('Error closing database', err.message);
        } else {
          console.log('Database connection closed.');
        }
      });
    });
  });
}; 