# WEB2POS ID 시스템 마이그레이션 - 단계별 안전 작업 가이드

## 📋 전체 작업 개요

새로운 ID 범위로 변경하면서 **데이터베이스, 백엔드, 프론트엔드, 통신** 전체를 안전하게 업데이트하는 작업입니다.

### 변경 범위
- 🗄️ **데이터베이스**: 기존 데이터 ID 변경 + 스키마 확인
- 🔧 **백엔드**: ID 생성 로직 + API 응답 + 라우터
- 🎨 **프론트엔드**: 타입 정의 + 컴포넌트 + API 호출
- 📡 **통신**: API 요청/응답 데이터 구조

---

## ⚠️ 사전 준비 (필수)

### 1. 전체 시스템 중지
```bash
# 1. 프론트엔드 중지 (Ctrl+C)
# 2. 백엔드 중지 (Ctrl+C) 
# 3. 모든 개발 도구 종료
```

### 2. 백업 생성
```bash
# 프로젝트 전체 백업
cd /c/Users/Luckyhan
cp -r web2pos web2pos_backup_$(date +%Y%m%d_%H%M%S)

# 데이터베이스만 별도 백업
cd web2pos
cp db/web2pos.db db/web2pos_backup_$(date +%Y%m%d_%H%M%S).db
```

---

## 📊 1단계: 현재 상태 확인

### 현재 데이터 현황 체크
```bash
cd /c/Users/Luckyhan/web2pos

# 현재 ID 범위 확인
sqlite3 db/web2pos.db "
SELECT 
    'Categories' as type,
    MIN(category_id) as min_id, 
    MAX(category_id) as max_id,
    COUNT(*) as count
FROM base_menu_categories
UNION ALL
SELECT 
    'Items',
    MIN(item_id), 
    MAX(item_id),
    COUNT(*)
FROM base_menu_items
UNION ALL  
SELECT 
    'Menus',
    MIN(menu_id), 
    MAX(menu_id),
    COUNT(*)
FROM base_menus;
"
```

**예상 결과 기록:**
```
Categories|10000|10008|7  ← 기록하세요
Items|15000|15009|10      ← 기록하세요  
Menus|100001|100003|3     ← 기록하세요
```

---

## 🗄️ 2단계: 데이터베이스 마이그레이션

### A. 마이그레이션 스크립트 실행
```bash
# 마이그레이션 실행
sqlite3 db/web2pos.db < db/migrate_to_new_id_ranges.sql
```

### B. 마이그레이션 결과 확인
```bash
# 새로운 ID 범위 확인
sqlite3 db/web2pos.db "
SELECT 
    'Categories' as type,
    MIN(category_id) as min_id, 
    MAX(category_id) as max_id,
    COUNT(*) as count,
    CASE 
        WHEN MIN(category_id) >= 1000000 AND MAX(category_id) <= 1999999 THEN 'OK'
        ELSE 'ERROR'
    END as status
FROM base_menu_categories
UNION ALL
SELECT 
    'Items',
    MIN(item_id), 
    MAX(item_id),
    COUNT(*),
    CASE 
        WHEN MIN(item_id) >= 2000000 AND MAX(item_id) <= 2999999 THEN 'OK'
        ELSE 'ERROR'  
    END
FROM base_menu_items
UNION ALL  
SELECT 
    'Menus',
    MIN(menu_id), 
    MAX(menu_id),
    COUNT(*),
    CASE 
        WHEN MIN(menu_id) >= 8000000 AND MAX(menu_id) <= 9999999 THEN 'OK'
        ELSE 'ERROR'
    END
FROM base_menus;
"
```

**✅ 성공 조건:** 모든 status가 'OK'

### C. 외래키 무결성 확인
```bash
# 외래키 제약 조건 확인
sqlite3 db/web2pos.db "PRAGMA foreign_key_check;"
```

**✅ 성공 조건:** 출력이 없어야 함 (오류 없음)

---

## 🔧 3단계: 백엔드 시스템 확인

