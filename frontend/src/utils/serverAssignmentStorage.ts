export type ServerAssignmentPayload = {
  serverId: string;
  serverName: string;
  assignedAt: number;
};

type AssignmentScope = 'table' | 'order' | 'session';

const KEY_PREFIX = 'serverAssignment:';

/** `scope: 'session'` — Sales 테이블맵 상단에 표시할 현재 POS 서버(서버선택모드) */
export const POS_TABLE_MAP_SERVER_SESSION_ID = 'pos-table-map-active';

const getStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
};

const buildKey = (scope: AssignmentScope, id: string | number) =>
  `${KEY_PREFIX}${scope}:${String(id)}`;

export const loadServerAssignment = (
  scope: AssignmentScope,
  id?: string | number | null
): ServerAssignmentPayload | null => {
  const storage = getStorage();
  if (!storage || id === undefined || id === null) return null;
  try {
    const raw = storage.getItem(buildKey(scope, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.serverId === 'string' &&
      typeof parsed.serverName === 'string'
    ) {
      return {
        serverId: parsed.serverId,
        serverName: parsed.serverName,
        assignedAt: Number(parsed.assignedAt || Date.now()),
      };
    }
  } catch {
    // ignore malformed payload
  }
  return null;
};

export const saveServerAssignment = (
  scope: AssignmentScope,
  id: string | number | null | undefined,
  assignment?: { serverId: string; serverName: string }
): void => {
  const storage = getStorage();
  if (!storage || id === undefined || id === null) return;
  if (!assignment || !assignment.serverId || !assignment.serverName) return;
  try {
    storage.setItem(
      buildKey(scope, id),
      JSON.stringify({
        serverId: assignment.serverId,
        serverName: assignment.serverName,
        assignedAt: Date.now(),
      })
    );
  } catch {
    // ignore storage quota errors
  }
};

export const clearServerAssignment = (
  scope: AssignmentScope,
  id?: string | number | null
): void => {
  const storage = getStorage();
  if (!storage || id === undefined || id === null) return;
  try {
    storage.removeItem(buildKey(scope, id));
  } catch {
    // ignore
  }
};

