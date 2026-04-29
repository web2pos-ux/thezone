const { exec, execSync } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { splitStoredTetraRef, truncateForReceipt } = require('./tetraReceiptRefDisplay');

const execAsync = util.promisify(exec);

/**
 * Kitchen ticket footer: MM-DD-YY + spaces + 12h time (same string for TEXT + GRAPHIC footers).
 */
function formatKitchenTicketFooterDateTime(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const dateStr = `${mm}-${dd}-${yy}`;
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr}      ${timeStr}`;
}

/**
 * Windows Raw Printing API를 사용하여 ESC/POS 데이터 전송
 * RawPrinterHelper C# 클래스를 PowerShell에서 동적으로 생성하여 사용
 * @param {string} printerName - 프린터 이름
 * @param {Buffer} data - 전송할 바이너리 데이터
 */
async function sendRawToPrinter(printerName, data) {
  // 프린터 이름이 없으면 에러
  if (!printerName) {
    throw new Error('[RawPrint] ERROR: No printer name specified! Cannot send to default printer.');
  }
  
  // 프린터 이름에서 특수 문자 escape (PowerShell 안전)
  const safePrinterName = printerName.replace(/"/g, '`"').replace(/\$/g, '`$');
  
  // 바이트 배열을 PowerShell 형식으로 변환
  const bytesArray = Array.from(data).join(',');
  
  // PowerShell 스크립트 생성 (RawPrinterHelper 클래스 포함)
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes)
    {
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        bool bSuccess = false;

        di.pDocName = "Cash Drawer";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
                if (StartPagePrinter(hPrinter))
                {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    Int32 dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
"@ -ErrorAction SilentlyContinue

$bytes = [byte[]](${bytesArray})
$result = [RawPrinterHelper]::SendBytesToPrinter("${safePrinterName}", $bytes)
if ($result) {
    Write-Output "SUCCESS"
} else {
    Write-Error "FAILED"
    exit 1
}
`;
  
  const psFile = path.join(os.tmpdir(), `raw_print_${Date.now()}.ps1`);
  fs.writeFileSync(psFile, psScript, 'utf8');
  
  try {
    console.log(`[RawPrint] Sending ${data.length} bytes to ${printerName}...`);
    const { stdout, stderr } = await execAsync(`powershell -ExecutionPolicy Bypass -File "${psFile}"`);
    console.log('[RawPrint] Result:', stdout.trim());
    if (stderr) console.error('[RawPrint Error]', stderr);
    return { success: stdout.includes('SUCCESS'), output: stdout };
  } catch (err) {
    console.error('[RawPrint] Failed:', err.message);
    throw err;
  } finally {
    try { fs.unlinkSync(psFile); } catch {}
  }
}

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

/**
 * Windows 프린터로 텍스트 출력
 * @param {string} printerName - 프린터 이름 (필수!)
 * @param {string} text - 출력할 텍스트
 * @param {number} copies - 출력 매수
 */
async function printTextToWindows(printerName, text, copies = 1) {
  // 프린터 이름이 없으면 에러 (기본 프린터로 보내지 않음!)
  if (!printerName) {
    throw new Error('[Printer] ERROR: No printer name specified! Cannot send to default printer.');
  }
  
  try {
    // 임시 파일 생성
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `print_${Date.now()}.txt`);
    
    // 텍스트를 파일로 저장
    fs.writeFileSync(tempFile, text, 'utf8');
    
    for (let i = 0; i < copies; i++) {
      // PowerShell로 출력 (프린터 이름 필수!)
      const cmd = `powershell "Get-Content '${tempFile.replace(/\\/g, '\\\\')}' | Out-Printer -PrinterName '${printerName}'"`;
      
      console.log(`[Printer] Printing copy ${i + 1}/${copies} to ${printerName}`);
      await execAsync(cmd);
    }
    
    // 임시 파일 삭제
    try { fs.unlinkSync(tempFile); } catch {}
    
    console.log(`[Printer] Successfully printed ${copies} copies`);
    return { success: true, copies };
  } catch (error) {
    console.error('[Printer] Print failed:', error);
    throw error;
  }
}

/**
 * Bistro Kitchen 반전 헤더 1줄: `#주문 |   고객명   | T2` (고객명은 고정 폭 가운데 패딩).
 * @param {number} widthChars 58mm≈32, 80mm≈42
 */
function formatBistroKitchenTicketHeaderLine(widthChars, orderNumberRaw, customerNameRaw, tableSpotRaw) {
  const w = Number(widthChars);
  const width = Number.isFinite(w) && w >= 24 ? Math.floor(w) : 42;
  const rawNum = String(orderNumberRaw ?? '').replace(/^#/, '').trim();
  const ord = rawNum ? `#${rawNum}` : '—';
  const nameRaw = String(customerNameRaw ?? '').trim();
  const cn = nameRaw || '—';
  const spotRaw = String(tableSpotRaw ?? '').trim();
  const spot = spotRaw || '—';
  const leftSeg = `${ord} | `;
  const rightSeg = ` | ${spot}`;
  const inner = width - leftSeg.length - rightSeg.length;
  if (inner < 1) {
    const fallback = `${ord}|${cn}|${spot}`;
    return fallback.length > width ? fallback.slice(0, width) : fallback;
  }
  let mid = cn;
  if (mid.length > inner) mid = mid.slice(0, inner);
  const padTotal = inner - mid.length;
  const padL = Math.floor(padTotal / 2);
  const padR = padTotal - padL;
  return `${leftSeg}${' '.repeat(padL)}${mid}${' '.repeat(padR)}${rightSeg}`;
}

/**
 * Kitchen Ticket 텍스트 생성 (FSR/QSR 공통) - ESC/POS 그래픽 스타일
 * 반전 헤더, 큰 글씨 등을 지원
 */
function buildKitchenTicketText(orderData) {
  // ESC/POS 명령 상수
  const ESC = '\x1B';
  const GS = '\x1D';
  const LF = '\x0A';
  
  // 명령어 함수들
  const INIT = ESC + '@';                    // 프린터 초기화
  const BOLD_ON = ESC + 'E' + '\x01';        // 강조 ON
  const BOLD_OFF = ESC + 'E' + '\x00';       // 강조 OFF
  const DOUBLE_SIZE = GS + '!' + '\x11';     // 가로세로 2배
  const NORMAL_SIZE = GS + '!' + '\x00';     // 기본 크기
  const DOUBLE_WIDTH = GS + '!' + '\x10';    // 가로 2배
  const DOUBLE_HEIGHT = GS + '!' + '\x01';   // 세로 2배
  const CENTER = ESC + 'a' + '\x01';         // 중앙 정렬
  const LEFT = ESC + 'a' + '\x00';           // 왼쪽 정렬
  const REVERSE_ON = GS + 'B' + '\x01';      // 반전 ON (흰 글씨 검은 배경)
  const REVERSE_OFF = GS + 'B' + '\x00';     // 반전 OFF
  const CUT = GS + 'V' + 'A' + '\x03';       // 부분 컷
  
  let output = INIT;  // 초기화
  
  // 주문 정보 추출
  const header = orderData.header || {};
  const orderInfo = orderData.orderInfo || orderData;
  const orderNumber = header.orderNumber || orderInfo.orderNumber || orderData.orderNumber || '';
  const channel = (header.channel || orderInfo.channel || orderData.channel || orderInfo.orderType || orderData.orderType || 'DINE-IN').toUpperCase();
  const tableName = header.tableName || orderInfo.tableName || orderData.tableName || orderInfo.table || '';
  const customerName = orderInfo.customerName || orderData.customerName || '';
  const customerPhone = orderInfo.customerPhone || orderData.customerPhone || '';
  const pickupTime = orderInfo.pickupTime || orderData.pickupTime || '';
  const pickupMinutes = orderInfo.pickupMinutes || orderData.pickupMinutes || '';
  const isPaid = orderData.isPaid || false;
  const isReprint = orderData.isReprint || false;
  const isAdditionalOrder = orderData.isAdditionalOrder || false;
  
  // === 헤더 영역 (반전 + 큰 글씨) ===
  // 두 박스 레이아웃: [#주문번호 | 채널+정보]
  // 텍스트 모드에서는 한 줄로 표현
  output += CENTER;
  output += REVERSE_ON + BOLD_ON + DOUBLE_SIZE;
  
  let headerText = '';
  const cleanNum = String(orderNumber).replace('#', '');
  if (channel === 'PICKUP') {
    const phoneDigits = String(customerPhone || '').replace(/\D/g, '');
    if (phoneDigits.length >= 4) {
      headerText = cleanNum ? `#${cleanNum} PICKUP-${phoneDigits.slice(-4)}` : `PICKUP-${phoneDigits.slice(-4)}`;
    } else if (phoneDigits.length > 0) {
      headerText = cleanNum ? `#${cleanNum} PICKUP-${phoneDigits}` : `PICKUP-${phoneDigits}`;
    } else {
      headerText = cleanNum ? `#${cleanNum} PICKUP` : 'PICKUP';
    }
  } else if (channel === 'TOGO' || channel === 'TAKEOUT') {
    const phoneDigits = String(customerPhone || '').replace(/\D/g, '');
    const nameStr = String(customerName || '').trim();
    let togoSuffix = '';
    if (phoneDigits.length >= 4) {
      togoSuffix = phoneDigits.slice(-4);
    } else if (phoneDigits.length > 0) {
      togoSuffix = phoneDigits;
    } else if (nameStr) {
      togoSuffix = nameStr.slice(0, 8).toUpperCase();
    } else if (cleanNum) {
      togoSuffix = String(cleanNum);
    }
    if (togoSuffix) {
      headerText = cleanNum ? `#${cleanNum} TOGO-${togoSuffix}` : `TOGO-${togoSuffix}`;
    } else {
      headerText = 'TOGO';
    }
  } else if (channel === 'EAT IN' || channel === 'EATIN' || channel === 'FOR HERE' || channel === 'FORHERE') {
    headerText = cleanNum ? `#${cleanNum} EAT IN` : 'EAT IN';
  } else if (channel === 'ONLINE' || channel === 'THEZONE') {
    const onlineOrderTrim = String(orderInfo.onlineOrderNumber || orderData.onlineOrderNumber || header.onlineOrderNumber || '').trim().replace(/"/g, '');
    const phoneDigits = String(customerPhone || '').replace(/\D/g, '');
    let quoteBody = '';
    if (onlineOrderTrim) {
      quoteBody = onlineOrderTrim.toUpperCase();
    } else if (phoneDigits.length >= 4) {
      quoteBody = phoneDigits.slice(-4);
    } else if (phoneDigits.length > 0) {
      quoteBody = phoneDigits.slice(0, Math.min(4, phoneDigits.length));
    } else if (cleanNum) {
      quoteBody = String(cleanNum);
    }
    if (quoteBody) {
      const qUpper = quoteBody.toUpperCase();
      headerText = cleanNum ? `#${cleanNum} ONLINE-${qUpper}` : `ONLINE-${qUpper}`;
    } else {
      headerText = cleanNum ? `#${cleanNum} ONLINE` : 'ONLINE';
    }
  } else if (channel === 'DELIVERY' || orderInfo.deliveryCompany || orderData.deliveryCompany) {
    const deliveryCompany = orderInfo.deliveryCompany || orderInfo.deliveryChannel || orderData.deliveryCompany || orderData.deliveryChannel || '';
    const deliveryOrderNumber = orderInfo.deliveryOrderNumber || orderInfo.externalOrderNumber || orderData.deliveryOrderNumber || orderData.externalOrderNumber || '';
    const platformMap = { UBEREATS: 'UBER', DOORDASH: 'DDASH', SKIPTHEDISHES: 'SKIP', FANTUAN: 'FANTUAN' };
    const normKey = String(deliveryCompany).toUpperCase().replace(/\s+/g, '');
    const platform = platformMap[normKey] || deliveryCompany || 'DELIVERY';
    const ext = String(deliveryOrderNumber || '').replace(/^#\s*/, '').replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();
    const channelPart = ext ? `${platform}-${ext}` : platform;
    headerText = cleanNum ? `#${cleanNum} ${channelPart}` : channelPart;
  } else if (orderInfo.fromBistro || orderData.fromBistro) {
    const pw = Number(orderData.paperWidth || orderInfo.paperWidth || header.paperWidth);
    const lineChars = pw === 58 ? 32 : 42;
    const spot = String(orderInfo.bistroTableSpot || orderData.bistroTableSpot || '').trim();
    headerText = formatBistroKitchenTicketHeaderLine(lineChars, cleanNum || orderNumber, customerName, spot);
  } else if (tableName) {
    const isDineInLike = (channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS');
    if (cleanNum) {
      headerText = isDineInLike ? `#${cleanNum} ${tableName}` : `#${cleanNum} ${tableName}`;
    } else {
      headerText = isDineInLike ? `DINE-IN / ${tableName}` : tableName;
    }
  } else {
    headerText = cleanNum ? `#${cleanNum}` : '';
  }
  output += ' ' + headerText + ' ' + LF;
  
  output += REVERSE_OFF + NORMAL_SIZE + BOLD_OFF;
  
  // === PICKUP 시간 (큰 글씨) ===
  if (pickupTime || pickupMinutes) {
    output += DOUBLE_SIZE + BOLD_ON;
    const pickupDisplay = pickupTime || `${pickupMinutes} min`;
    output += `PICKUP: ${pickupDisplay}` + LF;
    output += NORMAL_SIZE + BOLD_OFF;
  }
  
  // === 상태 표시 (UNPAID/PAID/REPRINT/ADDITIONAL) ===
  const isKitchenPrinter = orderData.isKitchenPrinter || false;
  output += CENTER + DOUBLE_HEIGHT + BOLD_ON;
  if (isReprint) {
    output += (orderData.reprintBannerText || '** REPRINT **') + LF;
  } else if (isAdditionalOrder) {
    output += '** ADDITIONAL **' + LF;
  } else if (!isKitchenPrinter && isPaid) {
    output += 'PAID' + LF;
  } else if (!isKitchenPrinter) {
    output += 'UNPAID' + LF;
  }
  output += NORMAL_SIZE + BOLD_OFF + LEFT;
  
  // === 고객명 (TOGO/ONLINE/THEZONE 채널 제외, Bistro는 헤더에만 표시) ===
  const isBistroOrder = !!(orderInfo.fromBistro || orderData.fromBistro);
  if (customerName && !isBistroOrder && channel !== 'ONLINE' && channel !== 'THEZONE' && channel !== 'TOGO' && channel !== 'TAKEOUT') {
    output += BOLD_ON + customerName + BOLD_OFF + LF;
  }
  
  // === 아이템 목록 (큰 글씨) ===
  output += LF;
  output += DOUBLE_HEIGHT + BOLD_ON;
  
  // 프린터 그룹 섹션이 있는 경우 (Sushi Bar / Roll Bar 등 display_order로 구분)
  if (orderData.printerGroupSections && orderData.printerGroupSections.length > 0) {
    orderData.printerGroupSections.forEach((section, idx) => {
      if (orderData.printerGroupSections.length > 1) {
        output += CENTER;
        output += `---------- ${section.groupName || `Section ${idx + 1}`} ----------` + LF;
        output += LEFT;
      }
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          output += formatKitchenItem(item, DOUBLE_HEIGHT, NORMAL_SIZE, LF);
        });
      }
    });
  } else if (orderData.guestSections && orderData.guestSections.length > 0) {
    orderData.guestSections.forEach((section, idx) => {
      if (orderData.guestSections.length > 1) {
        output += CENTER;
        output += `---------- Guest ${section.guestNumber || idx + 1} ----------` + LF;
        output += LEFT;
      }
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          output += formatKitchenItem(item, DOUBLE_HEIGHT, NORMAL_SIZE, LF);
        });
      }
    });
  } else if (orderData.items && orderData.items.length > 0) {
    // Check if items have guestNumber - group by guest if multiple guests
    const items = orderData.items;
    const guestNumbers = [...new Set(items.map(item => item.guestNumber || item.guest_number || 1))].sort((a, b) => a - b);
    const hasMultipleGuests = guestNumbers.length > 1;
    
    if (hasMultipleGuests) {
      // Multiple guests - show guest separators
      guestNumbers.forEach(guestNum => {
        const guestItems = items.filter(item => (item.guestNumber || item.guest_number || 1) === guestNum);
        
        if (guestItems.length > 0) {
          // Guest separator line
          output += CENTER;
          output += `---------- Guest ${guestNum} ----------` + LF;
          output += LEFT;
          
          // Render items for this guest
          guestItems.forEach(item => {
            output += formatKitchenItem(item, DOUBLE_HEIGHT, NORMAL_SIZE, LF);
          });
          
          output += LF; // Extra spacing between guest sections
        }
      });
    } else {
      // Single guest - no separators needed
      items.forEach(item => {
        output += formatKitchenItem(item, DOUBLE_HEIGHT, NORMAL_SIZE, LF);
      });
    }
  }
  
  output += NORMAL_SIZE + BOLD_OFF;
  
  // === 시간 표시 (서버이름 + 시간) ===
  output += LF;
  const serverName = orderInfo.server || orderInfo.serverName || orderData.server || orderData.serverName || '';
  const now = new Date();
  const dateTimeStr = formatKitchenTicketFooterDateTime(now);
  if (serverName) {
    output += LEFT + BOLD_ON + serverName + BOLD_OFF;
    output += '                    '.slice(0, Math.max(1, 20 - serverName.length));
    output += dateTimeStr + LF;
  } else {
    output += CENTER;
    output += `---------- ${dateTimeStr} ----------` + LF;
  }
  output += LEFT;
  
  // === 여백 및 컷 ===
  output += LF + LF + LF;
  output += CUT;
  
  return output;
}

