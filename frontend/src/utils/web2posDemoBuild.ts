/**
 * 데모 UI (Back Office 버튼 비활성화 등).
 *
 * 1) Electron: `window.web2posDemo.isDemo` — 패키지 앱은 설치 폴더 `resources/demo.flag` 파일이 있으면 true.
 *    개발 중 Electron은 `WEB2POS_DEMO=1` (또는 true/yes) 후 `electron .`
 * 2) CRA: `REACT_APP_WEB2POS_DEMO=true` — `npm run start:demo` / `npm run build:demo` 또는 .env.development.local
 */
export function isWeb2posDemoBuild(): boolean {
  if (typeof window !== 'undefined') {
    try {
      if (window.web2posDemo?.isDemo === true) return true;
    } catch {
      /* ignore */
    }
  }
  const v = process.env.REACT_APP_WEB2POS_DEMO;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
