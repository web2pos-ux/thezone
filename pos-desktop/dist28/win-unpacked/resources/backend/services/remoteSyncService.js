// backend/services/remoteSyncService.js
// Remote Sync Service - Firebase Admin Control과 원격 설정 동기화

let isInitialized = false;
let currentRestaurantId = null;

/**
 * Remote Sync Service 초기화
 * @param {string} restaurantId - Firebase 레스토랑 ID
 */
async function initialize(restaurantId) {
  if (isInitialized && currentRestaurantId === restaurantId) {
    console.log('📡 Remote Sync Service already initialized');
    return true;
  }

  try {
    currentRestaurantId = restaurantId;
    isInitialized = true;
    console.log(`📡 Remote Sync Service initialized for restaurant: ${restaurantId}`);
    return true;
  } catch (error) {
    console.error('❌ Remote Sync Service initialization failed:', error.message);
    return false;
  }
}

/**
 * 현재 초기화 상태 확인
 */
function isReady() {
  return isInitialized;
}

/**
 * 현재 연결된 레스토랑 ID
 */
function getRestaurantId() {
  return currentRestaurantId;
}

/**
 * 서비스 종료
 */
function shutdown() {
  isInitialized = false;
  currentRestaurantId = null;
  console.log('📡 Remote Sync Service shutdown');
}

module.exports = {
  initialize,
  isReady,
  getRestaurantId,
  shutdown
};
