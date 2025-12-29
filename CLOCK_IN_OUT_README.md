# Clock In/Out 시스템 구현 완료 ✅

## 📋 구현 개요

**SalesPage**와 **TableMapPage**에 직원 출퇴근 관리 시스템을 성공적으로 구현했습니다.

---

## 🎯 구현 위치

### 1. **SalesPage** (`/sales`) - 메인 POS 화면
- 상단 헤더 오른쪽에 **⏰ IN** / **🚪 OUT** 버튼
- 컴팩트한 디자인으로 화면 공간 절약

### 2. **TableMapPage** (`/backoffice/table-map`) - 백오피스
- 상단에 **Clock In (출근)** / **Clock Out (퇴근)** 버튼
- 출근 중인 직원 목록 실시간 표시
- 근무 시간 실시간 계산 및 표시

---

## 🗄️ 데이터베이스 변경사항

### 1. `employees` 테이블 업데이트
- **추가된 컬럼**: `pin` (TEXT)
  - 직원 PIN 번호 저장
  - 기본값: `1234` (모든 기존 직원)

### 2. `clock_records` 테이블 신규 생성
```sql
CREATE TABLE clock_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  employee_name TEXT,
  clock_in_time TEXT NOT NULL,
  clock_out_time TEXT,
  scheduled_shift_id INTEGER,
  early_out_approved_by TEXT,
  early_out_reason TEXT,
  total_hours REAL,
  status TEXT DEFAULT 'clocked_in',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
)
```

---

## 🔧 백엔드 API 엔드포인트

### Clock In/Out API (`/api/work-schedule/`)

1. **POST `/verify-pin`** - PIN 인증
   - Request: `{ pin: string }`
   - Response: `{ employee: { id, name, role, department } }`

2. **POST `/clock-in`** - 출근 처리
   - Request: `{ employeeId, employeeName, pin }`
   - Response: `{ message, recordId, clockInTime, hasSchedule }`
   - 기능:
     - PIN 인증
     - 중복 출근 방지 (오늘 이미 출근한 경우)
     - 스케줄 확인 및 연동
     - `work_schedules.worked_start` 업데이트

3. **POST `/clock-out`** - 퇴근 처리
   - Request: `{ employeeId, pin, earlyOut?, earlyOutReason?, approvedBy? }`
   - Response: `{ message, clockOutTime, totalHours, earlyOut }`
   - 기능:
     - PIN 인증
     - 근무 시간 자동 계산
     - 조기 퇴근 사유 및 승인자 기록
     - `work_schedules.worked_end` 및 `notes` 업데이트

4. **GET `/clocked-in`** - 현재 출근 중인 직원 목록
   - Response: `[{ id, employee_id, employee_name, clock_in_time, role, department }]`

5. **GET `/clock-history/:employeeId`** - 직원 출퇴근 기록
   - Query params: `startDate`, `endDate`, `limit`
   - Response: `[ClockRecord]`

---

## 🎨 프론트엔드 구현

### 1. **새로운 컴포넌트**

#### `ClockInOutButtons.tsx` ⭐ NEW
- Clock In/Out 버튼과 모든 로직을 포함한 독립 컴포넌트
- Props:
  - `compact?: boolean` - true면 작은 버튼 (IN/OUT), false면 큰 버튼
- 기능:
  - PIN 인증
  - 출근/퇴근 처리
  - 조기 퇴근(EO) 처리
  - 에러 핸들링

#### `PinInputModal.tsx`
- 4자리 PIN 입력 모달
- 숫자 패드 UI
- 자동 제출 (4자리 입력 시)
- 에러 표시
- 로딩 상태 관리

### 2. **새로운 서비스**

#### `clockInOutApi.ts`
- `verifyPin()` - PIN 인증
- `clockIn()` - 출근 처리
- `clockOut()` - 퇴근 처리
- `getClockedInEmployees()` - 출근 중인 직원 목록
- `getClockHistory()` - 출퇴근 기록 조회

### 3. **업데이트된 페이지**

#### `SalesPage.tsx` ⭐ 메인 POS 화면
- 상단 헤더 오른쪽에 `<ClockInOutButtons compact />` 추가
- 작은 버튼: **⏰ IN** / **🚪 OUT**
- 위치: `/sales`

#### `TableMapPage.tsx` - 백오피스
- 상단에 `<ClockInOutButtons />` 추가
- 큰 버튼: **⏰ Clock In (출근)** / **🚪 Clock Out (퇴근)**
- 현재 출근 중인 직원 목록 실시간 표시
- 근무 시간 실시간 계산 및 표시
- 위치: `/backoffice/table-map`

