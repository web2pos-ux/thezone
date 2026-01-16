# 🍽️ WEB2POS - Restaurant POS System

**WEB2POS**는 다채널 주문, 메뉴 편집, 프린터, 모디파이어, 세금 설정, 그리고 Firebase 연동을 통해 온라인 주문까지 통합적으로 처리할 수 있는 레스토랑 POS 시스템입니다.

---

## 📦 프로젝트 기술 스택

| 구성 요소 | 기술 |
|---|---|
| **프론트엔드** | React + TailwindCSS |
| **백엔드** | Node.js + Express |
| **DB** | SQLite (로컬 파일 기반) |
| **데이터 통신**| REST API (Express) 및 Socket.io (선택적으로 실시간 처리) |
| **클라우드 연동**| Firebase, Google Drive, TryOtter |

---

## ⚙️ 환경 변수 (.env 설정)

```env
# Backend 서버 포트
PORT=3177

# 프론트엔드 주소
CORS_ORIGIN=http://localhost:3088

# SQLite DB 경로 (tzp.db만 사용)
DB_PATH=db/tzp.db
```

## 🧩 ID 생성 규칙 (idGenerator.js 기반)
ID는 고유한 숫자 범위로 구분되며, `idGenerator.js` 파일에서 생성 규칙을 따릅니다:

| 항목 | ID 범위/규칙 |
|---|---|
| Menu Category ID | 10000 ~ 14999 |
| Menu Item ID | 15000 ~ 29999 |
| Legacy: Derived Menu Category ID | (removed) |
| Legacy: Derived Menu Item ID | (removed) |
| Modifier ID | 1000 ~ 1999 |
| Modifier Group ID | 2000 ~ 2999 |
| Modifier와 메뉴 연결 ID | 3000 ~ 3999 |
| Modifier Channel ID | 4000 ~ 4299 |
| Modifier Type ID | 4300 ~ 4499 |
| Individual Tax ID | 4500 ~ 4599 |
| Tax Group ID | 4600 ~ 4699 |
| Tax와 메뉴 연결 ID | 4700 ~ 4799 |
| Printer ID | 4800 ~ 4899 |
| Printer Group ID | 4900 ~ 4999 |
| Printer와 메뉴 연결 ID | 5000 ~ 5099 |
| Table Map 요소 ID | 5100 ~ 5199 |
| 직원(계정) ID | 5200 ~ 8999 |
| 테이블 디바이스 ID | 9000 ~ 9499 |

## 🛒 Channel 종류
메뉴/카테고리는 아래 채널 별로 관리됩니다:

- **POS** (매장)
- **Togo** (포장)
- **온라인 주문** (Web)
- **딜리버리** (배달앱)
- **테이블 디바이스 주문**
- **QR 코드 주문**
- **키오스크**
- **소셜 오더** (예: 인스타그램 등)

## 🖱️ 주요 기능
- Menu 관리
- 모디파이어, 세금, 프린터는 메뉴에 드래그 앤 드롭으로 연결
- 메뉴 및 카테고리 순서도 드래그 앤 드롭 정렬
- 온라인에서 메뉴 수정 및 보고서 조회
- Firebase 연동으로 QR Order, Online Order, Otter 연동 지원
- 모든 주문은 MenuID를 공유해 프린터와 레포트 통합 관리

## 🗺️ 테이블맵 관리 기능

### 📋 테이블 요소 기본 속성
- **ID**: 고유 식별자
- **Type**: 요소 타입 (rounded-rectangle, circle, entrance, counter, restroom, divider, wall, cook-area, other)
- **Position**: X, Y 좌표 위치
- **Size**: 너비, 높이
- **Rotation**: 회전 각도 (도 단위)
- **Text**: 텍스트 내용
- **FontSize**: 폰트 크기 (px)

### 🎯 드래그 & 이동 기능
- **드래그 이동**: 마우스로 요소를 캔버스 내에서 자유롭게 이동
- **그리드 스냅**: 20픽셀 단위로 위치 그룹화
- **경계 제한**: 캔버스 경계를 벗어나지 않도록 제한
- **실시간 업데이트**: 드래그 중 실시간 위치 표시

### ✏️ 선택 & 편집 기능
- **클릭 선택**: 요소 클릭으로 선택 상태 활성화
- **선택 표시**: 선택된 요소는 파란색 테두리와 그림자로 표시
- **더블클릭 편집**: 더블클릭으로 텍스트 편집 모드 활성화
- **우클릭 편집**: 우클릭으로도 텍스트 편집 모드 활성화

### 📝 텍스트 편집 기능
- **실시간 편집**: 텍스트 입력 필드로 직접 편집
- **폰트 크기 조절**: 키보드 방향키로 폰트 크기 증가/감소
- **자동 크기 조절**: 마우스 휠로 폰트 크기 자동 조절
- **편집 완료**: Enter 키 또는 포커스 아웃으로 저장
- **편집 취소**: Escape 키로 편집 취소

### 🔄 리사이즈 기능
- **모서리 핸들**: 4개 모서리에 리사이즈 핸들 표시
- **비율 유지**: Shift 키와 함께 드래그하면 비율 유지
- **최소/최대 크기**: 요소 타입별 최소/최대 크기 제한
- **실시간 크기 조절**: 드래그 중 실시간 크기 변경

