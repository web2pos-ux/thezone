const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

/**
 * Windows 시스템에 설치된 프린터 목록을 가져옵니다.
 * @returns {Promise<Array>} 프린터 목록 배열
 */
async function getWindowsPrinters() {
  try {
    // PowerShell 명령어로 프린터 목록 가져오기
    const { stdout } = await execAsync('powershell "Get-Printer | Select-Object Name, DriverName, PortName, ShareName | ConvertTo-Json"');
    
    if (!stdout.trim()) {
      return [];
    }

    let printers = JSON.parse(stdout);
    
    // 단일 프린터인 경우 배열로 변환
    if (!Array.isArray(printers)) {
      printers = [printers];
    }

    // 프린터 정보 정리
    return printers.map(printer => ({
      name: printer.Name,
      driver: printer.DriverName,
      port: printer.PortName,
      share: printer.ShareName,
      // IP 주소 추출 시도 (TCP/IP 포트인 경우)
      ip_address: extractIPFromPort(printer.PortName)
    }));

  } catch (error) {
    console.error('Failed to get Windows printers:', error);
    return [];
  }
}

/**
 * 포트 이름에서 IP 주소를 추출합니다.
 * @param {string} portName - 포트 이름
 * @returns {string|null} IP 주소 또는 null
 */
function extractIPFromPort(portName) {
  if (!portName) return null;
  
  // TCP/IP 포트 패턴 매칭
  const ipPattern = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
  const match = portName.match(ipPattern);
  
  return match ? match[1] : null;
}

module.exports = {
  getWindowsPrinters,
  extractIPFromPort
}; 