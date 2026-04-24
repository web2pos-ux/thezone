/**
 * Hardware settings persisted in app_settings (key: hardware_credit_card).
 * Frontend expects GET/POST /api/settings/hardware/credit-card
 */

'use strict';

const express = require('express');
const router = express.Router();
const { dbGet, dbRun } = require('../db');

const KEY = 'hardware_credit_card';

const defaultSettings = () => ({
  integrationMode: 'standalone',
  terminalType: 'ingenico_tetra_semi',
  terminalId: '',
  /** Ingenico vendor software / contract file ID (e.g. KVMR…); support reference only — not sent on ECR wire */
  deviceContractRef: '',
  /** Terminal admin menu PIN if the device prompts; optional; not used by semi-integrated purchase frames */
  deviceAdminPin: '',
  merchantId: '',
  apiKey: '',
  apiEndpoint: '',
  connectionPort: '',
  connectionKind: 'serial',
  tcpHost: '',
  tcpPort: 0,
  baudRate: 19200,
  timeout: 120,
});

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

router.get('/credit-card', async (req, res) => {
  try {
    const row = await dbGet('SELECT setting_value FROM app_settings WHERE setting_key = ?', [KEY]);
    const settings = parseStored(row && row.setting_value);
    res.json({ settings });
  } catch (e) {
    console.error('[settings-hardware] GET credit-card:', e);
    res.status(500).json({ error: e.message || 'Failed to load settings' });
  }
});

router.post('/credit-card', async (req, res) => {
  try {
    const { settings } = req.body || {};
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object required' });
    }
    const merged = { ...defaultSettings(), ...settings };
    const json = JSON.stringify(merged);
    await dbRun(
      `INSERT INTO app_settings (setting_key, setting_value, description) VALUES (?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`,
      [KEY, json, 'Credit card / Tetra hardware (JSON)']
    );
    res.json({ success: true, settings: merged });
  } catch (e) {
    console.error('[settings-hardware] POST credit-card:', e);
    res.status(500).json({ error: e.message || 'Failed to save settings' });
  }
});

module.exports = router;
