const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

const sql = `
-- Printers 테이블
CREATE TABLE IF NOT EXISTS printers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    type                TEXT DEFAULT '',
    selected_printer    TEXT DEFAULT '',
    sort_order          INTEGER DEFAULT 0,
    is_active           INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Printer Groups 테이블
CREATE TABLE IF NOT EXISTS printer_groups (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    is_active           INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Printer Group Links 테이블 (그룹-프린터 연결)
CREATE TABLE IF NOT EXISTS printer_group_links (
    group_id            INTEGER NOT NULL,
    printer_id          INTEGER NOT NULL,
    PRIMARY KEY (group_id, printer_id),
    FOREIGN KEY (group_id) REFERENCES printer_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE
);
`;

db.exec(sql, (err) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log('✅ Printer 테이블이 성공적으로 생성되었습니다!');
    console.log('   - printers');
    console.log('   - printer_groups');
    console.log('   - printer_group_links');
  }
  db.close();
});


