### A. ID 생성 함수 테스트
```bash
cd backend

# 새로운 ID 생성 테스트
node -e "
const idGen = require('./utils/idGenerator');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../db/web2pos.db');

console.log('=== ID 생성 테스트 ===');

Promise.all([
    idGen.generateMenuCategoryId(db),
idGen.generateMenuItemId(db),
idGen.generateMenuId(db),
    idGen.generateModifierMenuLinkId(db)
]).then(([catId, itemId, menuId, linkId]) => {
    console.log('Category ID:', catId, (catId >= 1000000 && catId <= 1999999) ? '✅ OK' : '❌ ERROR');
    console.log('Item ID:', itemId, (itemId >= 2000000 && itemId <= 2999999) ? '✅ OK' : '❌ ERROR');
    console.log('Menu ID:', menuId, (menuId >= 8000000 && menuId <= 9999999) ? '✅ OK' : '❌ ERROR');
    console.log('Link ID:', linkId, (linkId >= 3700000 && linkId <= 3999999) ? '✅ OK' : '❌ ERROR');
    db.close();
}).catch(err => {
    console.error('❌ ERROR:', err.message);
    db.close();
    process.exit(1);
});
"
```

**✅ 성공 조건:** 모든 ID가 ✅ OK

### B. 백엔드 서버 시작 테스트
```bash
# 백엔드 서버 시작
npm start
```

**✅ 성공 조건:** 
```
Server running on port 3001
Database connected successfully
```

**⚠️ 서버를 계속 실행 상태로 둡니다**

---

## 📡 4단계: API 통신 테스트

### A. 새 터미널에서 API 테스트
```bash
# 새 터미널 열기 (백엔드는 계속 실행)
cd /c/Users/Luckyhan/web2pos

# 메뉴 목록 조회 테스트
curl -X GET http://localhost:3001/api/base-menus
```

**✅ 성공 조건:** JSON 응답에서 menu_id가 8000000번대

### B. 카테고리 조회 테스트  
```bash
# 첫 번째 메뉴의 카테고리 조회 (menu_id는 위에서 확인한 값 사용)
curl -X GET "http://localhost:3001/api/menu/categories?menu_id=8000001"
```

**✅ 성공 조건:** JSON 응답에서 category_id가 1000000번대

### C. 아이템 조회 테스트
```bash
# 첫 번째 카테고리의 아이템 조회 (category_id는 위에서 확인한 값 사용)
curl -X GET "http://localhost:3001/api/menu/items?categoryId=1000000"
```

**✅ 성공 조건:** JSON 응답에서 item_id가 2000000번대

---

## 🎨 5단계: 프론트엔드 확인

### A. 프론트엔드 서버 시작
```bash
# 새 터미널에서 프론트엔드 시작
cd /c/Users/Luckyhan/web2pos/frontend
npm start
```

**✅ 성공 조건:** 
```
webpack compiled successfully
Local: http://localhost:3000
```

### B. 브라우저에서 기능 테스트

1. **메뉴 목록 페이지** (`http://localhost:3000/menu`)
   - ✅ 메뉴 카드들이 정상 표시
   - ✅ 메뉴 이름과 설명이 올바르게 표시

2. **메뉴 편집 페이지** (`http://localhost:3000/menu/edit/8000001`)
   - ✅ 카테고리 목록 로드
   - ✅ 각 카테고리 클릭 시 아이템 목록 로드
   - ✅ 아이템 상세 정보 표시

---

## 🧪 6단계: CRUD 기능 테스트

### A. 카테고리 생성 테스트
브라우저에서:
1. 메뉴 편집 페이지 접속
2. "Create New Category" 클릭
3. 카테고리 이름 입력 후 생성
4. **네트워크 탭에서 응답 확인**: category_id가 1000000번대

### B. 아이템 생성 테스트
브라우저에서:
1. 새로 만든 카테고리 선택
2. "Create New Item" 클릭  
3. 아이템 정보 입력 후 생성
4. **네트워크 탭에서 응답 확인**: item_id가 2000000번대

