// backend/routes/app-settings.js
// 시스템 설정 관리 API

const express = require('express');
const router = express.Router();
const { db, dbRun, dbAll, dbGet } = require('../db');

/**
 * GET /api/app-settings
 * 모든 설정 조회
 */
router.get('/', async (req, res) => {
  try {
    const settings = await dbAll('SELECT setting_key, setting_value, description FROM app_settings');
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.setting_key] = s.setting_value;
    });
    res.json(settingsObj);
  } catch (err) {
    console.error('[app-settings] Error fetching settings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/app-settings/:key
 * 특정 설정 조회
 */
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const setting = await dbGet('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]);
    if (!setting) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json({ key, value: setting.setting_value });
  } catch (err) {
    console.error('[app-settings] Error fetching setting:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/app-settings/:key
 * 설정 업데이트
 */
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'value is required' });
    }

    await dbRun(
      `INSERT OR REPLACE INTO app_settings (setting_key, setting_value, description, updated_at) 
       VALUES (?, ?, COALESCE(?, (SELECT description FROM app_settings WHERE setting_key = ?)), datetime('now'))`,
      [key, value, description, key]
    );

    res.json({ success: true, key, value });
  } catch (err) {
    console.error('[app-settings] Error updating setting:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/app-settings
 * 여러 설정 일괄 업데이트
 */
router.post('/', async (req, res) => {
  try {
    const { settings } = req.body; // { key1: value1, key2: value2, ... }

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object is required' });
    }

    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
      await dbRun(
        `INSERT OR REPLACE INTO app_settings (setting_key, setting_value, updated_at) 
         VALUES (?, ?, datetime('now'))`,
        [key, String(value)]
      );
      updates.push({ key, value });
    }

    res.json({ success: true, updated: updates });
  } catch (err) {
    console.error('[app-settings] Error bulk updating settings:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
