/**
 * 주문 시 Kitchen / Receipt / Bill 을 실제 프린터로 보내지 않고
 * 화면 미리보기만 할지 여부 (localStorage + 선택적 빌드 플래그).
 * 데모 앱/데모 빌드(`isWeb2posDemoBuild`)에서는 기본으로 화면 프린트 ON (localStorage '0'이면 끔).
 */

import { isWeb2posDemoBuild } from './web2posDemoBuild';

const STORAGE_KEY = 'web2pos_print_preview_mode';

/** '1' = 켜짐, '0' = 강제 끔(데모에서도 실제 출력), 미설정 = 데모 빌드면 ON / 아니면 PRINT_PREVIEW env */
export function getPrintPreviewModeRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isPrintPreviewModeEnabled(): boolean {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {}
  try {
    if (isWeb2posDemoBuild()) return true;
    return process.env.REACT_APP_WEB2POS_PRINT_PREVIEW === 'true';
  } catch {
    return false;
  }
}

export function setPrintPreviewModeExplicit(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.setItem(STORAGE_KEY, '0');
  } catch {}
}
