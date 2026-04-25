/**
 * 주문 시 Kitchen / Receipt / Bill 을 실제 프린터로 보내지 않고
 * 화면 미리보기만 할지 여부 (localStorage + 선택적 빌드 플래그).
 */

const STORAGE_KEY = 'web2pos_print_preview_mode';

/** '1' = 켜짐, '0' = 강제 끔(데모 빌드에서도 실제 출력), 미설정 = env만 따름 */
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
