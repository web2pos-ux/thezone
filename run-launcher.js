#!/usr/bin/env node
/**
 * TheZonePOS 개발 모드 실행 런처
 * Backend, Frontend, POS Desktop을 순차적으로 시작
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname);
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const DESKTOP_DIR = path.join(ROOT, 'pos-desktop');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const nodeCmd = isWin ? 'node.exe' : 'node';

const processes = [];

function log(msg, tag = '') {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${tag ? `[${tag}] ` : ''}${msg}`);
}

async function ensureDeps() {
  const dirs = [
    { dir: FRONTEND_DIR, name: 'Frontend' },
    { dir: BACKEND_DIR, name: 'Backend' },
    { dir: DESKTOP_DIR, name: 'pos-desktop' }
  ];
  for (const { dir, name } of dirs) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      log(`${name} 의존성 설치 중...`, '설치');
      await new Promise((resolve, reject) => {
        const p = spawn(npmCmd, ['install'], {
          cwd: dir,
          stdio: 'inherit',
          shell: true
        });
        p.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${name} npm install failed (${code})`));
        });
      });
    }
  }
}

function spawnProcess(name, cmd, args, cwd, delay = 0) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: process.platform !== 'win32'
    });
    processes.push(p);
    p.stdout?.on('data', (d) => process.stdout.write(d));
    p.stderr?.on('data', (d) => process.stderr.write(d));
    p.on('error', (err) => log(`${name} 오류: ${err.message}`, 'error'));
    p.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        log(`${name} 종료 (코드: ${code})`, 'error');
      }
    });
    setTimeout(() => resolve(p), delay);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('');
  console.log('================================================');
  console.log('  TheZonePOS - 개발 모드 실행');
  console.log('================================================');
  console.log('');

  try {
    await ensureDeps();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(ROOT, 'db'))) {
    fs.mkdirSync(path.join(ROOT, 'db'), { recursive: true });
  }
  if (!fs.existsSync(path.join(ROOT, 'db', 'web2pos.db'))) {
    log('db/web2pos.db 가 없습니다. 빈 DB가 필요하면 backend/scripts/create-empty-db-for-build.js 를 실행하세요.', '경고');
  }

  log('[1/3] Backend 시작 (포트 3177)...', 'Backend');
  await spawnProcess('Backend', nodeCmd, ['index.js'], BACKEND_DIR);
  await delay(3000);

  log('[2/3] Frontend 시작 (포트 3088)...', 'Frontend');
  await spawnProcess('Frontend', npmCmd, ['run', 'start'], FRONTEND_DIR);
  await delay(8000);

  log('[3/3] TheZonePOS 데스크톱 앱 실행...', 'Desktop');
  await spawnProcess('Desktop', npmCmd, ['run', 'start'], DESKTOP_DIR);

  console.log('');
  console.log('================================================');
  console.log('  실행 완료!');
  console.log('  - Backend:  http://localhost:3177');
  console.log('  - Frontend: http://localhost:3088');
  console.log('  - POS 앱이 곧 열립니다.');
  console.log('  종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.');
  console.log('================================================');
  console.log('');

  process.on('SIGINT', () => {
    log('종료 중...', '');
    processes.forEach((p) => {
      try {
        p.kill('SIGTERM');
        if (p.pid) process.kill(-p.pid, 'SIGTERM');
      } catch (_) {}
    });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
