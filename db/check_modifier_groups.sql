-- 최근 생성된 모디파이어 그룹 확인
-- Min/Max 값이 제대로 저장되었는지 확인

-- 1. 모든 모디파이어 그룹 확인
SELECT 
    group_id, 
    name, 
    selection_type, 
    min_selection, 
    max_selection,
    is_deleted,
    datetime('now', 'localtime') as current_time
FROM modifier_groups 
WHERE is_deleted = 0
ORDER BY group_id DESC
LIMIT 10;

-- 2. 특정 이름의 모디파이어 그룹 확인 (1111)
SELECT 
    group_id, 
    name, 
    selection_type, 
    min_selection, 
    max_selection,
    is_deleted
FROM modifier_groups 
WHERE name LIKE '%1111%' OR name LIKE '%111%'
ORDER BY group_id DESC;

-- 3. 최근 생성된 그룹의 상세 정보
SELECT 
    mg.group_id, 
    mg.name, 
    mg.selection_type, 
    mg.min_selection, 
    mg.max_selection,
    mg.menu_id,
    mg.is_deleted,
    COUNT(mgl.modifier_id) as modifier_count
FROM modifier_groups mg
LEFT JOIN modifier_group_links mgl ON mg.group_id = mgl.modifier_group_id
WHERE mg.is_deleted = 0
GROUP BY mg.group_id
ORDER BY mg.group_id DESC
LIMIT 5; 