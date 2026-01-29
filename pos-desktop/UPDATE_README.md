# 🔄 WEB2POS 업데이트 가이드

## 📦 업데이트 방법 (간단!)

### 1️⃣ 개발자가 할 일

```powershell
# 1. 코드 수정 후 빌드
cd frontend
npm run build

# 2. build 폴더 압축해서 전달
# frontend/build 폴더를 ZIP으로 압축
```

### 2️⃣ 사용자가 할 일

```
1. WEB2POS 앱 종료
2. 기존 frontend/build 폴더 삭제
3. 새 build.zip 압축 해제
4. WEB2POS 앱 다시 실행
```

**끝! 앱 재설치 필요 없음 🎉**

---

## 📁 폴더 구조

```
WEB2POS 설치 폴더/
├── WEB2POS.exe          ← 실행 파일 (안 바뀜)
├── backend/             ← 서버 로직 (거의 안 바뀜)
│   ├── index.js
│   └── routes/
├── frontend/
│   └── build/           ← ⭐ 이것만 교체!
│       ├── index.html
│       └── static/
└── db/
    └── tzp.db           ← 데이터베이스 (절대 삭제 금지!)
```

---

## ⚠️ 주의사항

| 절대 삭제하면 안 됨! | 교체해도 됨 |
|---------------------|-------------|
| `db/tzp.db` (데이터!) | `frontend/build/` |
| `backend/` | |

---

## 🔧 고급: 자동 업데이트 설정

나중에 자동 업데이트가 필요하면:

1. GitHub Releases에 새 버전 업로드
2. `electron-updater` 패키지 추가
3. 앱이 자동으로 업데이트 확인 & 설치

현재는 **수동 업데이트**가 더 안전하고 간단합니다!
