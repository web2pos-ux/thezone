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

## 🚀 새 POS 컴퓨터 배포 가이드 (처음부터 세팅하기)

> 배포 대상은 **윈도우만 설치된 빈 컴퓨터**입니다.
> 아래 순서대로 따라하면 POS 프로그램이 동작합니다.

---

### 📌 방법 1: 설치 파일(.exe)로 배포 (가장 쉬움 — 권장)

이미 빌드된 설치 파일이 있다면 새 컴퓨터에서는 아래 하나만 실행하면 됩니다:

```
pos-desktop\dist\TheZonePOS Setup 1.0.1.exe    ← 설치 프로그램
pos-desktop\dist\TheZonePOS-Portable-1.0.1.exe ← 설치 없이 바로 실행
```

- **Setup 버전**: 바탕화면 바로가기 생성, 시작메뉴 등록
- **Portable 버전**: 설치 없이 더블클릭으로 바로 실행

> ✅ 이 방법은 **Node.js 설치가 필요 없습니다.** 앱 안에 모든 것이 포함되어 있습니다.

---

### 📌 방법 2: 개발용으로 세팅 (소스 코드를 직접 실행)

새 컴퓨터에서 소스 코드를 직접 실행하려면, 아래 프로그램들을 **순서대로** 설치해야 합니다.

#### 🔧 STEP 1: 필수 프로그램 설치

| 순서 | 프로그램 | 다운로드 링크 | 설명 |
|------|----------|--------------|------|
| ① | **Node.js v22.15.0** | https://nodejs.org/ | 서버와 앱 실행에 필요 (LTS 버전 설치) |
| ② | **Visual Studio Build Tools** | https://visualstudio.microsoft.com/ko/visual-cpp-build-tools/ | 네이티브 모듈(canvas, sqlite3, serialport) 컴파일에 필요 |
| ③ | **Python 3.x** | https://www.python.org/downloads/ | 네이티브 모듈 빌드 도구(node-gyp)에 필요 |
| ④ | **Git** (선택) | https://git-scm.com/ | 소스 코드 관리용 (USB 복사 시 불필요) |

> ⚠️ **중요 — Node.js 설치 시:**
> - 설치 중 **"Add to PATH"** 반드시 체크
> - 설치 중 **"Automatically install the necessary tools"** 체크하면 ②③이 자동 설치됨

> ⚠️ **중요 — Visual Studio Build Tools 설치 시:**
> - 설치 화면에서 **"C++를 사용한 데스크톱 개발"** 워크로드를 선택

#### 🔧 STEP 2: 설치 확인

프로그램 설치가 끝나면 **PowerShell**(또는 명령 프롬프트)을 열고 아래 명령어로 확인:

```powershell
node -v       # v22.15.0 나오면 OK
npm -v        # 10.x.x 나오면 OK
python --version  # Python 3.x.x 나오면 OK
```

#### 🔧 STEP 3: 프로젝트 파일 복사

USB 또는 네트워크 공유로 `web2pos` 폴더 전체를 새 컴퓨터에 복사합니다.

> ⚠️ **복사 시 주의:** `node_modules` 폴더는 **복사하지 마세요.** 새 컴퓨터에서 새로 설치해야 합니다.

#### 🔧 STEP 4: 패키지 설치 (npm install)

PowerShell을 열고 아래 명령어를 **순서대로** 실행합니다:

```powershell
# 1. 백엔드 패키지 설치 (약 3~5분)
cd web2pos\backend
npm install

# 2. 프론트엔드 패키지 설치 (약 3~5분)
cd ..\frontend
npm install
```

> 💡 **npm install이 10분 넘게 안 끝나면?**
> - 네이티브 모듈 빌드 도구가 없는 것 → STEP 1의 ②③ 설치 확인
> - 또는 아래 "빠른 복사 방법" 참고

#### 🔧 STEP 5: 환경 변수 설정

`backend` 폴더에 `.env` 파일이 있는지 확인합니다. 없으면 새로 만듭니다:

```env
PORT=3177
CORS_ORIGIN=http://localhost:3088
DB_PATH=db/tzp.db
```