/**
 * Kitchen 아이템 포맷 (ESC/POS용)
 */
function formatKitchenItem(item, DOUBLE_HEIGHT, NORMAL_SIZE, LF) {
  let output = '';
  const qty = item.quantity || item.qty || 1;
  const name = item.name || item.short_name || 'Unknown Item';
  
  // ESC/POS commands
  const ESC = '\x1B';
  const GS = '\x1D';
  const BOLD_ON = ESC + 'E' + '\x01';      // Bold ON
  const BOLD_OFF = ESC + 'E' + '\x00';     // Bold OFF
  const ITALIC_ON = ESC + '4' + '\x01';    // Italic ON
  const ITALIC_OFF = ESC + '4' + '\x00';   // Italic OFF
  const DOUBLE_SIZE = GS + '!' + '\x11';   // 가로세로 2배 (1.3x 효과)
  const NORMAL = GS + '!' + '\x00';        // 기본 크기
  
  // 아이템 라인 - 더 굵은 볼드, 더 큰 크기
  output += DOUBLE_SIZE + BOLD_ON;
  output += `${qty}x ${name}` + LF;
  
  // 모디파이어 (">>" 접두사) - 아이템과 동일 크기, 이탤릭, 동일 모디파이어 그룹핑
  if (item.modifiers && item.modifiers.length > 0) {
    output += ITALIC_ON;
    const allMods = [];
    item.modifiers.forEach(mod => {
      if (typeof mod === 'string') {
        allMods.push(mod);
      } else if (mod.name) {
        allMods.push(mod.name);
      } else if (mod.modifierNames && mod.modifierNames.length > 0) {
        mod.modifierNames.forEach(n => allMods.push(n));
      } else if (mod.selectedEntries && mod.selectedEntries.length > 0) {
        mod.selectedEntries.forEach(entry => { if (entry.name) allMods.push(entry.name); });
      } else if (mod.groupName) {
        allMods.push(mod.groupName);
      }
    });
    const modCounts = new Map();
    const modOrder = [];
    allMods.forEach(n => { const k = String(n).trim(); if (!k) return; if (!modCounts.has(k)) modOrder.push(k); modCounts.set(k, (modCounts.get(k) || 0) + 1); });
    modOrder.forEach(n => { const c = (modCounts.get(n) || 0) * qty; if (!c) return; output += (c > 1 ? `  >> ${c}x ${n}` : `  >> ${n}`) + LF; });
    output += ITALIC_OFF;
  }
  
  // 메모 - 아이템과 동일 크기, 이탤릭
  if (item.memo) {
    output += ITALIC_ON;
    let memoText = typeof item.memo === 'string' ? item.memo : item.memo.text;
    if (memoText) {
      output += `  * ${memoText}` + LF;
    }
    output += ITALIC_OFF;
  }
  
  // 스타일 리셋
  output += BOLD_OFF + NORMAL;
  
  // 아이템 간 간격 추가 (1.2x)
  output += LF;
  
  return output;
}

/**
 * Kitchen 아이템 출력 헬퍼 함수 (텍스트 모드용 - 레거시)
 */
function printKitchenItem(lines, item) {
  const qty = item.quantity || item.qty || 1;
  const name = item.name || 'Unknown Item';
  lines.push(`${qty}x ${name}`);
  
  // 모디파이어 출력
  formatModifiers(item.modifiers, lines, '  >> ');
  
  // 메모 출력
  if (item.memo) {
    let memoText = typeof item.memo === 'string' ? item.memo : item.memo.text;
    if (memoText) {
      lines.push(`  >> ${memoText}`);
    }
  }
}

/**
 * 모디파이어 출력 헬퍼 (다양한 구조 지원)
 */
function formatModifiers(modifiers, lines, prefix = '  >> ') {
  if (!modifiers || !modifiers.length) return;
  const allMods = [];
  modifiers.forEach(mod => {
    if (typeof mod === 'string') { allMods.push(mod); }
    else if (mod.name) { allMods.push(mod.name); }
    else if (mod.modifierNames && mod.modifierNames.length > 0) { mod.modifierNames.forEach(n => allMods.push(n)); }
    else if (mod.selectedEntries && mod.selectedEntries.length > 0) { mod.selectedEntries.forEach(e => { if (e.name) allMods.push(e.name); }); }
    else if (mod.groupName) { allMods.push(mod.groupName); }
  });
  const counts = new Map();
  const order = [];
  allMods.forEach(n => { const k = String(n).trim(); if (!k) return; if (!counts.has(k)) order.push(k); counts.set(k, (counts.get(k) || 0) + 1); });
  order.forEach(n => { const c = counts.get(n) || 0; if (!c) return; lines.push(c > 1 ? `${prefix}${c}x ${n}` : `${prefix}${n}`); });
}

