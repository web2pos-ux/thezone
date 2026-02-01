const { exec, execSync } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = util.promisify(exec);

/**
 * Windows Raw Printing API를 사용하여 ESC/POS 데이터 전송
 * RawPrinterHelper C# 클래스를 PowerShell에서 동적으로 생성하여 사용
 * @param {string} printerName - 프린터 이름
 * @param {Buffer} data - 전송할 바이너리 데이터
 */
async function sendRawToPrinter(printerName, data) {
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
$result = [RawPrinterHelper]::SendBytesToPrinter("${printerName}", $bytes)
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
 * @param {string} printerName - 프린터 이름 (null이면 기본 프린터 사용)
 * @param {string} text - 출력할 텍스트
 * @param {number} copies - 출력 매수
 */
async function printTextToWindows(printerName, text, copies = 1) {
  try {
    // 임시 파일 생성
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `print_${Date.now()}.txt`);
    
    // 텍스트를 파일로 저장
    fs.writeFileSync(tempFile, text, 'utf8');
    
    for (let i = 0; i < copies; i++) {
      // PowerShell로 출력
      const printerArg = printerName ? `-PrinterName "${printerName}"` : '';
      const cmd = `powershell "Get-Content '${tempFile.replace(/\\/g, '\\\\')}' | Out-Printer ${printerArg}"`;
      
      console.log(`[Printer] Printing copy ${i + 1}/${copies} to ${printerName || 'default printer'}`);
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
 * Kitchen Ticket 텍스트 생성
 */
function buildKitchenTicketText(orderData) {
  const lines = [];
  const width = 42; // 표준 영수증 프린터 폭
  const divider = '='.repeat(width);
  const thinDivider = '-'.repeat(width);
  
  lines.push(divider);
  lines.push(centerText('*** KITCHEN TICKET ***', width));
  lines.push(divider);
  lines.push('');
  
  // 주문 정보
  if (orderData.orderNumber) {
    lines.push(`Order #: ${orderData.orderNumber}`);
  }
  if (orderData.channel) {
    lines.push(`Channel: ${orderData.channel}`);
  }
  if (orderData.tableName) {
    lines.push(`Table: ${orderData.tableName}`);
  }
  if (orderData.customerName) {
    lines.push(`Customer: ${orderData.customerName}`);
  }
  lines.push(`Time: ${new Date().toLocaleString()}`);
  lines.push(thinDivider);
  
  // 아이템 목록
  if (orderData.items && orderData.items.length > 0) {
    orderData.items.forEach(item => {
      const qty = item.quantity || 1;
      const name = item.name || 'Unknown Item';
      lines.push(`${qty}x ${name}`);
      
      // 모디파이어
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach(mod => {
          lines.push(`   + ${mod.name || mod}`);
        });
      }
      
      // 메모
      if (item.memo) {
        const memoText = typeof item.memo === 'string' ? item.memo : item.memo.text;
        if (memoText) {
          lines.push(`   ** ${memoText}`);
        }
      }
    });
  }
  
  lines.push(divider);
  lines.push('');
  lines.push('');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Receipt 텍스트 생성
 */
function buildReceiptText(receiptData) {
  const lines = [];
  const width = 42;
  const divider = '='.repeat(width);
  const thinDivider = '-'.repeat(width);
  
  lines.push(divider);
  lines.push(centerText('*** RECEIPT ***', width));
  lines.push(divider);
  lines.push('');
  
  // 주문 정보
  if (receiptData.orderNumber) {
    lines.push(`Order #: ${receiptData.orderNumber}`);
  }
  if (receiptData.channel) {
    lines.push(`Channel: ${receiptData.channel}`);
  }
  if (receiptData.tableName) {
    lines.push(`Table: ${receiptData.tableName}`);
  }
  lines.push(`Date: ${new Date().toLocaleString()}`);
  lines.push(thinDivider);
  
  // 아이템 목록
  if (receiptData.items && receiptData.items.length > 0) {
    receiptData.items.forEach(item => {
      const qty = item.quantity || 1;
      const name = item.name || 'Unknown';
      const price = Number(item.totalPrice || item.price || 0).toFixed(2);
      const line = `${qty}x ${name}`;
      lines.push(rightAlign(line, `$${price}`, width));
      
      // 모디파이어
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach(mod => {
          const modPrice = mod.price ? `$${Number(mod.price).toFixed(2)}` : '';
          lines.push(rightAlign(`   + ${mod.name || mod}`, modPrice, width));
        });
      }
    });
  }
  
  lines.push(thinDivider);
  
  // 소계
  if (receiptData.subtotal != null) {
    lines.push(rightAlign('Subtotal:', `$${Number(receiptData.subtotal).toFixed(2)}`, width));
  }
  
  // 세금
  if (receiptData.taxLines && receiptData.taxLines.length > 0) {
    receiptData.taxLines.forEach(tax => {
      lines.push(rightAlign(`${tax.name}:`, `$${Number(tax.amount).toFixed(2)}`, width));
    });
  }
  
  lines.push(divider);
  
  // 총액
  if (receiptData.total != null) {
    lines.push(rightAlign('TOTAL:', `$${Number(receiptData.total).toFixed(2)}`, width));
  }
  
  lines.push(divider);
  
  // 결제 정보
  if (receiptData.payments && receiptData.payments.length > 0) {
    lines.push('');
    lines.push('Payment:');
    receiptData.payments.forEach(p => {
      lines.push(rightAlign(`  ${p.method}:`, `$${Number(p.amount).toFixed(2)}`, width));
    });
  }
  
  lines.push('');
  lines.push(centerText('Thank you!', width));
  lines.push('');
  lines.push('');
  lines.push('');
  
  return lines.join('\n');
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
 * ESC/POS Kitchen Ticket 빌드 (stub)
 */
function buildEscPosKitchenTicket(orderData) {
  return buildKitchenTicketText(orderData);
}

/**
 * Image Kitchen Ticket 빌드 (stub)
 */
function buildImageKitchenTicket(orderData) {
  return buildKitchenTicketText(orderData);
}

/**
 * ESC/POS to Windows 출력 (stub)
 */
async function printEscPosToWindows(printerName, data, copies = 1) {
  return printTextToWindows(printerName, data, copies);
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
  getWindowsPrinters,
  extractIPFromPort,
  printTextToWindows,
  printRawToWindows,
  sendRawToPrinter,
  buildKitchenTicketText,
  buildReceiptText,
  buildEscPosKitchenTicket,
  buildImageKitchenTicket,
  printEscPosToWindows
};
