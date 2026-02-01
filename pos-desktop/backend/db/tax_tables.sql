-- Tax Tables for WEB2POS
-- 세금 그룹과 세금 항목을 관리하는 테이블들

-- Tax Groups: 여러 세금을 묶는 그룹 (예: California Tax, BC Tax)
CREATE TABLE IF NOT EXISTS tax_groups (
    group_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    description         TEXT,
    is_active           INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Taxes: 개별 세금 항목 (예: GST, PST, HST, VAT)
CREATE TABLE IF NOT EXISTS taxes (
    tax_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    display_name        TEXT NOT NULL, -- 화면에 표시될 이름
    rate                REAL NOT NULL, -- 예: 8.25% -> 8.25
    type                TEXT NOT NULL DEFAULT 'PERCENTAGE', -- 'PERCENTAGE' or 'FIXED'
    is_active           INTEGER DEFAULT 1,
    sort_order          INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tax Group Links: 세금과 세금 그룹 연결 (M:N)
CREATE TABLE IF NOT EXISTS tax_group_links (
    tax_group_id        INTEGER NOT NULL,
    tax_id              INTEGER NOT NULL,
    PRIMARY KEY (tax_group_id, tax_id),
    FOREIGN KEY (tax_group_id) REFERENCES tax_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_id) REFERENCES taxes(tax_id) ON DELETE CASCADE
);

-- Menu-Tax Links: 메뉴와 세금그룹 연결
CREATE TABLE IF NOT EXISTS menu_tax_links (
    link_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id             INTEGER NOT NULL,
    tax_group_id        INTEGER NOT NULL,
    is_active           INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES base_menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_group_id) REFERENCES tax_groups(group_id) ON DELETE CASCADE
);

-- 기본 세금 데이터 삽입
INSERT OR IGNORE INTO tax_groups (group_id, name, description) VALUES 
(1, 'Canadian Standard', 'Standard Canadian taxes (GST + PST)'),
(2, 'Canadian HST', 'Harmonized Sales Tax for certain provinces'),
(3, 'US Standard', 'Standard US sales tax'),
(4, 'European VAT', 'European Value Added Tax');

INSERT OR IGNORE INTO taxes (tax_id, name, display_name, rate, type, sort_order) VALUES 
(1, 'GST', 'GST', 5.0, 'PERCENTAGE', 1),
(2, 'PST', 'PST', 7.0, 'PERCENTAGE', 2),
(3, 'HST', 'HST', 13.0, 'PERCENTAGE', 1),
(4, 'PST2', 'PST2', 5.0, 'PERCENTAGE', 3),
(5, 'VAT', 'VAT', 20.0, 'PERCENTAGE', 1),
(6, 'Sales Tax', 'Sales Tax', 8.25, 'PERCENTAGE', 1);

-- 세금 그룹과 세금 연결
INSERT OR IGNORE INTO tax_group_links (tax_group_id, tax_id) VALUES 
(1, 1), -- Canadian Standard: GST
(1, 2), -- Canadian Standard: PST
(2, 3), -- Canadian HST: HST
(3, 6), -- US Standard: Sales Tax
(4, 5); -- European VAT: VAT

-- 기본 메뉴와 세금 그룹 연결 (예시)
INSERT OR IGNORE INTO menu_tax_links (menu_id, tax_group_id) VALUES 
(1, 1); -- 기본 메뉴에 Canadian Standard 세금 그룹 연결 
