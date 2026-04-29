'use strict';

/**
 * Urban Piper 연동 서비스 (Order Status Update / Prep Time)
 *
 * 자격증명 우선순위 (높은 → 낮은):
 *   1) Firebase  restaurants/{id}/settings/urbanPiper  ← 신규 (클라우드 공유)
 *   2) SQLite    delivery_channel_settings (channel_id='urbanpiper')  ← 로컬 캐시
 *   3) 환경변수  URBANPIPER_*
 *
 * Firebase에 자격증명이 있으면 SQLite에도 캐시(동기화)하여
 * 인터넷이 끊겨도 기존 캐시로 동작할 수 있도록 한다.
 *
 * 인증 방식 (URBANPIPER_AUTH_MODE 또는 settings.authMode):
 *   - basic   : Authorization: Basic base64(username:apiKey)
 *   - bearer  : Authorization: Bearer apiKey
 *   - apikey  : Authorization: apikey apiKey   (Urban Piper 일부 환경 디폴트)
 *   - custom  : settings.headers JSON 그대로 사용
 *
 * 모든 외부 호출은 실패해도 throw 하지 않고 표준 객체를 반환:
 *   { skipped, ok, status, body, error }
 */

const fetch = require('node-fetch');

// ============================================
// 설정 로드
// ============================================

function envCfg() {
  return {
    baseUrl:  (process.env.URBANPIPER_API_BASE_URL || '').trim(),
    apiKey:   (process.env.URBANPIPER_API_KEY      || '').trim(),
    apiSecret:(process.env.URBANPIPER_API_SECRET   || '').trim(),
    username: (process.env.URBANPIPER_USERNAME     || '').trim(),
    authMode: (process.env.URBANPIPER_AUTH_MODE    || '').trim().toLowerCase(),
    storeId:  (process.env.URBANPIPER_STORE_ID     || '').trim(),
  };
}

/** SQLite delivery_channel_settings 행을 읽는다 (로컬 캐시). */
async function dbCfg(db) {
  if (!db || typeof db.get !== 'function') return {};
  return new Promise((resolve) => {
    db.get(
      `SELECT * FROM delivery_channel_settings WHERE channel_id = 'urbanpiper'`,
      (err, row) => {
        if (err || !row) return resolve({});
        let s = {};
        try {
          s = row.settings_json ? JSON.parse(row.settings_json) : {};
        } catch (_) {
          s = {};
        }
        resolve({
          baseUrl:  (s.baseUrl || row.webhook_url || '').toString().trim(),
          apiKey:   (row.api_key   || '').toString().trim(),
          apiSecret:(row.api_secret|| '').toString().trim(),
          username: (s.username || '').toString().trim(),
          authMode: (s.authMode || '').toString().trim().toLowerCase(),
          storeId:  (row.store_id  || '').toString().trim(),
          merchantId:(row.merchant_id|| '').toString().trim(),
          extraHeaders: (s.headers && typeof s.headers === 'object') ? s.headers : null,
        });
      }
    );
  });
}

/**
 * Firebase  restaurants/{restaurantId}/settings/urbanPiper 에서 자격증명 읽기.
 * @returns {Promise<object>}  채워진 필드만 반환, 실패 시 빈 객체.
 */
async function firebaseCfg() {
  try {
    const firebaseService = require('./firebaseService');
    const firestore = firebaseService.getFirestore();
    if (!firestore) return {};

    // restaurantId를 SQLite admin_settings에서 가져온다
    const { dbGet: localDbGet } = require('../db');
    const row = await localDbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
    const restaurantId = (row && row.value) ? row.value.trim() : '';
    if (!restaurantId) return {};

    const docRef = firestore.collection('restaurants').doc(restaurantId).collection('settings').doc('urbanPiper');
    const snap = await docRef.get();
    if (!snap.exists) return {};

    const d = snap.data() || {};
    return {
      baseUrl:      (d.baseUrl || '').toString().trim(),
      apiKey:       (d.apiKey || '').toString().trim(),
      apiSecret:    (d.apiSecret || '').toString().trim(),
      username:     (d.username || '').toString().trim(),
      authMode:     (d.authMode || '').toString().trim().toLowerCase(),
      storeId:      (d.storeId || '').toString().trim(),
      merchantId:   (d.merchantId || '').toString().trim(),
      webhookUrl:   (d.webhookUrl || '').toString().trim(),
      extraHeaders: (d.headers && typeof d.headers === 'object') ? d.headers : null,
      _restaurantId: restaurantId,
    };
  } catch (e) {
    console.warn('[UP] Firebase config load failed (non-fatal):', e?.message);
    return {};
  }
}

