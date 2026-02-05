/**
 * TheZonePOS - Main Electron Process
 * 하이브리드 방식: Backend + Frontend를 앱 내부에서 실행
 * + 자동 업데이트 기능
 */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { runUpdateProcess, APP_VERSION } = require('./updater');

// 서버 프로세스
let frontendServer = null;
let mainWindow = null;

// 포트 설정
const BACKEND_PORT = 3177;
const FRONTEND_PORT = 3088;

// 앱 경로 (개발/프로덕션 모두 지원)
const isDev = !app.isPackaged;
const appPath = isDev ? path.join(__dirname, '..') : process.resourcesPath;

/**
 * Backend 서버 시작 (직접 require로 실행)
 */
function startBackend() {
  return new Promise((resolve, reject) => {
    // extraResources 경로 사용
    const backendPath = isDev 
      ? path.join(__dirname, '..', 'backend')
      : path.join(process.resourcesPath, 'backend');
    
    let dbPath = isDev 
      ? path.join(__dirname, '..', 'db', 'web2pos.db')
      : path.join(process.resourcesPath, 'db', 'web2pos.db');
    
    // 쓰기 가능한 경로 설정 (빌드된 앱에서는 userData 폴더 사용)
    const userDataPath = app.getPath('userData');
    const uploadsPath = isDev 
      ? path.join(__dirname, '..', 'backend', 'uploads')
      : path.join(userDataPath, 'uploads');
    const configPath = isDev 
      ? path.join(__dirname, '..', 'backend', 'config')
      : path.join(userDataPath, 'config');
    const backupsPath = isDev 
      ? path.join(__dirname, '..', 'backups')
      : path.join(userDataPath, 'backups');
    
    // 빌드된 앱: DB 및 config 폴더 초기화
    if (!isDev) {
      const sourceDbPath = path.join(process.resourcesPath, 'db', 'web2pos.db');
      const destDbPath = path.join(userDataPath, 'web2pos.db');
      
      // DB가 userData에 없으면 복사
      if (!fs.existsSync(destDbPath)) {
        if (fs.existsSync(sourceDbPath)) {
          // db 폴더 생성
          const destDbDir = path.dirname(destDbPath);
          if (!fs.existsSync(destDbDir)) fs.mkdirSync(destDbDir, { recursive: true });
          
          fs.copyFileSync(sourceDbPath, destDbPath);
          console.log('[App] Database initialized in userData folder');
        }
      }
      
      // 실제 사용할 DB 경로 업데이트
      dbPath = destDbPath;

      const sourceConfigPath = path.join(process.resourcesPath, 'backend', 'config');
      const installedMarker = path.join(userDataPath, '.installed');
      
      // config 폴더가 없으면 생성
      if (!fs.existsSync(configPath)) {
        fs.mkdirSync(configPath, { recursive: true });
      }
      
      // 첫 설치인지 확인 (.installed 파일이 없으면 첫 설치)
      const isFirstInstall = !fs.existsSync(installedMarker);
      
      const sourceSetupStatus = path.join(sourceConfigPath, 'setup-status.json');
      const destSetupStatus = path.join(configPath, 'setup-status.json');
      
      if (isFirstInstall) {
        // 첫 설치: setup-status.json 초기화
        if (fs.existsSync(sourceSetupStatus)) {
          fs.copyFileSync(sourceSetupStatus, destSetupStatus);
          console.log('[Backend] Setup status initialized for first installation');
        }
        // 설치 완료 마커 생성
        fs.writeFileSync(installedMarker, new Date().toISOString());
      } else if (!fs.existsSync(destSetupStatus) && fs.existsSync(sourceSetupStatus)) {
        // 이후 실행: setup-status.json이 없으면 복사
        fs.copyFileSync(sourceSetupStatus, destSetupStatus);
        console.log('[Backend] Setup status restored');
      }
    }
    
    console.log('[Backend] Starting from:', backendPath);
    console.log('[Backend] DB path:', dbPath);
    console.log('[Backend] Uploads path:', uploadsPath);
    console.log('[Backend] Config path:', configPath);
    console.log('[Backend] Backups path:', backupsPath);
    
    // 환경 변수 설정
    process.env.PORT = BACKEND_PORT;
    process.env.DB_PATH = dbPath;
    process.env.UPLOADS_PATH = uploadsPath;
    process.env.CONFIG_PATH = configPath;
    process.env.BACKUPS_PATH = backupsPath;
    
    // 작업 디렉토리 변경 (backend 폴더 기준으로 경로 해결)
    const originalCwd = process.cwd();
    process.chdir(backendPath);
    
    // 패키징된 앱에서 모듈 경로 설정 (app 내부의 node_modules 사용)
    if (!isDev) {
      const appNodeModules = path.join(app.getAppPath(), 'node_modules');
      // NODE_PATH 환경 변수 설정 (가장 확실한 방법)
      process.env.NODE_PATH = appNodeModules;
      require('module')._initPaths(); // NODE_PATH 변경 적용
      // globalPaths에도 추가 (fallback)
      require('module').globalPaths.push(appNodeModules);
      console.log('[Backend] Added module path:', appNodeModules);
    }
    
    try {
      // Backend 직접 require (자동으로 서버 시작됨)
      require(path.join(backendPath, 'index.js'));
      console.log('[Backend] Module loaded successfully');
      
      // 서버가 준비될 때까지 대기
      const checkServer = setInterval(() => {
        http.get(`http://localhost:${BACKEND_PORT}/api/health`, (res) => {
          if (res.statusCode === 200) {
            clearInterval(checkServer);
            process.chdir(originalCwd); // 작업 디렉토리 복원
            console.log('[Backend] Server is ready!');
            resolve();
          }
        }).on('error', () => {
          // 아직 준비 안됨, 계속 대기
        });
      }, 500);

      // 타임아웃 (30초)
      setTimeout(() => {
        clearInterval(checkServer);
        process.chdir(originalCwd); // 작업 디렉토리 복원
        reject(new Error('Backend startup timeout'));
      }, 30000);
      
    } catch (err) {
      process.chdir(originalCwd);
      console.error('[Backend] Failed to load:', err);
      reject(err);
    }
  });
}

