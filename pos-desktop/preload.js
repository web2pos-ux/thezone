/**
 * WEB2POS - Preload Script
 * Electron 메인 프로세스와 렌더러 프로세스 간의 안전한 통신
 */

const { contextBridge, ipcRenderer } = require('electron');

// 안전하게 노출되는 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 정보
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 시스템 정보
  getPlatform: () => process.platform,
  
  // 앱 제어
  quit: () => ipcRenderer.send('app-quit'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  
  // 알림
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
});

// Electron 환경임을 표시
contextBridge.exposeInMainWorld('isElectron', true);