---

## 🚀 사용 방법

### 1. 데이터베이스 설정
```bash
cd backend
node setup-clock-in-out.js
```

### 2. 서버 실행
```bash
# Backend
cd backend
npm run dev

# Frontend
cd frontend
npm start
```

### 3. Clock In/Out 사용

#### 출근 (Clock In)
1. "⏰ Clock In (출근)" 버튼 클릭
2. 4자리 PIN 입력 (기본: `1234`)
3. 자동으로 출근 처리

#### 퇴근 (Clock Out)
1. "🚪 Clock Out (퇴근)" 버튼 클릭
2. 4자리 PIN 입력
3. 18시 이전이면 조기 퇴근 사유 입력 요청
4. 퇴근 처리 및 근무 시간 표시

#### 조기 퇴근 (Early Out)
1. 18시 이전에 퇴근 시도
2. 조기 퇴근 사유 입력
3. 승인자 이름 입력 (선택)
4. PIN 재입력
5. 퇴근 처리

---

## 🔐 보안 고려사항

1. **PIN 저장**
   - 현재: 평문 저장 (개발 환경)
   - 권장: bcrypt 등으로 해시화하여 저장

2. **PIN 인증**
   - 매 출퇴근마다 PIN 인증 필요
   - 중복 출근 방지

3. **권한 관리**
   - 조기 퇴근은 승인자 정보 기록
   - 관리자 권한 확인 추가 권장

---

## 📊 데이터 흐름

### Clock In 흐름
```
1. 사용자 PIN 입력
2. POST /verify-pin (PIN 인증)
3. POST /clock-in (출근 처리)
4. clock_records 테이블에 레코드 생성
5. work_schedules.worked_start 업데이트 (스케줄이 있는 경우)
6. 출근 완료 메시지 표시
7. 출근 중인 직원 목록 새로고침
```

### Clock Out 흐름
```
1. 사용자 PIN 입력
2. POST /verify-pin (PIN 인증)
3. 현재 시간 확인 (18시 이전이면 조기 퇴근 처리)
4. POST /clock-out (퇴근 처리)
5. clock_records 업데이트 (clock_out_time, total_hours, status)
6. work_schedules.worked_end 및 notes 업데이트
7. 퇴근 완료 메시지 및 근무 시간 표시
8. 출근 중인 직원 목록 새로고침
```

---

## 🎯 추가 개선 가능 사항

### 단기
- [ ] PIN 해시화 (bcrypt)
- [ ] 생체 인증 지원 (지문, 얼굴 인식)
- [ ] 출퇴근 기록 내보내기 (CSV, Excel)
- [ ] 출퇴근 통계 대시보드

### 중기
- [ ] GPS 기반 위치 확인
- [ ] 모바일 앱 지원
- [ ] 푸시 알림 (출근 알림, 퇴근 알림)
- [ ] 급여 계산 연동

### 장기
- [ ] AI 기반 근무 패턴 분석
- [ ] 자동 스케줄 최적화
- [ ] 실시간 알림 시스템 (Socket.io)

---

## 🐛 문제 해결

### PIN을 잊어버린 경우
```sql
-- 데이터베이스에서 직접 PIN 재설정
UPDATE employees 
SET pin = '1234' 
WHERE id = 'EMPLOYEE_ID';
```

### 출근 기록이 남아있는 경우
```sql
-- 수동으로 퇴근 처리
UPDATE clock_records 
SET clock_out_time = datetime('now'),
    status = 'clocked_out',
    total_hours = (julianday(datetime('now')) - julianday(clock_in_time)) * 24
WHERE employee_id = 'EMPLOYEE_ID' 
  AND clock_out_time IS NULL;
```

---

## 📝 테스트 체크리스트

- [x] 정상 출근 (스케줄 있음)
- [x] 정상 출근 (스케줄 없음)
- [x] 중복 출근 방지
- [x] 잘못된 PIN 입력
- [x] 정상 퇴근 (18시 이후)
- [x] 조기 퇴근 (18시 이전)
- [x] 근무 시간 계산
- [x] 출근 중인 직원 목록 표시
- [x] 실시간 근무 시간 업데이트

---

## 🎉 완료!

Clock In/Out 시스템이 성공적으로 구현되었습니다!

**기본 PIN**: `1234`

테스트 후 Employee Info 페이지에서 개별 직원의 PIN을 변경할 수 있습니다.

