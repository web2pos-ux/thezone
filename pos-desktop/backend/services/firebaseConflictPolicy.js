/**
 * Firebase 미러링 충돌 정책 (WEB2POS)
 *
 * 스펙 6 — 충돌
 * - 진실원천: 항상 로컬(SQLite / POS가 보낸 payload).
 * - 인터넷 복구 시 로컬 내용을 클라우드에 맞춰 넣는다(미러링).
 * - 클라우드가 예전 스냅샷을 가져도 로컬 기준으로 덮어쓰기(또는 merge set으로 동일 목표).
 * - "어느 쪽이 더 나중인가"는 타임스탬프(posLocalUpdatedAtIso 등)로 보조할 수 있으나,
 *   시계 오차·오프라인 드리프트가 있으므로 최종은 POS 우선 + 이 모듈의 정책 필드와 함께 쓴다.
 */

const POS_AUTHORITY = 'local_authoritative';
const POS_POLICY = 'local_overwrites_cloud';

/** SQLite 큐 적재 사유 — `firebase_sync_queue.deferral_reason` */
const DEFERRAL_REASON_OFFLINE = 'offline';
const DEFERRAL_REASON_LIVE_SYNC_FAILED = 'live_sync_failed';

/** Firestore에 실릴 “지연 동기” 출처 메타 키(주문·결제·매출 등 공통). */
const QUEUED_SYNC_PROVENANCE_KEYS = [
  'posSyncDeferred',
  'posSyncDeferralReason',
  'posSyncQueuedAtIso',
  'posSyncQueueRowId',
  'posSyncReplayFromDlq',
  'posSyncDlqRowId',
];

/**
 * Firestore `set()` 시 로컬 필드가 동일 키의 클라우드 값을 덮어쓴다(병합 쓰기).
 * @type {Readonly<{ merge: boolean }>}
 */
const LOCAL_MIRROR_WRITE_OPTIONS = Object.freeze({ merge: true });

/**
 * payload에서 로컬 변경 시각 후보를 찾아 ISO 문자열로 통일. 없으면 현재 시각.
 * @param {Record<string, unknown>|null|undefined} payload
 */
function resolvePosLocalUpdatedIso(payload) {
  if (!payload || typeof payload !== 'object') {
    return new Date().toISOString();
  }
  const candidates = [
    payload.updated_at,
    payload.updatedAt,
    payload.local_updated_at,
    payload.localUpdatedAt,
    payload.modified_at,
    payload.modifiedAt,
    payload.timestamp,
    payload.last_modified,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string' && c.trim()) {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (typeof c === 'number' && Number.isFinite(c)) {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Firestore 문서에 공통으로 붙이는 POS 미러 메타(문자열만 — Admin merge/set 호환).
 * @param {Record<string, unknown>|null|undefined} payload
 */
function mergePosMirrorFields(payload) {
  const nowIso = new Date().toISOString();
  return {
    posConflictAuthority: POS_AUTHORITY,
    posConflictPolicy: POS_POLICY,
    posLocalUpdatedAtIso: resolvePosLocalUpdatedIso(payload),
    posMirroredAtIso: nowIso,
  };
}

/**
 * Firestore `orders` 문서에 POS→클라우드 미러 메타가 붙은 경우(신규 동기화 파이프라인).
 * 온라인 주문 리스너에서 고객 앱 주문과 구분할 때 사용.
 * @param {Record<string, unknown>|null|undefined} order
 */
function isPosMirrorMetadataOrder(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.posConflictAuthority === POS_AUTHORITY) return true;
  if (order.posConflictPolicy === POS_POLICY) return true;
  return false;
}

/**
 * SQLite datetime 문자열을 ISO로 근사(표시·비교용). 파싱 실패 시 현재 시각.
 * @param {string|null|undefined} s
 */
function sqliteDatetimeToIsoOrNow(s) {
  if (s == null || String(s).trim() === '') return new Date().toISOString();
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const normalized = str.includes('T') ? str : str.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * payload에 섞인 큐 출처 메타만 골라 Firestore에 넣는다(나머지 필드는 각 서비스가 담당).
 * @param {Record<string, unknown>|null|undefined} payload
 */
function extractQueuedSyncProvenanceFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of QUEUED_SYNC_PROVENANCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, k) && payload[k] != null) {
      out[k] = payload[k];
    }
  }
  return out;
}

/**
 * SQLite `firebase_sync_queue` / `firebase_sync_dlq` 행 → Firestore 공통 메타.
 * 실시간이 아니라 큐를 거쳐 늦게 반영된 쓰기임을 표시한다.
 *
 * @param {Record<string, unknown>|null|undefined} row
 * @param {{ fromDlq?: boolean }} [opts]
 */
function mergeQueuedSyncProvenanceFields(row, opts = {}) {
  if (!row || typeof row !== 'object') return {};
  const fromDlq = opts.fromDlq === true;
  const reason =
    row.deferral_reason != null && String(row.deferral_reason).trim() !== ''
      ? String(row.deferral_reason).trim()
      : 'legacy_queue';
  const queuedAtRaw = fromDlq ? row.queue_created_at || row.created_at : row.created_at;
  /** @type {Record<string, unknown>} */
  const out = {
    posSyncDeferred: true,
    posSyncDeferralReason: reason,
    posSyncQueuedAtIso: sqliteDatetimeToIsoOrNow(
      typeof queuedAtRaw === 'string' || typeof queuedAtRaw === 'number' ? queuedAtRaw : null,
    ),
  };
  if (fromDlq) {
    out.posSyncReplayFromDlq = true;
    if (row.id != null) out.posSyncDlqRowId = row.id;
    if (row.queue_id != null) out.posSyncQueueRowId = row.queue_id;
  } else if (row.id != null) {
    out.posSyncQueueRowId = row.id;
  }
  return out;
}

module.exports = {
  POS_AUTHORITY,
  POS_POLICY,
  LOCAL_MIRROR_WRITE_OPTIONS,
  DEFERRAL_REASON_OFFLINE,
  DEFERRAL_REASON_LIVE_SYNC_FAILED,
  mergePosMirrorFields,
  resolvePosLocalUpdatedIso,
  isPosMirrorMetadataOrder,
  mergeQueuedSyncProvenanceFields,
  extractQueuedSyncProvenanceFromPayload,
  sqliteDatetimeToIsoOrNow,
};
