#!/usr/bin/env node
/**
 * TheZonePOS 빌드 후 실행 런처
 * build.bat 실행 → pos-desktop 앱 실행
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname);
const DESKTOP_DIR = path.join(ROOT, 'pos-desktop');
const BUILD_BAT = path.join(DESKTOP_DIR, 'build.bat');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function log(msg, tag = '') {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${tag ? `[${tag}] ` : ''}${msg}`);
}

function runBuild() {
  return new Promise((resolve, reject) => {
    log('프로젝트 빌드 중... (Frontend, Backend, DB 준비)', 'Build');
    const p = spawn('cmd', ['/c', BUILD_BAT], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true
    });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`빌드 실패 (코드: ${code})`));
    });
  });
}

function runApp() {
  return new Promise((resolve, reject) => {
    log('TheZonePOS 앱 실행...', 'App');
    const p = spawn(npmCmd, ['run', 'start'], {
      cwd: DESKTOP_DIR,
      stdio: 'inherit',
      shell: true
    });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`앱 종료 (코드: ${code})`));
    });
  });
}

async function main() {
  console.log('');
  console.log('================================================');
  console.log('  TheZonePOS - 빌드 후 실행');
  console.log('================================================');
  console.log('');

  if (!fs.existsSync(BUILD_BAT)) {
    console.error('[오류] build.bat을 찾을 수 없습니다:', BUILD_BAT);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(DESKTOP_DIR, 'node_modules'))) {
    log('pos-desktop 의존성 설치 중...', '설치');
    await new Promise((resolve, reject) => {
      const p = spawn(npmCmd, ['install'], {
        cwd: DESKTOP_DIR,
        stdio: 'inherit',
        shell: true
      });
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('npm install 실패'));
      });
    });
  }

  try {
    await runBuild();
    console.log('');
    await runApp();
  } catch (err) {
    console.error('');
    console.error('[오류]', err.message);
    process.exit(1);
  }
}

main();
