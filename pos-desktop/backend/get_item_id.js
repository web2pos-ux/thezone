const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../db/web2pos.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
        return;
    }
    console.log('Connected to the database.');
});

const itemName = 'Agedashi Tofus';
const categoryId = 1000022;

const sql = `SELECT item_id, name FROM menu_items WHERE name = ? AND category_id = ?;`;

db.get(sql, [itemName, categoryId], (err, row) => {
    if (err) {
        console.error('Error querying item:', err.message);
    } else {
        if (row) {
            console.log(`${row.item_id}|${row.name}`);
        } else {
            console.log('Item not found.');
        }
    }
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
    });
}); 