/**
 * Frontend 정적 파일 서빙 (serve 대신 간단한 http 서버)
 */
function startFrontend() {
  return new Promise((resolve, reject) => {
    const express = require('express');
    const frontendApp = express();
    
    // extraResources 경로 사용
    const buildPath = isDev
      ? path.join(__dirname, '..', 'frontend', 'build')
      : path.join(process.resourcesPath, 'frontend', 'build');
    
    console.log('[Frontend] Serving from:', buildPath);
    
    // 정적 파일 서빙
    frontendApp.use(express.static(buildPath));
    
    // SPA를 위한 fallback (Express 5.x 호환)
    frontendApp.get('/{*path}', (req, res) => {
      res.sendFile(path.join(buildPath, 'index.html'));
    });
    
    frontendServer = frontendApp.listen(FRONTEND_PORT, () => {
      console.log('[Frontend] Server is ready on port', FRONTEND_PORT);
      resolve();
    });

    frontendServer.on('error', (err) => {
      console.error('[Frontend] Server error:', err);
      reject(err);
    });
  });
}

/**
 * 메인 윈도우 생성
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    title: 'TheZonePOS',
    frame: false,  // 타이틀바 숨기기 (접기, 줄이기, 닫기 버튼 제거)
    kiosk: true  // 완전한 전체화면 모드 (taskbar 숨김)
  });

  // POS 페이지 로드
  mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 외부 링크는 기본 브라우저로 열기
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 개발자 도구 단축키 (F12)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * IPC 이벤트 핸들러 설정
 */
function setupIpcHandlers() {
  // 앱 종료
  ipcMain.on('app-quit', () => {
    app.quit();
  });

  // 창 최소화 (Go to Windows)
  ipcMain.on('window-minimize', () => {
    if (mainWindow) {
      mainWindow.minimize();
    }
  });

  // 창 최대화/복원
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  // 앱 버전 조회
  ipcMain.handle('get-version', () => {
    return APP_VERSION;
  });
}

