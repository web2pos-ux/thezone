/**
 * WEB2POS Table Order - Windows Desktop App
 * Electron Main Process
 */

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

// 설정 저장소
const store = new Store({
  defaults: {
    deviceId: '',
    posHost: '',
    storeId: 'default',
    tableId: '',
    configured: false,
    autoAssigned: false
  }
});

// 디바이스 ID 초기화
function getOrCreateDeviceId() {
  let deviceId = store.get('deviceId');
  if (!deviceId) {
    // 윈도우용 ID 형식
    deviceId = 'WIN-' + uuidv4().slice(0, 8).toUpperCase();
    store.set('deviceId', deviceId);
    console.log('[Device] New device ID created:', deviceId);
  } else {
    console.log('[Device] Existing device ID loaded:', deviceId);
  }
  return deviceId;
}

let mainWindow;
let tray = null;
let heartbeatInterval = null;
let configSyncInterval = null;

// Heartbeat 간격 (30초)
const HEARTBEAT_INTERVAL = 30000;
// 설정 동기화 간격 (10초)
const CONFIG_SYNC_INTERVAL = 10000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    // icon: path.join(__dirname, 'assets', 'icon.png'), // 아이콘 파일이 있으면 주석 해제
    autoHideMenuBar: true,
    show: false
  });

  // 설정 상태 확인
  const configured = store.get('configured');
  const posHost = store.get('posHost');
  const tableId = store.get('tableId');
  const storeId = store.get('storeId');
  const deviceId = getOrCreateDeviceId();

  if (configured && posHost && tableId) {
    // 테이블 오더 페이지 로드
    const tableOrderUrl = `${posHost}/table-order/${storeId}/${tableId}`;
    console.log('[App] Loading table order URL:', tableOrderUrl);
    mainWindow.loadURL(tableOrderUrl);
    
    // POS에 등록 및 Heartbeat 시작
    registerDevice(posHost, deviceId);
    startHeartbeat(posHost, deviceId);
    startConfigSync(posHost, deviceId);
  } else {
    // 설정 페이지 로드
    mainWindow.loadFile('setup.html');
    
    // POS 주소가 있으면 등록 시도
    if (posHost) {
      registerDevice(posHost, deviceId);
      startConfigSync(posHost, deviceId);
    }
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 창 닫기 이벤트
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 시스템 트레이 생성
function createTray() {
  // 기본 아이콘 사용 (아이콘 파일이 없을 경우 대비)
  let iconPath = path.join(__dirname, 'assets', 'icon.png');
  try {
    const fs = require('fs');
    if (!fs.existsSync(iconPath)) {
      iconPath = null; // 기본 아이콘 사용
    }
  } catch (e) {
    iconPath = null;
  }
  
  // 아이콘이 없으면 빈 이미지 사용
  let trayIcon;
  if (iconPath) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // 16x16 빈 이미지 생성
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  
  tray.setToolTip('WEB2POS Table Order');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => mainWindow?.show());
}

// 설정 페이지 열기
function openSettings() {
  if (mainWindow) {
    mainWindow.loadFile('setup.html');
    mainWindow.show();
  }
}

// POS에 디바이스 등록
async function registerDevice(host, deviceId) {
  if (!host || !deviceId) return null;
  
  try {
    const os = require('os');
    const response = await fetch(`${host}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        device_name: `Windows Tablet ${deviceId.slice(-4)}`,
        device_type: 'table_order',
        app_version: '1.0.0',
        os_version: `Windows ${os.release()}`,
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Device] Registration successful:', data);
      
      // 이미 테이블이 배정되어 있으면 자동 적용
      if (data.device?.assigned_table_id) {
        handleTableAssignment(data.device.assigned_table_id);
      }
      
      return data;
    }
  } catch (e) {
    console.error('[Device] Registration error:', e.message);
  }
  return null;
}

// Heartbeat 전송
async function sendHeartbeat(host, deviceId) {
  if (!host || !deviceId) return;
  
  try {
    const response = await fetch(`${host}/api/devices/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        battery_level: null,
        is_charging: true,
        app_version: '1.0.0',
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Heartbeat] Sent successfully');
      
      // POS에서 테이블 배정이 변경되었는지 확인
      const currentTableId = store.get('tableId');
      if (data.assigned_table_id && data.assigned_table_id !== currentTableId) {
        console.log('[Heartbeat] Table assignment changed:', data.assigned_table_id);
        handleTableAssignment(data.assigned_table_id);
      }
    }
  } catch (e) {
    console.error('[Heartbeat] Error:', e.message);
  }
}

// 설정 동기화
async function syncConfigFromPOS(host, deviceId) {
  if (!host || !deviceId) return;
  
  try {
    const response = await fetch(`${host}/api/devices/${deviceId}/config`);
    
    if (response.ok) {
      const data = await response.json();
      const posConfig = data.config;
      
      const currentTableId = store.get('tableId');
      const configured = store.get('configured');
      
      // POS에서 테이블이 배정되었으면 자동 적용
      if (posConfig.assigned_table_id && posConfig.status === 'active') {
        if (posConfig.assigned_table_id !== currentTableId || !configured) {
          console.log('[ConfigSync] Auto-applying table from POS:', posConfig.assigned_table_id);
          handleTableAssignment(posConfig.assigned_table_id, posConfig.store_id);
        }
      }
    }
  } catch (e) {
    console.error('[ConfigSync] Error:', e.message);
  }
}

