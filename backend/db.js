// backend/db.js
// 공유 데이터베이스 모듈

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB 경로: 환경 변수 우선, 없으면 기본 경로 사용 (Electron 앱 호환)
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '..', 'db', 'web2pos.db');
console.log('[db.js] Using database:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database from db.js:', err.message);
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















