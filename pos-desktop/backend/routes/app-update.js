/**
 * WEB2POS App Update API
 * 앱 업데이트 확인 및 다운로드 제공
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// 현재 버전 정보 파일 경로 (환경 변수 CONFIG_PATH 사용, 빌드된 앱 호환)
const CONFIG_DIR = process.env.CONFIG_PATH || path.join(__dirname, '..');
const VERSION_FILE = path.join(CONFIG_DIR, 'app-version.json');
const UPDATE_DIR = path.join(CONFIG_DIR, 'updates');
console.log('[App Update] Config directory:', CONFIG_DIR);

// 버전 정보 초기화
function initVersionFile() {
  // config 폴더 생성
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(VERSION_FILE)) {
    const defaultVersion = {
      version: "1.0.0",
      releaseDate: new Date().toISOString(),
      releaseNotes: "Initial release",
      downloadUrl: null,
      mandatory: false
    };
    fs.writeFileSync(VERSION_FILE, JSON.stringify(defaultVersion, null, 2));
  }
  
  // updates 폴더 생성
  if (!fs.existsSync(UPDATE_DIR)) {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
  }
}

initVersionFile();

/**
 * GET /api/app-update/check
 * 업데이트 확인
 */
router.get('/check', (req, res) => {
  try {
    const { currentVersion } = req.query;
    
    // 서버의 최신 버전 정보 읽기
    const versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    
    // 버전 비교
    const hasUpdate = compareVersions(versionData.version, currentVersion) > 0;
    
    res.json({
      success: true,
      hasUpdate,
      currentVersion: currentVersion || '0.0.0',
      latestVersion: versionData.version,
      releaseDate: versionData.releaseDate,
      releaseNotes: versionData.releaseNotes,
      downloadUrl: hasUpdate ? `/api/app-update/download` : null,
      mandatory: versionData.mandatory || false,
      fileSize: versionData.fileSize || null
    });
  } catch (error) {
    console.error('Update check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/app-update/download
 * 업데이트 파일 다운로드 (build.zip)
 */
router.get('/download', (req, res) => {
  try {
    const updateFile = path.join(UPDATE_DIR, 'build.zip');
    
    if (!fs.existsSync(updateFile)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Update file not found. Please contact administrator.' 
      });
    }
    
    const stat = fs.statSync(updateFile);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', 'attachment; filename=build.zip');
    
    const readStream = fs.createReadStream(updateFile);
    readStream.pipe(res);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/app-update/publish
 * 새 버전 배포 (관리자용)
 */
router.post('/publish', (req, res) => {
  try {
    const { version, releaseNotes, mandatory } = req.body;
    
    if (!version) {
      return res.status(400).json({ success: false, error: 'Version is required' });
    }
    
    // 버전 정보 업데이트
    const versionData = {
      version,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || `Version ${version}`,
      mandatory: mandatory || false
    };
    
    // build.zip 파일 크기 확인
    const updateFile = path.join(UPDATE_DIR, 'build.zip');
    if (fs.existsSync(updateFile)) {
      const stat = fs.statSync(updateFile);
      versionData.fileSize = stat.size;
    }
    
    fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2));
    
    res.json({ 
      success: true, 
      message: `Version ${version} published successfully`,
      data: versionData
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/app-update/version
 * 현재 서버 버전 정보
 */
router.get('/version', (req, res) => {
  try {
    const versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    res.json({ success: true, data: versionData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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

module.exports = router;