/**
 * Receipt 텍스트 생성 (FSR/QSR 공통) - ESC/POS 그래픽 스타일
 */
function buildReceiptText(receiptData) {
  // ESC/POS 명령 상수
  const ESC = '\x1B';
  const GS = '\x1D';
  const LF = '\x0A';
  
  const INIT = ESC + '@';
  const BOLD_ON = ESC + 'E' + '\x01';
  const BOLD_OFF = ESC + 'E' + '\x00';
  const DOUBLE_SIZE = GS + '!' + '\x11';     // 가로세로 2배
  const TRIPLE_SIZE = GS + '!' + '\x22';     // 가로세로 3배
  const NORMAL_SIZE = GS + '!' + '\x00';
  const DOUBLE_HEIGHT = GS + '!' + '\x01';
  const DOUBLE_WIDTH = GS + '!' + '\x10';    // 가로 2배
  const CENTER = ESC + 'a' + '\x01';
  const LEFT = ESC + 'a' + '\x00';
  const RIGHT = ESC + 'a' + '\x02';
  const REVERSE_ON = GS + 'B' + '\x01';      // 반전 ON
  const REVERSE_OFF = GS + 'B' + '\x00';     // 반전 OFF
  const LINE_SPACING_DEFAULT = ESC + '2';    // 기본 줄간격
  const LINE_SPACING_TIGHT = ESC + '3' + '\x12'; // 좁은 줄간격 (18 dots)
  const CUT = GS + 'V' + 'A' + '\x03';
  
  const width = 42;
  const divider = '═'.repeat(width);         // 굵은 구분선
  const thinDivider = '─'.repeat(width);     // 얇은 구분선
  
  let output = INIT;
  output += LINE_SPACING_DEFAULT;
  
  // 주문 정보 추출
  const header = receiptData.header || {};
  const orderInfo = receiptData.orderInfo || receiptData;
  const orderNumber = header.orderNumber || orderInfo.orderNumber || receiptData.orderNumber || '';
  const channel = (header.channel || orderInfo.channel || receiptData.channel || orderInfo.orderType || receiptData.orderType || '').toUpperCase();
  const tableName = header.tableName || orderInfo.tableName || receiptData.tableName || '';
  const serverName = header.serverName || orderInfo.serverName || receiptData.serverName || '';
  const customerName = orderInfo.customerName || receiptData.customerName || '';
  const customerPhone = orderInfo.customerPhone || receiptData.customerPhone || '';
  const storeName = header.storeName || receiptData.storeName || 'Restaurant';
  const storeAddress = header.storeAddress || receiptData.storeAddress || '';
  const storePhone = header.storePhone || receiptData.storePhone || '';
  
  // === REPRINT 배너 (Receipt) ===
  if (receiptData.isReprint) {
    output += CENTER + BOLD_ON + DOUBLE_HEIGHT;
    output += '** REPRINT **' + LF;
    output += NORMAL_SIZE + BOLD_OFF;
  }

  // === 스토어 헤더 (반전 + 큰 글씨) ===
  output += CENTER;
  output += REVERSE_ON + BOLD_ON + DOUBLE_SIZE;
  output += ' ' + storeName + ' ' + LF;
  output += REVERSE_OFF + NORMAL_SIZE + BOLD_OFF;
  
  // 스토어 정보
  if (storeAddress) output += storeAddress + LF;
  if (storePhone) output += 'Tel: ' + storePhone + LF;
  output += LF;
  
  // === 주문 타입 (반전 헤더) ===
  let orderTypeText = channel || 'ORDER';
  if (!channel || channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE') {
    orderTypeText = 'Dine-In';
  }
  if (tableName && !channel) orderTypeText = tableName;
  const isDineInLike = (channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS');
  const headerLine = (isDineInLike && tableName)
    ? `DINE-IN / ${tableName}`
    : `${orderTypeText} #${String(orderNumber).replace('#', '')}`;
  
  output += REVERSE_ON + BOLD_ON + DOUBLE_WIDTH;
  output += ' ' + headerLine + ' ' + LF;
  output += REVERSE_OFF + NORMAL_SIZE + BOLD_OFF;
  
  output += divider + LF;
  output += LEFT;
  
  // 주문 정보
  if (orderNumber) output += `Order #: ${orderNumber}` + LF;
  if (channel) output += `Type: ${channel}` + LF;
  if (tableName) output += `Table: ${tableName}` + LF;
  if (serverName) output += `Server: ${serverName}` + LF;
  if (customerName) output += `Customer: ${customerName}` + LF;
  if (customerPhone) output += `Phone: ${customerPhone}` + LF;
  output += `Date: ${new Date().toLocaleString()}` + LF;
  output += thinDivider + LF;
  
  // 아이템 목록
  output += DOUBLE_HEIGHT + BOLD_ON;
  if (receiptData.guestSections && receiptData.guestSections.length > 0) {
    receiptData.guestSections.forEach((section, idx) => {
      if (receiptData.guestSections.length > 1) {
        output += `--- Guest ${section.guestNumber || idx + 1} ---` + LF;
      }
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          output += formatReceiptItem(item, width, LF, NORMAL_SIZE + BOLD_ON, DOUBLE_HEIGHT + BOLD_ON);
        });
      }
    });
  } else if (receiptData.items && receiptData.items.length > 0) {
    receiptData.items.forEach(item => {
      output += formatReceiptItem(item, width, LF, NORMAL_SIZE + BOLD_ON, DOUBLE_HEIGHT + BOLD_ON);
    });
  }
  output += NORMAL_SIZE + BOLD_OFF;
  
  output += thinDivider + LF;
  
  // 소계
  output += BOLD_ON;
  if (receiptData.subtotal != null) {
    output += rightAlignText('Subtotal:', `$${Number(receiptData.subtotal).toFixed(2)}`, width) + LF;
  }
  
  // 조정 (할인 등)
  if (receiptData.adjustments && receiptData.adjustments.length > 0) {
    receiptData.adjustments.forEach(adj => {
      const amount = Number(adj.amount || 0);
      let label = adj.label || adj.name || 'Adjustment';
      if (amount < 0) label = label.replace(/^Discount\b/, 'D/C');
      const sign = amount < 0 ? '-' : '';
      output += rightAlignText(`${label}:`, `${sign}$${Math.abs(amount).toFixed(2)}`, width) + LF;
    });
    // Net Sales (할인 적용 후 순매출)
    const hasDiscount = receiptData.adjustments.some(adj => Number(adj.amount || 0) < 0);
    if (hasDiscount && receiptData.subtotal != null) {
      const discountSum = receiptData.adjustments.reduce((s, adj) => s + Number(adj.amount || 0), 0);
      const netSales = Number((Number(receiptData.subtotal) + discountSum).toFixed(2));
      output += rightAlignText('Net Sales:', `$${netSales.toFixed(2)}`, width) + LF;
    }
  }
  
  // 세금
  if (receiptData.taxLines && receiptData.taxLines.length > 0) {
    receiptData.taxLines.forEach(tax => {
      output += rightAlignText(`${tax.name}:`, `$${Number(tax.amount).toFixed(2)}`, width) + LF;
    });
  }
  output += BOLD_OFF;
  
  output += divider + LF;
  
  // 총액 (반전 + 2배 크기)
  if (receiptData.total != null) {
    output += CENTER;
    output += REVERSE_ON + BOLD_ON + DOUBLE_SIZE;
    output += ` TOTAL: $${Number(receiptData.total).toFixed(2)} ` + LF;
    output += REVERSE_OFF + NORMAL_SIZE + BOLD_OFF;
    output += LEFT;
  }
  
  output += divider + LF;
  
  // 결제 정보 (굵게)
  if (receiptData.payments && receiptData.payments.length > 0) {
    const paidTotal = receiptData.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    output += REVERSE_ON + BOLD_ON + DOUBLE_HEIGHT;
    output += rightAlignText(' PAID', `$${Number(paidTotal).toFixed(2)} `, width) + LF;
    output += REVERSE_OFF + NORMAL_SIZE + BOLD_OFF;
    output += DOUBLE_HEIGHT;
    receiptData.payments.forEach(p => {
      output += rightAlignText(`  ${p.method}:`, `$${Number(p.amount).toFixed(2)}`, width) + LF;
      const rawRef = p.ref || p.terminalRef;
      if (rawRef) {
        const { host, auth } = splitStoredTetraRef(rawRef);
        if (host || auth) {
          output += NORMAL_SIZE;
          if (host) {
            output += rightAlignText('   Ref:', truncateForReceipt(host, width - 8), width) + LF;
          }
          if (auth) {
            output += rightAlignText('   Auth:', truncateForReceipt(auth, width - 8), width) + LF;
          }
          output += DOUBLE_HEIGHT;
        }
      }
    });
    output += NORMAL_SIZE;
    
    // Cash Tendered
    if (receiptData.cashTendered && Number(receiptData.cashTendered) > 0) {
      output += thinDivider + LF;
      output += BOLD_ON + DOUBLE_HEIGHT;
      output += rightAlignText(' CASH TENDERED:', `$${Number(receiptData.cashTendered).toFixed(2)} `, width) + LF;
      output += NORMAL_SIZE + BOLD_OFF;
    }
    // 거스름돈 (Change) - 반전 강조
    if (receiptData.change && Number(receiptData.change) > 0) {
      if (!receiptData.cashTendered || Number(receiptData.cashTendered) <= 0) output += thinDivider + LF;
      output += REVERSE_ON + BOLD_ON + DOUBLE_HEIGHT;
      output += rightAlignText(' CHANGE:', `$${Number(receiptData.change).toFixed(2)} `, width) + LF;
      output += REVERSE_OFF + NORMAL_SIZE + BOLD_OFF;
    }
  }
  
  // Footer (반전 강조)
  output += LF;
  output += CENTER;
  output += REVERSE_ON + BOLD_ON;
  if (receiptData.footer && receiptData.footer.message) {
    output += ' ' + receiptData.footer.message + ' ' + LF;
  } else {
    output += ' Thank you! Please come again! ' + LF;
  }
  output += REVERSE_OFF + BOLD_OFF;
  output += LEFT;
  
  // 여백 및 컷
  output += LF + LF + LF;
  output += CUT;
  
  return output;
}

/**
 * Receipt 아이템 포맷 (ESC/POS용)
 */
