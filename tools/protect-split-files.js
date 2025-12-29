#!/usr/bin/env node

const { execSync } = require('child_process');

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

const protectedGroups = [
  {
    key: 'split',
    label: 'Split Order',
    env: 'ALLOW_SPLIT_EDITS',
    files: [
      'frontend/src/hooks/useOrderManagement.ts',
      'frontend/src/pages/OrderPage.tsx',
    ],
  },
  {
    key: 'vkeyboard',
    label: 'Virtual Keyboard Module',
    env: 'ALLOW_VKEY_EDITS',
    files: [
      'frontend/src/components/order/VirtualKeyboard.tsx',
    ],
  },
];

function printBlockMessage(group, changedFiles) {
  console.error(`\n[protect-${group.key}] Commit blocked: ${group.label} 보호 파일이 수정되었습니다.`);
  console.error('보호 파일:');
  changedFiles.forEach(f => console.error('- ' + f));
  console.error('\n수정하려면 다음 중 하나를 수행하세요:');
  console.error(`1) 일시적으로 허용: 환경변수 ${group.env}=1 를 설정하고 커밋 (권장하지 않음)`);
  console.error(`   예) PowerShell:  $env:${group.env}='1'; git commit -m "..."; Remove-Item Env:${group.env}`);
  console.error(`   예) Bash:        ${group.env}=1 git commit -m "..."`);
  console.error('2) 별도 브랜치에서 PR로 변경하고 리뷰 필수 설정 사용 (권장)');
  console.error('3) 정말 필요한 경우에만 후킹을 수동으로 비활성화');
}

function main() {
  const staged = getStagedFiles().map(p => p.replace(/\\/g, '/'));
  let blocked = false;

  for (const group of protectedGroups) {
    const changed = group.files.filter(p => staged.includes(p));
    if (changed.length === 0) continue;

    const allowEnv = String(process.env[group.env] || '').trim();
    if (allowEnv === '1') {
      console.log(`[protect-${group.key}] Warning: ${group.label} 보호 파일이 수정되었지만 ${group.env}=1 이 설정되어 있어 계속 진행합니다.`);
      continue;
    }

    blocked = true;
    printBlockMessage(group, changed);
  }

  if (blocked) {
    process.exit(1);
  }
}

main();