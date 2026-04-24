/**
 * Ingenico Tetra semi-integrated terminal bridge (ECR side).
 * Does not modify payment records — callers use /api/payments after success.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { dbGet } = require('../db');
const { tetraExchange } = require('../services/tetraTerminalClient');
const {
  buildPurchaseRequestInner,
  buildTerminalInfoRequestInner,
  buildDetailedReportRequestInner,
  isApprovedStatus,
  parseTerminalResponseInner,
} = require('../utils/tetraSemiIntegratedProtocol');

const KEY = 'hardware_credit_card';

function defaultSettings() {
  return {
    integrationMode: 'standalone',
    terminalType: 'ingenico_tetra_semi',
    deviceContractRef: '',
    deviceAdminPin: '',
    connectionKind: 'serial',
    connectionPort: '',
    tcpHost: '',
    tcpPort: 0,
    apiEndpoint: '',
    baudRate: 19200,
    timeout: 120,
  };
}

function parseStored(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'string') return base;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return base;
    return { ...base, ...o };
  } catch {
    return base;
  }
}

async function loadHardwareSettings() {
  const row = await dbGet('SELECT setting_value FROM app_settings WHERE setting_key = ?', [KEY]);
  return parseStored(row && row.setting_value);
}

function tetraTransportConfig(settings) {
  let tcpHost = String(settings.tcpHost || '').trim();
  let tcpPort = Number(settings.tcpPort) || 0;
  const ep = String(settings.apiEndpoint || '').trim();
  if ((!tcpHost || !tcpPort) && ep) {
    const m = ep.match(/^([^:\s]+):(\d{1,5})$/);
    if (m) {
      tcpHost = m[1];
      tcpPort = parseInt(m[2], 10);
    }
  }
  return {
    connectionKind: String(settings.connectionKind || 'serial').toLowerCase(),
    connectionPort: String(settings.connectionPort || '').trim(),
    tcpHost,
    tcpPort,
    baudRate: Number(settings.baudRate) || 19200,
  };
}

function assertIntegrated(settings) {
  if (String(settings.integrationMode) !== 'integrated') {
    const err = new Error('Credit card integrationMode must be "integrated" to use the terminal bridge');
    err.code = 'NOT_INTEGRATED';
    throw err;
  }
}

function timeoutOpts(settings) {
  const sec = Math.max(30, Math.min(600, Number(settings.timeout) || 120));
  return {
    ackTimeoutMs: 3000,
    responseTimeoutMs: sec * 1000,
  };
}

/** Map low-level socket/serial errors to operator-friendly text (Korean). */
function friendlyTetraTransportError(e) {
  const raw = String((e && e.message) || e || '');
  const m = raw.toLowerCase();
  if (m.includes('socket has been ended by the other party')) {
    return (
      '[단말 TCP] 상대(단말·방화벽·스위치)가 연결을 끊었습니다. ' +
      '단말 IP·ECR용 포트(SSL/비SSL)가 맞는지, 반통합 대기 상태인지 확인하세요. ' +
      '가능하면 USB(Serial)로 시험해 보세요.'
    );
  }
  if (m.includes('econnrefused')) {
    return '[단말 TCP] 연결이 거절되었습니다. IP·포트·단말 전원·같은 LAN 여부를 확인하세요.';
  }
  if (m.includes('etimedout') || m.includes('timeout waiting for terminal')) {
    return '[단말] 응답이 없거나 시간이 초과되었습니다. 케이블·Wi‑Fi·방화벽을 확인하세요.';
  }
  if (m.includes('no ack from terminal')) {
    return '[단말] ACK가 없습니다. Serial 보드레이트·케이블, TCP 포트(반통합 전용)를 확인하세요.';
  }
  return raw || 'Terminal I/O error';
}

