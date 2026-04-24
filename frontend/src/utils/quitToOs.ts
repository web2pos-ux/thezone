/**
 * "Go to Windows": Electron이면 앱 종료. 인트로(/)로 보내지 않음.
 * 브라우저만 쓸 때는 window.close()만 시도.
 */
export function quitToOsFromPos(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.electron?.quit) {
      window.electron.quit();
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    window.close();
  } catch {
    /* ignore */
  }
}
