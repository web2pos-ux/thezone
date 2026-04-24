/**
 * 데모 배포용: 스냅샷 web2pos.db에서 Firebase 레스토랑 ID만 제거 (수신자가 Setup에서 입력).
 * 사용: repo 루트에서 backend 의존성 설치 후
 *   node pos-desktop/scripts/strip-demo-restaurant-id.mjs "C:\path\web2pos.db"
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sqlite3Path = path.resolve(__dirname, '../../backend/node_modules/sqlite3');
let sqlite3;
try {
  sqlite3 = require(sqlite3Path).verbose();
} catch (e) {
  console.error('[strip-demo] sqlite3 로드 실패. repo backend 폴더에서 npm install 후 다시 실행하세요.');
  console.error(e.message);
  process.exit(1);
}

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: node pos-desktop/scripts/strip-demo-restaurant-id.mjs "<web2pos.db>"');
  process.exit(1);
}

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });

async function main() {
  const db = new sqlite3.Database(dbPath);
  try {
    await run(db, `UPDATE business_profile SET firebase_restaurant_id = NULL WHERE id = 1`);
    await run(db, `DELETE FROM admin_settings WHERE key = 'firebase_restaurant_id'`);
    console.log('[strip-demo] firebase_restaurant_id 제거 완료:', dbPath);
  } catch (e) {
    console.error('[strip-demo] 오류:', e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
