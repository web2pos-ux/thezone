/**
 * TheZonePOS Auto Updater
 * 앱 실행 시 자동으로 업데이트 확인
 * Firebase Hosting에서 업데이트 다운로드
 */

const { app, dialog, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 현재 앱 버전 (package.json에서 가져옴)
const APP_VERSION = require('./package.json').version;

// 업데이트 서버 URL (Firebase Hosting)
const UPDATE_SERVER = 'https://ezorder-platform.web.app';

/**
 * 업데이트 확인
 */
async function checkForUpdates() {
  return new Promise((resolve, reject) => {
    const url = `${UPDATE_SERVER}/version.json?t=${Date.now()}`;
    
    console.log('[Updater] Checking for updates...', url);
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const versionInfo = JSON.parse(data);
          const hasUpdate = compareVersions(versionInfo.version, APP_VERSION) > 0;
          
          console.log('[Updater] Current:', APP_VERSION, 'Latest:', versionInfo.version, 'HasUpdate:', hasUpdate);
          
          resolve({
            success: true,
            hasUpdate,
            currentVersion: APP_VERSION,
            latestVersion: versionInfo.version,
            releaseDate: versionInfo.releaseDate,
            releaseNotes: versionInfo.releaseNotes,
            downloadUrl: `${UPDATE_SERVER}${versionInfo.downloadUrl}`,
            mandatory: versionInfo.mandatory || false
          });
        } catch (error) {
          reject(new Error('Invalid response from update server'));
        }
      });
    }).on('error', (error) => {
      console.error('[Updater] Check error:', error.message);
      reject(error);
    });
  });
}

/**
 * 버전 비교 함수
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  if (!v1) return 1;
  if (!v2) return 1;
  
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  return 0;
}

/**
 * 업데이트 팝업 표시
 */
async function showUpdateDialog(updateInfo) {
  const { latestVersion, releaseNotes, releaseDate, mandatory } = updateInfo;
  
  const releaseStr = releaseDate || '';
  
  const message = `새로운 버전이 있습니다!\n\n` +
    `현재 버전: v${APP_VERSION}\n` +
    `새 버전: v${latestVersion}\n` +
    `배포일: ${releaseStr}\n\n` +
    `업데이트 내용:\n${releaseNotes || '버그 수정 및 기능 개선'}`;
  
  const buttons = mandatory 
    ? ['지금 업데이트'] 
    : ['나중에', '지금 업데이트'];
  
  const result = await dialog.showMessageBox({
    type: 'info',
    icon: null,
    title: '🔄 TheZonePOS 업데이트',
    message: '새로운 버전이 있습니다!',
    detail: message,
    buttons: buttons,
    defaultId: mandatory ? 0 : 1,
    cancelId: mandatory ? -1 : 0
  });
  
  const updateClicked = mandatory ? result.response === 0 : result.response === 1;
  
  return updateClicked;
}

/**
 * 업데이트 다운로드 진행률 표시 윈도우
 */
function createProgressWindow() {
  const progressWindow = new BrowserWindow({
    width: 400,
    height: 150,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true
    }
  });
  
  progressWindow.loadURL(`data:text/html,
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
          color: white;
          display: flex;
          flex-direction: column;
          justify-content: center;
          height: calc(100vh - 40px);
          border-radius: 10px;
        }
        h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
        }
        .progress-container {
          background: rgba(255,255,255,0.2);
          border-radius: 10px;
          height: 20px;
          overflow: hidden;
        }
        .progress-bar {
          background: linear-gradient(90deg, #4ade80 0%, #22c55e 100%);
          height: 100%;
          width: 0%;
          transition: width 0.3s ease;
          border-radius: 10px;
        }
        .status {
          margin-top: 10px;
          font-size: 12px;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <h3>🔄 업데이트 다운로드 중...</h3>
      <div class="progress-container">
        <div class="progress-bar" id="progress"></div>
      </div>
      <div class="status" id="status">준비 중...</div>
      <script>
        function updateProgress(percent, status) {
          document.getElementById('progress').style.width = percent + '%';
          document.getElementById('status').textContent = status;
        }
      </script>
    </body>
    </html>
  `);
  
  return progressWindow;
}

/**
 * 업데이트 파일 다운로드
 */