function formatReceiptItem(item, width, LF, NORMAL_SIZE, DOUBLE_HEIGHT) {
  let output = '';
  const qty = item.quantity || item.qty || 1;
  const name = item.name || 'Unknown';
  const price = Number(item.lineTotal || item.totalPrice || item.price || 0).toFixed(2);
  
  output += rightAlignText(`${qty}x ${name}`, `$${price}`, width) + LF;

  // Dine-in item-level TOGO label (separate from orderType TOGO)
  if (item.togoLabel || item.togo_label) {
    output += NORMAL_SIZE;
    output += `  <<TOGO>>` + LF;
    output += DOUBLE_HEIGHT;
  }
  
  // 원래 가격과 할인 표시
  if (item.originalTotal && item.discount) {
    output += NORMAL_SIZE;
    output += rightAlignText(`   (was $${Number(item.originalTotal).toFixed(2)})`, '', width) + LF;
    output += rightAlignText(`   ${item.discount.type}:`, `-$${Number(item.discount.amount).toFixed(2)}`, width) + LF;
    output += DOUBLE_HEIGHT;
  }
  
  // 모디파이어
  if (item.modifiers && item.modifiers.length > 0) {
    output += NORMAL_SIZE;
    const allMods = [];
    item.modifiers.forEach(mod => {
      if (typeof mod === 'string') {
        allMods.push({ name: mod, price: 0 });
      } else if (mod.name) {
        allMods.push({ name: mod.name, price: mod.price || 0 });
      } else if (mod.modifierNames && mod.modifierNames.length > 0) {
        mod.modifierNames.forEach((modName, idx) => {
          let p = 0;
          if (mod.selectedEntries && mod.selectedEntries[idx] && mod.selectedEntries[idx].price_delta > 0) p = mod.selectedEntries[idx].price_delta;
          allMods.push({ name: modName, price: p });
        });
      } else if (mod.selectedEntries && mod.selectedEntries.length > 0) {
        mod.selectedEntries.forEach(entry => {
          if (entry.name) allMods.push({ name: entry.name, price: entry.price_delta > 0 ? entry.price_delta : 0 });
        });
      } else if (mod.groupName) {
        allMods.push({ name: mod.groupName, price: mod.totalModifierPrice || 0 });
      }
    });
    const modCounts = new Map();
    const modOrder = [];
    allMods.forEach(m => { const k = String(m.name).trim(); if (!k) return; if (!modCounts.has(k)) { modOrder.push(k); modCounts.set(k, { count: 0, unitPrice: m.price }); } const e = modCounts.get(k); e.count++; });
    modOrder.forEach(n => { const e = modCounts.get(n); if (!e || !e.count) return; const label = e.count > 1 ? `  >> ${e.count}x ${n}` : `  >> ${n}`; const totalPrice = e.unitPrice * e.count; const priceStr = totalPrice > 0 ? `$${Number(totalPrice).toFixed(2)}` : ''; output += rightAlignText(label, priceStr, width) + LF; });
    output += DOUBLE_HEIGHT;
  }
  
  // 메모
  if (item.memo) {
    output += NORMAL_SIZE;
    let memoText = typeof item.memo === 'string' ? item.memo : item.memo.text;
    if (memoText) {
      output += `  >> ${memoText}` + LF;
    }
    if (item.memo.price && Number(item.memo.price) > 0) {
      output += rightAlignText(`   Memo charge:`, `$${Number(item.memo.price).toFixed(2)}`, width) + LF;
    }
    output += DOUBLE_HEIGHT;
  }
  
  return output;
}

/**
 * 텍스트 오른쪽 정렬 (문자열 반환)
 */
function rightAlignText(left, right, width) {
  const spaces = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(spaces) + right;
}

/**
 * 아이템 출력 헬퍼 함수
 */
function printItem(lines, item, width) {
  const qty = item.quantity || item.qty || 1;
  const name = item.name || 'Unknown';
  // lineTotal이 있으면 사용, 없으면 totalPrice 또는 price
  const price = Number(item.lineTotal || item.totalPrice || item.price || 0).toFixed(2);
  const line = `${qty}x ${name}`;
  lines.push(rightAlign(line, `$${price}`, width));
  
  // 원래 가격과 할인 표시
  if (item.originalTotal && item.discount) {
    lines.push(rightAlign(`   (was $${Number(item.originalTotal).toFixed(2)})`, '', width));
    lines.push(rightAlign(`   ${item.discount.type}:`, `-$${Number(item.discount.amount).toFixed(2)}`, width));
  }
  
  // 모디파이어 (다양한 구조 지원)
  if (item.modifiers && item.modifiers.length > 0) {
    item.modifiers.forEach(mod => {
      // 1. 단순 문자열
      if (typeof mod === 'string') {
        lines.push(rightAlign(`   + ${mod}`, '', width));
      }
      // 2. { name, price } 구조 (FSR 스타일)
      else if (mod.name) {
        const modPrice = mod.price ? `$${Number(mod.price).toFixed(2)}` : '';
        lines.push(rightAlign(`   + ${mod.name}`, modPrice, width));
      }
      // 3. QSR 스타일: { groupName, modifierNames, selectedEntries, totalModifierPrice }
      else if (mod.modifierNames && mod.modifierNames.length > 0) {
        mod.modifierNames.forEach((modName, idx) => {
          // selectedEntries에서 가격 찾기
          let modPrice = '';
          if (mod.selectedEntries && mod.selectedEntries[idx]) {
            const delta = mod.selectedEntries[idx].price_delta;
            if (delta && delta > 0) {
              modPrice = `$${Number(delta).toFixed(2)}`;
            }
          }
          lines.push(rightAlign(`   + ${modName}`, modPrice, width));
        });
      }
      else if (mod.selectedEntries && mod.selectedEntries.length > 0) {
        mod.selectedEntries.forEach(entry => {
          if (entry.name) {
            const modPrice = entry.price_delta && entry.price_delta > 0 ? `$${Number(entry.price_delta).toFixed(2)}` : '';
            lines.push(rightAlign(`   + ${entry.name}`, modPrice, width));
          }
        });
      }
      // 4. groupName만 있는 경우
      else if (mod.groupName) {
        const modPrice = mod.totalModifierPrice ? `$${Number(mod.totalModifierPrice).toFixed(2)}` : '';
        lines.push(rightAlign(`   + ${mod.groupName}`, modPrice, width));
      }
    });
  }
  
  // 메모 (다양한 구조 지원)
  if (item.memo) {
    let memoText = null;
    let memoPrice = 0;
    if (typeof item.memo === 'string') {
      memoText = item.memo;
    } else if (item.memo.text) {
      memoText = item.memo.text;
      memoPrice = item.memo.price || 0;
    }
    if (memoText) {
      lines.push(`   ** ${memoText}`);
    }
    if (memoPrice > 0) {
      lines.push(rightAlign(`   Memo charge:`, `$${Number(memoPrice).toFixed(2)}`, width));
    }
  }
}

/**
 * 텍스트 중앙 정렬
 */
function centerText(text, width) {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(padding) + text;
}

/**
 * 왼쪽-오른쪽 정렬
 */
function rightAlign(left, right, width) {
  const spaces = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(spaces) + right;
}

/**
 * ESC/POS 명령어 상수 (완전한 구현)
 */
const ESC_POS = {
  ESC: '\x1B',
  GS: '\x1D',
  LF: '\x0A',
  INIT: '\x1B@',
  // 텍스트 스타일
  BOLD_ON: '\x1BE\x01',
  BOLD_OFF: '\x1BE\x00',
  ITALIC_ON: '\x1B4\x01',      // ESC 4 1 - Italic ON
  ITALIC_OFF: '\x1B4\x00',     // ESC 4 0 - Italic OFF
  UNDERLINE_ON: '\x1B-\x01',
  UNDERLINE_OFF: '\x1B-\x00',
  // 폰트 크기 (GS ! n)
  NORMAL_SIZE: '\x1D!\x00',    // 기본 크기
  DOUBLE_WIDTH: '\x1D!\x10',   // 가로 2배
  DOUBLE_HEIGHT: '\x1D!\x01',  // 세로 2배
  DOUBLE_SIZE: '\x1D!\x11',    // 가로세로 2배
  TRIPLE_WIDTH: '\x1D!\x20',   // 가로 3배
  TRIPLE_HEIGHT: '\x1D!\x02',  // 세로 3배
  TRIPLE_SIZE: '\x1D!\x22',    // 가로세로 3배
  // 정렬 (ESC a n)
  LEFT: '\x1Ba\x00',
  CENTER: '\x1Ba\x01',
  RIGHT: '\x1Ba\x02',
  // 반전 (GS B n)
  REVERSE_ON: '\x1DB\x01',
  REVERSE_OFF: '\x1DB\x00',
  // 줄간격 (ESC 3 n) - n = 0~255 (n/180 inch)
  LINE_SPACING_DEFAULT: '\x1B2',        // 기본 줄간격 (1/6 inch)
  // 컷
  CUT: '\x1DVA\x03',
};

/**
 * 줄간격 설정 명령 생성 (ESC 3 n)
 * @param {number} spacing - 줄간격 픽셀 (0~255)
 */
function getLineSpacingCommand(spacing) {
  if (spacing <= 0) return '';
  // ESC 3 n: n/180 inch 간격 설정
  // 일반적으로 lineHeight 8~60px를 0~255 범위로 매핑
  const n = Math.min(255, Math.max(0, Math.round(spacing * 2)));
  return '\x1B3' + String.fromCharCode(n);
}

/**
 * 요소 스타일에 따른 ESC/POS 명령 생성 (완전한 구현)
 * @param {Object} style - 요소 스타일 객체
 */
function getStyleCommand(style) {
  if (!style) return ESC_POS.NORMAL_SIZE;
  
  let cmd = '';
  const fontSize = style.fontSize || 12;
  const fontWeight = style.fontWeight || 'regular';
  const isItalic = style.isItalic || false;
  const inverse = style.inverse || false;
  const textAlign = style.textAlign || 'left';
  const lineHeight = style.lineHeight || style.lineSpacing || 0;
  
  // 1. 줄간격 설정
  if (lineHeight > 0) {
    cmd += getLineSpacingCommand(lineHeight);
  }
  
  // 2. 정렬
  cmd += getAlignCommand(textAlign);
  
  // 3. 반전
  if (inverse) {
    cmd += ESC_POS.REVERSE_ON;
  }
  
  // 4. 폰트 크기 (GS ! n)
  // n의 비트 0-2: 세로 배율 (0=1배, 1=2배, 2=3배, ...)
  // n의 비트 4-6: 가로 배율 (0=1배, 1=2배, 2=3배, ...)
  let widthScale = 0;
  let heightScale = 0;
  if (fontSize >= 24) {
    widthScale = 2; heightScale = 2; // 3배
  } else if (fontSize >= 20) {
    widthScale = 1; heightScale = 1; // 2배
  } else if (fontSize >= 16) {
    heightScale = 1; // 세로 2배
  } else if (fontSize >= 14) {
    widthScale = 1; // 가로 2배
  }
  const sizeN = (widthScale << 4) | heightScale;
  cmd += '\x1D!' + String.fromCharCode(sizeN);
  
  // 5. Bold (fontWeight)
  if (fontWeight === 'bold' || fontWeight === 'extrabold') {
    cmd += ESC_POS.BOLD_ON;
  }
  
  // 6. Italic
  if (isItalic) {
    cmd += ESC_POS.ITALIC_ON;
  }
  
  return cmd;
}

