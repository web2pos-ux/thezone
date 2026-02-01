/**
 * 시리얼(COM 포트) 프린터 유틸리티
 * ESC/POS 영수증 프린터용 시리얼 통신 지원
 */

const { SerialPort } = require('serialport');

// 기본 시리얼 포트 설정
const DEFAULT_BAUD_RATE = 9600;
const DEFAULT_DATA_BITS = 8;
const DEFAULT_STOP_BITS = 1;
const DEFAULT_PARITY = 'none';

/**
 * 시스템의 사용 가능한 시리얼 포트 목록을 가져옵니다.
 * @returns {Promise<Array>} 시리얼 포트 목록
 */
async function getSerialPorts() {
  try {
    const ports = await SerialPort.list();
    
    // 프린터로 사용 가능한 포트만 필터링 (COM 포트)
    return ports.map(port => ({
      path: port.path,                    // COM1, COM2, etc.
      manufacturer: port.manufacturer || 'Unknown',
      serialNumber: port.serialNumber || '',
      vendorId: port.vendorId || '',
      productId: port.productId || '',
      pnpId: port.pnpId || '',
      // 프린터 친화적인 표시 이름
      displayName: `${port.path}${port.manufacturer ? ` (${port.manufacturer})` : ''}`
    }));
  } catch (error) {
    console.error('[Serial] Failed to list ports:', error.message);
    return [];
  }
}

/**
 * 시리얼 포트가 유효한지 확인합니다.
 * @param {string} portPath - 포트 경로 (예: COM1)
 * @returns {Promise<boolean>} 유효 여부
 */
async function isPortAvailable(portPath) {
  try {
    const ports = await SerialPort.list();
    return ports.some(p => p.path === portPath);
  } catch {
    return false;
  }
}

/**
 * 시리얼 포트로 데이터를 전송합니다.
 * @param {string} portPath - 포트 경로 (예: COM1)
 * @param {Buffer|string} data - 전송할 데이터 (ESC/POS 명령 등)
 * @param {Object} options - 시리얼 포트 옵션
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendToSerialPort(portPath, data, options = {}) {
  return new Promise((resolve, reject) => {
    const portConfig = {
      path: portPath,
      baudRate: options.baudRate || DEFAULT_BAUD_RATE,
      dataBits: options.dataBits || DEFAULT_DATA_BITS,
      stopBits: options.stopBits || DEFAULT_STOP_BITS,
      parity: options.parity || DEFAULT_PARITY,
      autoOpen: false
    };

    const port = new SerialPort(portConfig);

    // 에러 핸들링
    port.on('error', (err) => {
      console.error(`[Serial] Port ${portPath} error:`, err.message);
      reject(err);
    });

    // 포트 열기
    port.open((err) => {
      if (err) {
        console.error(`[Serial] Failed to open ${portPath}:`, err.message);
        reject(err);
        return;
      }

      console.log(`[Serial] Port ${portPath} opened successfully`);

      // 데이터 전송
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
      
      port.write(buffer, (writeErr) => {
        if (writeErr) {
          console.error(`[Serial] Write error on ${portPath}:`, writeErr.message);
          port.close();
          reject(writeErr);
          return;
        }

        // 데이터 전송 완료 대기
        port.drain((drainErr) => {
          if (drainErr) {
            console.error(`[Serial] Drain error on ${portPath}:`, drainErr.message);
          }

          // 포트 닫기
          port.close((closeErr) => {
            if (closeErr) {
              console.error(`[Serial] Close error on ${portPath}:`, closeErr.message);
            }
            console.log(`[Serial] Data sent to ${portPath} successfully`);
            resolve(true);
          });
        });
      });
    });

    // 타임아웃 설정 (10초)
    setTimeout(() => {
      if (port.isOpen) {
        port.close();
      }
      reject(new Error('Serial port operation timed out'));
    }, 10000);
  });
}

/**
 * ESC/POS 명령을 시리얼 포트로 출력합니다.
 * @param {string} portPath - 포트 경로 (예: COM1)
 * @param {Object} printData - 출력 데이터
 * @param {Object} options - 시리얼 포트 옵션
 * @returns {Promise<boolean>} 출력 성공 여부
 */
async function printToSerialPrinter(portPath, printData, options = {}) {
  try {
    // ESC/POS 명령 생성
    const escPosBuffer = buildEscPosCommands(printData);
    
    // 시리얼 포트로 전송
    await sendToSerialPort(portPath, escPosBuffer, options);
    
    return true;
  } catch (error) {
    console.error(`[Serial] Print failed on ${portPath}:`, error.message);
    throw error;
  }
}

/**
 * ESC/POS 명령을 생성합니다.
 * @param {Object} data - 출력 데이터
 * @returns {Buffer} ESC/POS 명령 버퍼
 */
