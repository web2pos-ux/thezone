/**
 * WEB2POS Table Order - Preload Script
 * Electron에서 renderer와 main process 간 안전한 통신을 위한 스크립트
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 설정 가져오기
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // 연결 테스트
  testConnection: (host) => ipcRenderer.invoke('test-connection', host),
  
  // 설정 저장
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // 배정된 테이블 사용
  useAssignedTable: (tableId) => ipcRenderer.invoke('use-assigned-table', tableId),
  
  // 설정 리셋
  resetConfig: () => ipcRenderer.invoke('reset-config'),
  
  // 설정 페이지 열기
  openSettings: () => ipcRenderer.invoke('open-settings'),
  
  // POS에서 배정 확인
  checkAssignment: () => ipcRenderer.invoke('check-assignment'),
  
  // 플랫폼 정보
  platform: process.platform
});