/**
 * 스타일 리셋 명령
 */
function getStyleResetCommand() {
  return ESC_POS.REVERSE_OFF + ESC_POS.BOLD_OFF + ESC_POS.ITALIC_OFF + 
         ESC_POS.NORMAL_SIZE + ESC_POS.LEFT + ESC_POS.LINE_SPACING_DEFAULT;
}

/**
 * 레이아웃 설정에 따른 폰트 크기 ESC/POS 명령 생성 (레거시 호환)
 * @param {number} fontSize - 폰트 사이즈 (10~24)
 * @param {boolean} bold - 볼드 여부
 */
function getFontSizeCommand(fontSize, bold = false) {
  return getStyleCommand({ fontSize, fontWeight: bold ? 'bold' : 'regular' });
}

/**
 * 정렬 명령 생성
 * @param {'left' | 'center' | 'right'} align
 */
function getAlignCommand(align) {
  switch (align) {
    case 'center': return ESC_POS.CENTER;
    case 'right': return ESC_POS.RIGHT;
    default: return ESC_POS.LEFT;
  }
}

/**
 * 구분선 생성
 * @param {'solid' | 'dashed' | 'dotted' | 'none'} style
 * @param {number} width
 */
function getSeparatorLine(style, width = 42) {
  switch (style) {
    case 'solid': return '='.repeat(width);
    case 'dashed': return '-'.repeat(width);
    case 'dotted': return '.'.repeat(width);
    default: return '';
  }
}

/**
 * 두 요소를 한 줄에 병합하여 출력
 * @param {string} leftText - 왼쪽 텍스트
 * @param {string} rightText - 오른쪽 텍스트
 * @param {Object} leftStyle - 왼쪽 스타일
 * @param {Object} rightStyle - 오른쪽 스타일
 * @param {string} alignment - 정렬 방식
 * @param {number} width - 용지 너비
 */
function formatMergedLine(leftText, rightText, leftStyle, rightStyle, alignment, width, gap = 2) {
  const { LF } = ESC_POS;
  let output = '';
  
  // 병합 정렬에 따라 출력
  switch (alignment) {
    case 'left-right':
      // 왼쪽 텍스트는 왼쪽, 오른쪽 텍스트는 오른쪽
      const spaces = Math.max(1, width - leftText.length - rightText.length);
      output += getStyleCommand(leftStyle);
      output += leftText;
      output += getStyleResetCommand();
      output += ' '.repeat(spaces);
      output += getStyleCommand(rightStyle);
      output += rightText;
      output += getStyleResetCommand();
      break;
    case 'left-center':
      // 왼쪽에 텍스트, 중앙에 텍스트
      const leftPad = Math.floor((width - leftText.length - rightText.length - gap) / 2);
      output += getStyleCommand(leftStyle);
      output += leftText;
      output += getStyleResetCommand();
      output += ' '.repeat(Math.max(gap, leftPad));
      output += getStyleCommand(rightStyle);
      output += rightText;
      output += getStyleResetCommand();
      break;
    case 'center-center':
      // 둘 다 중앙
      const totalLen = leftText.length + gap + rightText.length;
      const centerPad = Math.max(0, Math.floor((width - totalLen) / 2));
      output += ' '.repeat(centerPad);
      output += getStyleCommand(leftStyle);
      output += leftText;
      output += getStyleResetCommand();
      output += ' '.repeat(gap);
      output += getStyleCommand(rightStyle);
      output += rightText;
      output += getStyleResetCommand();
      break;
    case 'center-right':
      // 중앙에 왼쪽 텍스트, 오른쪽에 오른쪽 텍스트
      output += getStyleCommand(leftStyle);
      output += ESC_POS.CENTER + leftText;
      output += getStyleResetCommand();
      output += ESC_POS.RIGHT;
      output += getStyleCommand(rightStyle);
      output += rightText;
      output += getStyleResetCommand();
      break;
    default:
      output += leftText + ' ' + rightText;
  }
  
  output += LF;
  return output;
}

/**
 * 요소의 값을 가져오는 헬퍼 함수
 */
function getElementValue(key, data) {
  const { orderInfo, orderData, header } = data;
  const oi = orderInfo || orderData || {};
  const h = header || {};
  const channelUpper = String(h.channel || oi.channel || oi.orderType || 'DINE-IN').toUpperCase();
  const table = h.tableName || oi.tableName || oi.table || '';
  const isDineInLike = (channelUpper === 'DINE-IN' || channelUpper === 'POS' || channelUpper === 'TABLE' || channelUpper === 'HANDHELD' || channelUpper === 'SUBPOS');
  
  switch (key) {
    case 'orderType':
      if (oi.fromBistro) {
        const spot = String(oi.bistroTableSpot || '').trim();
        return spot ? `| ${spot}` : '| —';
      }
      // FSR 테이블 주문: 헤더는 반드시 DINE-IN/T4 형식
      if (isDineInLike && table) return `DINE-IN / ${table}`;
      return channelUpper;
    case 'tableNumber':
      if (oi.fromBistro) {
        const cn = String(oi.customerName || '').trim();
        return cn || '—';
      }
      return table;
    case 'posOrderNumber':
      if (oi.fromBistro) return '';
      if (isDineInLike && table) {
        const num = h.orderNumber || oi.orderNumber || oi.orderId || '';
        const clean = String(num).replace('#', '').trim();
        return clean ? `#${clean} ${table}` : table;
      }
      return h.orderNumber || oi.orderNumber || oi.orderId || '';
    case 'externalOrderNumber':
      return oi.deliveryOrderNumber || oi.externalOrderNumber || '';
    case 'guestNumber':
      return oi.guestNumber || '';
    case 'serverName':
      return h.serverName || oi.serverName || oi.server || '';
    case 'dateTime':
      return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    case 'pickupTime':
      return oi.pickupTime || oi.readyTime || (oi.pickupMinutes ? `${oi.pickupMinutes} min` : '');
    case 'deliveryChannel':
      return (oi.deliveryChannel || oi.deliveryCompany || '').toUpperCase();
    case 'customerName':
      return oi.customerName || '';
    case 'customerPhone':
      return oi.customerPhone || '';
    case 'deliveryAddress':
      return oi.deliveryAddress || '';
    case 'paidStatus':
      if (data.isReprint) return (data.orderData && data.orderData.reprintBannerText) || '** REPRINT **';
      if (data.isAdditionalOrder) return '** ADDITIONAL **';
      if (data.isPaid) return 'PAID';
      return 'UNPAID';
    case 'kitchenNote':
      return oi.kitchenNote || oi.specialInstructions || '';
    default:
      return '';
  }
}

/**
 * 단일 요소 출력
 */
function renderElement(key, style, data, width, LF) {
  if (!style || style.visible === false) return '';
  
  const value = getElementValue(key, data);
  if (!value && key !== 'paidStatus' && key !== 'dateTime') return '';
  
  let output = '';
  
  // 스타일 적용
  output += getStyleCommand(style);
  
  // 값 출력 (반전의 경우 좌우 패딩 추가)
  if (style.inverse) {
    output += ' ' + value + ' ';
  } else {
    output += value;
  }
  
  output += LF;
  output += getStyleResetCommand();
  
  return output;
}

/**
 * 병합된 요소 출력
 */
