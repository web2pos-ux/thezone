/**
 * WEB2POS - Preload Script
 * 보안을 위해 Node.js API를 제한적으로 노출
 */

const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer, app } = require('electron');

/** 데모: 패키지는 resources/demo.flag, 개발은 WEB2POS_DEMO=1|true|yes */
function computeIsWeb2posDemo() {
  try {
    if (app && app.isPackaged) {
      const flagPath = path.join(process.resourcesPath, 'demo.flag');
      if (fs.existsSync(flagPath)) {
        console.log('[Preload] Demo mode: found resources/demo.flag');
        return true;
      }
      return false;
    }
  } catch (e) {
    console.warn('[Preload] Demo (packaged) check failed:', e && e.message);
  }
  const raw = String(process.env.WEB2POS_DEMO || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') {
    console.log('[Preload] Demo mode: WEB2POS_DEMO env');
    return true;
  }
  return false;
}

const web2posDemoIsDemo = computeIsWeb2posDemo();
contextBridge.exposeInMainWorld('web2posDemo', { isDemo: web2posDemoIsDemo });

// 안전하게 노출할 API만 정의
contextBridge.exposeInMainWorld('electron', {
  // 앱 정보
  getVersion: () => ipcRenderer.invoke('get-version'),
  
  // 앱 제어
  quit: () => ipcRenderer.send('app-quit'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  
  // 인쇄 기능
  print: () => ipcRenderer.send('print'),
  
  // 플랫폼 정보
  platform: process.platform
});

console.log('[Preload] WEB2POS preload script loaded');
