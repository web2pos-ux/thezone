/**
 * Employee Manager → Detailed Permissions → POS Operations.
 * Stored under employee_permission_levels_v1 / API voids/settings/permission-levels.
 */
export const INTRO_SCREEN_LOGIN_PERMISSION = {
  category: 'POS Operations',
  /** Minimum role level (1–5) required to use an employee PIN on the Intro screen. */
  name: 'Log in to POS from Intro screen',
  defaultLevel: 4,
} as const;

export const PERMISSION_LEVELS_STORAGE_KEY = 'employee_permission_levels_v1';

/** Align with backend routes/voids.js roleToLevel */
export function roleToPermLevel(roleRaw: string): number {
  const role = String(roleRaw || '').toLowerCase().trim();
  if (!role) return 2;
  if (role.includes('owner') || role.includes('admin')) return 5;
  if (role.includes('manager')) return 4;
  if (role.includes('supervisor')) return 3;
  if (role.includes('server') || role.includes('cashier')) return 2;
  if (role.includes('kitchen') || role.includes('bar')) return 1;
  return 2;
}

export function clampPermLevel(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}
