/**
 * 데모 전용 백오피스 PIN — process.env.WEB2POS_DEMO 가 켜진 서버에서만 verify 에서 허용.
 * (Electron 데모: main.js 가 resources/demo.flag 존재 시 WEB2POS_DEMO=1 설정)
 */
const DEMO_BACKOFFICE_PIN = '9998887117';

function isDemoModeEnv() {
  const v = String(process.env.WEB2POS_DEMO || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function isDemoBackofficePin(pin) {
  if (!isDemoModeEnv()) return false;
  return String(pin || '').trim() === DEMO_BACKOFFICE_PIN;
}

module.exports = {
  DEMO_BACKOFFICE_PIN,
  isDemoBackofficePin,
  isDemoModeEnv,
};