### 🔄 회전 기능
- **회전 핸들**: 요소 상단에 회전 핸들 표시
- **자유 회전**: 360도 자유 회전
- **각도 표시**: 회전 각도를 도 단위로 표시
- **실시간 회전**: 드래그 중 실시간 회전

### 🗑️ 삭제 기능
- **Delete 키**: 선택된 요소를 Delete 키로 삭제
- **Backspace 키**: 선택된 요소를 Backspace 키로 삭제
- **삭제 확인**: 삭제 전 확인 메시지 표시

### 📚 히스토리 관리
- **Undo/Redo**: 작업 히스토리 관리
- **자동 저장**: 모든 변경사항을 localStorage에 자동 저장
- **타임스탬프**: 각 히스토리 항목에 타임스탬프 기록

### 🏢 플로어 관리
- **다중 플로어**: 1F, 2F, 3F, Patio 플로어 지원
- **플로어별 저장**: 각 플로어별로 요소들을 독립적으로 저장
- **플로어 전환**: 플로어 변경 시 해당 플로어의 요소들 로드

### 📐 화면 크기 관리
- **화면 크기 설정**: 사용자 정의 화면 크기 설정
- **비율 유지**: 원본 비율 유지하면서 크기 조절
- **자동 저장**: 설정된 화면 크기를 localStorage에 저장

### 🎨 요소 타입별 특성
- **이미지 요소**: Restroom, Counter는 이미지로 표시
- **색상 구분**: 타입별로 다른 배경색 적용
- **크기 설정**: 타입별로 기본 크기 자동 설정
- **편집 가능성**: 일부 타입만 텍스트 편집 가능

### 🐛 디버깅 기능
- **좌표 로깅**: 모든 요소의 좌표를 콘솔에 출력
- **변경 추적**: 모든 변경사항을 콘솔에 기록
- **상태 표시**: 현재 선택된 요소와 편집 상태 표시

## 🛠️ 개발 및 실행 방법
### 1. 백엔드 실행
```bash
cd backend
npm install
npm run dev
```
### 2. 프론트엔드 실행

#### 🚀 **Production 모드 (권장 - 5-10배 빠름)**
```bash
cd frontend
npm install
start-prod.bat
```

#### 개발 모드 (느림)
```bash
cd frontend
npm install
npm start
```

> **⚡ 성능 팁:** 
> - **Development 서버**는 디버깅용으로 매우 느립니다
> - **Production 빌드**는 최적화되어 다른 POS처럼 즉시 반응합니다
> - 실제 사용 시에는 항상 **start-prod.bat** 사용을 권장합니다
> - Production에서 코드 변경 시: `Ctrl+C` → 다시 `start-prod.bat` 실행

## 🗂️ 기타 정보
- **메인 POS**: Windows 10/11
- **서브 POS**: Android Tablet / iPad / Windows Tablet 지원 예정
- DB 파일은 SQLite로 로컬 저장되며, Google Drive 백업 지원 예정

## 🔒 보호 파일 안내
- `tools/protect-split-files.js` 스크립트가 Split Order 핵심 파일과 가상 키보드 모듈을 동시에 보호합니다.
- `frontend/src/components/order/VirtualKeyboard.tsx`를 수정하려면 커밋 전에 **`ALLOW_VKEY_EDITS=1`** 환경 변수를 명시적으로 설정해야 합니다.
- 보호 해제는 일시적으로만 사용하고, 변경은 별도 브랜치/PR 리뷰를 거치는 것을 권장합니다.

## 📁 관련 파일
- `idGenerator.js`: 모든 ID 생성 로직 정의
- `.env`: 환경 변수 파일
- `tzp.db`: SQLite 데이터베이스 파일

## 🗄️ 데이터베이스 사용 규칙
- **데이터베이스 파일**: `tzp.db`만 사용합니다.
- **경로**: `db/tzp.db` (상대 경로)
- **다른 .db 파일**: 무시하거나 삭제하세요.
- **백업**: 필요시 `tzp.db` 파일만 백업하세요.

## 🔥 Firebase ID 처리 규칙 (중요!)

### ⚠️ 절대 parseInt()로 Firebase 문서 ID를 변환하지 마세요!

Firebase 문서 ID는 `"1KPpCzNIjYVzP96ZMXUM"` 같은 랜덤 문자열입니다.
JavaScript의 `parseInt()`는 숫자로 시작하는 문자열을 잘못 변환합니다:

```javascript
// ❌ 잘못된 예 - 절대 사용 금지!
const id = parseInt(doc.id, 10);  
// "1KPpCzNIjYVzP96ZMXUM" → 1 (버그!)
// "9gdaO21hhyR3jFovDSPr" → 9 (버그!)

// ✅ 올바른 예
const id = doc.id;  // 문자열 그대로 사용
```

### SQLite vs Firebase ID 차이점

| 시스템 | ID 타입 | 예시 |
|--------|---------|------|
| **SQLite (POS)** | 숫자 (INTEGER) | `15001`, `10002` |
| **Firebase** | 문자열 (랜덤) | `"1KPpCzNIjYVzP96ZMXUM"` |
| **동기화용 firebase_id** | 문자열 | `"1KPpCzNIjYVzP96ZMXUM"` |

### 규칙 요약
1. **POS 내부**: `item_id`, `category_id` 등은 **숫자** 사용 OK
2. **Firebase 관련**: `firebase_id`, `categoryId` 등은 **문자열** 사용 필수
3. **TZO 앱**: 모든 ID는 **문자열**로 처리 