function renderMergedElement(merged, data, width, LF) {
  if (!merged) return '';

  const { orderInfo, orderData, header } = data;
  const oi = orderInfo || orderData || {};
  const h = header || {};
  if (
    oi.fromBistro &&
    merged.leftElement?.key === 'tableNumber' &&
    merged.rightElement?.key === 'orderType'
  ) {
    const rawNum = h.orderNumber || oi.orderNumber || oi.orderId || '';
    const clean = String(rawNum).replace(/^#/, '').trim();
    const singleLine = formatBistroKitchenTicketHeaderLine(
      width,
      clean || rawNum,
      oi.customerName || '',
      oi.bistroTableSpot || ''
    );
    let output = '';
    if (merged.lineInverse) output += ESC_POS.REVERSE_ON;
    output += getStyleCommand(merged.leftElement);
    output += ESC_POS.CENTER + singleLine + LF;
    output += getStyleResetCommand();
    output += ESC_POS.LEFT;
    if (merged.lineInverse) output += ESC_POS.REVERSE_OFF;
    return output;
  }

  const leftValue = getElementValue(merged.leftElement.key, data);
  const rightValue = getElementValue(merged.rightElement.key, data);
  
  if (!leftValue && !rightValue) return '';
  
  let output = '';
  
  // 줄 전체 반전
  if (merged.lineInverse) {
    output += ESC_POS.REVERSE_ON;
  }
  
  output += formatMergedLine(
    leftValue || '',
    rightValue || '',
    merged.leftElement,
    merged.rightElement,
    merged.alignment,
    width,
    merged.gap || 2
  );
  
  if (merged.lineInverse) {
    output += ESC_POS.REVERSE_OFF;
  }
  
  return output;
}

/**
 * 레이아웃 설정을 적용한 ESC/POS Kitchen Ticket 빌드 (완전한 구현)
 * - order 순서 처리
 * - mergedElements 처리
 * - showInHeader/showInFooter 처리
 * - 모든 스타일 속성 지원
 */
function buildEscPosKitchenTicketWithLayout(orderData, layout) {
  const { LF, CUT } = ESC_POS;
  const ticketLayout = layout?.kitchenPrinter || layout || {};
  const width = ticketLayout.paperWidth === 58 ? 32 : 42;
  
  let output = ESC_POS.INIT;
  
  // 주문 정보를 data 객체로 구성
  const header = orderData.header || {};
  const orderInfo = orderData.orderInfo || orderData;
  const data = {
    header,
    orderInfo,
    orderData,
    isPaid: orderData.isPaid || false,
    isReprint: orderData.isReprint || false,
    isAdditionalOrder: orderData.isAdditionalOrder || false,
  };
  
  // Header 요소 키 목록
  const headerKeys = [
    'orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber',
    'guestNumber', 'pickupTime', 'deliveryChannel', 'customerName',
    'customerPhone', 'deliveryAddress', 'serverName', 'dateTime', 'paidStatus'
  ];
  
  // 병합된 요소 키 수집
  const mergedKeys = new Set();
  const mergedElements = ticketLayout.mergedElements || [];
  mergedElements.forEach(m => {
    mergedKeys.add(m.leftElement?.key);
    mergedKeys.add(m.rightElement?.key);
  });
  
  // === HEADER 영역 출력 (order 순서대로) ===
  // 1. 병합되지 않은 요소들을 order 순서대로 수집
  const headerElements = [];
  
  headerKeys.forEach(key => {
    const style = ticketLayout[key];
    if (!style || style.visible === false) return;
    if (mergedKeys.has(key)) return; // 병합된 요소는 제외
    if (style.showInHeader === false) return; // showInHeader가 false면 헤더에서 제외
    
    headerElements.push({
      type: 'single',
      key,
      style,
      order: style.order || 0,
    });
  });
  
  // 2. 병합된 요소 추가
  mergedElements.forEach(m => {
    headerElements.push({
      type: 'merged',
      merged: m,
      order: m.order || 0,
    });
  });
  
  // 3. order 순서대로 정렬
  headerElements.sort((a, b) => a.order - b.order);
  
  // QSR mode only: order number / channel 30% larger
  const isQsrMode = !!(orderData?.orderInfo?.isQsrMode || orderData?.isQsrMode);
  const getStyleBoost = (key, style) => {
    if (!isQsrMode || !style) return {};
    if (key !== 'orderType' && key !== 'posOrderNumber') return {};
    const baseFont = style.fontSize ?? 18;
    return { fontSize: Math.round(baseFont * 1.3) };
  };
  
  // 4. 순서대로 출력
  headerElements.forEach(el => {
    if (el.type === 'single') {
      const style = { ...el.style, ...getStyleBoost(el.key, el.style) };
      output += renderElement(el.key, style, data, width, LF);
    } else if (el.type === 'merged') {
      const m = el.merged;
      const boostedMerged = {
        ...m,
        leftElement: { ...m.leftElement, ...getStyleBoost(m.leftElement?.key, m.leftElement) },
        rightElement: { ...m.rightElement, ...getStyleBoost(m.rightElement?.key, m.rightElement) },
      };
      output += renderMergedElement(boostedMerged, data, width, LF);
    }
  });
  
  // === Separator 1 (헤더 아래) ===
  const sep1 = ticketLayout.separator1 || { visible: true, style: 'dashed' };
  if (sep1.visible !== false && sep1.style !== 'none') {
    output += ESC_POS.LEFT;
    output += getSeparatorLine(sep1.style || 'dashed', width) + LF;
  }
  
  // === BODY (Items) 영역 ===
  output += ESC_POS.LEFT;
  const itemsStyle = ticketLayout.items || { fontSize: 14, visible: true };
  const modifiersStyle = ticketLayout.modifiers || { fontSize: 10, prefix: '>>', visible: true };
  const itemNoteStyle = ticketLayout.itemNote || { fontSize: 10, prefix: '->', visible: true };
  const kitchenTicketElementsStyle = ticketLayout.kitchenTicketElements || { visible: true, prefix: '  - ' };
  
  // Printer Group Sections, Guest Sections, or Items
  if (orderData.printerGroupSections && orderData.printerGroupSections.length > 0) {
    orderData.printerGroupSections.forEach((section, idx) => {
      if (orderData.printerGroupSections.length > 1) {
        const splitSep = ticketLayout.splitSeparator || { visible: true, style: 'dashed' };
        if (splitSep.visible !== false) {
          const groupStyle = ticketLayout.guestNumber || { inverse: true };
          output += ESC_POS.CENTER;
          if (groupStyle.inverse) output += ESC_POS.REVERSE_ON;
          output += getStyleCommand(groupStyle);
          const groupLabel = `--- ${section.groupName || `Section ${idx + 1}`} ---`;
          output += ' ' + groupLabel + ' ' + LF;
          output += getStyleResetCommand();
          output += ESC_POS.LEFT;
        }
      }
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          output += formatKitchenItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, width, LF, kitchenTicketElementsStyle);
        });
      }
    });
  } else if (orderData.guestSections && orderData.guestSections.length > 0) {
    orderData.guestSections.forEach((section, idx) => {
      // Guest separator
      if (orderData.guestSections.length > 1) {
        const splitSep = ticketLayout.splitSeparator || { visible: true, style: 'dashed' };
        if (splitSep.visible !== false) {
          const guestNumStyle = ticketLayout.guestNumber || { inverse: true };
          output += ESC_POS.CENTER;
          if (guestNumStyle.inverse) output += ESC_POS.REVERSE_ON;
          output += getStyleCommand(guestNumStyle);
          const guestLabel = `--- GUEST ${section.guestNumber || idx + 1} ---`;
          output += ' ' + guestLabel + ' ' + LF;
          output += getStyleResetCommand();
          output += ESC_POS.LEFT;
        }
      }
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          output += formatKitchenItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, width, LF, kitchenTicketElementsStyle);
        });
      }
    });
  } else if (orderData.items && orderData.items.length > 0) {
    orderData.items.forEach(item => {
      output += formatKitchenItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, width, LF, kitchenTicketElementsStyle);
    });
  }
  
  // === Separator 2 (아이템 아래) ===
  const sep2 = ticketLayout.separator2 || { visible: true, style: 'solid' };
  if (sep2.visible !== false && sep2.style !== 'none') {
    output += ESC_POS.LEFT;
    output += getSeparatorLine(sep2.style || 'solid', width) + LF;
  }
  
  // === Kitchen Note ===
  const kitchenNote = orderInfo.kitchenNote || orderInfo.specialInstructions || orderData.kitchenNote || '';
  const kitchenNoteStyle = ticketLayout.kitchenNote || { fontSize: 12, visible: true };
  if (kitchenNoteStyle.visible !== false && kitchenNote) {
    output += LF;
    output += ESC_POS.CENTER;
    output += getSeparatorLine('dashed', width) + LF;
    output += getStyleCommand({ ...kitchenNoteStyle, fontWeight: 'bold' });
    output += '*** Kitchen Memo ***' + LF;
    output += getStyleResetCommand();
    output += ESC_POS.LEFT;
    output += kitchenNote + LF;
  }
  
  // === FOOTER 영역 ===
  // showInFooter가 true인 요소들 출력
  output += LF;
  
  headerKeys.forEach(key => {
    const style = ticketLayout[key];
    if (!style || style.visible === false) return;
    if (!style.showInFooter) return; // showInFooter가 true인 것만
    
    const footerStyle = { ...style, ...getStyleBoost(key, style) };
    output += renderElement(key, footerStyle, data, width, LF);
  });
  
  // 시간 구분선 (MM-DD-YY + 접수 시간)
  output += ESC_POS.CENTER;
  const now = new Date();
  const dateTimeStr = formatKitchenTicketFooterDateTime(now);
  const halfWidth = Math.floor((width - dateTimeStr.length - 2) / 2);
  output += getSeparatorLine('dashed', halfWidth) + ' ' + dateTimeStr + ' ' + getSeparatorLine('dashed', halfWidth) + LF;
  output += ESC_POS.LEFT;
  
  // 여백 및 컷
  output += LF + LF + LF;
  output += CUT;
  
  return output;
}

/**
 * 레이아웃 설정을 적용한 Kitchen 아이템 포맷 (완전한 구현)
 */
function formatKitchenItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, width, LF, kitchenTicketElementsStyle) {
  let output = '';
  const qty = item.quantity || item.qty || 1;
  const name = item.name || item.short_name || 'Unknown Item';
  
  // 아이템 라인 - 스타일 완전 적용
  output += getStyleCommand(itemsStyle);
  output += `${qty}x ${name}` + LF;
  output += getStyleResetCommand();
  
  // Kitchen Ticket Elements (sub-items, e.g. Roll Combo: California Roll, Dynamite Roll...)
  const kteStyle = kitchenTicketElementsStyle || { visible: true, prefix: '  - ' };
  const elements = item.kitchenTicketElements || item.kitchen_ticket_elements || [];
  if (kteStyle.visible !== false && Array.isArray(elements) && elements.length > 0) {
    const prefix = kteStyle.prefix || '  - ';
    elements.forEach(el => {
      if (el && String(el.name || '').trim()) {
        const elQty = Math.max(1, parseInt(el.qty, 10) || 1);
        output += getStyleCommand(kteStyle);
        output += `${prefix}${elQty} x ${String(el.name).trim()}` + LF;
        output += getStyleResetCommand();
      }
    });
  }
  
  // 모디파이어
  if (modifiersStyle.visible !== false && item.modifiers && item.modifiers.length > 0) {
    output += getStyleCommand(modifiersStyle);
    const prefix = modifiersStyle.prefix || '>>';
    item.modifiers.forEach(mod => {
      if (typeof mod === 'string') {
        output += `  ${prefix} ${mod}` + LF;
      } else if (mod.name) {
        output += `  ${prefix} ${mod.name}` + LF;
      } else if (mod.modifierNames && mod.modifierNames.length > 0) {
        mod.modifierNames.forEach(modName => {
          output += `  ${prefix} ${modName}` + LF;
        });
      } else if (mod.selectedEntries && mod.selectedEntries.length > 0) {
        mod.selectedEntries.forEach(entry => {
          if (entry.name) output += `  ${prefix} ${entry.name}` + LF;
        });
      } else if (mod.groupName) {
        output += `  ${prefix} ${mod.groupName}` + LF;
      }
    });
  }
  
  // 모디파이어 스타일 리셋
  if (modifiersStyle.visible !== false && item.modifiers && item.modifiers.length > 0) {
    output += getStyleResetCommand();
  }
  
  // 아이템 메모
  if (itemNoteStyle.visible !== false && item.memo) {
    output += getStyleCommand(itemNoteStyle);
    const prefix = itemNoteStyle.prefix || '->';
    let memoText = typeof item.memo === 'string' ? item.memo : item.memo.text;
    if (memoText) {
      output += `  ${prefix} ${memoText}` + LF;
    }
    output += getStyleResetCommand();
  }
  
  return output;
}

/**
 * Receipt/Bill용 요소 값 가져오기
 */
function getReceiptElementValue(key, data, layout) {
  const { receiptData, header, orderInfo } = data;
  
  switch (key) {
    case 'storeName':
      return layout?.storeName?.text || '';
    case 'storeAddress':
      return layout?.storeAddress?.text || '';
    case 'storePhone':
      return layout?.storePhone?.text || '';
    case 'orderNumber':
      return header.orderNumber || orderInfo.orderNumber || receiptData.orderNumber || '';
    case 'orderChannel':
      const channel = (header.channel || orderInfo.channel || orderInfo.orderType || 'POS').toUpperCase();
      const table = header.tableName || orderInfo.tableName || orderInfo.table || '';
      if (channel === 'DINE-IN' || channel === 'POS') {
        return table ? `DINE-IN / ${table}` : 'DINE-IN';
      }
      return channel;
    case 'serverName':
      return header.serverName || orderInfo.serverName || '';
    case 'dateTime':
      return new Date().toLocaleString();
    default:
      return '';
  }
}

/**
 * 레이아웃 설정을 적용한 ESC/POS Receipt/Bill 빌드 (완전한 구현)
 * @param {Object} receiptData - 영수증 데이터
 * @param {Object} layout - 레이아웃 설정 (receiptLayout, billLayout)
 * @param {string} type - 'receipt' | 'bill'
 */
