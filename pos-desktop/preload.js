/**
 * WEB2POS - Preload Script
 * 보안을 위해 Node.js API를 제한적으로 노출
 */

const { contextBridge, ipcRenderer } = require('electron');

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
