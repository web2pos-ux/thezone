-- Age Size 모디파이어 그룹의 Min/Max 값 수정
-- Min = 1, Max = 1로 설정하여 Required (1개 선택)로 변경

-- 1. 현재 Age Size 모디파이어 그룹 확인
SELECT 
    group_id, 
    name, 
    selection_type, 
    min_selection, 
    max_selection 
FROM modifier_groups 
WHERE name LIKE '%Age%' OR name LIKE '%Size%';

-- 2. Age Size 모디파이어 그룹의 Min/Max 값 수정
UPDATE modifier_groups 
SET 
    min_selection = 1,
    max_selection = 1,
    selection_type = 'SINGLE'
WHERE name LIKE '%Age%' OR name LIKE '%Size%';

-- 3. 수정 후 확인
SELECT 
    group_id, 
    name, 
    selection_type, 
    min_selection, 
    max_selection 
FROM modifier_groups 
WHERE name LIKE '%Age%' OR name LIKE '%Size%';

-- 4. 모든 모디파이어 그룹의 현재 상태 확인
SELECT 
    group_id, 
    name, 
    selection_type, 
    min_selection, 
    max_selection 
FROM modifier_groups 
WHERE is_deleted = 0
ORDER BY name; 