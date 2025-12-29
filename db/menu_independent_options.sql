-- 메뉴별 독립적인 옵션 관리 시스템
-- 각 메뉴마다 고유한 옵션들을 가질 수 있음

-- 1. 메뉴별 모디파이어 그룹 테이블
CREATE TABLE IF NOT EXISTS menu_modifier_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    selection_type TEXT DEFAULT 'MULTIPLE',
    min_selection INTEGER DEFAULT 0,
    max_selection INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    UNIQUE(menu_id, group_id)
);

-- 2. 메뉴별 모디파이어 옵션 테이블
CREATE TABLE IF NOT EXISTS menu_modifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    modifier_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_delta REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES menu_modifier_groups(group_id) ON DELETE CASCADE,
    UNIQUE(menu_id, modifier_id)
);

-- 3. 메뉴별 세금 그룹 테이블
CREATE TABLE IF NOT EXISTS menu_tax_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    UNIQUE(menu_id, tax_group_id)
);

-- 4. 메뉴별 세금 항목 테이블
CREATE TABLE IF NOT EXISTS menu_taxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    tax_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    rate REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_group_id) REFERENCES menu_tax_groups(tax_group_id) ON DELETE CASCADE,
    UNIQUE(menu_id, tax_id)
);

-- 5. 메뉴별 프린터 그룹 테이블
CREATE TABLE IF NOT EXISTS menu_printer_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    UNIQUE(menu_id, printer_group_id)
);

-- 6. 메뉴별 프린터 항목 테이블
CREATE TABLE IF NOT EXISTS menu_printers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    printer_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (printer_group_id) REFERENCES menu_printer_groups(printer_group_id) ON DELETE CASCADE,
    UNIQUE(menu_id, printer_id)
);

-- 7. 메뉴 아이템과 메뉴별 옵션 연결 테이블들
CREATE TABLE IF NOT EXISTS menu_item_modifier_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    menu_modifier_group_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_modifier_group_id) REFERENCES menu_modifier_groups(group_id) ON DELETE CASCADE,
    UNIQUE(item_id, menu_modifier_group_id)
);

CREATE TABLE IF NOT EXISTS menu_item_tax_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    menu_tax_group_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_tax_group_id) REFERENCES menu_tax_groups(tax_group_id) ON DELETE CASCADE,
    UNIQUE(item_id, menu_tax_group_id)
);

CREATE TABLE IF NOT EXISTS menu_item_printer_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    menu_printer_group_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_printer_group_id) REFERENCES menu_printer_groups(printer_group_id) ON DELETE CASCADE,
    UNIQUE(item_id, menu_printer_group_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_menu_modifier_groups_menu_id ON menu_modifier_groups(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_modifiers_menu_id ON menu_modifiers(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_modifiers_group_id ON menu_modifiers(group_id);
CREATE INDEX IF NOT EXISTS idx_menu_tax_groups_menu_id ON menu_tax_groups(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_taxes_menu_id ON menu_taxes(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_taxes_group_id ON menu_taxes(tax_group_id);
CREATE INDEX IF NOT EXISTS idx_menu_printer_groups_menu_id ON menu_printer_groups(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_printers_menu_id ON menu_printers(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_printers_group_id ON menu_printers(printer_group_id);

-- 트리거: 업데이트 시간 자동 갱신
CREATE TRIGGER IF NOT EXISTS update_menu_modifier_groups_timestamp 
    AFTER UPDATE ON menu_modifier_groups
    BEGIN
        UPDATE menu_modifier_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_menu_modifiers_timestamp 
    AFTER UPDATE ON menu_modifiers
    BEGIN
        UPDATE menu_modifiers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_menu_tax_groups_timestamp 
    AFTER UPDATE ON menu_tax_groups
    BEGIN
        UPDATE menu_tax_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_menu_taxes_timestamp 
    AFTER UPDATE ON menu_taxes
    BEGIN
        UPDATE menu_taxes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_menu_printer_groups_timestamp 
    AFTER UPDATE ON menu_printer_groups
    BEGIN
        UPDATE menu_printer_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_menu_printers_timestamp 
    AFTER UPDATE ON menu_printers
    BEGIN
        UPDATE menu_printers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END; 