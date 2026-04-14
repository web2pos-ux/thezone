/** 시스템 만능 PIN — Void/백오피스 PIN 검증 등 */
const MASTER_POS_PIN = '1126';

function isMasterPosPin(pin) {
  return String(pin || '').trim() === MASTER_POS_PIN;
}

module.exports = { MASTER_POS_PIN, isMasterPosPin };
