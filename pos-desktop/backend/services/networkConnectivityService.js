/**
 * 외부 인터넷 도달 여부 (초경량 HTTPS ping).
 * - URL: 짧은 응답 고정 (204 또는 200 + 빈 본문/소문자 ok 몇 바이트), 인증 없음, redirect: manual
 * - 1회 성공 → 온라인 (연속 실패 카운터 0으로 리셋)
 * - 3회 연속 실패 → 오프라인
 * - 온라인: 60초마다 확인 / 오프라인: 30분마다 확인
 *
 * 자체 초경량 엔드포인트를 쓰려면 환경변수 PING_URL 또는 INTERNET_PING_URL (HTTPS 권장).
 */

const DEFAULT_PING_URL = 'https://connectivitycheck.gstatic.com/generate_204';
/** @deprecated 실제 사용 URL은 getPingUrl() — env 오버라이드 반영 */
const PING_URL = DEFAULT_PING_URL;
const FETCH_TIMEOUT_MS = 5000;
const FAIL_THRESHOLD = 3;
const INTERVAL_ONLINE_MS = 60 * 1000;
const INTERVAL_OFFLINE_MS = 30 * 60 * 1000;
/** 200 응답 시 본문이 이보다 길면 캡티브 포털 등으로 보고 실패 */
const MAX_OK_BODY_BYTES = 64;

let consecutiveFailures = 0;
/** @type {boolean} */
let internetUp = true;
let lastCheckIso = null;
let lastError = null;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
const onlineCallbacks = [];
const offlineCallbacks = [];

function getPingUrl() {
  const u = process.env.PING_URL || process.env.INTERNET_PING_URL;
  if (typeof u === 'string' && u.trim() !== '') return u.trim();
  return DEFAULT_PING_URL;
}

function getLastCheckIso() {
  return lastCheckIso;
}

function getConsecutiveFailures() {
  return consecutiveFailures;
}

function isInternetConnected() {
  return internetUp === true;
}

/**
 * @returns {'online'|'offline'|'syncing'}
 */
function getSyncState() {
  if (!internetUp) return 'offline';
  return 'online';
}

function onBecameOnline(fn) {
  if (typeof fn === 'function') onlineCallbacks.push(fn);
}

function onBecameOffline(fn) {
  if (typeof fn === 'function') offlineCallbacks.push(fn);
}

function notifyBecameOnline() {
  onlineCallbacks.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[Network] onBecameOnline callback:', e.message);
    }
  });
}

function notifyBecameOffline() {
  offlineCallbacks.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[Network] onBecameOffline callback:', e.message);
    }
  });
}

/**
 * 스트림 앞부분만 읽어 대용량 HTML(캡티브 포털 등) 전체 소비 방지.
 * @param {globalThis.Response} res
 */
async function readBodyPrefix(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (out.length < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      out += dec.decode(value, { stream: true });
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return out.slice(0, maxBytes);
}

/** @param {globalThis.Response} res */
async function isPingResponseOk(res) {
  if (res.status === 204) return true;
  if (res.status !== 200) return false;
  const cl = res.headers.get('content-length');
  if (cl != null && cl !== '' && !Number.isNaN(parseInt(cl, 10)) && parseInt(cl, 10) > MAX_OK_BODY_BYTES) {
    return false;
  }
  const txt = await readBodyPrefix(res, MAX_OK_BODY_BYTES + 1);
  if (txt.length > MAX_OK_BODY_BYTES) return false;
  const s = txt.trim();
  return s === '' || /^ok$/i.test(s);
}

async function pingOnce() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(getPingUrl(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: '*/*' },
      cache: 'no-store',
    });
    clearTimeout(t);
    return await isPingResponseOk(res);
  } catch (e) {
    clearTimeout(t);
    lastError = e && e.message ? e.message : String(e);
    return false;
  }
}

async function runCheckCycle() {
  const onlineBefore = internetUp;
  const ok = await pingOnce();
  lastCheckIso = new Date().toISOString();

  if (ok) {
    consecutiveFailures = 0;
    lastError = null;
    const wasOffline = !internetUp;
    internetUp = true;
    if (wasOffline) {
      console.log('[Network] Internet reachable (ping OK)');
      notifyBecameOnline();
    }
  } else {
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAIL_THRESHOLD) {
      if (internetUp) {
        internetUp = false;
        console.warn(`[Network] Offline (${FAIL_THRESHOLD} consecutive ping failures)`);
        notifyBecameOffline();
      }
    }
  }

  if (!timer || onlineBefore !== internetUp) {
    rescheduleTimer();
  }
}

function rescheduleTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const ms = internetUp ? INTERVAL_ONLINE_MS : INTERVAL_OFFLINE_MS;
  timer = setInterval(() => {
    runCheckCycle().catch((e) => console.warn('[Network] check cycle:', e.message));
  }, ms);
}

/**
 * 부팅 직후 1회 동기 실행 (서버가 리스너를 올릴지 말지 판단)
 */
async function runInitialProbe() {
  await runCheckCycle();
}

/**
 * @param {{ onBecameOnline?: () => void, onBecameOffline?: () => void }} [opts]
 */
function startScheduler(opts = {}) {
  if (typeof opts.onBecameOnline === 'function') {
    onBecameOnline(opts.onBecameOnline);
  }
  if (typeof opts.onBecameOffline === 'function') {
    onBecameOffline(opts.onBecameOffline);
  }
  rescheduleTimer();
}

function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  pingOnce,
  runInitialProbe,
  startScheduler,
  stopScheduler,
  isInternetConnected,
  getConsecutiveFailures,
  getLastCheckIso,
  getSyncState,
  onBecameOnline,
  onBecameOffline,
  getPingUrl,
  PING_URL,
};