function buildEscPosCommands(data) {
  const commands = [];
  
  // ESC/POS 명령어 상수
  const ESC = 0x1B;
  const GS = 0x1D;
  const LF = 0x0A;
  
  // 초기화
  commands.push(ESC, 0x40); // ESC @ - 프린터 초기화
  
  // 문자 설정 (한글 지원)
  commands.push(ESC, 0x74, 0x12); // ESC t 18 - 한글 코드 페이지 (CP949/EUC-KR)
  
  // 제목 출력 (굵게, 중앙 정렬)
  if (data.title) {
    commands.push(ESC, 0x61, 0x01); // ESC a 1 - 중앙 정렬
    commands.push(ESC, 0x45, 0x01); // ESC E 1 - 강조 ON
    commands.push(GS, 0x21, 0x11); // GS ! 17 - 2배 크기
    commands.push(...Buffer.from(data.title, 'euc-kr'));
    commands.push(LF);
    commands.push(GS, 0x21, 0x00); // GS ! 0 - 기본 크기
    commands.push(ESC, 0x45, 0x00); // ESC E 0 - 강조 OFF
    commands.push(ESC, 0x61, 0x00); // ESC a 0 - 왼쪽 정렬
  }
  
  // 구분선
  commands.push(...Buffer.from('--------------------------------', 'ascii'));
  commands.push(LF);
  
  // 주문 정보
  if (data.orderInfo) {
    const info = data.orderInfo;
    if (info.orderNumber) {
      commands.push(...Buffer.from(`Order #: ${info.orderNumber}`, 'ascii'));
      commands.push(LF);
    }
    if (info.tableName) {
      commands.push(...Buffer.from(`Table: ${info.tableName}`, 'ascii'));
      commands.push(LF);
    }
    if (info.time) {
      commands.push(...Buffer.from(`Time: ${info.time}`, 'ascii'));
      commands.push(LF);
    }
    commands.push(...Buffer.from('--------------------------------', 'ascii'));
    commands.push(LF);
  }
  
  // 아이템 목록
  if (data.items && Array.isArray(data.items)) {
    data.items.forEach(item => {
      const qty = item.quantity || 1;
      const name = item.name || '';
      const line = `${qty}x ${name}`;
      
      try {
        commands.push(...Buffer.from(line, 'euc-kr'));
      } catch {
        commands.push(...Buffer.from(line, 'ascii'));
      }
      commands.push(LF);
      
      // 모디파이어
      if (item.modifiers && Array.isArray(item.modifiers)) {
        item.modifiers.forEach(mod => {
          const modLine = `   + ${mod.name || mod}`;
          try {
            commands.push(...Buffer.from(modLine, 'euc-kr'));
          } catch {
            commands.push(...Buffer.from(modLine, 'ascii'));
          }
          commands.push(LF);
        });
      }
      
      // 메모
      if (item.memo) {
        const memoLine = `   [${item.memo}]`;
        try {
          commands.push(...Buffer.from(memoLine, 'euc-kr'));
        } catch {
          commands.push(...Buffer.from(memoLine, 'ascii'));
        }
        commands.push(LF);
      }
    });
  }
  
  // 금액 정보 (영수증용)
  if (data.subtotal !== undefined) {
    commands.push(...Buffer.from('--------------------------------', 'ascii'));
    commands.push(LF);
    commands.push(...Buffer.from(`Subtotal: $${Number(data.subtotal).toFixed(2)}`, 'ascii'));
    commands.push(LF);
    
    if (data.taxLines && Array.isArray(data.taxLines)) {
      data.taxLines.forEach(tax => {
        commands.push(...Buffer.from(`${tax.name}: $${Number(tax.amount).toFixed(2)}`, 'ascii'));
        commands.push(LF);
      });
    }
    
    if (data.total !== undefined) {
      commands.push(ESC, 0x45, 0x01); // ESC E 1 - 강조 ON
      commands.push(...Buffer.from(`TOTAL: $${Number(data.total).toFixed(2)}`, 'ascii'));
      commands.push(LF);
      commands.push(ESC, 0x45, 0x00); // ESC E 0 - 강조 OFF
    }
  }
  
  // 푸터
  if (data.footer) {
    commands.push(...Buffer.from('--------------------------------', 'ascii'));
    commands.push(LF);
    commands.push(ESC, 0x61, 0x01); // 중앙 정렬
    try {
      commands.push(...Buffer.from(data.footer, 'euc-kr'));
    } catch {
      commands.push(...Buffer.from(data.footer, 'ascii'));
    }
    commands.push(LF);
    commands.push(ESC, 0x61, 0x00); // 왼쪽 정렬
  }
  
  // 여백 및 용지 컷
  commands.push(LF, LF, LF);
  commands.push(GS, 0x56, 0x41, 0x03); // GS V A 3 - 부분 컷 (3줄 여백)
  
  return Buffer.from(commands);
}

/**
 * 시리얼 포트 테스트 출력
 * @param {string} portPath - 포트 경로
 * @param {Object} options - 시리얼 포트 옵션
 * @returns {Promise<boolean>} 테스트 성공 여부
 */
async function testSerialPrinter(portPath, options = {}) {
  const testData = {
    title: 'PRINTER TEST',
    orderInfo: {
      time: new Date().toLocaleString()
    },
    items: [
      { name: 'Test Item 1', quantity: 1 },
      { name: 'Test Item 2', quantity: 2, modifiers: ['Extra Cheese'] }
    ],
    footer: 'Serial Printer Test Complete'
  };
  
  return printToSerialPrinter(portPath, testData, options);
}

/**
 * Cash Drawer 열기 (시리얼 연결)
 * @param {string} portPath - 포트 경로
 * @param {Object} options - 시리얼 포트 옵션
 * @returns {Promise<boolean>} 성공 여부
 */
async function openCashDrawerSerial(portPath, options = {}) {
  try {
    // Cash Drawer 열기 명령 (ESC/POS 표준)
    const drawerCommand = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]); // ESC p 0 25 250
    await sendToSerialPort(portPath, drawerCommand, options);
    return true;
  } catch (error) {
    console.error(`[Serial] Cash drawer open failed on ${portPath}:`, error.message);
    throw error;
  }
}

module.exports = {
  getSerialPorts,
  isPortAvailable,
  sendToSerialPort,
  printToSerialPrinter,
  buildEscPosCommands,
  testSerialPrinter,
  openCashDrawerSerial,
  DEFAULT_BAUD_RATE,
  DEFAULT_DATA_BITS,
  DEFAULT_STOP_BITS,
  DEFAULT_PARITY
};
