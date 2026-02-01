/**
 * 동적 설정 관리
 * 데이터베이스에서 설정을 로드하여 사용합니다.
 */

// 설정 캐시
let settingsCache: Record<string, string> | null = null;
let settingsPromise: Promise<Record<string, string>> | null = null;

/**
 * 설정을 API에서 로드합니다.
 * 첫 호출 시에만 API를 호출하고, 이후에는 캐시를 사용합니다.
 */
export async function loadSettings(): Promise<Record<string, string>> {
  // 이미 로드 중이면 기다림
  if (settingsPromise) {
    return settingsPromise;
  }

  // 캐시가 있으면 반환
  if (settingsCache) {
    return settingsCache;
  }

  // API 호출
  const defaultApiUrl = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
  const apiBase = defaultApiUrl.replace(/\/api$/, '') || 'http://localhost:3177';

  settingsPromise = fetch(`${apiBase}/api/app-settings`)
    .then(async (res) => {
      if (res.ok) {
        const settings = await res.json();
        settingsCache = settings;
        return settings;
      } else {
        // API 실패 시 기본값 반환
        return {
          api_url: defaultApiUrl,
          api_base: apiBase,
          backend_port: '3177'
        };
      }
    })
    .catch((err) => {
      console.warn('[settings] Failed to load settings from API, using defaults:', err);
      // 네트워크 오류 시 기본값 반환
      return {
        api_url: defaultApiUrl,
        api_base: apiBase,
        backend_port: '3177'
      };
    })
    .finally(() => {
      settingsPromise = null;
    });

  return settingsPromise;
}

/**
 * 설정값을 가져옵니다.
 * @param key 설정 키
 * @param defaultValue 기본값
 */
export async function getSetting(key: string, defaultValue: string = ''): Promise<string> {
  const settings = await loadSettings();
  return settings[key] || defaultValue;
}

/**
 * 설정 캐시를 초기화합니다 (설정 변경 후 호출)
 */
export function clearSettingsCache(): void {
  settingsCache = null;
  settingsPromise = null;
}

/**
 * 동기적으로 설정값을 가져옵니다 (캐시된 값 사용)
 * 캐시가 없으면 기본값을 반환합니다.
 */
export function getSettingSync(key: string, defaultValue: string = ''): string {
  if (!settingsCache) {
    return defaultValue;
  }
  return settingsCache[key] || defaultValue;
}
