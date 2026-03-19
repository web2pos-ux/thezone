// backend/db.js
// 공유 데이터베이스 모듈

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// DB 경로: 환경 변수 우선, 없으면 기본 경로 사용 (Electron 앱 호환)
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '..', 'db', 'web2pos.db');
console.log('[db.js] Using database:', dbPath);

// DB 파일이 있는 디렉토리 존재 확인 및 생성
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('[db.js] Created database directory:', dbDir);
}

// DB 디렉토리 쓰기 권한 확인
try {
  fs.accessSync(dbDir, fs.constants.W_OK);
  console.log('[db.js] Database directory is writable:', dbDir);
} catch (err) {
  console.error('[db.js] ⚠️ WARNING: Database directory is NOT writable:', dbDir);
  console.error('[db.js] ⚠️ This will cause all save operations to fail!');
  console.error('[db.js] ⚠️ Please check file permissions or install location.');
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[db.js] ❌ Error opening database:', err.message);
    console.error('[db.js] ❌ DB path:', dbPath);
    console.error('[db.js] ❌ All database operations will fail.');
  } else {
    console.log('[db.js] ✅ Database opened successfully:', dbPath);
  }
});

// WAL 모드 설정: 동시 읽기/쓰기 성능 향상 및 SQLITE_BUSY 에러 방지
db.run('PRAGMA journal_mode=WAL', (err) => {
  if (err) console.error('[db.js] Failed to set WAL mode:', err.message);
  else console.log('[db.js] WAL mode enabled');
});

// busy_timeout 증가: 동시 접근 시 최대 5초 대기 (기본 1초 → 5초)
db.run('PRAGMA busy_timeout=5000', (err) => {
  if (err) console.error('[db.js] Failed to set busy_timeout:', err.message);
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

module.exports = {
  db,
  dbRun,
  dbAll,
  dbGet
};















