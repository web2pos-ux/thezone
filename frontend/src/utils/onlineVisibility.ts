/**
 * Online / Delivery item visibility — time-window evaluation.
 *
 * Backend stores three relevant fields per channel ('online' | 'delivery'):
 *   - <channel>_visible       : 0 | 1   (hard visibility flag)
 *   - <channel>_hide_type     : 'visible' | 'permanent' | 'time_limited'
 *   - <channel>_available_until : 'HH:MM' | null
 *   - <channel>_available_from  : 'HH:MM' | null   (NEW — recurring daily window)
 *
 * Semantics for `time_limited`:
 *   - If only `<channel>_available_until` is set:
 *       Visible until that time of day. After that time, hidden until midnight.
 *   - If both `<channel>_available_from` AND `<channel>_available_until` are set:
 *       Visible only inside the recurring daily window [from, until).
 *       Supports overnight windows (e.g., 22:00 → 02:00).
 *   - If only `<channel>_available_from` is set:
 *       Visible from that time of day until midnight.
 *
 * `permanent` => hidden always.
 * `visible`   => visible always (subject to <channel>_visible flag).
 */

export type HideType = 'visible' | 'permanent' | 'time_limited';

export interface VisibilityFields {
  online_visible?: number | boolean;
  delivery_visible?: number | boolean;
  online_hide_type?: HideType | string | null;
  online_available_until?: string | null;
  online_available_from?: string | null;
  delivery_hide_type?: HideType | string | null;
  delivery_available_until?: string | null;
  delivery_available_from?: string | null;
}

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

const parseHHMM = (s?: string | null): number | null => {
  if (!s) return null;
  const m = HHMM_RE.exec(String(s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
};

const nowMinutes = (now: Date = new Date()): number => now.getHours() * 60 + now.getMinutes();

/**
 * Pure check for whether the current time is inside [from, until).
 * Supports overnight windows when until <= from.
 */
export const isInsideDailyWindow = (
  fromHHMM: string | null | undefined,
  untilHHMM: string | null | undefined,
  now: Date = new Date(),
): boolean => {
  const from = parseHHMM(fromHHMM);
  const until = parseHHMM(untilHHMM);
  const cur = nowMinutes(now);

  if (from == null && until == null) return true;

  if (from != null && until != null) {
    if (from === until) return true;
    if (from < until) return cur >= from && cur < until;
    return cur >= from || cur < untilOvernight(until);
  }
  if (from != null) return cur >= from;
  return cur < (until as number);
};

const untilOvernight = (until: number) => until;

/**
 * Returns true if the item should be displayed for the given channel.
 *
 * - Honors hard visibility flag (returns false if 0/false).
 * - Honors `permanent` hide type.
 * - Evaluates daily time window for `time_limited`.
 */
export const isItemVisibleForChannel = (
  item: VisibilityFields | null | undefined,
  channel: 'online' | 'delivery',
  now: Date = new Date(),
): boolean => {
  if (!item) return true;

  const visibleFlag = channel === 'online' ? item.online_visible : item.delivery_visible;
  if (visibleFlag === 0 || visibleFlag === false) return false;

  const hideType = (channel === 'online' ? item.online_hide_type : item.delivery_hide_type) || 'visible';
  if (hideType === 'permanent') return false;
  if (hideType !== 'time_limited') return true;

  const from = channel === 'online' ? item.online_available_from : item.delivery_available_from;
  const until = channel === 'online' ? item.online_available_until : item.delivery_available_until;
  return isInsideDailyWindow(from, until, now);
};

/** Convenience: filter an array of items to only those currently visible. */
export const filterVisibleItems = <T extends VisibilityFields>(
  items: T[] | null | undefined,
  channel: 'online' | 'delivery',
  now: Date = new Date(),
): T[] => {
  if (!Array.isArray(items)) return [];
  return items.filter((it) => isItemVisibleForChannel(it, channel, now));
};

/** Build a human-readable label for the configured window (POS-side preview). */
export const formatWindowLabel = (
  hideType: HideType | string | null | undefined,
  fromHHMM: string | null | undefined,
  untilHHMM: string | null | undefined,
): string => {
  if (hideType === 'permanent') return 'Hidden';
  if (hideType !== 'time_limited') return 'Visible';
  const from = parseHHMM(fromHHMM);
  const until = parseHHMM(untilHHMM);
  if (from != null && until != null) return `${fromHHMM} – ${untilHHMM}`;
  if (until != null) return `Until ${untilHHMM}`;
  if (from != null) return `From ${fromHHMM}`;
  return 'Visible';
};
