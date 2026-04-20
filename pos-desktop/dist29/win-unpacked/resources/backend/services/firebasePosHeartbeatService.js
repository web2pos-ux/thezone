/**
 * POS → Firestore 생체 신호 (주기적 write).
 * - 인터넷 Ping(networkConnectivity)과 별개로 "Firebase 경로가 살아 있는지" 기록.
 * - 오프라인 시 stopAllFirebaseCloudForOffline 에서 중지.
 *
 * 소비자 앱(TZO)은 `restaurants/{id}/posPresence/heartbeat` 의 `lastAt`으로 온라인 주문 가능 여부를 판단한다.
 * 향후 Urban Piper 등 외부 연동도 동일 문서에 필드를 추가하거나 별도 문서로 생체 신호를 확장할 수 있다.
 */

const firebaseService = require('./firebaseService');

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** @type {string | null} */
let currentRestaurantId = null;

const DEFAULT_INTERVAL_MS = 90 * 1000;

function getIntervalMs() {
  const raw = process.env.POS_FIREBASE_HEARTBEAT_INTERVAL_MS;
  const n = raw != null && String(raw).trim() !== '' ? parseInt(String(raw), 10) : NaN;
  if (Number.isFinite(n) && n >= 15000 && n <= 3600000) return n;
  return DEFAULT_INTERVAL_MS;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  currentRestaurantId = null;
}

async function tick() {
  const rid = currentRestaurantId;
  if (!rid) return;
  try {
    await firebaseService.writePosHeartbeat(rid);
  } catch (e) {
    console.warn('[POS] Firebase heartbeat tick:', e && e.message ? e.message : e);
  }
}

/**
 * @param {string} restaurantId - business_profile.firebase_restaurant_id
 */
function start(restaurantId) {
  if (!restaurantId || String(restaurantId).trim() === '') return;
  const id = String(restaurantId).trim();
  if (currentRestaurantId === id && timer) return;

  stop();
  currentRestaurantId = id;
  const ms = getIntervalMs();
  void tick();
  timer = setInterval(() => {
    void tick();
  }, ms);
  console.log(
    `[POS] Firebase 생체 신호 시작 (${Math.round(ms / 1000)}초마다) → restaurants/${id}/posPresence/heartbeat`
  );
}

function isRunning() {
  return timer != null && !!currentRestaurantId;
}

module.exports = {
  start,
  stop,
  isRunning,
};
