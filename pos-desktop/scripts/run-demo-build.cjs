/**
 * Run demo packaging via cmd.exe (avoids PowerShell breaking %VAR% in nested .bat).
 * From repo root: node pos-desktop/scripts/run-demo-build.cjs
 * From pos-desktop: node scripts/run-demo-build.cjs
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const cmd = process.env.ComSpec || 'cmd.exe';

const result = spawnSync(
  cmd,
  ['/d', '/s', '/c', 'call build-demo-executable.bat'],
  {
    cwd: desktopDir,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  }
);

const code = typeof result.status === 'number' ? result.status : 1;
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(code);
