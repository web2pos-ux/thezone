# WEB2POS Table Order - Android App

안드로이드 태블릿용 테이블 오더 앱입니다.

## 🚀 주요 기능

- **디바이스 자동 등록**: 앱 실행 시 POS에 자동으로 디바이스 등록
- **테이블 자동 배정**: POS에서 배정한 테이블을 자동으로 수신 및 적용
- **Heartbeat**: 30초마다 상태 정보 전송 (온라인 상태 확인용)
- **설정 화면**: POS 서버 IP 주소, 테이블 번호 설정
- **WebView**: 테이블 오더 웹 페이지 표시
- **자동 실행**: 기기 부팅 시 자동으로 앱 시작
- **키오스크 모드**: 다른 앱으로 이동 불가, 풀스크린 모드

## 📱 디바이스 관리

### POS에서 디바이스 관리
1. POS에서 **Back Office → Hardware Manager → Table Devices** 메뉴 접속
2. 자동 등록된 디바이스 목록 확인
3. 각 디바이스에 테이블 배정 (예: T1, T2...)
4. 배정된 테이블이 자동으로 태블릿에 적용됨

### 디바이스 ID
- 각 태블릿은 고유한 **디바이스 ID**를 가짐 (예: `TABLET-A1B2C3D4`)
- 앱 삭제 전까지 유지됨
- 설정 화면의 우측 상단 또는 고급 설정에서 확인 가능

## 📋 빌드 요구사항

1. **Node.js**: 18+ 버전
2. **Java JDK**: 17 버전
3. **Android Studio**: Android SDK 설치
4. **환경 변수 설정**:
   - `ANDROID_HOME`: Android SDK 경로
   - `JAVA_HOME`: JDK 경로

## 🔧 설치 및 빌드

### 1. 의존성 설치

```bash
cd android-app
npm install
```

### 2. 개발 모드 실행

```bash
# Metro 서버 시작
npm start

# 새 터미널에서 Android 앱 실행
npm run android
```

### 3. 릴리스 APK 빌드

```bash
# APK 빌드
cd android
./gradlew assembleRelease

# 빌드된 APK 위치
# android/app/build/outputs/apk/release/app-release.apk
```

## 📱 태블릿 설치 방법

### APK 직접 설치

1. APK 파일을 태블릿에 복사
2. 파일 관리자에서 APK 파일 실행
3. "알 수 없는 출처" 앱 설치 허용
4. 설치 완료

### ADB 설치

```bash
adb install app-release.apk
```

## ⚙️ 초기 설정

1. 앱 실행
2. POS 서버 주소 입력 (예: `http://192.168.1.100:3088`)
3. 테이블 번호 입력 (예: `T1`)
4. "Test" 버튼으로 연결 확인
5. "Save & Start" 버튼 클릭

## 🔒 키오스크 모드

### 활성화 방법

1. 앱이 설치된 후 기기 재부팅
2. 홈 화면 선택 시 "Table Order" 선택
3. "항상" 선택

### 설정 화면 접근

- 화면 우측 상단을 **3초간 길게 누르기**

### 키오스크 모드 해제

1. 설정 → 앱 → Table Order → 기본 앱으로 지우기
2. 기기 재부팅

## 📂 프로젝트 구조

```
android-app/
├── App.tsx                 # 메인 React Native 앱
├── index.js                # 앱 진입점
├── package.json            # 의존성
├── android/                # Android 네이티브 코드
│   ├── app/
│   │   ├── build.gradle
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/com/tableorderapp/
│   │       │   ├── MainActivity.kt
│   │       │   ├── MainApplication.kt
│   │       │   └── BootReceiver.kt     # 부팅 시 자동 실행
│   │       └── res/
│   ├── build.gradle
│   └── settings.gradle
└── README.md
```

## ❓ 문제 해결

### 연결 실패
- POS 서버가 실행 중인지 확인
- 태블릿과 POS가 같은 네트워크인지 확인
- 방화벽 설정 확인

### 자동 실행 안됨
- 설정 → 배터리 → 앱 배터리 최적화 해제
- 설정 → 앱 → Table Order → 권한에서 "백그라운드 활동" 허용

### 화면이 꺼짐
- 설정 → 디스플레이 → 화면 자동 꺼짐 → "사용 안 함"