/**
 * Firebase에서 가져온 자격증명을 SQLite에 캐시한다.
 * 인터넷이 끊겼을 때 로컬 캐시로 동작할 수 있도록.
 */
async function cacheToSqlite(cfg) {
  try {
    if (!cfg || !cfg.apiKey) return;
    const { dbRun: localDbRun } = require('../db');
    const settingsJson = JSON.stringify({
      baseUrl: cfg.baseUrl || '',
      username: cfg.username || '',
      authMode: cfg.authMode || '',
      headers: cfg.extraHeaders || null,
    });
    await localDbRun(`
      INSERT INTO delivery_channel_settings
        (channel_id, channel_name, api_key, api_secret, merchant_id, store_id, webhook_url, settings_json, enabled, updated_at)
      VALUES ('urbanpiper', 'Urban Piper', ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(channel_id) DO UPDATE SET
        api_key      = excluded.api_key,
        api_secret   = excluded.api_secret,
        merchant_id  = excluded.merchant_id,
        store_id     = excluded.store_id,
        webhook_url  = excluded.webhook_url,
        settings_json= excluded.settings_json,
        enabled      = 1,
        updated_at   = CURRENT_TIMESTAMP
    `, [
      cfg.apiKey || null,
      cfg.apiSecret || null,
      cfg.merchantId || null,
      cfg.storeId || null,
      cfg.webhookUrl || null,
      settingsJson,
    ]);
    console.log('[UP] Firebase config cached to SQLite');
  } catch (e) {
    console.warn('[UP] SQLite cache write failed (non-fatal):', e?.message);
  }
}

/**
 * 자격증명 통합 로드. Firebase > SQLite > env 우선.
 * Firebase에서 성공적으로 읽으면 SQLite에도 캐시한다.
 *   @param {object|null} db  SQLite db 인스턴스 (선택)
 *   @returns {{ baseUrl, apiKey, apiSecret, username, authMode, storeId, merchantId, extraHeaders }}
 */
async function loadConfig(db) {
  const e = envCfg();

  // 1) Firebase (클라우드 우선)
  const f = await firebaseCfg().catch(() => ({}));
  if (f.apiKey) {
    // Firebase에서 가져왔으면 SQLite에 캐시
    cacheToSqlite(f).catch(() => {});
    return {
      baseUrl:    (f.baseUrl    || e.baseUrl    || '').replace(/\/+$/, ''),
      apiKey:      f.apiKey,
      apiSecret:   f.apiSecret  || e.apiSecret  || '',
      username:    f.username   || e.username   || '',
      authMode:   (f.authMode   || e.authMode   || '').toLowerCase(),
      storeId:     f.storeId    || e.storeId    || '',
      merchantId:  f.merchantId || '',
      extraHeaders: f.extraHeaders || null,
    };
  }

  // 2) SQLite (로컬 캐시 / 오프라인 대비)
  const d = await dbCfg(db).catch(() => ({}));
  return {
    baseUrl:    (d.baseUrl    || e.baseUrl    || '').replace(/\/+$/, ''),
    apiKey:      d.apiKey     || e.apiKey     || '',
    apiSecret:   d.apiSecret  || e.apiSecret  || '',
    username:    d.username   || e.username   || '',
    authMode:   (d.authMode   || e.authMode   || '').toLowerCase(),
    storeId:     d.storeId    || e.storeId    || '',
    merchantId:  d.merchantId || '',
    extraHeaders: d.extraHeaders || null,
  };
}

function isConfigured(cfg) {
  return !!(cfg && cfg.baseUrl && cfg.apiKey);
}

/**
 * Firebase에 UP 자격증명을 저장한다.
 * OnlineOrderPage 설정 화면에서 호출됨.
 * @param {string} restaurantId
 * @param {object} config  { apiKey, apiSecret, storeId, merchantId, baseUrl, authMode, webhookUrl }
 */
async function saveConfigToFirebase(restaurantId, config) {
  const firebaseService = require('./firebaseService');
  const firestore = firebaseService.getFirestore();
  if (!firestore || !restaurantId) {
    throw new Error('Firebase not initialized or restaurantId missing');
  }
  const docRef = firestore.collection('restaurants').doc(restaurantId).collection('settings').doc('urbanPiper');
  await docRef.set({
    apiKey:      config.apiKey || '',
    apiSecret:   config.apiSecret || '',
    storeId:     config.storeId || '',
    merchantId:  config.merchantId || '',
    baseUrl:     config.baseUrl || '',
    authMode:    config.authMode || 'basic',
    webhookUrl:  config.webhookUrl || '',
    updatedAt:   new Date().toISOString(),
  }, { merge: true });
  console.log(`[UP] Config saved to Firebase: restaurants/${restaurantId}/settings/urbanPiper`);
}