function buildReceiptTextWithLayout(receiptData, layout, type = 'receipt') {
  const { LF, CUT } = ESC_POS;
  const width = layout?.paperWidth === 58 ? 32 : 42;
  
  let output = ESC_POS.INIT;

  // Top margin (mm) → feed blank lines.
  // NOTE: Many printers reliably advance paper on LF.
  try {
    const tmRaw = receiptData?.topMargin ?? layout?.topMargin ?? 0;
    const tm = Number(tmRaw);
    if (Number.isFinite(tm) && tm > 0) {
      const mmPerLine = 25.4 / 6; // common ESC/POS default line height (1/6 inch)
      const lines = Math.max(0, Math.round(tm / mmPerLine));
      if (lines > 0) output += (' ' + LF).repeat(lines); // print a blank char then LF (more reliable feed)
    }
  } catch {}
  
  // 데이터 구성
  const header = receiptData.header || {};
  const orderInfo = receiptData.orderInfo || receiptData;
  const data = { receiptData, header, orderInfo };
  
  // === HEADER 영역 ===
  // Store Name
  const storeNameStyle = layout?.storeName || { fontSize: 16, fontWeight: 'bold', visible: true, text: '' };
  if (storeNameStyle.visible !== false && storeNameStyle.text) {
    output += ESC_POS.CENTER;
    // Screenshot form uses inverse store name bar by default
    output += getStyleCommand({ ...storeNameStyle, textAlign: 'center', inverse: storeNameStyle.inverse !== false });
    output += storeNameStyle.text + LF;
    output += getStyleResetCommand();
  }
  
  // Store Address
  const addressStyle = layout?.storeAddress || { fontSize: 10, visible: true, text: '' };
  if (addressStyle.visible !== false && addressStyle.text) {
    output += ESC_POS.CENTER;
    output += getStyleCommand(addressStyle);
    output += addressStyle.text + LF;
    output += getStyleResetCommand();
  }
  
  // Store Phone
  const phoneStyle = layout?.storePhone || { fontSize: 10, visible: true, text: '' };
  if (phoneStyle.visible !== false && phoneStyle.text) {
    output += ESC_POS.CENTER;
    output += getStyleCommand(phoneStyle);
    output += phoneStyle.text + LF;
    output += getStyleResetCommand();
  }
  
  // Separator 1 (After Header)
  const sep1 = layout?.separator1 || { visible: true, style: 'solid' };
  if (sep1.visible !== false && sep1.style !== 'none') {
    output += getSeparatorLine(sep1.style || 'solid', width) + LF;
  }
  
  // === Order Info 영역 ===
  output += ESC_POS.LEFT;
  
  // 주문 정보 추출
  const orderNumber = header.orderNumber || orderInfo.orderNumber || receiptData.orderNumber || '';
  const channel = (header.channel || orderInfo.channel || orderInfo.orderType || 'POS').toUpperCase();
  const tableName = header.tableName || orderInfo.tableName || orderInfo.table || '';
  const serverName = header.serverName || orderInfo.serverName || '';
  const isDineInLike = (channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS');
  
  // Header line like the screenshot: "DINE-IN / T4" (centered, large, not inverse)
  {
    const channelStyle = layout?.orderChannel || layout?.orderType || { fontSize: 18, fontWeight: 'bold', visible: true };
    if (channelStyle.visible !== false) {
      let headerLine = channel;
      if (isDineInLike) headerLine = tableName ? `DINE-IN / ${tableName}` : 'DINE-IN';
      else headerLine = `${channel} #${String(orderNumber).replace('#', '')}`;
      output += ESC_POS.CENTER;
      output += getStyleCommand({ ...channelStyle, textAlign: 'center', inverse: false, fontWeight: channelStyle.fontWeight || 'bold' });
      output += headerLine + LF;
      output += getStyleResetCommand();
      output += ESC_POS.LEFT;
    }
  }

  // Optional order number line (skip for dine-in to match screenshot)
  {
    const orderNumStyle = layout?.orderNumber || { fontSize: 12, visible: false };
    if (!isDineInLike && orderNumStyle.visible !== false && orderNumber) {
      output += getStyleCommand(orderNumStyle);
      output += `Order#: ${orderNumber}` + LF;
      output += getStyleResetCommand();
    }
  }
  
  // Server
  const serverStyle = layout?.serverName || { fontSize: 12, visible: true };
  if (serverStyle.visible !== false && serverName) {
    output += getStyleCommand(serverStyle);
    output += `Server: ${serverName}` + LF;
    output += getStyleResetCommand();
  }
  
  // Date/Time
  const dateTimeStyle = layout?.dateTime || { fontSize: 12, visible: true };
  if (dateTimeStyle.visible !== false) {
    output += getStyleCommand(dateTimeStyle);
    output += `Date: ${new Date().toLocaleString()}` + LF;
    output += getStyleResetCommand();
  }
  
  // Separator 2
  const sep2 = layout?.separator2 || { visible: true, style: 'dashed' };
  if (sep2.visible !== false) {
    output += getSeparatorLine(sep2.style || 'dashed', width) + LF;
  }
  
  // === Items 영역 ===
  const itemsStyle = { fontWeight: 'bold', ...(layout?.items || { fontSize: 12, visible: true }) };
  const modifiersStyle = { fontWeight: 'bold', ...(layout?.modifiers || { fontSize: 10, prefix: '>>', visible: true }) };
  const itemNoteStyle = { fontWeight: 'bold', ...(layout?.itemNote || { fontSize: 10, prefix: '->', visible: true }) };
  const itemDiscountStyle = layout?.itemDiscount || { fontSize: 10, visible: true };
  
  if (receiptData.guestSections && receiptData.guestSections.length > 0) {
    receiptData.guestSections.forEach((section, idx) => {
      if (receiptData.guestSections.length > 1) {
        output += `--- Guest ${section.guestNumber || idx + 1} ---` + LF;
      }
      if (section.items && section.items.length > 0) {
        section.items.forEach(item => {
          output += formatReceiptItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, itemDiscountStyle, width, LF);
        });
      }
    });
  } else if (receiptData.items && receiptData.items.length > 0) {
    receiptData.items.forEach(item => {
      output += formatReceiptItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, itemDiscountStyle, width, LF);
    });
  }
  
  // Separator 3
  const sep3 = layout?.separator3 || { visible: true, style: 'solid' };
  if (sep3.visible !== false) {
    output += getSeparatorLine(sep3.style || 'solid', width) + LF;
  }
  
  // === Totals 영역 ===
  const subtotalStyle = { fontWeight: 'bold', ...(layout?.subtotal || { fontSize: 12, visible: true }) };
  const discountStyle = layout?.discount || { fontSize: 12, visible: true };
  const totalStyle = layout?.total || { fontSize: 16, fontWeight: 'bold', visible: true };
  
  // Subtotal
  if (subtotalStyle.visible !== false && receiptData.subtotal != null) {
    output += getStyleCommand(subtotalStyle);
    output += rightAlignText('Subtotal:', `$${Number(receiptData.subtotal).toFixed(2)}`, width) + LF;
    output += getStyleResetCommand();
  }
  
  // Adjustments (Discounts)
  if (discountStyle.visible !== false && receiptData.adjustments && receiptData.adjustments.length > 0) {
    output += getStyleCommand(discountStyle);
    receiptData.adjustments.forEach(adj => {
      const amount = Number(adj.amount || 0);
      let label = adj.label || adj.name || 'Discount';
      if (amount < 0) label = label.replace(/^Discount\b/, 'D/C');
      const sign = amount < 0 ? '-' : '';
      output += rightAlignText(`${label}:`, `${sign}$${Math.abs(amount).toFixed(2)}`, width) + LF;
    });
    // Net Sales (할인 적용 후 순매출)
    const hasDiscount = receiptData.adjustments.some(adj => Number(adj.amount || 0) < 0);
    if (hasDiscount && receiptData.subtotal != null) {
      const discountSum = receiptData.adjustments.reduce((s, adj) => s + Number(adj.amount || 0), 0);
      const netSales = Number((Number(receiptData.subtotal) + discountSum).toFixed(2));
      output += rightAlignText('Net Sales:', `$${netSales.toFixed(2)}`, width) + LF;
    }
    output += getStyleResetCommand();
  }
  
  // Taxes
  if (receiptData.taxLines && receiptData.taxLines.length > 0) {
    output += getStyleCommand({ fontWeight: 'bold' });
    receiptData.taxLines.forEach(tax => {
      const taxName = tax.name || 'Tax';
      const rateStr = tax.rate ? ` (${tax.rate}%)` : '';
      output += rightAlignText(`${taxName}${rateStr}:`, `$${Number(tax.amount).toFixed(2)}`, width) + LF;
    });
    output += getStyleResetCommand();
  }
  
  // Separator 4 (before Total)
  const sep4 = layout?.separator4 || { visible: true, style: 'solid' };
  if (sep4.visible !== false && sep4.style !== 'none') {
    output += getSeparatorLine(sep4.style || 'solid', width) + LF;
  }
  
  // Total
  if (totalStyle.visible !== false && receiptData.total != null) {
    output += ESC_POS.CENTER;
    output += getStyleCommand({ ...totalStyle, textAlign: 'center', inverse: false, fontWeight: totalStyle.fontWeight || 'bold' });
    output += `TOTAL: $${Number(receiptData.total).toFixed(2)}` + LF;
    output += getStyleResetCommand();
    output += ESC_POS.LEFT;
  }

  // Separator after TOTAL (matches screenshot)
  output += getSeparatorLine('solid', width) + LF;
  
  // === Payment 영역 (Receipt only) ===
  if (type === 'receipt' && receiptData.payments && receiptData.payments.length > 0) {
    output += LF;
    const paymentMethodStyle = layout?.paymentMethod || { fontSize: 12, visible: true };
    const paymentDetailsStyle = layout?.paymentDetails || paymentMethodStyle;

    // Match graphic mode rules: Payment total (incl tip) + per-method food portion lines
    const prettyMethod = (m) => {
      const upper = String(m || 'OTHER').toUpperCase();
      const map = { CASH: 'Cash', DEBIT: 'Debit', VISA: 'Visa', MC: 'MC', MASTERCARD: 'MC', OTHER_CARD: 'Other Card', OTHER: 'Other' };
      return map[upper] || upper;
    };
    const dineOrTogoTag = isDineInLike ? 'Dine-in' : 'Togo';

    const foodByMethod = {};
    let grossPaidTotal = 0;
    (receiptData.payments || []).forEach((p) => {
      const method = String((p && p.method) || 'OTHER').toUpperCase();
      const amount = Number((p && p.amount) || 0);
      const tipField = Number((p && p.tip) || 0);
      grossPaidTotal += amount;
      const foodPortion = Math.max(0, Number((amount - tipField).toFixed(2)));
      foodByMethod[method] = Number(((foodByMethod[method] || 0) + foodPortion).toFixed(2));
    });

    if (paymentMethodStyle.visible !== false) {
      output += getStyleCommand(paymentMethodStyle);
      output += rightAlignText('Payment', `$${Number(grossPaidTotal).toFixed(2)}`, width) + LF;
      output += getStyleResetCommand();
    }

    if (paymentDetailsStyle?.visible !== false) {
      output += getStyleCommand(paymentDetailsStyle);
      Object.entries(foodByMethod).forEach(([method, totalAmount]) => {
        if (Number(totalAmount || 0) <= 0) return;
        output += rightAlignText(`  ${prettyMethod(method)}(${dineOrTogoTag})`, `$${Number(totalAmount).toFixed(2)}`, width) + LF;
      });
      output += getStyleResetCommand();
    }

    (receiptData.payments || []).forEach((p) => {
      const rawRef = p.ref || p.terminalRef;
      if (!rawRef) return;
      const { host, auth } = splitStoredTetraRef(rawRef);
      const pds =
        paymentDetailsStyle && typeof paymentDetailsStyle === 'object'
          ? paymentDetailsStyle
          : { fontSize: 10, visible: true };
      output += getStyleCommand({ ...pds, fontSize: pds.fontSize || 10 });
      if (host) {
        output += rightAlignText('  Ref:', truncateForReceipt(host, width - 6), width) + LF;
      }
      if (auth) {
        output += rightAlignText('  Auth:', truncateForReceipt(auth, width - 6), width) + LF;
      }
      output += getStyleResetCommand();
    });
    
    // Cash Tendered
    if (receiptData.cashTendered && Number(receiptData.cashTendered) > 0) {
      output += ESC_POS.CENTER;
      output += getStyleCommand({ fontSize: 12, textAlign: 'center', fontWeight: 'bold' });
      output += ` CASH TENDERED: $${Number(receiptData.cashTendered).toFixed(2)} ` + LF;
      output += getStyleResetCommand();
      output += ESC_POS.LEFT;
    }
    // Change
    const changeStyle = layout?.changeAmount || { fontSize: 12, visible: true, inverse: false };
    if (changeStyle.visible !== false && receiptData.change && Number(receiptData.change) > 0) {
      output += ESC_POS.CENTER;
      output += getStyleCommand({ ...changeStyle, textAlign: 'center', inverse: true, fontWeight: changeStyle.fontWeight || 'bold' });
      output += ` CHANGE: $${Number(receiptData.change).toFixed(2)} ` + LF;
      output += getStyleResetCommand();
      output += ESC_POS.LEFT;
    }
  }
  
  // === Footer ===
  output += LF;
  output += ESC_POS.CENTER;

  const footerText = receiptData.footer?.message || layout?.greeting?.text || (type === 'bill' ? 'Thank you for dining with us!' : 'Thank you! Please come again!');
  const greetingStyle = layout?.greeting || { visible: true, fontSize: 12, fontWeight: 'regular', textAlign: 'center' };
  if (greetingStyle.visible !== false && footerText) {
    output += getStyleCommand({ ...greetingStyle, textAlign: 'center', inverse: false, fontWeight: greetingStyle.fontWeight || 'regular' });
    output += footerText + LF;
    output += getStyleResetCommand();
  }
  
  output += ESC_POS.LEFT;
  
  // 여백 및 컷
  output += LF + LF + LF;
  output += CUT;
  
  return output;
}

