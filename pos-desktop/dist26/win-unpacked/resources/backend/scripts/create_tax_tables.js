const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

const sql = `
-- Tax Groups 테이블
CREATE TABLE IF NOT EXISTS tax_groups (
    group_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    description         TEXT,
    is_active           INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Individual Taxes 테이블
CREATE TABLE IF NOT EXISTS taxes (
    tax_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    rate                REAL NOT NULL,
    type                TEXT NOT NULL DEFAULT 'PERCENTAGE',
    is_active           INTEGER DEFAULT 1,
    sort_order          INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tax Group Links 테이블 (세금그룹-세금 연결)
CREATE TABLE IF NOT EXISTS tax_group_links (
    tax_group_id        INTEGER NOT NULL,
    tax_id              INTEGER NOT NULL,
    PRIMARY KEY (tax_group_id, tax_id),
    FOREIGN KEY (tax_group_id) REFERENCES tax_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_id) REFERENCES taxes(tax_id) ON DELETE CASCADE
);
`;

db.exec(sql, (err) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log('✅ Tax 테이블이 성공적으로 생성되었습니다!');
    console.log('   - tax_groups');
    console.log('   - taxes');
    console.log('   - tax_group_links');
  }
  db.close();
});


