// ============================================
// 공통 HTTP
// ============================================

function buildHeaders(cfg) {
  const headers = { 'Content-Type': 'application/json' };

  let mode = cfg.authMode;
  if (!mode) mode = cfg.username ? 'basic' : 'apikey';

  if (mode === 'basic') {
    const u = cfg.username || '';
    const p = cfg.apiKey   || '';
    headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
  } else if (mode === 'bearer') {
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  } else if (mode === 'apikey') {
    headers['Authorization'] = `apikey ${cfg.apiKey}`;
  } else if (mode === 'custom' && cfg.extraHeaders) {
    Object.assign(headers, cfg.extraHeaders);
  } else {
    // fallback
    headers['Authorization'] = `apikey ${cfg.apiKey}`;
  }

  if (cfg.apiSecret && !headers['X-API-Secret']) {
    headers['X-API-Secret'] = cfg.apiSecret;
  }
  return headers;
}

function skipResult(reason) {
  return { skipped: true, ok: false, status: null, body: null, error: reason };
}

async function safeFetch(url, options) {
  try {
    const res = await fetch(url, { timeout: 15000, ...options });
    let body = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }
    return { skipped: false, ok: res.ok, status: res.status, body, error: null };
  } catch (err) {
    return { skipped: false, ok: false, status: null, body: null, error: err.message };
  }
}

// ============================================
// 공개 API
// ============================================

/** PUT {base}/orders/{upId}/status/  with { new_status, ...extra } */
async function updateOrderStatus(urbanPiperOrderId, newStatus, extra = {}, db = null) {
  const cfg = await loadConfig(db);
  if (!isConfigured(cfg)) return skipResult('UP credentials not configured');
  if (!urbanPiperOrderId) return skipResult('No Urban Piper order ID');

  const url = `${cfg.baseUrl}/orders/${encodeURIComponent(urbanPiperOrderId)}/status/`;
  const payload = { new_status: newStatus, ...extra };

  console.log(`[UP] updateOrderStatus → ${url}`, JSON.stringify(payload));
  return safeFetch(url, {
    method: 'PUT',
    headers: buildHeaders(cfg),
    body: JSON.stringify(payload),
  });
}

/** Acknowledged + prep_time(분) */
async function acknowledgeOrder(urbanPiperOrderId, prepMinutes, db = null) {
  const extra = {};
  if (Number.isFinite(prepMinutes) && prepMinutes > 0) {
    extra.prep_time = Math.round(prepMinutes);
  }
  return updateOrderStatus(urbanPiperOrderId, 'Acknowledged', extra, db);
}

/** Food Ready */
async function markFoodReady(urbanPiperOrderId, db = null) {
  return updateOrderStatus(urbanPiperOrderId, 'Food Ready', {}, db);
}

/** Cancelled + reason */
async function cancelOrder(urbanPiperOrderId, reason, db = null) {
  const extra = {};
  if (reason) extra.message = reason;
  return updateOrderStatus(urbanPiperOrderId, 'Cancelled', extra, db);
}

/**
 * 매장 기본 prep 변경.
 * PUT {base}/stores/{storeId}/  with { prep_time }
 */
async function updateStorePrepTime(prepMinutes, db = null, overrideStoreId = null) {
  const cfg = await loadConfig(db);
  if (!isConfigured(cfg)) return skipResult('UP credentials not configured');
  const storeId = (overrideStoreId || cfg.storeId || '').toString().trim();
  if (!storeId) return skipResult('No UP store ID configured');

  const url = `${cfg.baseUrl}/stores/${encodeURIComponent(storeId)}/`;
  const payload = { prep_time: Math.round(prepMinutes) };

  console.log(`[UP] updateStorePrepTime → ${url}`, JSON.stringify(payload));
  return safeFetch(url, {
    method: 'PUT',
    headers: buildHeaders(cfg),
    body: JSON.stringify(payload),
  });
}

/**
 * 자격증명 점검용 — 가벼운 GET 요청을 시도한다.
 *   (실서비스 호출 전 환경 검증)
 */
async function ping(db = null) {
  const cfg = await loadConfig(db);
  if (!isConfigured(cfg)) return skipResult('UP credentials not configured');
  const url = `${cfg.baseUrl}/`;
  return safeFetch(url, { method: 'GET', headers: buildHeaders(cfg) });
}

module.exports = {
  loadConfig,
  isConfigured: async (db = null) => isConfigured(await loadConfig(db)),
  isConfiguredSync: () => isConfigured(envCfg()),
  saveConfigToFirebase,
  updateOrderStatus,
  acknowledgeOrder,
  markFoodReady,
  cancelOrder,
  updateStorePrepTime,
  ping,
};
