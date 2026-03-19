// backend/routes/settings-transfer.js
// POS 설정 데이터 Export/Import API (메뉴, 테이블맵, 주문페이지 레이아웃)

const express = require('express');
const { getLocalDatetimeString, getLocalDateString, getLocalTimestampForFilename } = require('../utils/datetimeUtils');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, dbRun, dbAll, dbGet } = require('../db');

const TRANSFER_VERSION = '1.0';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Manager 권한 확인
function requireManager(req, res, next) {
  const role = String(req.headers['x-role'] || '').toUpperCase();
  if (role === 'ADMIN' || role === 'MANAGER') return next();
  return res.status(403).json({ error: 'Manager role required' });
}


// multer 설정 (JSON 파일 업로드)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  }
});

// 백업 디렉토리
const backupsDir = process.env.BACKUPS_PATH || path.join(__dirname, '..', 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

// =====================================================
// EXPORT API
// =====================================================
router.post('/export', requireManager, async (req, res) => {
  try {
    const { sections = ['menu', 'tablemap', 'layout'] } = req.body;
    const exportData = {
      version: TRANSFER_VERSION,
      exportedAt: getLocalDatetimeString(),
      sections: {}
    };

    // --- 메뉴 데이터 ---
    if (sections.includes('menu')) {
      const menus = await dbAll('SELECT menu_id, name, description, is_active, sales_channels, created_at FROM menus');
      const categories = await dbAll('SELECT category_id, name, menu_id, sort_order, image_url FROM menu_categories');
      const items = await dbAll('SELECT item_id, name, short_name, price, price2, description, category_id, menu_id, is_open_price, image_url, sort_order, online_visible, delivery_visible, online_hide_type, online_available_until, delivery_hide_type, delivery_available_until, kitchen_ticket_elements FROM menu_items');
      const modifierGroups = await dbAll('SELECT modifier_group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted, firebase_id FROM modifier_groups');
      const modifiers = await dbAll('SELECT modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted FROM modifiers');
      const modifierGroupLinks = await dbAll('SELECT modifier_group_id, modifier_id FROM modifier_group_links');
      const modifierLabels = await dbAll('SELECT label_id, modifier_group_id, label_name FROM modifier_labels');
      const menuModifierLinks = await dbAll('SELECT item_id, modifier_group_id FROM menu_modifier_links');
      const categoryModifierLinks = await dbAll('SELECT category_id, modifier_group_id FROM category_modifier_links');
      const taxGroups = await dbAll('SELECT * FROM tax_groups');
      const taxes = await dbAll('SELECT * FROM taxes');
      const taxGroupLinks = await dbAll('SELECT * FROM tax_group_links');
      const menuTaxLinks = await dbAll('SELECT * FROM menu_tax_links');
      const categoryTaxLinks = await dbAll('SELECT * FROM category_tax_links');
      const printerGroups = await dbAll('SELECT * FROM printer_groups');
      const printerGroupLinks = await dbAll('SELECT * FROM printer_group_links');
      const menuPrinterLinks = await dbAll('SELECT * FROM menu_printer_links');
      const categoryPrinterLinks = await dbAll('SELECT * FROM category_printer_links');

      exportData.sections.menu = {
        menus, categories, items,
        modifierGroups, modifiers, modifierGroupLinks, modifierLabels,
        menuModifierLinks, categoryModifierLinks,
        taxGroups, taxes, taxGroupLinks, menuTaxLinks, categoryTaxLinks,
        printerGroups, printerGroupLinks, menuPrinterLinks, categoryPrinterLinks
      };
    }

    // --- 테이블맵 데이터 ---
    if (sections.includes('tablemap')) {
      const elements = await dbAll(
        'SELECT element_id, floor, type, x_pos, y_pos, width, height, rotation, name, fontSize, color, status, current_order_id FROM table_map_elements'
      );
      const screenSettings = await dbAll('SELECT floor, width, height, scale FROM table_map_screen_settings');

      exportData.sections.tablemap = { elements, screenSettings };
    }

    // --- 주문페이지 레이아웃 ---
    if (sections.includes('layout')) {
      const orderPageSetups = await dbAll('SELECT order_type, menu_id, menu_name, price_type FROM order_page_setups');
      const layoutSettings = await dbAll('SELECT * FROM layout_settings');
      const menuItemColors = await dbAll('SELECT item_id, color FROM menu_item_colors');

      exportData.sections.layout = { orderPageSetups, layoutSettings, menuItemColors };
    }

    res.json({ success: true, data: exportData });
  } catch (e) {
    console.error('[Settings Transfer] Export failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// =====================================================
// IMPORT API
// =====================================================
router.post('/import', requireManager, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    let importData;
    try {
      importData = JSON.parse(req.file.buffer.toString('utf-8'));
    } catch (parseErr) {
      return res.status(400).json({ success: false, error: 'Invalid JSON file' });
    }

    if (!importData.version || !importData.sections) {
      return res.status(400).json({ success: false, error: 'Invalid settings transfer file format' });
    }

    const sectionsToImport = req.body.sections
      ? (typeof req.body.sections === 'string' ? JSON.parse(req.body.sections) : req.body.sections)
      : Object.keys(importData.sections);

    // --- 백업 생성 ---
    const backupTimestamp = getLocalTimestampForFilename();
    const backupFilename = `settings_backup_${backupTimestamp}.json`;
    const backupSections = {};

    for (const section of sectionsToImport) {
      if (section === 'menu') {
        backupSections.menu = {
          menus: await dbAll('SELECT * FROM menus'),
          categories: await dbAll('SELECT * FROM menu_categories'),
          items: await dbAll('SELECT * FROM menu_items'),
          modifierGroups: await dbAll('SELECT * FROM modifier_groups'),
          modifiers: await dbAll('SELECT * FROM modifiers'),
          modifierGroupLinks: await dbAll('SELECT * FROM modifier_group_links'),
          modifierLabels: await dbAll('SELECT * FROM modifier_labels'),
          menuModifierLinks: await dbAll('SELECT * FROM menu_modifier_links'),
          categoryModifierLinks: await dbAll('SELECT * FROM category_modifier_links'),
          taxGroups: await dbAll('SELECT * FROM tax_groups'),
          taxes: await dbAll('SELECT * FROM taxes'),
          taxGroupLinks: await dbAll('SELECT * FROM tax_group_links'),
          menuTaxLinks: await dbAll('SELECT * FROM menu_tax_links'),
          categoryTaxLinks: await dbAll('SELECT * FROM category_tax_links'),
          printerGroups: await dbAll('SELECT * FROM printer_groups'),
          printerGroupLinks: await dbAll('SELECT * FROM printer_group_links'),
          menuPrinterLinks: await dbAll('SELECT * FROM menu_printer_links'),
          categoryPrinterLinks: await dbAll('SELECT * FROM category_printer_links')
        };
      }
      if (section === 'tablemap') {
        backupSections.tablemap = {
          elements: await dbAll('SELECT * FROM table_map_elements'),
          screenSettings: await dbAll('SELECT * FROM table_map_screen_settings')
        };
      }
      if (section === 'layout') {
        backupSections.layout = {
          orderPageSetups: await dbAll('SELECT * FROM order_page_setups'),
          layoutSettings: await dbAll('SELECT * FROM layout_settings'),
          menuItemColors: await dbAll('SELECT * FROM menu_item_colors')
        };
      }
    }

    fs.writeFileSync(
      path.join(backupsDir, backupFilename),
      JSON.stringify({ version: TRANSFER_VERSION, backupAt: getLocalDatetimeString(), sections: backupSections }, null, 2)
    );

    // --- 트랜잭션으로 Import ---
    const summary = { menu: null, tablemap: null, layout: null };

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION', async (beginErr) => {
          if (beginErr) return reject(beginErr);

          try {
            // === 메뉴 Import ===
            if (sectionsToImport.includes('menu') && importData.sections.menu) {
              const m = importData.sections.menu;

              await dbRun('DELETE FROM category_printer_links');
              await dbRun('DELETE FROM menu_printer_links');
              await dbRun('DELETE FROM printer_group_links');
              await dbRun('DELETE FROM printer_groups');
              await dbRun('DELETE FROM category_tax_links');
              await dbRun('DELETE FROM menu_tax_links');
              await dbRun('DELETE FROM tax_group_links');
              await dbRun('DELETE FROM taxes');
              await dbRun('DELETE FROM tax_groups');
              await dbRun('DELETE FROM category_modifier_links');
              await dbRun('DELETE FROM menu_modifier_links');
              await dbRun('DELETE FROM modifier_labels');
              await dbRun('DELETE FROM modifier_group_links');
              await dbRun('DELETE FROM modifiers');
              await dbRun('DELETE FROM modifier_groups');
              await dbRun('DELETE FROM menu_items');
              await dbRun('DELETE FROM menu_categories');
              await dbRun('DELETE FROM menus');

              for (const row of (m.menus || [])) {
                await dbRun(
                  'INSERT INTO menus (menu_id, name, description, is_active, sales_channels, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                  [row.menu_id, row.name, row.description, row.is_active, row.sales_channels, row.created_at]
                );
              }
              for (const row of (m.categories || [])) {
                await dbRun(
                  'INSERT INTO menu_categories (category_id, name, menu_id, sort_order, image_url) VALUES (?, ?, ?, ?, ?)',
                  [row.category_id, row.name, row.menu_id, row.sort_order, row.image_url]
                );
              }
              for (const row of (m.items || [])) {
                const kteJson = (row.kitchen_ticket_elements != null && row.kitchen_ticket_elements !== '')
                  ? (typeof row.kitchen_ticket_elements === 'string' ? row.kitchen_ticket_elements : JSON.stringify(row.kitchen_ticket_elements || []))
                  : '[]';
                await dbRun(
                  'INSERT INTO menu_items (item_id, name, short_name, price, price2, description, category_id, menu_id, is_open_price, image_url, sort_order, online_visible, delivery_visible, online_hide_type, online_available_until, delivery_hide_type, delivery_available_until, kitchen_ticket_elements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  [row.item_id, row.name, row.short_name, row.price, row.price2, row.description, row.category_id, row.menu_id, row.is_open_price, row.image_url, row.sort_order, row.online_visible, row.delivery_visible, row.online_hide_type, row.online_available_until, row.delivery_hide_type, row.delivery_available_until, kteJson]
                );
              }
              for (const row of (m.modifierGroups || [])) {
                await dbRun(
                  'INSERT INTO modifier_groups (modifier_group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted, firebase_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                  [row.modifier_group_id, row.name, row.selection_type, row.min_selection, row.max_selection, row.menu_id, row.is_deleted, row.firebase_id]
                );
              }
              for (const row of (m.modifiers || [])) {
                await dbRun(
                  'INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  [row.modifier_id, row.name, row.price_delta, row.price_delta2, row.type, row.sort_order, row.is_deleted]
                );
              }
              for (const row of (m.modifierGroupLinks || [])) {
                await dbRun('INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)', [row.modifier_group_id, row.modifier_id]);
              }
              for (const row of (m.modifierLabels || [])) {
                await dbRun('INSERT INTO modifier_labels (label_id, modifier_group_id, label_name) VALUES (?, ?, ?)', [row.label_id, row.modifier_group_id, row.label_name]);
              }
              for (const row of (m.menuModifierLinks || [])) {
                await dbRun('INSERT INTO menu_modifier_links (item_id, modifier_group_id) VALUES (?, ?)', [row.item_id, row.modifier_group_id]);
              }
              for (const row of (m.categoryModifierLinks || [])) {
                await dbRun('INSERT INTO category_modifier_links (category_id, modifier_group_id) VALUES (?, ?)', [row.category_id, row.modifier_group_id]);
              }
              for (const row of (m.taxGroups || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO tax_groups (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.taxes || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO taxes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.taxGroupLinks || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO tax_group_links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.menuTaxLinks || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO menu_tax_links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.categoryTaxLinks || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO category_tax_links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.printerGroups || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO printer_groups (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.printerGroupLinks || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO printer_group_links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.menuPrinterLinks || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO menu_printer_links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }
              for (const row of (m.categoryPrinterLinks || [])) {
                const cols = Object.keys(row);
                const vals = Object.values(row);
                await dbRun(`INSERT INTO category_printer_links (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
              }

              summary.menu = {
                menus: (m.menus || []).length,
                categories: (m.categories || []).length,
                items: (m.items || []).length,
                modifierGroups: (m.modifierGroups || []).length,
                modifiers: (m.modifiers || []).length,
                taxGroups: (m.taxGroups || []).length,
                printerGroups: (m.printerGroups || []).length
              };
            }

            // === 테이블맵 Import ===
            if (sectionsToImport.includes('tablemap') && importData.sections.tablemap) {
              const t = importData.sections.tablemap;

              await dbRun('DELETE FROM table_map_elements');
              await dbRun('DELETE FROM table_map_screen_settings');

              for (const row of (t.elements || [])) {
                await dbRun(
                  'INSERT INTO table_map_elements (element_id, floor, type, x_pos, y_pos, width, height, rotation, name, fontSize, color, status, current_order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  [row.element_id, row.floor ?? '1F', row.type, row.x_pos, row.y_pos, row.width, row.height, row.rotation ?? 0, row.name ?? '', row.fontSize ?? 20, row.color ?? '#3B82F6', row.status ?? 'Available', row.current_order_id ?? null]
                );
              }
              for (const row of (t.screenSettings || [])) {
                await dbRun(
                  'INSERT INTO table_map_screen_settings (floor, width, height, scale) VALUES (?, ?, ?, ?)',
                  [row.floor, row.width, row.height, row.scale]
                );
              }

              summary.tablemap = {
                elements: (t.elements || []).length,
                screenSettings: (t.screenSettings || []).length
              };
            }

            // === 레이아웃 Import ===
            if (sectionsToImport.includes('layout') && importData.sections.layout) {
              const l = importData.sections.layout;

              await dbRun('DELETE FROM order_page_setups');
              await dbRun('DELETE FROM menu_item_colors');

              for (const row of (l.orderPageSetups || [])) {
                const now = getLocalDatetimeString();
                await dbRun(
                  'INSERT INTO order_page_setups (order_type, menu_id, menu_name, price_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                  [row.order_type, row.menu_id, row.menu_name, row.price_type, now, now]
                );
              }

              // layout_settings: id, settings_data, created_at, updated_at 스키마 (setting_key 없음)
              await dbRun('DELETE FROM layout_settings');
              for (const row of (l.layoutSettings || [])) {
                let settingsData = row.settings_data ?? row.setting_value;
                if (settingsData == null) continue;
                if (typeof settingsData === 'object') settingsData = JSON.stringify(settingsData);
                const createdAt = row.created_at || getLocalDatetimeString();
                const updatedAt = row.updated_at || getLocalDatetimeString();
                await dbRun(
                  'INSERT INTO layout_settings (settings_data, created_at, updated_at) VALUES (?, ?, ?)',
                  [String(settingsData), createdAt, updatedAt]
                );
              }

              for (const row of (l.menuItemColors || [])) {
                await dbRun(
                  'INSERT INTO menu_item_colors (item_id, color) VALUES (?, ?)',
                  [row.item_id, row.color]
                );
              }

              summary.layout = {
                orderPageSetups: (l.orderPageSetups || []).length,
                layoutSettings: (l.layoutSettings || []).length,
                menuItemColors: (l.menuItemColors || []).length
              };
            }

            db.run('COMMIT', (commitErr) => {
              if (commitErr) reject(commitErr);
              else resolve();
            });
          } catch (txErr) {
            db.run('ROLLBACK', () => reject(txErr));
          }
        });
      });
    });

    res.json({
      success: true,
      message: 'Settings imported successfully',
      backup: backupFilename,
      summary
    });
  } catch (e) {
    console.error('[Settings Transfer] Import failed:', e);
    const msg = e?.message || String(e);
    res.status(500).json({ success: false, error: msg });
  }
});

// =====================================================
// PREVIEW API (Import 전 미리보기)
// =====================================================
router.post('/preview', requireManager, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    let importData;
    try {
      importData = JSON.parse(req.file.buffer.toString('utf-8'));
    } catch (parseErr) {
      return res.status(400).json({ success: false, error: 'Invalid JSON file' });
    }

    if (!importData.version || !importData.sections) {
      return res.status(400).json({ success: false, error: 'Invalid settings transfer file format' });
    }

    const preview = {
      version: importData.version,
      exportedAt: importData.exportedAt,
      sections: {}
    };

    if (importData.sections.menu) {
      const m = importData.sections.menu;
      preview.sections.menu = {
        menus: (m.menus || []).length,
        categories: (m.categories || []).length,
        items: (m.items || []).length,
        modifierGroups: (m.modifierGroups || []).length,
        modifiers: (m.modifiers || []).length,
        taxGroups: (m.taxGroups || []).length,
        printerGroups: (m.printerGroups || []).length
      };
    }

    if (importData.sections.tablemap) {
      const t = importData.sections.tablemap;
      preview.sections.tablemap = {
        elements: (t.elements || []).length,
        screenSettings: (t.screenSettings || []).length
      };
    }

    if (importData.sections.layout) {
      const l = importData.sections.layout;
      preview.sections.layout = {
        orderPageSetups: (l.orderPageSetups || []).length,
        layoutSettings: (l.layoutSettings || []).length,
        menuItemColors: (l.menuItemColors || []).length
      };
    }

    res.json({ success: true, preview });
  } catch (e) {
    console.error('[Settings Transfer] Preview failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
