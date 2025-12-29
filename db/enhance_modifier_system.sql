-- 옵션과 메뉴 카테고리, 메뉴 아이템 연결을 위한 향상된 시스템
-- Version: 2.0

-- 1. 기존 modifier_groups 테이블에 카테고리 연결 필드 추가
ALTER TABLE modifier_groups ADD COLUMN target_level TEXT DEFAULT 'ITEM';
ALTER TABLE modifier_groups ADD COLUMN category_id INTEGER;
ALTER TABLE modifier_groups ADD COLUMN is_global BOOLEAN DEFAULT FALSE;
ALTER TABLE modifier_groups ADD COLUMN description TEXT;

-- 2. 카테고리별 옵션 연결 테이블
CREATE TABLE IF NOT EXISTS category_modifier_links (
    link_id INTEGER PRIMARY KEY, -- 4000 ~ 4099
    category_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    is_required BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (category_id, modifier_group_id),
    FOREIGN KEY (category_id) REFERENCES base_menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- 3. 옵션 상속 규칙 테이블
CREATE TABLE IF NOT EXISTS modifier_inheritance_rules (
    rule_id INTEGER PRIMARY KEY, -- 4100 ~ 4199
    category_id INTEGER,
    modifier_group_id INTEGER NOT NULL,
    inheritance_type TEXT NOT NULL CHECK (inheritance_type IN ('INHERIT', 'OVERRIDE', 'EXCLUDE')),
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES base_menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- 4. 옵션 템플릿 테이블 (재사용 가능한 옵션 조합)
CREATE TABLE IF NOT EXISTS modifier_templates (
    template_id INTEGER PRIMARY KEY, -- 4200 ~ 4299
    name TEXT NOT NULL,
    description TEXT,
    category_id INTEGER,
    is_global BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES base_menu_categories(category_id) ON DELETE SET NULL
);

-- 5. 템플릿과 옵션 그룹 연결
CREATE TABLE IF NOT EXISTS template_modifier_links (
    link_id INTEGER PRIMARY KEY, -- 4300 ~ 4399
    template_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    UNIQUE (template_id, modifier_group_id),
    FOREIGN KEY (template_id) REFERENCES modifier_templates(template_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- 6. 메뉴 아이템별 옵션 오버라이드 테이블 (기존 테이블과 통합)
CREATE TABLE IF NOT EXISTS item_modifier_overrides (
    override_id INTEGER PRIMARY KEY, -- 4400 ~ 4499
    item_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('ENABLE', 'DISABLE', 'MODIFY')),
    modified_options TEXT, -- JSON 형태로 수정된 옵션들 저장
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (item_id, modifier_group_id),
    FOREIGN KEY (item_id) REFERENCES base_menu_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(group_id) ON DELETE CASCADE
);

-- 인덱스 생성
CREATE INDEX idx_category_modifier_links_category ON category_modifier_links(category_id);
CREATE INDEX idx_category_modifier_links_modifier ON category_modifier_links(modifier_group_id);
CREATE INDEX idx_modifier_inheritance_rules_category ON modifier_inheritance_rules(category_id);
CREATE INDEX idx_modifier_templates_category ON modifier_templates(category_id);
CREATE INDEX idx_item_modifier_overrides_item ON item_modifier_overrides(item_id);

-- 뷰 생성: 카테고리별 사용 가능한 옵션들
CREATE VIEW category_available_modifiers AS
SELECT 
    c.category_id,
    c.name as category_name,
    mg.group_id,
    mg.name as modifier_group_name,
    mg.selection_type,
    mg.min_selection,
    mg.max_selection,
    cml.is_required,
    cml.sort_order,
    'DIRECT' as source_type
FROM base_menu_categories c
JOIN category_modifier_links cml ON c.category_id = cml.category_id
JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
WHERE cml.is_active = TRUE

UNION

SELECT 
    c.category_id,
    c.name as category_name,
    mg.group_id,
    mg.name as modifier_group_name,
    mg.selection_type,
    mg.min_selection,
    mg.max_selection,
    FALSE as is_required,
    999 as sort_order,
    'GLOBAL' as source_type
FROM base_menu_categories c
CROSS JOIN modifier_groups mg
WHERE mg.is_global = TRUE;

-- 뷰 생성: 아이템별 최종 옵션들 (상속 규칙 적용)
CREATE VIEW item_final_modifiers AS
SELECT 
    bmi.item_id,
    bmi.name as item_name,
    bmc.category_id,
    bmc.name as category_name,
    mg.group_id,
    mg.name as modifier_group_name,
    mg.selection_type,
    mg.min_selection,
    mg.max_selection,
    COALESCE(imo.action, 'INHERIT') as final_action,
    CASE 
        WHEN imo.action = 'DISABLE' THEN FALSE
        WHEN imo.action = 'ENABLE' THEN TRUE
        ELSE cml.is_required
    END as is_required,
    COALESCE(imo.modified_options, '[]') as modified_options
FROM base_menu_items bmi
JOIN base_menu_categories bmc ON bmi.category_id = bmc.category_id
LEFT JOIN category_modifier_links cml ON bmc.category_id = cml.category_id
LEFT JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
LEFT JOIN item_modifier_overrides imo ON bmi.item_id = imo.item_id AND mg.group_id = imo.modifier_group_id
WHERE (cml.is_active = TRUE OR mg.is_global = TRUE)
  AND (imo.is_active = TRUE OR imo.is_active IS NULL); 