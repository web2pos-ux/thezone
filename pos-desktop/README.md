# WEB2POS Desktop App

Windows용 POS 데스크톱 애플리케이션

## 빌드 방법

### 1. 사전 요구사항
- Node.js 18+ 설치
- npm 또는 yarn

### 2. 의존성 설치
```bash
cd pos-desktop
npm install
```

### 3. 빌드 준비 (Frontend + Backend 복사)
```bash
# Windows에서
build.bat
```

### 3b. 배포용 실행앱 만들 때 (권장)

**설치파일/포터블을 새로 낼 때는 패치 버전을 무조건 올린 뒤 빌드한다.**

```bash
# Windows — package.json 패치 버전 증가 → build.bat → build:win
build-release.bat
```

- `pos-desktop/package.json`의 `version` (예: 1.6.5 → 1.6.6)이 올라가며, `dist29\TheZonePOS Setup x.y.z.exe` 파일명에 반영된다.
- 개발 중에만 버전을 바꾸지 않고 묶고 싶다면 기존처럼 `build.bat` 후 `npm run build:win`만 사용한다.

### ⚠️ 빌드 전 필수 체크리스트

빌드하기 전에 아래 파일들이 `pos-desktop/backend/config/`에 있는지 확인:

| 파일 | 필수 | 설명 |
|------|------|------|
| `dealer-access.json` | ✅ | Dealer PIN 설정 (masterPin: 9998887117) |
| `firebase-service-account.json` | ✅ | Firebase 인증 키 |
| `app-version.json` | ✅ | 앱 버전 정보 (Business Info에 표시됨) |
| `setup-status.json` | ⚪ | 초기 설정 상태 (선택) |

**dealer-access.json 기본 내용:**
```json
{
  "masterPin": "9998887117",
  "dealers": [],
  "accessLog": []
}
```

### 4. Electron 앱 빌드
```bash
# 설치 프로그램 + 포터블 생성
npm run build:win

# 설치 프로그램만
npm run build:installer

# 포터블만
npm run build:portable
```

### 5. 빌드 결과물
- `dist/WEB2POS Setup x.x.x.exe` - 설치 프로그램
- `dist/WEB2POS-Portable-x.x.x.exe` - 포터블 버전

## 개발 모드 실행
```bash
# 백엔드 서버 실행 (별도 터미널)
cd ../backend
npm start

# 프론트엔드 서버 실행 (별도 터미널)
cd ../frontend
npm start

# Electron 앱 실행
cd ../pos-desktop
npm start
```

## 앱 구조
```
pos-desktop/
├── main.js           # Electron 메인 프로세스
├── preload.js        # 렌더러 프로세스 preload
├── package.json      # 프로젝트 설정
├── build.bat         # 빌드 스크립트 (Windows)
├── assets/           # 아이콘 등 리소스
│   └── icon.ico      # 앱 아이콘
├── frontend-build/   # 프론트엔드 빌드 결과물 (빌드 시 생성)
├── backend/          # 백엔드 코드 복사본 (빌드 시 생성)
└── db/               # SQLite 데이터베이스 (빌드 시 생성)
```

## 아이콘 생성
256x256 PNG 이미지를 준비한 후:
1. https://icoconvert.com/ 등에서 .ico 파일 생성
2. `assets/icon.ico`로 저장