// 테이블 배정 처리
function handleTableAssignment(tableId, storeId) {
  if (!tableId) return;
  
  const posHost = store.get('posHost');
  if (!posHost) return;
  
  store.set('tableId', tableId);
  if (storeId) store.set('storeId', storeId);
  store.set('configured', true);
  store.set('autoAssigned', true);
  
  // 테이블 오더 페이지로 이동
  const tableOrderUrl = `${posHost}/table-order/${storeId || store.get('storeId')}/${tableId}`;
  console.log('[App] Loading assigned table:', tableOrderUrl);
  
  if (mainWindow) {
    mainWindow.loadURL(tableOrderUrl);
  }
  
  // Heartbeat 시작
  const deviceId = store.get('deviceId');
  startHeartbeat(posHost, deviceId);
}

// Heartbeat 시작
function startHeartbeat(host, deviceId) {
  stopHeartbeat();
  
  sendHeartbeat(host, deviceId);
  heartbeatInterval = setInterval(() => {
    sendHeartbeat(host, deviceId);
  }, HEARTBEAT_INTERVAL);
  
  console.log('[Heartbeat] Started with interval:', HEARTBEAT_INTERVAL);
}

// Heartbeat 중지
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// 설정 동기화 시작
function startConfigSync(host, deviceId) {
  stopConfigSync();
  
  configSyncInterval = setInterval(() => {
    syncConfigFromPOS(host, deviceId);
  }, CONFIG_SYNC_INTERVAL);
  
  console.log('[ConfigSync] Started with interval:', CONFIG_SYNC_INTERVAL);
}

// 설정 동기화 중지
function stopConfigSync() {
  if (configSyncInterval) {
    clearInterval(configSyncInterval);
    configSyncInterval = null;
  }
}

// ==================== IPC 핸들러 ====================

// 설정 가져오기
ipcMain.handle('get-config', () => {
  return {
    deviceId: store.get('deviceId'),
    posHost: store.get('posHost'),
    storeId: store.get('storeId'),
    tableId: store.get('tableId'),
    configured: store.get('configured'),
    autoAssigned: store.get('autoAssigned')
  };
});

// 연결 테스트
ipcMain.handle('test-connection', async (event, host) => {
  try {
    const response = await fetch(`${host}/api/business-profile`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (response.ok) {
      // 연결 성공 시 디바이스 등록
      const deviceId = store.get('deviceId');
      store.set('posHost', host);
      await registerDevice(host, deviceId);
      startConfigSync(host, deviceId);
      return { success: true };
    }
    return { success: false, error: 'Server error' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 설정 저장
ipcMain.handle('save-config', async (event, config) => {
  try {
    store.set('posHost', config.posHost);
    store.set('storeId', config.storeId || 'default');
    store.set('tableId', config.tableId);
    store.set('configured', true);
    store.set('autoAssigned', false);
    
    const deviceId = store.get('deviceId');
    const posHost = config.posHost;
    
    // POS에 등록 및 Heartbeat 시작
    await registerDevice(posHost, deviceId);
    startHeartbeat(posHost, deviceId);
    startConfigSync(posHost, deviceId);
    
    // 테이블 오더 페이지 로드
    const tableOrderUrl = `${posHost}/table-order/${config.storeId || 'default'}/${config.tableId}`;
    mainWindow.loadURL(tableOrderUrl);
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 배정된 테이블 사용
ipcMain.handle('use-assigned-table', async (event, tableId) => {
  try {
    handleTableAssignment(tableId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 설정 리셋
ipcMain.handle('reset-config', async () => {
  try {
    const deviceId = store.get('deviceId'); // 디바이스 ID는 유지
    
    stopHeartbeat();
    stopConfigSync();
    
    store.set('posHost', '');
    store.set('storeId', 'default');
    store.set('tableId', '');
    store.set('configured', false);
    store.set('autoAssigned', false);
    
    mainWindow.loadFile('setup.html');
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 설정 페이지 열기
ipcMain.handle('open-settings', () => {
  openSettings();
});

// POS에서 배정 확인
ipcMain.handle('check-assignment', async () => {
  const posHost = store.get('posHost');
  const deviceId = store.get('deviceId');
  
  if (!posHost || !deviceId) return { assigned: false };
  
  try {
    const response = await fetch(`${posHost}/api/devices/${deviceId}/config`);
    
    if (response.ok) {
      const data = await response.json();
      const posConfig = data.config;
      
      if (posConfig.assigned_table_id && posConfig.status === 'active') {
        return { 
          assigned: true, 
          tableId: posConfig.assigned_table_id,
          tableLabel: posConfig.assigned_table_label
        };
      }
    }
  } catch (e) {
    console.error('[CheckAssignment] Error:', e.message);
  }
  
  return { assigned: false };
});

// ==================== 앱 생명주기 ====================

app.whenReady().then(() => {
  // 디바이스 ID 초기화
  getOrCreateDeviceId();
  
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopHeartbeat();
  stopConfigSync();
});

