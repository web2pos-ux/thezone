/**
 * TheZonePOS - Restaurant POS System
 * Electron Main Process
 * 
 * 이 앱은 백엔드 서버와 프론트엔드를 통합하여
 * 하나의 Windows 데스크톱 앱으로 실행합니다.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

// 개발 모드 확인
const isDev = !app.isPackaged;

// 포트 설정
const BACKEND_PORT = 3177;
const FRONTEND_PORT = 3000;

let mainWindow;
let backendProcess = null;
let splashWindow = null;

// 앱 경로 설정
function getAppPaths() {
  if (isDev) {
    return {
      backend: path.join(__dirname, '..', 'backend'),
      frontend: path.join(__dirname, '..', 'frontend', 'build'),
      db: path.join(__dirname, '..', 'db'),
    };
  } else {
    // 패키징된 앱 - extraResources에서 백엔드 실행
    const resourcesPath = process.resourcesPath;
    return {
      backend: path.join(resourcesPath, 'backend'),
      frontend: path.join(resourcesPath, 'app.asar', 'frontend-build'),
      db: path.join(resourcesPath, 'db'),
    };
  }
}

// 스플래시 화면 생성
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  splashWindow.loadURL(`data:text/html;charset=utf-8,
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: white;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          border-radius: 12px;
        }
        h1 {
          font-size: 36px;
          margin-bottom: 10px;
          background: linear-gradient(90deg, #4facfe, #00f2fe);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .loading {
          font-size: 14px;
          color: #888;
          margin-top: 20px;
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #333;
          border-top: 3px solid #4facfe;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-top: 30px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <h1>TheZonePOS</h1>
      <p style="color:#aaa;font-size:14px;">Restaurant POS System</p>
      <div class="spinner"></div>
      <p class="loading" id="status">Starting server...</p>
    </body>
    </html>
  `);
}

// 백엔드 서버 시작
function startBackend() {
  return new Promise((resolve, reject) => {
    const paths = getAppPaths();
    
    console.log('[Backend] Starting server...');
    console.log('[Backend] Path:', paths.backend);
    
    // Node.js 실행 경로 (패키징 시 extraResources에서 node.exe 사용)
    const nodePath = isDev ? 'node' : path.join(process.resourcesPath, 'node.exe');
    console.log('[Backend] Node path:', nodePath);
    const serverPath = path.join(paths.backend, 'index.js');
    
    // 환경 변수 설정
    const env = {
      ...process.env,
      PORT: BACKEND_PORT.toString(),
      NODE_ENV: isDev ? 'development' : 'production',
      DB_PATH: path.join(paths.db, 'web2pos.db'),
    };

    // 개발 모드에서는 이미 실행 중인 서버 사용
    if (isDev) {
      checkServerReady(BACKEND_PORT, 30)
        .then(() => {
          console.log('[Backend] Using existing dev server');
          resolve();
        })
        .catch(() => {
          // 서버가 없으면 시작
          backendProcess = spawn('node', ['index.js'], {
            cwd: paths.backend,
            env,
            stdio: 'pipe',
          });

          backendProcess.stdout.on('data', (data) => {
            console.log(`[Backend] ${data.toString().trim()}`);
          });

          backendProcess.stderr.on('data', (data) => {
            console.error(`[Backend Error] ${data.toString().trim()}`);
          });

          backendProcess.on('close', (code) => {
            console.log(`[Backend] Server exited with code ${code}`);
          });

          // 서버 시작 대기
          checkServerReady(BACKEND_PORT, 30)
            .then(resolve)
            .catch(reject);
        });
    } else {
      // 프로덕션 모드: 번들된 백엔드 시작 (포함된 node.exe 사용)
      console.log('[Backend] Starting with bundled Node.js:', nodePath);
      backendProcess = spawn(nodePath, [serverPath], {
        cwd: paths.backend,
        env,
        stdio: 'pipe',
        windowsHide: true,
      });

      backendProcess.stdout.on('data', (data) => {
        console.log(`[Backend] ${data.toString().trim()}`);
      });

      backendProcess.stderr.on('data', (data) => {
        console.error(`[Backend Error] ${data.toString().trim()}`);
      });

      backendProcess.on('close', (code) => {
        console.log(`[Backend] Server exited with code ${code}`);
        if (code !== 0 && code !== null) {
          dialog.showErrorBox('Server Error', 'Backend server crashed. Please restart the application.');
        }
      });

      // 서버 시작 대기
      checkServerReady(BACKEND_PORT, 30)
        .then(resolve)
        .catch(reject);
    }
  });
}

// 서버 준비 상태 확인
function checkServerReady(port, maxAttempts) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      attempts++;
      
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/api/health',
        method: 'GET',
        timeout: 1000,
      }, (res) => {
        if (res.statusCode === 200) {
          console.log(`[Server] Ready on port ${port}`);
          resolve();
        } else {
          retry();
        }
      });

      req.on('error', () => {
        retry();
      });

      req.on('timeout', () => {
        req.destroy();
        retry();
      });

      req.end();
    };

    const retry = () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`Server not ready after ${maxAttempts} attempts`));
      } else {
        setTimeout(check, 1000);
      }
    };

    check();
  });
}

// 메인 윈도우 생성
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
    autoHideMenuBar: true,
    fullscreen: true,           // 전체화면 모드
    fullscreenable: true,       // F11로 전체화면 토글 가능
  });

  // 개발 모드: localhost:3000
  // 프로덕션: localhost:3177 (백엔드가 프론트엔드 서빙)
  const url = isDev
    ? `http://localhost:${FRONTEND_PORT}`
    : `http://localhost:${BACKEND_PORT}`;

  console.log('[App] Loading URL:', url);
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.maximize();
    
    // 화면 크기에 맞게 자동 줌 조절
    autoFitZoom();
  });
  
  // 화면 크기 변경 시 자동 줌 조절
  mainWindow.on('resize', () => {
    autoFitZoom();
  });
  
  // 화면 크기에 맞게 자동 줌 계산
  function autoFitZoom() {
    if (!mainWindow) return;
    const { width, height } = mainWindow.getContentBounds();
    // 기준 해상도: 1920x1080 (100% 줌)
    const baseWidth = 1920;
    const baseHeight = 1080;
    
    // 너비와 높이 중 작은 비율로 줌 계산
    const zoomWidth = width / baseWidth;
    const zoomHeight = height / baseHeight;
    const zoomFactor = Math.min(zoomWidth, zoomHeight, 1.5); // 최대 150%
    
    mainWindow.webContents.setZoomFactor(Math.max(0.5, zoomFactor)); // 최소 50%
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 외부 링크는 기본 브라우저에서 열기
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 메뉴 설정
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit', label: 'Exit TheZonePOS' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About TheZonePOS',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About TheZonePOS',
              message: 'TheZonePOS',
              detail: `Version: ${app.getVersion()}\n\nRestaurant POS System\n\n© 2024-2026 TheZone`
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow?.webContents.toggleDevTools();
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 앱 시작
async function startApp() {
  try {
    createSplashWindow();
    createMenu();
    
    await startBackend();
    createMainWindow();
  } catch (error) {
    console.error('[App] Startup error:', error);
    dialog.showErrorBox('Startup Error', `Failed to start the application:\n\n${error.message}`);
    app.quit();
  }
}

// 앱 종료 시 백엔드 프로세스 정리
function cleanupBackend() {
  if (backendProcess) {
    console.log('[Backend] Stopping server...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ==================== 앱 생명주기 ====================

app.whenReady().then(startApp);

app.on('window-all-closed', () => {
  cleanupBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  cleanupBackend();
});

// 예외 처리
process.on('uncaughtException', (error) => {
  console.error('[App] Uncaught exception:', error);
  cleanupBackend();
});