async function downloadUpdate(downloadUrl, progressWindow) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(app.getPath('temp'), 'thezonepos-update.zip');
    
    console.log('[Updater] Downloading from:', downloadUrl);
    console.log('[Updater] Saving to:', tempPath);
    
    const file = fs.createWriteStream(tempPath);
    
    https.get(downloadUrl, (res) => {
      // 리다이렉트 처리
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, (res2) => {
          handleDownload(res2);
        }).on('error', reject);
        return;
      }
      
      handleDownload(res);
      
      function handleDownload(response) {
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percent = totalSize ? Math.round((downloadedSize / totalSize) * 100) : 0;
          const downloaded = (downloadedSize / 1024 / 1024).toFixed(1);
          const total = totalSize ? (totalSize / 1024 / 1024).toFixed(1) : '?';
          
          if (progressWindow && !progressWindow.isDestroyed()) {
            progressWindow.webContents.executeJavaScript(
              `updateProgress(${percent}, '${downloaded}MB / ${total}MB (${percent}%)')`
            );
          }
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log('[Updater] Download complete:', tempPath);
          resolve(tempPath);
        });
      }
    }).on('error', (error) => {
      fs.unlink(tempPath, () => {});
      reject(error);
    });
  });
}

/**
 * 업데이트 설치 (frontend-build 폴더 교체)
 */
async function installUpdate(zipPath, progressWindow) {
  return new Promise((resolve, reject) => {
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.executeJavaScript(
        `updateProgress(100, '설치 중...')`
      );
    }
    
    // frontend-build 폴더 경로
    const isDev = !app.isPackaged;
    const buildPath = isDev
      ? path.join(__dirname, 'frontend-build')
      : path.join(process.resourcesPath, 'app', 'frontend-build');
    
    const backupPath = buildPath + '_backup_' + Date.now();
    
    console.log('[Updater] Installing to:', buildPath);
    
    try {
      // 1. 기존 frontend-build 폴더 백업
      if (fs.existsSync(buildPath)) {
        fs.renameSync(buildPath, backupPath);
        console.log('[Updater] Backed up old build to:', backupPath);
      }
      
      // 2. 새 폴더 생성
      fs.mkdirSync(buildPath, { recursive: true });
      
      // 3. ZIP 압축 해제 (PowerShell 사용)
      const command = `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${buildPath}' -Force"`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('[Updater] Extract error:', error);
          // 실패 시 백업 복원
          if (fs.existsSync(backupPath)) {
            if (fs.existsSync(buildPath)) {
              fs.rmSync(buildPath, { recursive: true, force: true });
            }
            fs.renameSync(backupPath, buildPath);
          }
          reject(error);
          return;
        }
        
        console.log('[Updater] Extract complete');
        
        // 4. 백업 폴더 삭제
        if (fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { recursive: true, force: true });
        }
        
        // 5. 임시 ZIP 파일 삭제
        fs.unlink(zipPath, () => {});
        
        resolve(true);
      });
    } catch (error) {
      // 실패 시 백업 복원
      if (fs.existsSync(backupPath) && !fs.existsSync(buildPath)) {
        fs.renameSync(backupPath, buildPath);
      }
      reject(error);
    }
  });
}

/**
 * 메인 업데이트 프로세스
 */
let isUpdateRunning = false;  // 중복 실행 방지

async function runUpdateProcess() {
  // 이미 실행 중이면 무시
  if (isUpdateRunning) {
    console.log('[Updater] Update process already running, skipping...');
    return false;
  }
  isUpdateRunning = true;
  
  try {
    // 1. 업데이트 확인
    const updateInfo = await checkForUpdates();
    
    if (!updateInfo.success) {
      console.log('[Updater] Check failed, skipping update');
      return false;
    }
    
    if (!updateInfo.hasUpdate) {
      console.log('[Updater] No updates available');
      return false;
    }
    
    // 2. 업데이트 팝업 표시
    const shouldUpdate = await showUpdateDialog(updateInfo);
    
    if (!shouldUpdate) {
      console.log('[Updater] User declined update');
      return false;
    }
    
    // 3. 진행률 윈도우 표시
    const progressWindow = createProgressWindow();
    
    try {
      // 4. 다운로드
      const zipPath = await downloadUpdate(updateInfo.downloadUrl, progressWindow);
      
      // 5. 설치
      await installUpdate(zipPath, progressWindow);
      
      // 6. 완료
      progressWindow.close();
      
      // 7. 재시작 확인
      const restartResult = await dialog.showMessageBox({
        type: 'info',
        title: '✅ 업데이트 완료',
        message: '업데이트가 완료되었습니다!',
        detail: `v${updateInfo.latestVersion}으로 업데이트되었습니다.\n변경사항을 적용하려면 앱을 재시작해야 합니다.`,
        buttons: ['지금 재시작', '나중에 재시작'],
        defaultId: 0
      });
      
      if (restartResult.response === 0) {
        app.relaunch();
        app.exit(0);
      }
      
      return true;
      
    } catch (error) {
      if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.close();
      }
      throw error;
    }
    
  } catch (error) {
    console.error('[Updater] Update process error:', error);
    isUpdateRunning = false;  // 오류 시 플래그 리셋
    return false;
  } finally {
    isUpdateRunning = false;  // 완료 시 플래그 리셋
  }
}

module.exports = {
  checkForUpdates,
  runUpdateProcess,
  APP_VERSION
};
