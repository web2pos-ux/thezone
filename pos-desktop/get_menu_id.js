const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../db/web2pos.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
        return;
    }
    console.log('Connected to the database.');
});

const menuName = '20260630-1'; // 조회할 메뉴 이름

const sql = `SELECT menu_id, name FROM menus WHERE name = ?;`;

db.get(sql, [menuName], (err, row) => {
    if (err) {
        console.error('Error querying menu:', err.message);
    } else {
        if (row) {
            console.log(`${row.menu_id}|${row.name}`);
        } else {
            console.log('Menu not found.');
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