/**
 * 레이아웃 설정을 적용한 Receipt 아이템 포맷 (완전한 구현)
 */
function formatReceiptItemWithLayout(item, itemsStyle, modifiersStyle, itemNoteStyle, itemDiscountStyle, width, LF) {
  let output = '';
  const qty = item.quantity || item.qty || 1;
  const name = item.name || 'Unknown';
  const unitPriceRaw = Number(item.price || item.itemPrice || 0);
  const unitPrice = Number.isFinite(unitPriceRaw) ? unitPriceRaw : 0;
  const totalRaw = unitPrice > 0 ? (unitPrice * qty) : Number(item.lineTotal || item.totalPrice || item.price || 0);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;
  const unitLabel = (qty > 1 && unitPrice > 0) ? ` @$${unitPrice.toFixed(2)}` : '';
  
  // 아이템 라인 - 스타일 적용
  output += getStyleCommand(itemsStyle);
  output += rightAlignText(`${qty}x ${name}${unitLabel}`, `$${total.toFixed(2)}`, width) + LF;
  output += getStyleResetCommand();

  // Dine-in item-level TOGO label (separate from orderType TOGO)
  if (item.togoLabel || item.togo_label) {
    const st = (modifiersStyle && typeof modifiersStyle === 'object') ? modifiersStyle : { fontSize: 10 };
    output += getStyleCommand({ ...st, inverse: false, visible: true });
    output += `  <<TOGO>>` + LF;
    output += getStyleResetCommand();
  }
  
  // 원래 가격과 할인 표시
  if (itemDiscountStyle.visible !== false && item.originalTotal && item.discount) {
    output += getStyleCommand(itemDiscountStyle);
    output += rightAlignText(`   (was $${Number(item.originalTotal).toFixed(2)})`, '', width) + LF;
    output += rightAlignText(`   ${item.discount.type}:`, `-$${Number(item.discount.amount).toFixed(2)}`, width) + LF;
    output += getStyleResetCommand();
  }
  
  // 모디파이어
  if (modifiersStyle.visible !== false && item.modifiers && item.modifiers.length > 0) {
    output += getStyleCommand(modifiersStyle);
    const prefix = '+';
    item.modifiers.forEach(mod => {
      if (typeof mod === 'string') {
        output += `  ${prefix} ${mod}` + LF;
      } else if (mod.name) {
        const p = Number(mod.price || mod.price_delta || 0);
        const modTotal = (qty > 1 && p > 0) ? (p * qty) : p;
        const modPrice = modTotal > 0 ? `$${Number(modTotal).toFixed(2)}` : '';
        output += rightAlignText(`  ${prefix} ${mod.name}`, modPrice, width) + LF;
      } else if (mod.modifierNames && mod.modifierNames.length > 0) {
        mod.modifierNames.forEach((modName, idx) => {
          let modPrice = '';
          if (mod.selectedEntries && mod.selectedEntries[idx] && mod.selectedEntries[idx].price_delta > 0) {
            const p = Number(mod.selectedEntries[idx].price_delta || 0);
            const modTotal = (qty > 1 && p > 0) ? (p * qty) : p;
            modPrice = `$${Number(modTotal).toFixed(2)}`;
          }
          output += rightAlignText(`  ${prefix} ${modName}`, modPrice, width) + LF;
        });
      } else if (mod.selectedEntries && mod.selectedEntries.length > 0) {
        mod.selectedEntries.forEach(entry => {
          if (entry.name) {
            const p = Number(entry.price_delta || 0);
            const modTotal = (qty > 1 && p > 0) ? (p * qty) : p;
            const modPrice = modTotal > 0 ? `$${Number(modTotal).toFixed(2)}` : '';
            output += rightAlignText(`  ${prefix} ${entry.name}`, modPrice, width) + LF;
          }
        });
      }
    });
    output += getStyleResetCommand();
  }
  
  // 아이템 메모
  if (itemNoteStyle.visible !== false && item.memo) {
    output += getStyleCommand(itemNoteStyle);
    const prefix = '*';
    let memoText = typeof item.memo === 'string' ? item.memo : item.memo.text;
    if (memoText) {
      output += `  ${prefix} ${memoText}` + LF;
    }
    output += getStyleResetCommand();
  }
  
  return output;
}

/**
 * ESC/POS Kitchen Ticket 빌드 (레이아웃 적용)
 */
function buildEscPosKitchenTicket(orderData, layout = null) {
  if (layout) {
    return buildEscPosKitchenTicketWithLayout(orderData, layout);
  }
  return buildKitchenTicketText(orderData);
}

/**
 * Image Kitchen Ticket 빌드 (레이아웃 적용)
 */
function buildImageKitchenTicket(orderData, layout = null) {
  if (layout) {
    return buildEscPosKitchenTicketWithLayout(orderData, layout);
  }
  return buildKitchenTicketText(orderData);
}

/**
 * ESC/POS 바이너리 데이터를 Windows 프린터로 출력
 * 그래픽 모드 이미지 출력에 사용 (Raw Printing API 사용)
 * @param {string} printerName - 프린터 이름
 * @param {Buffer|string} data - ESC/POS 바이너리 데이터
 * @param {number} copies - 출력 매수
 */
async function printEscPosToWindows(printerName, data, copies = 1) {
  // Buffer가 아니면 Buffer로 변환
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
  
  for (let i = 0; i < copies; i++) {
    console.log(`[Printer] Printing ESC/POS copy ${i + 1}/${copies} to ${printerName || 'default printer'} (${buffer.length} bytes)`);
    await sendRawToPrinter(printerName, buffer);
  }
  
  console.log(`[Printer] Successfully printed ${copies} ESC/POS copies`);
  return { success: true, copies };
}

/**
 * Raw 바이너리 데이터를 프린터에 전송 (Cash Drawer 열기 등)
 * @param {string} printerName - 프린터 이름
 * @param {Buffer} buffer - 전송할 바이너리 데이터
 */
async function printRawToWindows(printerName, buffer) {
  try {
    // 임시 파일 생성 (바이너리 모드)
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `raw_${Date.now()}.bin`);
    
    // Buffer를 바이너리 파일로 저장
    fs.writeFileSync(tempFile, buffer);
    
    // PowerShell로 Raw 출력 - 바이너리 파일을 읽어서 프린터로 전송
    const printerArg = printerName ? `"${printerName}"` : '(Get-WmiObject Win32_Printer | Where-Object {$_.Default -eq $true}).Name';
    const cmd = `powershell -Command "$bytes = [System.IO.File]::ReadAllBytes('${tempFile.replace(/\\/g, '\\\\')}'); $port = New-Object System.IO.FileStream('\\\\localhost\\${printerName}', [System.IO.FileMode]::OpenOrCreate); $port.Write($bytes, 0, $bytes.Length); $port.Close()"`;
    
    console.log(`[Printer] Sending raw data to ${printerName || 'default printer'}`);
    try {
      await execAsync(cmd);
    } catch (psErr) {
      // PowerShell 방식이 실패하면 Out-Printer로 시도
      console.log('[Printer] Raw method failed, trying Out-Printer...');
      const text = buffer.toString('latin1');
      const textFile = path.join(tempDir, `raw_text_${Date.now()}.txt`);
      fs.writeFileSync(textFile, text, 'latin1');
      const altCmd = `powershell "Get-Content '${textFile.replace(/\\/g, '\\\\')}' -Encoding Byte | Out-Printer ${printerName ? `-PrinterName '${printerName}'` : ''}"`;
      try {
        await execAsync(altCmd);
      } catch {
        // 최후의 방법: 텍스트로 출력
        await printTextToWindows(printerName, text, 1);
      }
      try { fs.unlinkSync(textFile); } catch {}
    }
    
    // 임시 파일 삭제
    try { fs.unlinkSync(tempFile); } catch {}
    
    console.log(`[Printer] Raw data sent successfully`);
    return { success: true };
  } catch (error) {
    console.error('[Printer] Raw print failed:', error);
    throw error;
  }
}

module.exports = {
  formatKitchenTicketFooterDateTime,
  getWindowsPrinters,
  extractIPFromPort,
  printTextToWindows,
  printRawToWindows,
  sendRawToPrinter,
  buildKitchenTicketText,
  buildReceiptText,
  buildEscPosKitchenTicket,
  buildImageKitchenTicket,
  printEscPosToWindows,
  // 레이아웃 설정 적용 함수들
  buildEscPosKitchenTicketWithLayout,
  buildReceiptTextWithLayout,
  ESC_POS
}; 