### C. 메뉴 복사 테스트
브라우저에서:
1. 메뉴 목록 페이지로 이동
2. 메뉴 카드에서 "Copy" 버튼 클릭
3. 복사 성공 메시지 확인
4. **새로운 메뉴 확인**: menu_id가 8000000번대

---

## 🔍 7단계: 최종 검증

### A. 데이터 일관성 확인
```bash
# 모든 ID가 새 범위에 있는지 확인
sqlite3 db/web2pos.db "
SELECT 'Old Range Data Found' as issue, COUNT(*) as count
FROM (
    SELECT category_id FROM base_menu_categories WHERE category_id < 1000000
    UNION ALL
    SELECT item_id FROM base_menu_items WHERE item_id < 2000000  
    UNION ALL
    SELECT menu_id FROM base_menus WHERE menu_id < 8000000
);
"
```

**✅ 성공 조건:** count가 0

### B. 관계 무결성 확인
```bash
# 모든 외래키 관계가 올바른지 확인
sqlite3 db/web2pos.db "
SELECT 
    'Categories with invalid menu_id' as issue,
    COUNT(*) as count
FROM base_menu_categories c
LEFT JOIN base_menus m ON c.menu_id = m.menu_id
WHERE m.menu_id IS NULL

UNION ALL

SELECT 
    'Items with invalid category_id',
    COUNT(*)
FROM base_menu_items i  
LEFT JOIN base_menu_categories c ON i.category_id = c.category_id
WHERE c.category_id IS NULL;
"
```

**✅ 성공 조건:** 모든 count가 0

---

## ✅ 완료 체크리스트

### 데이터베이스
- [ ] 기존 데이터 백업 완료
- [ ] 마이그레이션 스크립트 실행 성공  
- [ ] 모든 ID가 새 범위로 변경됨
- [ ] 외래키 무결성 확인 완료

### 백엔드
- [ ] ID 생성 함수 정상 작동
- [ ] 서버 시작 성공
- [ ] API 응답에서 새 ID 확인

### 프론트엔드  
- [ ] 메뉴 목록 페이지 정상 표시
- [ ] 메뉴 편집 페이지 정상 작동
- [ ] 카테고리/아이템 로드 성공

### 통신
- [ ] API 요청/응답 정상
- [ ] 새 ID로 CRUD 작업 성공
- [ ] 메뉴 복사 기능 정상

### 전체 기능
- [ ] 카테고리 생성/편집/삭제 테스트
- [ ] 아이템 생성/편집/삭제 테스트  
- [ ] 메뉴 복사 기능 테스트
- [ ] 데이터 일관성 최종 확인

---

## 🆘 문제 발생 시 복원 절차

### 긴급 복원
```bash
# 1. 모든 서버 중지 (Ctrl+C)

# 2. 데이터베이스 복원
cd /c/Users/Luckyhan/web2pos
cp db/web2pos_backup_*.db db/web2pos.db

# 3. 이전 코드로 복원 (필요시)
cd ..
rm -rf web2pos
cp -r web2pos_backup_* web2pos
cd web2pos

# 4. 서버 재시작
cd backend && npm start
# 새 터미널에서: cd frontend && npm start
```

### 부분 문제 해결
- **API 오류**: 백엔드 로그 확인 후 관련 라우터 점검
- **프론트엔드 오류**: 브라우저 콘솔 및 네트워크 탭 확인  
- **데이터 불일치**: 데이터베이스 쿼리로 문제 데이터 식별

---

## 🎉 마이그레이션 완료!

모든 체크리스트가 완료되면:

### ✅ 달성한 것
- **ID 용량 대폭 증가**: 각 항목당 100만~200만 개 ID 확보
- **체계적 ID 구조**: ID만 봐도 데이터 타입 식별 가능
- **미래 확장성**: 수십 년간 ID 부족 걱정 없음
- **안정적 시스템**: 모든 기능이 새 ID 체계로 정상 작동

이제 안심하고 메뉴 복사, 대량 데이터 생성 등의 기능을 사용할 수 있습니다! 