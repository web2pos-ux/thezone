const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function getWindowsPrinters() {
  try {
    // Use PowerShell to get printers
    const { stdout } = await execPromise('powershell -command "Get-Printer | Select-Object Name, Default | ConvertTo-Json"');
    
    if (!stdout.trim()) {
      return [];
    }
    
    let printers = JSON.parse(stdout);
    
    // If single printer, wrap in array
    if (!Array.isArray(printers)) {
      printers = [printers];
    }
    
    return printers.map(p => ({
      name: p.Name,
      isDefault: p.Default || false
    }));
  } catch (error) {
    console.error('PowerShell error:', error.message);
    
    // Fallback to wmic
    try {
      const { stdout } = await execPromise('wmic printer get name');
      const lines = stdout.split('\n').filter(line => line.trim() && line.trim() !== 'Name');
      return lines.map(name => ({ name: name.trim(), isDefault: false }));
    } catch (wmicError) {
      console.error('WMIC error:', wmicError.message);
      return [];
    }
  }
}

async function test() {
  console.log('=== Windows 시스템 프린터 목록 ===\n');
  const printers = await getWindowsPrinters();
  
  if (printers.length === 0) {
    console.log('설치된 프린터가 없습니다.');
  } else {
    printers.forEach((p, i) => {
      console.log(`${i + 1}. ${p.name}${p.isDefault ? ' (기본 프린터)' : ''}`);
    });
  }
  console.log(`\n총 ${printers.length}개의 프린터 발견`);
}

test();
