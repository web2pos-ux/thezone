/**
 * 중앙 API 설정
 * 모든 API 호출은 이 상수를 사용해야 합니다.
 * 
 * 우선순위:
 * 1. 데이터베이스 설정 (app_settings 테이블)
 * 2. 환경변수 REACT_APP_API_URL
 * 3. 기본값 http://localhost:3177/api
 */

import { getSettingSync, loadSettings } from './settings';

// 기본값 (초기 로딩 시 사용)
const DEFAULT_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
const DEFAULT_API_BASE = DEFAULT_API_URL.replace(/\/api$/, '') || 'http://localhost:3177';

// 동적 API URL (데이터베이스 설정 우선)
export function getAPI_URL(): string {
  return getSettingSync('api_url', DEFAULT_API_URL);
}

// 동적 API Base (데이터베이스 설정 우선)
export function getAPI_BASE(): string {
  return getSettingSync('api_base', DEFAULT_API_BASE);
}

// 하위 호환성을 위한 상수 (초기값, 나중에 동적으로 업데이트됨)
export let API_URL = DEFAULT_API_URL;
export let API_BASE = DEFAULT_API_BASE;

// 앱 시작 시 설정 로드
loadSettings().then((settings) => {
  API_URL = settings.api_url || DEFAULT_API_URL;
  API_BASE = settings.api_base || DEFAULT_API_BASE;
  console.log('[constants] Settings loaded:', { API_URL, API_BASE });
}).catch((err) => {
  console.warn('[constants] Failed to load settings:', err);
});

// 개발 모드 확인
export const IS_DEV = process.env.NODE_ENV === 'development';
