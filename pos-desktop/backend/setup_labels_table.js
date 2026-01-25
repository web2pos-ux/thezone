const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Use the same database path as the main application
const db = new sqlite3.Database('../db/web2pos.db');

const sql = `
-- Create modifier_labels table
CREATE TABLE IF NOT EXISTS modifier_labels (
    label_id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL,
    label_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_modifier_labels_group_id ON modifier_labels(group_id);
CREATE INDEX IF NOT EXISTS idx_modifier_labels_name ON modifier_labels(label_name);
`;

db.exec(sql, (err) => {
    if (err) {
        console.error('Error creating table:', err);
    } else {
        console.log('modifier_labels table created successfully');
    }
    db.close();
}); 