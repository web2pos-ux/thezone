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

const normalizeApiUrl = (value: string): string => {
  const raw = (value || '').trim();
  if (!raw) return 'http://localhost:3177/api';
  const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (stripped.endsWith('/api')) return stripped;
  return `${stripped}/api`;
};

const normalizeApiBase = (value: string): string => {
  const raw = (value || '').trim();
  if (!raw) return 'http://localhost:3177';
  const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return stripped.endsWith('/api') ? stripped.slice(0, -4) : stripped;
};

const inferDefaultApiUrl = (): string => {
  // In the browser, prefer the same origin as the current page
  // so iPad/Android/Windows browsers can connect to Main POS by URL.
  if (typeof window !== 'undefined') {
    const port = window.location.port || '';
    const isDevFrontendPort = port === '3000' || port === '3088' || port === '5173';
    if (!isDevFrontendPort) {
      return `${window.location.origin}/api`;
    }
  }
  return process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
};

// 기본값 (초기 로딩 시 사용)
const DEFAULT_API_URL = normalizeApiUrl(inferDefaultApiUrl());
const DEFAULT_API_BASE = normalizeApiBase(DEFAULT_API_URL);

// 동적 API URL (데이터베이스 설정 우선)
export function getAPI_URL(): string {
  return normalizeApiUrl(getSettingSync('api_url', DEFAULT_API_URL));
}

// 동적 API Base (데이터베이스 설정 우선)
export function getAPI_BASE(): string {
  const base = getSettingSync('api_base', DEFAULT_API_BASE);
  return normalizeApiBase(base || getSettingSync('api_url', DEFAULT_API_URL) || DEFAULT_API_BASE);
}

// 하위 호환성을 위한 상수 (초기값, 나중에 동적으로 업데이트됨)
export let API_URL = DEFAULT_API_URL;
export let API_BASE = DEFAULT_API_BASE;

// 앱 시작 시 설정 로드
loadSettings().then((settings) => {
  API_URL = normalizeApiUrl(settings.api_url || DEFAULT_API_URL);
  API_BASE = normalizeApiBase(settings.api_base || settings.api_url || DEFAULT_API_BASE);
  console.log('[constants] Settings loaded:', { API_URL, API_BASE });
}).catch((err) => {
  console.warn('[constants] Failed to load settings:', err);
});

// 개발 모드 확인
export const IS_DEV = process.env.NODE_ENV === 'development';