/** GET /api/terminal-tetra/config — safe summary for UI */
router.get('/config', async (req, res) => {
  try {
    const s = await loadHardwareSettings();
    const t = tetraTransportConfig(s);
    const contract = String(s.deviceContractRef || '').trim();
    res.json({
      integrationMode: s.integrationMode,
      terminalType: s.terminalType,
      deviceContractRef: contract || null,
      hasDeviceAdminPin: !!(s.deviceAdminPin && String(s.deviceAdminPin).trim()),
      connectionKind: t.connectionKind,
      hasSerialPath: !!t.connectionPort,
      hasTcpPath: !!(t.tcpHost && t.tcpPort),
      baudRate: t.baudRate,
      timeout: s.timeout,
    });
  } catch (e) {
    console.error('[terminal-tetra] config:', e);
    res.status(500).json({ error: e.message || 'config load failed' });
  }
});

/** POST /api/terminal-tetra/terminal-info — transaction type 42 */
router.post('/terminal-info', async (req, res) => {
  try {
    const settings = await loadHardwareSettings();
    assertIntegrated(settings);
    const inner = buildTerminalInfoRequestInner();
    const result = await tetraExchange(tetraTransportConfig(settings), inner, timeoutOpts(settings));
    res.json({
      success: true,
      raw: result.packets,
      parsed: result.last,
      approved: isApprovedStatus(result.last.status),
    });
  } catch (e) {
    if (e.code === 'NOT_INTEGRATED') {
      return res.status(400).json({ success: false, error: e.message, code: e.code });
    }
    console.error('[terminal-tetra] terminal-info:', e);
    res.status(500).json({ success: false, error: friendlyTetraTransportError(e) });
  }
});

/** POST /api/terminal-tetra/detailed-report — transaction type 30 (connectivity / idle test) */
router.post('/detailed-report', async (req, res) => {
  try {
    const settings = await loadHardwareSettings();
    assertIntegrated(settings);
    const inner = buildDetailedReportRequestInner();
    const result = await tetraExchange(tetraTransportConfig(settings), inner, timeoutOpts(settings));
    res.json({
      success: true,
      raw: result.packets,
      parsed: result.last,
      approved: isApprovedStatus(result.last.status),
    });
  } catch (e) {
    if (e.code === 'NOT_INTEGRATED') {
      return res.status(400).json({ success: false, error: e.message, code: e.code });
    }
    console.error('[terminal-tetra] detailed-report:', e);
    res.status(500).json({ success: false, error: friendlyTetraTransportError(e) });
  }
});

/**
 * POST /api/terminal-tetra/purchase
 * body: { amountCents?: number, amountDollars?: number, invoice?, clerkId?, tenderType? ('0'..'7') }
 */
router.post('/purchase', async (req, res) => {
  try {
    const settings = await loadHardwareSettings();
    assertIntegrated(settings);
    const { amountCents: ac, amountDollars, invoice, clerkId, tenderType, customerRef } = req.body || {};
    let amountCents;
    if (ac != null && ac !== '') amountCents = Math.round(Number(ac));
    else if (amountDollars != null && amountDollars !== '') amountCents = Math.round(Number(amountDollars) * 100);
    else return res.status(400).json({ error: 'amountCents or amountDollars required' });
    const inner = buildPurchaseRequestInner({
      amountCents,
      invoice,
      clerkId,
      tenderType,
      customerRef,
    });
    const result = await tetraExchange(tetraTransportConfig(settings), inner, timeoutOpts(settings));
    const last = result.last;
    const ref = last.fields['112'] || last.fields['412'] || '';
    const auth = last.fields['400'] || '';
    res.json({
      success: true,
      approved: isApprovedStatus(last.status),
      status: last.status,
      multiFlag: last.multiFlag,
      fields: last.fields,
      hostReference: ref,
      authCode: auth,
      rawPackets: result.packets,
    });
  } catch (e) {
    if (e.code === 'NOT_INTEGRATED') {
      return res.status(400).json({ success: false, error: e.message, code: e.code });
    }
    console.error('[terminal-tetra] purchase:', e);
    res.status(500).json({ success: false, error: friendlyTetraTransportError(e) });
  }
});

/** POST /api/terminal-tetra/parse-only — debug: parse a raw inner message (no I/O) */
router.post('/parse-only', (req, res) => {
  try {
    const { inner } = req.body || {};
    if (!inner || typeof inner !== 'string') return res.status(400).json({ error: 'inner string required' });
    res.json({ parsed: parseTerminalResponseInner(inner) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