/**
 * 메뉴 생성
 */
function createMenu() {
  const template = [
    {
      label: 'TheZonePOS',
      submenu: [
        { label: 'About', click: showAbout },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'Ctrl+R', click: () => mainWindow?.reload() },
        { label: 'Toggle Fullscreen', accelerator: 'F11', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * About 다이얼로그
 */
function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About TheZonePOS',
    message: 'TheZonePOS - Restaurant POS System',
    detail: `Version: ${app.getVersion()}\n\nA modern POS system for restaurants.\n\n© 2024 TheZonePOS`
  });
}

/**
 * 스플래시 스크린 (로딩 중 표시)
 */
function createSplash() {
  const splash = new BrowserWindow({
    width: 400,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // 로고 이미지 경로
  const logoPath = path.join(__dirname, 'assets', 'icon.png').replace(/\\/g, '/');

  splash.loadURL(`data:text/html,
    <html>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#1e3a5f,#2d5a87);border-radius:20px;font-family:Arial;">
        <div style="text-align:center;color:white;">
          <img src="file:///${logoPath}" style="width:80px;height:80px;object-fit:contain;margin-bottom:15px;" onerror="this.style.display='none'"/>
          <h1 style="font-size:28px;margin:0 0 10px 0;">TheZonePOS</h1>
          <p style="font-size:14px;opacity:0.8;">Starting servers...</p>
          <div style="margin-top:20px;width:200px;height:4px;background:rgba(255,255,255,0.3);border-radius:2px;">
            <div style="width:0%;height:100%;background:white;border-radius:2px;animation:loading 2s ease-in-out infinite;"></div>
          </div>
        </div>
        <style>
          @keyframes loading {
            0% { width: 0%; }
            50% { width: 70%; }
            100% { width: 100%; }
          }
        </style>
      </body>
    </html>
  `);

  return splash;
}

/**
 * 앱 시작
 */
let isStartingApp = false;  // 중복 실행 방지 플래그

async function startApp() {
  // 이미 시작 중이면 무시
  if (isStartingApp) {
    console.log('[App] startApp() already running, skipping...');
    return;
  }
  isStartingApp = true;
  
  const splash = createSplash();

  try {
    // Backend 시작
    await startBackend();
    
    // Frontend 시작
    await startFrontend();
    
    // 스플래시 닫기
    splash.close();
    
    // 🔄 업데이트 확인 (Backend가 준비된 후)
    console.log('[App] Checking for updates...');
    try {
      const updated = await runUpdateProcess();
      if (updated) {
        // 업데이트 후 재시작되면 여기서 종료됨
        return;
      }
    } catch (updateError) {
      console.log('[App] Update check skipped:', updateError.message);
      // 업데이트 실패해도 앱은 계속 실행
    }
    
    // 메인 윈도우 생성
    createWindow();
    createMenu();
    setupIpcHandlers();
    
    // 앱 시작 완료
    isAppStarting = false;
    console.log('[App] Startup complete!');
    
  } catch (error) {
    console.error('[App] Startup error:', error);
    splash.close();
    isStartingApp = false;  // 오류 시 플래그 리셋
    
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start TheZonePOS:\n\n${error.message}\n\nPlease restart the application.`
    );
    
    app.quit();
  }
}

/**
 * 앱 종료 시 정리
 */
function cleanup() {
  console.log('[App] Cleaning up...');
  
  // Frontend 서버 종료
  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
  }
  
  // Backend는 같은 프로세스에서 실행되므로 앱 종료 시 자동으로 종료됨
}

// ==================== 앱 생명주기 ====================

app.whenReady().then(startApp);

// 앱 시작 중 플래그 (splash 닫힐 때 종료 방지)
let isAppStarting = true;

app.on('window-all-closed', () => {
  // 앱 시작 중이면 종료하지 않음
  if (isAppStarting) {
    console.log('[App] Ignoring window-all-closed during startup');
    return;
  }
  
  cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    startApp();
  }
});

app.on('before-quit', cleanup);

// 예외 처리
process.on('uncaughtException', (error) => {
  console.error('[App] Uncaught exception:', error);
});