#### 🔧 STEP 6: 실행

```powershell
# 터미널 1: 백엔드 실행
cd web2pos\backend
npm run dev

# 터미널 2: 프론트엔드 실행 (새 PowerShell 창 열기)
cd web2pos\frontend
npm start
```

브라우저에서 `http://localhost:3088` 접속하면 POS가 실행됩니다.

---

### 📌 방법 3: node_modules 직접 복사 (npm install이 안 될 때)

빌드 도구 설치 없이 가장 빠르게 해결하는 방법입니다.

> ⚠️ **조건:** 두 컴퓨터의 **Node.js 버전이 동일**해야 합니다. (`node -v`로 확인)

#### 순서:

1. **작동 중인 컴퓨터에서** 아래 2개 폴더를 **압축(zip)**:
   - `web2pos\backend\node_modules`
   - `web2pos\frontend\node_modules`

2. **USB 등으로 새 컴퓨터에 복사**

3. **새 컴퓨터에서** 같은 위치에 압축 해제:
   - `web2pos\backend\` 안에 `node_modules` 폴더 넣기
   - `web2pos\frontend\` 안에 `node_modules` 폴더 넣기

4. **실행** (STEP 6과 동일)

---

### 📌 데스크톱 앱 빌드 방법 (설치 파일 .exe 만들기)

설치 파일(.exe)을 새로 만들어야 할 때 사용합니다.

```powershell
# 1. pos-desktop 폴더로 이동
cd web2pos\pos-desktop

# 2. 빌드 준비 (Frontend 빌드 + Backend 복사)
build.bat

# 3. Electron 앱으로 패키징 (.exe 생성)
npm run build:win
```

결과물:
- `pos-desktop\dist\TheZonePOS Setup x.x.x.exe` — 설치 프로그램
- `pos-desktop\dist\TheZonePOS-Portable-x.x.x.exe` — 포터블 버전

> 이 .exe 파일만 새 컴퓨터에 복사하면 **아무것도 설치할 필요 없이** 바로 실행됩니다.

---

### 📋 배포 체크리스트

| 확인 항목 | 체크 |
|-----------|------|
| Node.js 설치 (v22.15.0) | ☐ |
| npm install 성공 (backend) | ☐ |
| npm install 성공 (frontend) | ☐ |
| `.env` 파일 존재 | ☐ |
| `db/tzp.db` 파일 존재 | ☐ |
| 백엔드 실행 확인 (port 3177) | ☐ |
| 프론트엔드 실행 확인 (port 3088) | ☐ |
| 프린터 연결 확인 | ☐ |

---

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

모든 보호 영역은 **HARD-LOCK** 상태이며, AI 에이전트(Cursor Rule `alwaysApply: true`) + Git pre-commit hook으로 이중 보호됩니다.

- (권장) 저장소에 포함된 훅을 활성화하면 커밋 시 자동으로 보호 검사가 실행됩니다:
  - `git config core.hooksPath .githooks`

| 보호 영역 | 환경변수 (일시 해제) |
|---|---|
| Split Order | `ALLOW_SPLIT_EDITS=1` |
| Virtual Keyboard | `ALLOW_VKEY_EDITS=1` |
| Payment Modal / Split Payment / Payments API | `ALLOW_PAYMENT_MODAL_EDITS=1` |
| Order Screen DnD / Merge / Color / Move / Empty Slot | `ALLOW_ORDER_DND_EDITS=1` |
| Order Page / Order Flow / Order Components | `ALLOW_ORDER_PAGE_EDITS=1` |
| Menu Management / Menu Components / Menu API | `ALLOW_MENU_EDITS=1` |
| Table Map / Table Operations / Move-Merge | `ALLOW_TABLEMAP_EDITS=1` |
| Closing Report (Z-Report) | `ALLOW_CLOSING_REPORT_EDITS=1` |

- 보호 해제는 일시적으로만 사용하고, 변경은 별도 브랜치/PR 리뷰를 거치는 것을 권장합니다.
- 상세 보호 파일 목록: `tools/protect-split-files.js` 참조
- Cursor Rule 파일: `.cursor/rules/*.mdc` 참조

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