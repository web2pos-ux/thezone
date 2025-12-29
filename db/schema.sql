-- WEB2POS Database Schema
-- Version: 1.0

-- 외래 키 제약 조건 활성화
PRAGMA foreign_keys = ON;

-- =================================================================
-- Menu Structure Tables
-- =================================================================

-- Menus: 최상위 메뉴 그룹 (파일/버전 개념)
CREATE TABLE IF NOT EXISTS base_menus (
    menu_id             INTEGER PRIMARY KEY, -- 100000 ~ 499999
    name                TEXT NOT NULL,
    description         TEXT,
    is_active           INTEGER DEFAULT 0, -- 0: 비활성, 1: 활성
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Legacy: Derived Menus (removed from system)
CREATE TABLE IF NOT EXISTS derived_menus (
    derived_menu_id     INTEGER PRIMARY KEY, -- 500000 ~ 599999
    base_menu_id        INTEGER NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    channel_id          INTEGER,
    is_active           INTEGER DEFAULT 1,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (base_menu_id) REFERENCES base_menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE SET NULL
);

-- Legacy: Derived Menu Modifier Overrides (removed from system)
CREATE TABLE IF NOT EXISTS derived_menu_modifier_overrides (
    override_id         INTEGER PRIMARY KEY, -- 630000 ~ 639999
    derived_menu_id     INTEGER NOT NULL,
    base_item_id        INTEGER NOT NULL,
    modifier_group_id   INTEGER NOT NULL,
    is_active           INTEGER DEFAULT 1,
    sort_order          INTEGER DEFAULT 0,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (derived_menu_id, base_item_id, modifier_group_id),
    FOREIGN KEY (derived_menu_id) REFERENCES derived_menus(derived_menu_id) ON DELETE CASCADE,
    FOREIGN KEY (base_item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- Menu Categories: 메뉴 카테고리 (예: 피자, 파스타, 음료)
CREATE TABLE IF NOT EXISTS menu_categories (
    category_id         INTEGER PRIMARY KEY, -- 10000 ~ 14999
    menu_id             INTEGER NOT NULL,
    name                TEXT NOT NULL,
    sort_order          INTEGER DEFAULT 0,
    UNIQUE (menu_id, name),
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
);

-- Menu Items: 메뉴 아이템 (예: 슈퍼 디럭스 피자)
CREATE TABLE IF NOT EXISTS menu_items (
    item_id             INTEGER PRIMARY KEY, -- 15000 ~ 29999
    menu_id             INTEGER NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    price               REAL NOT NULL,
    category_id         INTEGER NOT NULL,
    sort_order          INTEGER DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
);

-- Legacy: Derived Menu Categories (removed from system)
CREATE TABLE IF NOT EXISTS derived_menu_categories (
    derived_category_id INTEGER PRIMARY KEY, -- Base ID + Suffix
    base_category_id    INTEGER NOT NULL,
    channel_id          INTEGER NOT NULL, -- 채널 구분자 (예: 1:POS, 2:Web)
    name                TEXT NOT NULL,
    is_visible          BOOLEAN DEFAULT 1,
    sort_order          INTEGER DEFAULT 0,
    FOREIGN KEY (base_category_id) REFERENCES menu_categories(category_id) ON DELETE CASCADE
);

-- Legacy: Derived Menu Items (removed from system)
CREATE TABLE IF NOT EXISTS derived_menu_items (
    derived_item_id     INTEGER PRIMARY KEY, -- Base ID + Suffix
    base_item_id        INTEGER NOT NULL,
    derived_category_id INTEGER NOT NULL,
    channel_id          INTEGER NOT NULL,
    name                TEXT NOT NULL,
    price               REAL NOT NULL,
    is_visible          BOOLEAN DEFAULT 1,
    sort_order          INTEGER DEFAULT 0,
    FOREIGN KEY (base_item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (derived_category_id) REFERENCES derived_menu_categories(derived_category_id) ON DELETE CASCADE
);

-- =================================================================
-- Modifier Tables
-- =================================================================

-- Modifier Groups: 모디파이어 그룹 (예: 사이즈 선택, 토핑 추가)
CREATE TABLE IF NOT EXISTS modifier_groups (
    group_id            INTEGER PRIMARY KEY, -- 2000 ~ 2999
    name                TEXT NOT NULL,
    selection_type      TEXT NOT NULL, -- 'SINGLE' or 'MULTIPLE'
    min_selection       INTEGER DEFAULT 0,
    max_selection       INTEGER DEFAULT 1,
    menu_id             INTEGER, -- 메뉴별 필터링을 위한 필드
    is_deleted          INTEGER DEFAULT 0, -- Soft delete flag
    FOREIGN KEY (menu_id) REFERENCES base_menus(menu_id) ON DELETE CASCADE
);

-- Modifiers: 개별 모디파이어 (예: L 사이즈, 페퍼로니, 치즈)
CREATE TABLE IF NOT EXISTS modifiers (
    modifier_id         INTEGER PRIMARY KEY, -- 1000 ~ 1999
    name                TEXT NOT NULL,
    price_delta         REAL DEFAULT 0, -- 가격 변동량
    type                TEXT NOT NULL, -- 'SIZE', 'TOPPING', 'OPTION'
    is_deleted          INTEGER DEFAULT 0, -- Soft delete flag
    sort_order          INTEGER DEFAULT 0
);

-- Modifier Group Links: 모디파이어와 모디파이어 그룹 연결 (M:N)
CREATE TABLE IF NOT EXISTS modifier_group_links (
    modifier_group_id   INTEGER NOT NULL,
    modifier_id         INTEGER NOT NULL,
    PRIMARY KEY (modifier_group_id, modifier_id),
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_id) REFERENCES modifiers(modifier_id) ON DELETE CASCADE
);

-- Menu-Modifier Links: 메뉴와 모디파이어 그룹 연결 (M:N) - 표준화
CREATE TABLE IF NOT EXISTS menu_modifier_links (
    link_id             INTEGER PRIMARY KEY, -- 3000 ~ 3999
    item_id             INTEGER NOT NULL, -- item_id로 통일
    modifier_group_id   INTEGER NOT NULL,
    is_ambiguous        INTEGER DEFAULT 0, -- 0: 명확한 연결, 1: 중복 이름으로 인한 모호한 연결
    UNIQUE (item_id, modifier_group_id),
    FOREIGN KEY (item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- =================================================================
-- Tax Tables
-- =================================================================

-- Tax Groups: 여러 세금을 묶는 그룹 (예: California Tax)
CREATE TABLE IF NOT EXISTS tax_groups (
    group_id            INTEGER PRIMARY KEY, -- 4600 ~ 4699
    name                TEXT NOT NULL,
    menu_id             INTEGER, -- 메뉴별 필터링을 위한 필드
    is_deleted          INTEGER DEFAULT 0, -- Soft delete flag
    FOREIGN KEY (menu_id) REFERENCES base_menus(menu_id) ON DELETE CASCADE
);

-- Taxes: 개별 세금 항목 (예: Sales Tax, VAT)
CREATE TABLE IF NOT EXISTS taxes (
    tax_id              INTEGER PRIMARY KEY, -- 4500 ~ 4599
    name                TEXT NOT NULL,
    rate                REAL NOT NULL, -- 예: 8.25% -> 8.25
    type                TEXT NOT NULL, -- 'PERCENTAGE' or 'FIXED'
    is_deleted          INTEGER DEFAULT 0 -- Soft delete flag
);

-- Tax Group Links: 세금과 세금 그룹 연결 (M:N)
CREATE TABLE IF NOT EXISTS tax_group_links (
    tax_group_id        INTEGER NOT NULL,
    tax_id              INTEGER NOT NULL,
    PRIMARY KEY (tax_group_id, tax_id),
    FOREIGN KEY (tax_group_id) REFERENCES tax_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_id) REFERENCES taxes(tax_id) ON DELETE CASCADE
);


-- Menu-Tax Links: 메뉴와 세금그룹 연결 (표준화)
CREATE TABLE IF NOT EXISTS menu_tax_links (
    link_id             INTEGER PRIMARY KEY, -- 4700 ~ 4799
    item_id             INTEGER NOT NULL, -- item_id로 통일
    tax_group_id        INTEGER NOT NULL, -- tax_id 제거, tax_group_id만 사용
    is_ambiguous        INTEGER DEFAULT 0, -- 0: 명확한 연결, 1: 중복 이름으로 인한 모호한 연결
    UNIQUE (item_id, tax_group_id),
    FOREIGN KEY (item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_group_id) REFERENCES tax_groups(group_id) ON DELETE CASCADE
);

-- =================================================================
-- Printer Tables
-- =================================================================

-- Printers: 개별 프린터
CREATE TABLE IF NOT EXISTS printers (
    printer_id          INTEGER PRIMARY KEY, -- 4800 ~ 4899
    name                TEXT NOT NULL,
    type                TEXT NOT NULL, -- 'RECEIPT', 'KITCHEN'
    ip_address          TEXT UNIQUE,
    is_deleted          INTEGER DEFAULT 0 -- Soft delete flag
);

-- Printer Groups: 프린터 그룹 (예: 주방 프린터 그룹)
CREATE TABLE IF NOT EXISTS printer_groups (
    group_id            INTEGER PRIMARY KEY, -- 4900 ~ 4999
    name                TEXT NOT NULL,
    menu_id             INTEGER, -- 메뉴별 필터링을 위한 필드
    is_deleted          INTEGER DEFAULT 0, -- Soft delete flag
    FOREIGN KEY (menu_id) REFERENCES base_menus(menu_id) ON DELETE CASCADE
);

-- Printer Group Links: 프린터와 프린터 그룹 연결 (M:N)
CREATE TABLE IF NOT EXISTS printer_group_links (
    printer_group_id    INTEGER NOT NULL,
    printer_id          INTEGER NOT NULL,
    PRIMARY KEY (printer_group_id, printer_id),
    FOREIGN KEY (printer_group_id) REFERENCES printer_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (printer_id) REFERENCES printers(printer_id) ON DELETE CASCADE
);

-- Menu-Printer Links: 메뉴와 프린터그룹 연결 (표준화)
CREATE TABLE IF NOT EXISTS menu_printer_links (
    link_id             INTEGER PRIMARY KEY, -- 5000 ~ 5099
    item_id             INTEGER NOT NULL, -- item_id로 통일
    printer_group_id    INTEGER NOT NULL,
    is_ambiguous        INTEGER DEFAULT 0, -- 0: 명확한 연결, 1: 중복 이름으로 인한 모호한 연결
    UNIQUE (item_id, printer_group_id),
    FOREIGN KEY (item_id) REFERENCES menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (printer_group_id) REFERENCES printer_groups(group_id) ON DELETE CASCADE
);

-- =================================================================
-- System & User Tables
-- =================================================================

-- Channels: 판매 채널 (POS, Togo, Web, etc.)
CREATE TABLE IF NOT EXISTS channels (
    channel_id          INTEGER PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE
);

-- Employees: 직원 계정
CREATE TABLE IF NOT EXISTS employees (
    employee_id         INTEGER PRIMARY KEY, -- 5200 ~ 8999
    name                TEXT NOT NULL,
    pin_hash            TEXT NOT NULL, -- 항상 해시된 비밀번호 저장
    role                TEXT NOT NULL, -- 'Admin', 'Manager', 'Staff'
    channel_id          INTEGER,
    FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE SET NULL
);

-- Table Map Elements: 테이블 배치 정보
CREATE TABLE IF NOT EXISTS table_map_elements (
    element_id          INTEGER PRIMARY KEY, -- 5100 ~ 5199
    name                TEXT NOT NULL,
    type                TEXT NOT NULL, -- 'TABLE', 'BOOTH', 'BAR_SEAT'
    x_pos               INTEGER,
    y_pos               INTEGER,
    width               INTEGER,
    height              INTEGER
);

-- Table Devices: 테이블에 부착된 주문용 기기
CREATE TABLE IF NOT EXISTS table_devices (
    device_id           INTEGER PRIMARY KEY, -- 9000 ~ 9499
    name                TEXT NOT NULL,
    device_token        TEXT UNIQUE,
    assigned_table_id   INTEGER,
    FOREIGN KEY (assigned_table_id) REFERENCES table_map_elements(element_id) ON DELETE SET NULL
); 

-- =================================================================
-- Category-Option Link Tables (표준화)
-- =================================================================

-- 카테고리-모디파이어 그룹 연결 (M:N) - 이미 표준
CREATE TABLE IF NOT EXISTS category_modifier_links (
    link_id             INTEGER PRIMARY KEY, -- 6000 ~ 6099
    category_id         INTEGER NOT NULL,
    modifier_group_id   INTEGER NOT NULL,
    is_ambiguous        INTEGER DEFAULT 0, -- 0: 명확한 연결, 1: 중복 이름으로 인한 모호한 연결
    UNIQUE (category_id, modifier_group_id),
    FOREIGN KEY (category_id) REFERENCES base_menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- 카테고리-세금그룹 연결 (M:N) - 표준화
CREATE TABLE IF NOT EXISTS category_tax_links (
    link_id             INTEGER PRIMARY KEY, -- 6100 ~ 6199
    category_id         INTEGER NOT NULL,
    tax_group_id        INTEGER NOT NULL, -- tax_id 제거, tax_group_id만 사용
    is_ambiguous        INTEGER DEFAULT 0, -- 0: 명확한 연결, 1: 중복 이름으로 인한 모호한 연결
    UNIQUE (category_id, tax_group_id),
    FOREIGN KEY (category_id) REFERENCES base_menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_group_id) REFERENCES tax_groups(group_id) ON DELETE CASCADE
);

-- 카테고리-프린터 그룹 연결 (M:N) - 이미 표준
CREATE TABLE IF NOT EXISTS category_printer_links (
    link_id             INTEGER PRIMARY KEY, -- 6200 ~ 6299
    category_id         INTEGER NOT NULL,
    printer_group_id    INTEGER NOT NULL,
    is_ambiguous        INTEGER DEFAULT 0, -- 0: 명확한 연결, 1: 중복 이름으로 인한 모호한 연결
    UNIQUE (category_id, printer_group_id),
    FOREIGN KEY (category_id) REFERENCES base_menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (printer_group_id) REFERENCES printer_groups(group_id) ON DELETE CASCADE
); 