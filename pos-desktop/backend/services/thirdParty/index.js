// backend/services/thirdParty/index.js
// 3rd Party 연동 모듈 진입점

const BaseAdapter = require('./BaseAdapter');
const SampleAdapter = require('./SampleAdapter');

/**
 * 어댑터 레지스트리
 * 새로운 어댑터 추가 시 여기에 등록
 */
const adapters = {
  sample: SampleAdapter,
  // doordash: DoorDashAdapter,   // 추후 구현
  // skip: SkipAdapter,           // 추후 구현
  // ubereats: UberEatsAdapter,   // 추후 구현
};

/**
 * 어댑터 인스턴스 생성
 * @param {string} provider - 제공자 이름
 * @param {object} config - 설정
 * @returns {BaseAdapter}
 */
function createAdapter(provider, config = {}) {
  const AdapterClass = adapters[provider.toLowerCase()];
  
  if (!AdapterClass) {
    throw new Error(`Unknown provider: ${provider}. Available: ${Object.keys(adapters).join(', ')}`);
  }
  
  return new AdapterClass(config);
}

/**
 * 활성화된 어댑터 목록 조회
 */
async function getActiveAdapters() {
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const dbPath = path.resolve(__dirname, '..', '..', '..', 'db', 'web2pos.db');
  const db = new sqlite3.Database(dbPath);
  
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM third_party_integrations WHERE is_active = 1',
      (err, rows) => {
        db.close();
        if (err) reject(err);
        else {
          const activeAdapters = rows.map(row => {
            try {
              const adapter = createAdapter(row.provider, {
                storeId: row.store_id,
                apiKey: row.api_key,
                apiSecret: row.api_secret
              });
              return { provider: row.provider, adapter, config: row };
            } catch (e) {
              return { provider: row.provider, adapter: null, error: e.message };
            }
          });
          resolve(activeAdapters);
        }
      }
    );
  });
}

/**
 * 모든 활성화된 어댑터에 메뉴 동기화
 */
async function syncMenuToAll(menuItems) {
  const activeAdapters = await getActiveAdapters();
  const results = [];
  
  for (const { provider, adapter, error } of activeAdapters) {
    if (error) {
      results.push({ provider, success: false, error });
      continue;
    }
    
    if (!adapter.menu_sync_enabled) {
      results.push({ provider, success: true, skipped: true, reason: 'Menu sync disabled' });
      continue;
    }
    
    try {
      const result = await adapter.uploadMenu(menuItems);
      results.push({ provider, success: true, ...result });
    } catch (e) {
      results.push({ provider, success: false, error: e.message });
    }
  }
  
  return results;
}

module.exports = {
  BaseAdapter,
  SampleAdapter,
  createAdapter,
  getActiveAdapters,
  syncMenuToAll,
  adapters
};

