const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { generateNextId, ID_RANGES } = require('../utils/idGenerator');

// ESC/POS command builders (Import from separate utility if possible, but defining here for now)
const { buildEscPosKitchenTicket, buildImageKitchenTicket, printEscPosToWindows } = require('../utils/printerUtils');

// 동일 아이템 병합 유틸리티 (프린트용)
// 같은 메뉴 + 같은 모디파이어 + 같은 메모 + 같은 게스트 → qty 합산
function mergeItemsForPrint(items) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const result = [];
  const mergeMap = new Map();
  const normalizeMemoPayload = (item) => {
    try {
      const raw = item?.memo ?? item?.note ?? item?.specialInstructions ?? '';
      if (!raw) return { text: '', price: 0 };
      if (typeof raw === 'string') {
        const text = raw.replace(/\s+/g, ' ').trim();
        return { text, price: 0 };
      }
      if (typeof raw === 'object') {
        const txt = (raw.text ?? raw.note ?? raw.name ?? raw.specialInstructions ?? '').toString();
        const text = txt.replace(/\s+/g, ' ').trim();
        const price = Number(raw.price || raw.amount || 0) || 0;
        return { text, price: Number(price.toFixed(2)) };
      }
      const text = String(raw).replace(/\s+/g, ' ').trim();
      return { text, price: 0 };
    } catch {
      return { text: '', price: 0 };
    }
  };
  for (const item of items) {
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    const modKey = JSON.stringify(
      modifiers.map(m => {
        const groupId = m.groupId || m.group_id || m.id || '';
        const modifierIds = m.modifierIds || m.modifier_ids || [];
        const modifierNames = m.modifierNames || m.modifier_names || [];
        const name = m.name || '';
        return { groupId: String(groupId), modifierIds: [...(Array.isArray(modifierIds) ? modifierIds : [])].sort(), modifierNames: [...(Array.isArray(modifierNames) ? modifierNames : [])].sort(), name };
      }).sort((a, b) => (a.groupId || '').localeCompare(b.groupId || ''))
    );
    // IMPORTANT: memo can arrive as memo/note/specialInstructions (string or object).
    // If memo differs, items must NOT be merged (prevents 2x + single memo line bug).
    const memoKey = JSON.stringify(normalizeMemoPayload(item));
    const discountKey = JSON.stringify(item.discount || null);
    const guestNumber = item.guestNumber || item.guest_number || 1;
    const itemIdentifier = item.id || item.item_id || item.name || '';
    const priceKey = Number(item.price || 0).toFixed(2);
    const key = `${itemIdentifier}|${priceKey}|${guestNumber}|${modKey}|${memoKey}|${discountKey}`;
    if (mergeMap.has(key)) {
      const idx = mergeMap.get(key);
      const existingQty = result[idx].qty || result[idx].quantity || 1;
      const addQty = item.qty || item.quantity || 1;
      const newQty = existingQty + addQty;
      result[idx] = { ...result[idx], qty: newQty, quantity: newQty };
      if (result[idx].lineTotal != null && item.lineTotal != null) {
        result[idx].lineTotal = Number(result[idx].lineTotal) + Number(item.lineTotal);
      }
      if (result[idx].totalPrice != null && item.totalPrice != null) {
        result[idx].totalPrice = Number(result[idx].totalPrice) + Number(item.totalPrice);
      }
    } else {
      mergeMap.set(key, result.length);
      result.push({ ...item });
    }
  }
  return result;
}

// Graphic mode printer utilities
let graphicPrinterUtils = null;
try {
  graphicPrinterUtils = require('../utils/graphicPrinterUtils');
  console.log('[Printers] Graphic printer utils loaded successfully');
} catch (err) {
  console.warn('[Printers] Graphic printer utils not available:', err.message);
}

// Serial Port utilities for COM port printers (lazy loaded)
let serialPrinterUtils = null;
let serialPrinterError = null;

function getSerialPrinterUtils() {
  if (serialPrinterUtils) return serialPrinterUtils;
  if (serialPrinterError) throw serialPrinterError;
  
  try {
    serialPrinterUtils = require('../utils/serialPrinterUtils');
    console.log('[Printers] Serial printer utils loaded successfully');
    return serialPrinterUtils;
  } catch (err) {
    serialPrinterError = err;
    console.warn('[Printers] Serial printer utils not available:', err.message);
    throw err;
  }
}

module.exports = (db) => {
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // ==================== Printer debug file logging ====================
  // In packaged Electron app, CONFIG_PATH points to <userData>/config.
  // We'll write logs to <userData>/logs/printer-debug.log so issues are traceable even without a terminal.
  const printerLogDir = (() => {
    const env = process.env.LOGS_PATH && String(process.env.LOGS_PATH).trim();
    if (env) return env;
    const cfg = process.env.CONFIG_PATH && String(process.env.CONFIG_PATH).trim();
    if (cfg) return path.resolve(cfg, '..', 'logs');
    const uploads = process.env.UPLOADS_PATH && String(process.env.UPLOADS_PATH).trim();
    if (uploads) return path.resolve(uploads, '..', 'logs');
    return path.resolve(__dirname, '..', 'logs');
  })();
  const printerLogFile = path.join(printerLogDir, 'printer-debug.log');

  function appendPrinterLog(event, data) {
    try {
      if (!fs.existsSync(printerLogDir)) fs.mkdirSync(printerLogDir, { recursive: true });
      const line = `${new Date().toISOString()} ${event}${data ? ' ' + JSON.stringify(data) : ''}\n`;
      fs.appendFileSync(printerLogFile, line, 'utf8');
    } catch (e) {
      // never block printing due to logging issues
    }
  }

  // Log once per process start (helps locate where the file is)
  appendPrinterLog('PRINTER_LOG_READY', { printerLogFile });

  // GET /api/printers/system - Get list of system printers installed on the computer
  router.get('/system', async (req, res) => {
    try {
      const platform = os.platform();
      let printers = [];
      
      if (platform === 'win32') {
        // Windows: Use WMIC to get printers
        try {
          const { stdout } = await execPromise('wmic printer get name', { encoding: 'utf8' });
          const lines = stdout.split('\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'Name');
          
          printers = lines.map((name, index) => ({
            name: name,
            displayName: name,
            isDefault: index === 0
          }));
        } catch (wmicError) {
          console.error('WMIC error, trying PowerShell:', wmicError.message);
          // Fallback to PowerShell
          try {
            const { stdout } = await execPromise('powershell -Command "Get-Printer | Select-Object -Property Name | ConvertTo-Json"', { encoding: 'utf8' });
            const parsed = JSON.parse(stdout);
            const printerList = Array.isArray(parsed) ? parsed : [parsed];
            printers = printerList.map((p, index) => ({
              name: p.Name,
              displayName: p.Name,
              isDefault: index === 0
            }));
          } catch (psError) {
            console.error('PowerShell error:', psError.message);
          }
        }
      } else if (platform === 'darwin') {
        // macOS: Use lpstat
        try {
          const { stdout } = await execPromise('lpstat -p', { encoding: 'utf8' });
          const lines = stdout.split('\n').filter(line => line.startsWith('printer'));
          printers = lines.map((line, index) => {
            const match = line.match(/printer\s+(\S+)/);
            const name = match ? match[1] : line;
            return {
              name: name,
              displayName: name,
              isDefault: index === 0
            };
          });
        } catch (err) {
          console.error('lpstat error:', err.message);
        }
      } else {
        // Linux: Use lpstat
        try {
          const { stdout } = await execPromise('lpstat -p', { encoding: 'utf8' });
          const lines = stdout.split('\n').filter(line => line.startsWith('printer'));
          printers = lines.map((line, index) => {
            const match = line.match(/printer\s+(\S+)/);
            const name = match ? match[1] : line;
            return {
              name: name,
              displayName: name,
              isDefault: index === 0
            };
          });
        } catch (err) {
          console.error('lpstat error:', err.message);
        }
      }
      
      console.log(`[Printers] Found ${printers.length} system printers:`, printers.map(p => p.name));
      res.json(printers);
    } catch (err) {
      console.error('[Printers] Failed to get system printers:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers - Get all printers
  router.get('/', async (req, res) => {
    try {
      const rows = await dbAll('SELECT printer_id as id, name, type, selected_printer as selectedPrinter, sort_order as sortOrder FROM printers WHERE is_active = 1 ORDER BY sort_order, name');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers - Create new printer
  router.post('/', async (req, res) => {
    const { name, type, selectedPrinter, sortOrder } = req.body;
    try {
      const newPrinterId = await generateNextId(db, ID_RANGES.PRINTER);
      await dbRun(
        'INSERT INTO printers (printer_id, name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
        [newPrinterId, name || '', type || '', selectedPrinter || '', sortOrder || 0]
      );
      res.json({ id: newPrinterId, name, type, selectedPrinter, sortOrder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/:id - Update printer
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, selectedPrinter, sortOrder } = req.body;
    try {
      await dbRun(
        'UPDATE printers SET name = ?, type = ?, selected_printer = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE printer_id = ?',
        [name, type, selectedPrinter, sortOrder, id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/:id - Delete printer (soft delete)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE printers SET is_active = 0 WHERE printer_id = ?', [id]);
      await dbRun('DELETE FROM printer_group_links WHERE printer_id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/batch - Save all printers at once (UPSERT to preserve IDs)
  router.post('/batch', async (req, res) => {
    const { printers } = req.body;
    if (!Array.isArray(printers)) {
      return res.status(400).json({ error: 'printers must be an array' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');

      const existingPrinters = await dbAll('SELECT printer_id FROM printers WHERE is_active = 1');
      const existingIds = new Set(existingPrinters.map(p => p.printer_id));
      const incomingIds = new Set();

      const results = [];
      for (const printer of printers) {
        const existingId = printer.id || printer.printer_id;

        if (existingId && existingIds.has(existingId)) {
          await dbRun(
            'UPDATE printers SET name = ?, type = ?, selected_printer = ?, sort_order = ?, is_active = 1 WHERE printer_id = ?',
            [printer.name || '', printer.type || '', printer.selectedPrinter || '', printer.sortOrder || 0, existingId]
          );
          incomingIds.add(existingId);
          results.push({ ...printer, id: existingId });
        } else {
          const newPrinterId = await generateNextId(db, ID_RANGES.PRINTER);
          await dbRun(
            'INSERT INTO printers (printer_id, name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [newPrinterId, printer.name || '', printer.type || '', printer.selectedPrinter || '', printer.sortOrder || 0]
          );
          incomingIds.add(newPrinterId);
          results.push({ ...printer, id: newPrinterId });
        }
      }

      for (const ep of existingPrinters) {
        if (!incomingIds.has(ep.printer_id)) {
          await dbRun('UPDATE printers SET is_active = 0 WHERE printer_id = ?', [ep.printer_id]);
          await dbRun('DELETE FROM printer_group_links WHERE printer_id = ?', [ep.printer_id]);
        }
      }

      await dbRun('COMMIT');
      res.json(results);
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers/groups - Get all printer groups
  router.get('/groups', async (req, res) => {
    try {
      const { menu_id } = req.query;
      let query = 'SELECT printer_group_id as id, name, menu_id, COALESCE(show_label, 1) as show_label FROM printer_groups WHERE is_active = 1';
      const params = [];
      
      if (menu_id) {
        query += ' AND (menu_id = ? OR menu_id IS NULL)';
        params.push(menu_id);
      }
      query += ' ORDER BY name';

      const groups = await dbAll(query, params);
      
      for (const group of groups) {
        // Get full printer details for each group as the frontend expects group.printers
        const printers = await dbAll(
          `SELECT p.printer_id, p.name, p.type, p.selected_printer as ip_address, COALESCE(pgl.copies, 1) as copies
           FROM printer_group_links pgl 
           JOIN printers p ON pgl.printer_id = p.printer_id 
           WHERE pgl.printer_group_id = ? AND p.is_active = 1`,
          [group.id]
        );
        group.printers = printers;
        group.printerIds = printers.map(p => p.printer_id);
      }
      
      res.json(groups);
    } catch (err) {
      console.error('Failed to fetch printer groups:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/groups - Create new printer group
  router.post('/groups', async (req, res) => {
    const { name, printerIds, printers, menu_id, show_label } = req.body;
    // Allow both printerIds (array of IDs) or printers (array of objects with printer_id and copies)
    const printerList = printers && Array.isArray(printers) ? printers : [];
    const finalPrinterIds = printerIds || printerList.map(p => p.printer_id || p.id);

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');
      const newGroupId = await generateNextId(db, ID_RANGES.PRINTER_GROUP);
      await dbRun(
        'INSERT INTO printer_groups (printer_group_id, name, menu_id, is_active, show_label) VALUES (?, ?, ?, 1, ?)',
        [newGroupId, name, menu_id || null, show_label !== undefined ? (show_label ? 1 : 0) : 1]
      );
      
      // Insert printer links with copies
      for (let i = 0; i < finalPrinterIds.length; i++) {
        const printerId = finalPrinterIds[i];
        if (!printerId) continue;
        // Get copies from printers array if available
        const printerInfo = printerList.find(p => (p.printer_id || p.id) === printerId);
        const copies = printerInfo?.copies || 1;
        await dbRun(
          'INSERT OR IGNORE INTO printer_group_links (printer_group_id, printer_id, copies) VALUES (?, ?, ?)',
          [newGroupId, printerId, copies]
        );
      }
      await dbRun('COMMIT');
      res.json({ id: newGroupId, name, printerIds: finalPrinterIds, show_label: show_label !== undefined ? show_label : true });
    } catch (err) {
      if (db.inTransaction) await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/groups/:id - Update printer group
  router.put('/groups/:id', async (req, res) => {
    const { id } = req.params;
    const { name, printerIds, printers, show_label } = req.body;
    // Allow both printerIds (array of IDs) or printers (array of objects with printer_id and copies)
    const printerList = printers && Array.isArray(printers) ? printers : [];
    const finalPrinterIds = printerIds || printerList.map(p => p.printer_id || p.id);

    try {
      await dbRun('BEGIN TRANSACTION');
      if (name !== undefined || show_label !== undefined) {
        const updates = [];
        const params = [];
        if (name !== undefined) {
          updates.push('name = ?');
          params.push(name);
        }
        if (show_label !== undefined) {
          updates.push('show_label = ?');
          params.push(show_label ? 1 : 0);
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);
        await dbRun(
          `UPDATE printer_groups SET ${updates.join(', ')} WHERE printer_group_id = ?`,
          params
        );
      }
      
      await dbRun('DELETE FROM printer_group_links WHERE printer_group_id = ?', [id]);
      // Insert printer links with copies
      for (let i = 0; i < finalPrinterIds.length; i++) {
        const printerId = finalPrinterIds[i];
        if (!printerId) continue;
        // Get copies from printers array if available
        const printerInfo = printerList.find(p => (p.printer_id || p.id) === printerId);
        const copies = printerInfo?.copies || 1;
        await dbRun(
          'INSERT INTO printer_group_links (printer_group_id, printer_id, copies) VALUES (?, ?, ?)',
          [id, printerId, copies]
        );
      }
      await dbRun('COMMIT');
      res.json({ success: true, id: parseInt(id), name, printerIds: finalPrinterIds });
    } catch (err) {
      if (db.inTransaction) await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/groups/:id - Delete printer group (soft delete)
  router.delete('/groups/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('UPDATE printer_groups SET is_active = 0 WHERE printer_group_id = ?', [id]);
      await dbRun('DELETE FROM printer_group_links WHERE printer_group_id = ?', [id]);
      await dbRun('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // Batch for groups (UPSERT to preserve IDs)
  router.post('/groups/batch', async (req, res) => {
    const { groups } = req.body;
    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups must be an array' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');

      const existingGroups = await dbAll('SELECT printer_group_id FROM printer_groups WHERE is_active = 1');
      const existingGroupIds = new Set(existingGroups.map(g => g.printer_group_id));
      const incomingGroupIds = new Set();

      const results = [];
      for (const group of groups) {
        const existingId = group.id || group.printer_group_id;
        let groupId;

        if (existingId && existingGroupIds.has(existingId)) {
          await dbRun(
            'UPDATE printer_groups SET name = ?, is_active = 1, show_label = ?, updated_at = CURRENT_TIMESTAMP WHERE printer_group_id = ?',
            [group.name, group.show_label !== undefined ? (group.show_label ? 1 : 0) : 1, existingId]
          );
          groupId = existingId;
        } else {
          groupId = await generateNextId(db, ID_RANGES.PRINTER_GROUP);
          await dbRun(
            'INSERT INTO printer_groups (printer_group_id, name, is_active, show_label) VALUES (?, ?, 1, ?)',
            [groupId, group.name, group.show_label !== undefined ? (group.show_label ? 1 : 0) : 1]
          );
        }
        incomingGroupIds.add(groupId);

        await dbRun('DELETE FROM printer_group_links WHERE printer_group_id = ?', [groupId]);
        const printerList = group.printers && Array.isArray(group.printers) ? group.printers : [];
        const finalPrinterIds = group.printerIds || printerList.map(p => p.printer_id || p.id);

        if (finalPrinterIds && Array.isArray(finalPrinterIds)) {
          for (const printerId of finalPrinterIds) {
            if (!printerId) continue;
            const printerInfo = printerList.find(p => (p.printer_id || p.id) === printerId);
            const copies = printerInfo?.copies || 1;
            await dbRun(
              'INSERT INTO printer_group_links (printer_group_id, printer_id, copies) VALUES (?, ?, ?)',
              [groupId, printerId, copies]
            );
          }
        }
        results.push({ ...group, id: groupId });
      }

      for (const eg of existingGroups) {
        if (!incomingGroupIds.has(eg.printer_group_id)) {
          await dbRun('UPDATE printer_groups SET is_active = 0 WHERE printer_group_id = ?', [eg.printer_group_id]);
          await dbRun('DELETE FROM printer_group_links WHERE printer_group_id = ?', [eg.printer_group_id]);
        }
      }

      await dbRun('COMMIT');
      res.json(results);
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // Layout settings
  router.get('/layout-settings', async (req, res) => {
    try {
      const row = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
      res.json(row ? JSON.parse(row.settings) : {});
        } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/layout-settings', async (req, res) => {
    try {
      const { settings } = req.body;
      await dbRun('INSERT OR REPLACE INTO printer_layout_settings (id, settings, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)', [JSON.stringify(settings)]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // Print Job APIs
  // ============================================

  /**
   * POST /api/printers/print-text - ESC/POS 텍스트 명령을 직접 프린터로 전송
   * Z-Report, Opening Report 등 텍스트 기반 출력에 사용
   */
  router.post('/print-text', async (req, res) => {
    try {
      const { text, openDrawer = false } = req.body;
      console.log('📝 [Printer API] Print text request received');
      
      if (!text) {
        return res.status(400).json({ success: false, error: 'No text provided' });
      }
      
      // Prefer Front printer. If openDrawer is requested, Front is required.
      const frontPrinter = await dbGet("SELECT selected_printer FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      let pickedBy = 'front';
      if (!targetPrinter && !openDrawer) {
        // Fallback: any active configured printer
        const anyPrinter = await dbGet(
          "SELECT selected_printer FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
        pickedBy = 'first_active';
      }
      
      if (!targetPrinter) {
        console.error('📝 [Printer API] ERROR: No printer configured for text printing!');
        return res.status(400).json({ 
          success: false, 
          error: openDrawer
            ? 'No Front printer configured. Please set up the Front printer in the back office.'
            : 'No printer configured. Please set up a printer in the back office.'
        });
      }
      
      console.log(`📝 [Printer API] Target printer: ${targetPrinter} (pickedBy=${pickedBy})`);
      
      // ESC/POS 초기화 + 텍스트 + 용지 커팅 명령
      const ESC = '\x1B';
      const GS = '\x1D';
      const INIT = ESC + '@'; // 프린터 초기화
      const CUT = GS + 'V' + '\x00'; // Full cut
      
      let printData = INIT + text + '\n\n\n' + CUT;
      
      // Cash Drawer 열기 옵션
      if (openDrawer) {
        const DRAWER_KICK = ESC + 'p' + '\x00' + '\x19' + '\x19';
        printData = DRAWER_KICK + printData;
      }
      
      const printBuffer = Buffer.from(printData, 'binary');
      
      const { sendRawToPrinter } = require('../utils/printerUtils');
      await sendRawToPrinter(targetPrinter, printBuffer);
      
      console.log(`📝 [Printer API] Text sent to printer: ${targetPrinter}`);
      res.json({ success: true, message: 'Text printed successfully', printer: targetPrinter });
    } catch (err) {
      console.error('Print text failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/open-drawer - Cash Drawer 열기
   */
  router.post('/open-drawer', async (req, res) => {
    try {
      console.log('💰 [Printer API] Open cash drawer request received');
      
      // ESC/POS Cash Drawer 열기 명령: ESC p m t1 t2
      // 0x1B 0x70 0x00 0x19 0x19 = ESC p 0 25 25
      const drawerCommand = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0x19]);
      
      // 프린터 찾기 (Front 프린터가 Cash Drawer와 연결됨)
      const frontPrinter = await dbGet("SELECT selected_printer FROM printers WHERE name LIKE '%Front%' LIMIT 1");
      const targetPrinter = frontPrinter?.selected_printer;
      
      // 프린터 이름이 없으면 에러 반환 (기본 프린터로 보내지 않음!)
      if (!targetPrinter) {
        console.error('💰 [Printer API] ERROR: No printer configured for cash drawer!');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured for cash drawer. Please set up a printer in the back office.' 
        });
      }
      
      // Windows Raw Printing API로 ESC/POS 명령 전송
      const { sendRawToPrinter } = require('../utils/printerUtils');
      await sendRawToPrinter(targetPrinter, drawerCommand);
      console.log(`💰 [Printer API] Cash drawer command sent to ${targetPrinter}`);
      
      res.json({ success: true, message: 'Cash drawer opened', printer: targetPrinter });
    } catch (err) {
      console.error('Cash drawer open failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 단일 프린터로 Kitchen Ticket 출력하는 내부 헬퍼
   * @param {string} targetPrinter - Windows 프린터명
   * @param {Object} ticketData - 티켓 데이터 (items, orderInfo 등)
   * @param {string} printMode - 'graphic' | 'text'
   * @param {Object} orderInfo - 주문 정보 (레이아웃 결정용)
   * @param {Object} orderData - 원본 orderData (레이아웃 결정용)
   */
  async function sendKitchenTicketToPrinter(targetPrinter, ticketData, printMode, orderInfo, orderData) {
    const { sendRawToPrinter } = require('../utils/printerUtils');
    const BEEP_CMD = Buffer.from([0x1B, 0x42, 0x03, 0x02]);

    // tableName 보충: ticketData/orderInfo/orderData 어디에도 테이블명이 없으면 tableId로 DB 조회
    try {
      const tn = ticketData?.tableName || ticketData?.header?.tableName || orderInfo?.tableName || orderData?.tableName || ticketData?.table || orderInfo?.table || orderData?.table || '';
      if (!tn) {
        const tid = ticketData?.tableId || ticketData?.table_id || ticketData?.header?.tableId || orderInfo?.tableId || orderInfo?.table_id || orderData?.tableId || orderData?.table_id || '';
        if (tid && String(tid).trim().length >= 4) {
          const row = await dbGet('SELECT name FROM table_map_elements WHERE element_id = ? LIMIT 1', [String(tid)]);
          if (row?.name) {
            ticketData.tableName = row.name;
            ticketData.header = ticketData.header || {};
            ticketData.header.tableName = ticketData.header.tableName || row.name;
            if (orderInfo) orderInfo.tableName = orderInfo.tableName || row.name;
          }
        }
      } else {
        // table만 있고 tableName이 없는 케이스 보정
        if (!ticketData.tableName && tn) ticketData.tableName = tn;
        if (ticketData.header && !ticketData.header.tableName && tn) ticketData.header.tableName = tn;
      }
    } catch (_e) { /* non-blocking */ }

    appendPrinterLog('KT_START', {
      to: targetPrinter,
      printMode,
      orderNumber: orderInfo?.orderNumber || orderData?.orderNumber || null,
      channel: orderInfo?.channel || orderInfo?.orderType || orderData?.channel || orderData?.orderType || null,
      tableName: ticketData?.tableName || ticketData?.header?.tableName || orderInfo?.tableName || orderData?.tableName || '(empty)'
    });
    
    let usedTextMode = false;
    if (printMode === 'graphic') {
      try {
        console.log(`🍳 [Printer API] Printing Kitchen Ticket (GRAPHIC mode) → ${targetPrinter}`);
        const { buildGraphicKitchenTicket } = require('../utils/graphicPrinterUtils');
        const ticketBuffer = buildGraphicKitchenTicket(ticketData, false, true);
        console.log(`🍳 [Printer API] Graphic buffer size: ${ticketBuffer?.length || 0} bytes`);
        appendPrinterLog('KT_GRAPHIC_BUFFER', { to: targetPrinter, bytes: ticketBuffer?.length || 0 });
        
        const bufferWithBeep = Buffer.concat([BEEP_CMD, ticketBuffer]);
        await sendRawToPrinter(targetPrinter, bufferWithBeep);
        console.log(`✅ [Printer API] Kitchen Ticket printed (GRAPHIC) → ${targetPrinter}`);
        appendPrinterLog('KT_GRAPHIC_OK', { to: targetPrinter, bytes: bufferWithBeep?.length || 0 });
      } catch (graphicErr) {
        console.error(`❌ [Printer API] Graphic mode FAILED for ${targetPrinter}:`, graphicErr.message);
        appendPrinterLog('KT_GRAPHIC_FAIL', { to: targetPrinter, error: graphicErr?.message || String(graphicErr) });
        usedTextMode = true;
      }
    } else {
      usedTextMode = true;
    }
    
    if (usedTextMode) {
      console.log(`🍳 [Printer API] Printing Kitchen Ticket (TEXT mode) → ${targetPrinter}`);
      appendPrinterLog('KT_TEXT_START', { to: targetPrinter });
      
      const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
      let ticketLayout = null;
      
      if (layoutRow && layoutRow.settings) {
        try {
          const layoutSettings = JSON.parse(layoutRow.settings);
          const channel = (orderInfo?.channel || orderInfo?.orderType || orderData?.channel || orderData?.orderType || 'DINE-IN').toUpperCase();
          appendPrinterLog('KT_TEXT_CHANNEL', { to: targetPrinter, channel });
          if (channel === 'DELIVERY') {
            ticketLayout = layoutSettings.deliveryKitchen;
          } else if (channel === 'TOGO' || channel === 'ONLINE' || channel === 'PICKUP') {
            ticketLayout = layoutSettings.externalKitchen;
          } else {
            ticketLayout = layoutSettings.dineInKitchen;
          }
          if (!ticketLayout) {
            ticketLayout = { kitchenPrinter: layoutSettings.kitchenLayout };
          }
        } catch (parseErr) {
          console.warn('🍳 [Printer API] Failed to parse layout settings:', parseErr);
        }
      }
      
      const { buildEscPosKitchenTicketWithLayout, buildKitchenTicketText } = require('../utils/printerUtils');
      const ticketText = ticketLayout 
        ? buildEscPosKitchenTicketWithLayout(ticketData, ticketLayout)
        : buildKitchenTicketText(ticketData);
      
      const beepStr = '\x1B\x42\x03\x02';
      const ticketBuffer = Buffer.from(beepStr + ticketText, 'binary');
      await sendRawToPrinter(targetPrinter, ticketBuffer);
      console.log(`✅ [Printer API] Kitchen Ticket printed (TEXT) → ${targetPrinter}`);
      appendPrinterLog('KT_TEXT_OK', { to: targetPrinter, bytes: ticketBuffer?.length || 0 });
    }
  }

  /**
   * POST /api/printers/print-order - Kitchen Ticket 출력 (프린터 그룹 라우팅 지원)
   * 각 아이템의 printerGroupIds를 기반으로 해당 프린터 그룹에 연결된 개별 프린터로 각각 출력
   */
  router.post('/print-order', async (req, res) => {
    try {
      const { orderData, items, orderInfo, copies = 1, printerName, isPaid, isReprint, isAdditionalOrder, printMode = 'graphic', printerGroupName, showLabel, topMargin } = req.body;
      console.log(`🍳 [Printer API] Print Kitchen Ticket request received (mode: ${printMode})`);
      console.log(`🍳 [Printer API] Items count: ${items?.length || 0}`);
      console.log(`🍳 [TABLE-DEBUG] BEFORE orderInfo.table="${orderInfo?.table}" orderInfo.tableName="${orderInfo?.tableName}" orderInfo.tableId="${orderInfo?.tableId}" orderData?.tableName="${orderData?.tableName}" orderData?.tableId="${orderData?.tableId}"`);

      // ★ 핵심 수정: tableName이 비어있고 tableId가 있으면, DB에서 테이블명을 조회해서 orderInfo에 채움
      // 프론트엔드에서 resolvedTableName이 비동기 타이머(300ms) 뒤에 결정되어 빈 문자열이 올 수 있음
      try {
        const existingTableName = orderInfo?.tableName || orderInfo?.table || orderData?.tableName || orderData?.table || '';
        const existingTableId = orderInfo?.tableId || orderInfo?.table_id || orderData?.tableId || orderData?.table_id || '';
        if (!existingTableName && existingTableId && String(existingTableId).trim().length >= 4) {
          const tRow = await dbGet('SELECT name FROM table_map_elements WHERE element_id = ? LIMIT 1', [String(existingTableId)]);
          if (tRow?.name) {
            console.log(`🍳 [TABLE-DEBUG] Resolved tableId="${existingTableId}" => tableName="${tRow.name}" from DB`);
            if (orderInfo) {
              orderInfo.tableName = tRow.name;
              orderInfo.table = tRow.name;
            }
            if (orderData) {
              orderData.tableName = orderData.tableName || tRow.name;
            }
          }
        }
      } catch (_e) { /* non-blocking */ }
      console.log(`🍳 [TABLE-DEBUG] AFTER orderInfo.table="${orderInfo?.table}" orderInfo.tableName="${orderInfo?.tableName}"`);

      appendPrinterLog('PRINT_ORDER_REQ', {
        itemsCount: items?.length || 0,
        printMode,
        printerName: printerName || null,
        isPaid: !!isPaid,
        isReprint: !!isReprint,
        isAdditionalOrder: !!isAdditionalOrder,
        orderNumber: orderInfo?.orderNumber || orderData?.orderNumber || null,
        channel: orderInfo?.channel || orderData?.channel || null,
        deliveryCompany: orderInfo?.deliveryCompany || orderInfo?.deliveryChannel || null,
        deliveryOrderNumber: orderInfo?.deliveryOrderNumber || orderInfo?.externalOrderNumber || null
      });
      
      // Debug: Log first item
      if (items && items.length > 0) {
        const firstItem = items[0];
        console.log(`🍳 [Printer API] First item:`, {
          name: firstItem.name,
          printerGroupIds: firstItem.printerGroupIds,
          modifiers: firstItem.modifiers?.length || 0,
          memo: firstItem.memo
        });
      }
      
      // === 1. printerName이 명시적으로 지정된 경우: 모든 아이템을 해당 프린터로 전송 ===
      if (printerName) {
        console.log(`🍳 [Printer API] Explicit printer specified: ${printerName}`);
        appendPrinterLog('PRINT_ORDER_EXPLICIT_PRINTER', { printerName });
        const ticketData = orderData || { items, ...orderInfo, isPaid, isReprint, isAdditionalOrder };
        if (Array.isArray(ticketData.items)) {
          ticketData.items = mergeItemsForPrint(ticketData.items);
        }
        if (showLabel && printerGroupName) ticketData.printerLabel = printerGroupName;
        if (topMargin > 0) ticketData.topMargin = topMargin;
        
        await sendKitchenTicketToPrinter(printerName, ticketData, printMode, orderInfo, orderData);
        appendPrinterLog('PRINT_ORDER_SENT_EXPLICIT', { printerName });
        return res.json({ success: true, message: `Kitchen ticket printed`, printer: printerName });
      }
      
      // === 2. 프린터 그룹 라우팅: 아이템별 printerGroupIds → 프린터 그룹 → 개별 프린터 ===
      // 프론트엔드에서 printerGroupIds가 누락된 경우 DB에서 직접 조회
      const allGroupIds = new Set();
      for (const item of (items || [])) {
        let groupIds = item.printerGroupIds || [];
        
        // printerGroupIds가 비어있으면 DB에서 menu_printer_links → category_printer_links 순서로 조회
        if (groupIds.length === 0 && item.id) {
          try {
            const itemId = String(item.id).replace(/^(bagfee-|svc-|extra3-|openprice-).*$/, '');
            if (itemId && !isNaN(Number(itemId))) {
              // 1. 아이템 직접 연결된 프린터 그룹 조회
              const dbLinks = await dbAll(
                'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
                [Number(itemId)]
              );
              if (dbLinks && dbLinks.length > 0) {
                groupIds = dbLinks.map(l => l.printer_group_id);
                item.printerGroupIds = groupIds;
                console.log(`🍳 [Printer API] DB lookup for item "${item.name}" (${itemId}): printerGroupIds = [${groupIds}]`);
              } else {
                // 2. 아이템에 직접 연결이 없으면 카테고리 프린터 그룹 조회
                const menuItem = await dbGet(
                  'SELECT category_id FROM menu_items WHERE item_id = ?',
                  [Number(itemId)]
                );
                if (menuItem?.category_id) {
                  const catLinks = await dbAll(
                    'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
                    [menuItem.category_id]
                  );
                  if (catLinks && catLinks.length > 0) {
                    groupIds = catLinks.map(l => l.printer_group_id);
                    item.printerGroupIds = groupIds;
                    console.log(`🍳 [Printer API] Category lookup for item "${item.name}" (cat:${menuItem.category_id}): printerGroupIds = [${groupIds}]`);
                  }
                }
              }
            }
          } catch (lookupErr) {
            console.warn(`🍳 [Printer API] Failed to lookup printer groups for item "${item.name}":`, lookupErr.message);
          }
        }
        
        groupIds.forEach(id => {
          if (id) allGroupIds.add(Number(id));
        });
      }
      
      console.log(`🍳 [Printer API] Unique printer group IDs from items:`, Array.from(allGroupIds));
      appendPrinterLog('PRINT_ORDER_GROUP_IDS', { groupIds: Array.from(allGroupIds) });
      
      // printerGroupId → [{printer_id, selected_printer, printer_name, copies, group_name, show_label}]
      const printerJobMap = new Map(); // printer_id → { selectedPrinter, printerName, copies, groupName, showLabel, items: [] }
      
      if (allGroupIds.size > 0) {
        // 프린터 그룹 링크 조회: 어떤 그룹이 어떤 프린터에 연결되어 있는지
        const placeholders = Array.from(allGroupIds).map(() => '?').join(',');
        const links = await dbAll(`
          SELECT pgl.printer_group_id, pgl.printer_id, pgl.copies,
                 p.selected_printer, p.name as printer_name,
                 pg.name as group_name, COALESCE(pg.show_label, 1) as show_label
          FROM printer_group_links pgl
          JOIN printers p ON pgl.printer_id = p.printer_id AND p.is_active = 1
          JOIN printer_groups pg ON pgl.printer_group_id = pg.printer_group_id AND pg.is_active = 1
          WHERE pgl.printer_group_id IN (${placeholders})
        `, Array.from(allGroupIds));
        
        console.log(`🍳 [Printer API] Printer group links found: ${links.length}`);
        links.forEach(l => console.log(`   Group "${l.group_name}" (${l.printer_group_id}) → Printer "${l.printer_name}" (${l.selected_printer}) x${l.copies}`));
        appendPrinterLog('PRINT_ORDER_GROUP_LINKS', {
          linksCount: links.length,
          links: links.map(l => ({
            printer_group_id: l.printer_group_id,
            group_name: l.group_name,
            printer_id: l.printer_id,
            printer_name: l.printer_name,
            selected_printer: l.selected_printer,
            copies: l.copies
          }))
        });
        
        // 각 아이템을 해당 프린터에 배분
        (items || []).forEach(item => {
          const itemGroupIds = (item.printerGroupIds || []).map(Number);
          // 이 아이템이 속한 그룹에 연결된 모든 프린터를 찾음
          const targetLinks = links.filter(l => itemGroupIds.includes(l.printer_group_id));
          
          if (targetLinks.length === 0) return; // 이 아이템은 매칭되는 프린터 없음
          
          targetLinks.forEach(link => {
            if (!link.selected_printer) return; // 프린터가 설정 안 된 경우 스킵
            
            const key = link.printer_id;
            if (!printerJobMap.has(key)) {
              printerJobMap.set(key, {
                selectedPrinter: link.selected_printer,
                printerName: link.printer_name,
                copies: link.copies || 1,
                groupName: link.group_name,
                showLabel: link.show_label === 1,
                items: []
              });
            }
            const job = printerJobMap.get(key);
            // 중복 아이템 방지 (같은 아이템이 여러 그룹에 속한 경우)
            if (!job.items.some(i => i === item)) {
              job.items.push(item);
            }
          });
        });
      }
      
      // === 3. 프린터 그룹이 없거나 매칭 안 된 경우: Kitchen 프린터로 fallback ===
      if (printerJobMap.size === 0) {
        console.log(`🍳 [Printer API] No printer groups matched. Falling back to Kitchen printer.`);
        appendPrinterLog('PRINT_ORDER_FALLBACK', { reason: 'no printer groups matched' });
        
        // fallback 시에도 프린터 그룹 링크에서 copies를 조회
        const kitchenPrinterWithCopies = await dbGet(
          `SELECT p.printer_id, p.name, p.selected_printer, 
                  COALESCE(pgl.copies, 1) as copies,
                  pg.name as group_name, COALESCE(pg.show_label, 1) as show_label
           FROM printers p
           LEFT JOIN printer_group_links pgl ON p.printer_id = pgl.printer_id
           LEFT JOIN printer_groups pg ON pgl.printer_group_id = pg.printer_group_id AND pg.is_active = 1
           WHERE (p.type = 'kitchen' OR p.name LIKE '%Kitchen%') AND p.is_active = 1 
           LIMIT 1`
        );
        if (kitchenPrinterWithCopies?.selected_printer) {
          printerJobMap.set(kitchenPrinterWithCopies.printer_id, {
            selectedPrinter: kitchenPrinterWithCopies.selected_printer,
            printerName: kitchenPrinterWithCopies.name,
            copies: kitchenPrinterWithCopies.copies || 1,
            groupName: kitchenPrinterWithCopies.group_name || null,
            showLabel: kitchenPrinterWithCopies.show_label === 1,
            items: items || []
          });
        } else {
          // 최후 fallback: Front 프린터
          const frontPrinterWithCopies = await dbGet(
            `SELECT p.printer_id, p.name, p.selected_printer,
                    COALESCE(pgl.copies, 1) as copies,
                    pg.name as group_name, COALESCE(pg.show_label, 1) as show_label
             FROM printers p
             LEFT JOIN printer_group_links pgl ON p.printer_id = pgl.printer_id
             LEFT JOIN printer_groups pg ON pgl.printer_group_id = pg.printer_group_id AND pg.is_active = 1
             WHERE p.name LIKE '%Front%' AND p.is_active = 1 
             LIMIT 1`
          );
          if (frontPrinterWithCopies?.selected_printer) {
            printerJobMap.set(frontPrinterWithCopies.printer_id, {
              selectedPrinter: frontPrinterWithCopies.selected_printer,
              printerName: frontPrinterWithCopies.name,
              copies: frontPrinterWithCopies.copies || 1,
              groupName: frontPrinterWithCopies.group_name || null,
              showLabel: frontPrinterWithCopies.show_label === 1,
              items: items || []
            });
          }
        }
      }
      
      // 프린터가 하나도 없으면 에러
      if (printerJobMap.size === 0) {
        console.error('🍳 [Printer API] ERROR: No printer configured!');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured. Please set up a printer in the back office.' 
        });
      }
      
      // === 4. 각 프린터별로 Kitchen Ticket 빌드 & 전송 ===
      const printResults = [];
      appendPrinterLog('PRINT_ORDER_JOB_MAP', {
        printers: Array.from(printerJobMap.values()).map(j => ({
          printerName: j.printerName,
          selectedPrinter: j.selectedPrinter,
          copies: j.copies,
          groupName: j.groupName,
          itemsCount: Array.isArray(j.items) ? j.items.length : 0
        }))
      });
      
      for (const [printerId, job] of printerJobMap) {
        if (!job.selectedPrinter || job.items.length === 0) {
          console.log(`🍳 [Printer API] Skipping printer ${job.printerName}: no items or no printer configured`);
          continue;
        }
        
        // 이 프린터용 티켓 데이터 구성
        const ticketData = orderData 
          ? { ...orderData, items: [...job.items] }
          : { items: [...job.items], ...orderInfo, isPaid, isReprint, isAdditionalOrder };

        // 테이블 주문인데 tableName이 비어있으면 tableId로 테이블맵에서 이름(T4)을 채움
        try {
          const hasTableName =
            !!(ticketData?.tableName || ticketData?.header?.tableName || orderInfo?.tableName || orderData?.tableName);
          if (!hasTableName) {
            // 후보 tableId 수집 (프론트/백엔드 payload 차이 대응)
            const candidates = [
              ticketData?.tableId,
              ticketData?.table_id,
              ticketData?.header?.tableId,
              ticketData?.header?.table_id,
              orderInfo?.tableId,
              orderInfo?.table_id,
              orderData?.tableId,
              orderData?.table_id,
              // table 필드가 element_id로 들어오는 경우도 있음
              ticketData?.table,
              ticketData?.header?.table,
              orderInfo?.table,
              orderData?.table,
            ].filter(v => v !== undefined && v !== null && String(v).trim() !== '');

            // 이미 "T4" 같은 이름이 들어온 경우는 그대로 사용
            const directName = candidates.find(v => typeof v === 'string' && /^T\d+/i.test(v.trim()));
            if (directName) {
              ticketData.tableName = String(directName).trim();
              ticketData.header = ticketData.header || {};
              ticketData.header.tableName = ticketData.header.tableName || ticketData.tableName;
            } else {
              const tableId = candidates.find(v => String(v).trim().length >= 4); // element_id는 보통 길이가 김
              if (tableId) {
                const row = await dbGet('SELECT name FROM table_map_elements WHERE element_id = ? LIMIT 1', [String(tableId)]);
                if (row?.name) {
                  ticketData.tableName = row.name;
                  ticketData.header = ticketData.header || {};
                  ticketData.header.tableName = ticketData.header.tableName || row.name;
                }
              }
            }
          }
        } catch (e) {
          // non-blocking
        }
        
        // 동일 아이템 병합
        if (Array.isArray(ticketData.items)) {
          ticketData.items = mergeItemsForPrint(ticketData.items);
        }
        
        // 라벨: 프린터 그룹명 표시 (show_label이 켜져 있을 때)
        if (job.showLabel && job.groupName) {
          ticketData.printerLabel = job.groupName;
        }
        
        // 상단 마진
        if (topMargin !== undefined && topMargin > 0) {
          ticketData.topMargin = topMargin;
        }
        
        console.log(`🍳 [Printer API] Sending ${ticketData.items.length} items to "${job.printerName}" (${job.selectedPrinter}) x${job.copies} copies`);
        appendPrinterLog('PRINT_ORDER_SEND', {
          to: job.selectedPrinter,
          printerName: job.printerName,
          copies: job.copies,
          groupName: job.groupName,
          itemsCount: ticketData.items.length
        });
        
        // copies만큼 반복 출력
        for (let c = 0; c < job.copies; c++) {
          try {
            await sendKitchenTicketToPrinter(job.selectedPrinter, ticketData, printMode, orderInfo, orderData);
            console.log(`✅ [Printer API] Printed to "${job.printerName}" (copy ${c + 1}/${job.copies})`);
            appendPrinterLog('PRINT_ORDER_OK', { to: job.selectedPrinter, printerName: job.printerName, copy: c + 1, copies: job.copies });
          } catch (printErr) {
            console.error(`❌ [Printer API] Failed to print to "${job.printerName}" (copy ${c + 1}):`, printErr.message);
            appendPrinterLog('PRINT_ORDER_FAIL', { to: job.selectedPrinter, printerName: job.printerName, copy: c + 1, copies: job.copies, error: printErr.message });
          }
        }
        
        printResults.push({
          printer: job.selectedPrinter,
          printerName: job.printerName,
          groupName: job.groupName,
          itemCount: ticketData.items.length,
          copies: job.copies
        });
      }
      
      console.log(`🍳 [Printer API] Print complete: ${printResults.length} printers`);
      res.json({ 
        success: true, 
        message: `Kitchen ticket printed to ${printResults.length} printer(s)`,
        results: printResults
      });
    } catch (err) {
      console.error('Kitchen ticket print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/jobs/dispatch - 큐에 있는 프린터 작업 실행 (VOID_TICKET 등)
   */
  router.post('/jobs/dispatch', async (req, res) => {
    try {
      // 큐에서 대기 중인 작업 조회
      const jobs = await dbAll("SELECT * FROM printer_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 50");
      if (!jobs || jobs.length === 0) {
        return res.json({ success: true, message: 'No pending jobs', dispatched: 0 });
      }

      console.log(`🖨️ [Jobs Dispatch] Found ${jobs.length} queued jobs`);
      const { sendRawToPrinter } = require('../utils/printerUtils');
      const { buildGraphicVoidTicket } = require('../utils/graphicPrinterUtils');

      // ESC/POS 비프 명령: 3회 비프, 각 200ms
      const BEEP_CMD = Buffer.from([0x1B, 0x42, 0x03, 0x02]);

      let dispatched = 0;
      let errors = 0;

      for (const job of jobs) {
        try {
          const payload = JSON.parse(job.payload_json || '{}');

          if (job.type === 'VOID_TICKET') {
            // 스테이션(프린터 그룹)에 맞는 프린터 찾기
            let targetPrinter = null;
            const station = job.station || payload.station;

            if (station && station !== 'default') {
              // printer_group_id로 프린터 찾기
              try {
                const pg = await dbGet(
                  "SELECT selected_printer FROM printers WHERE id = ? AND is_active = 1",
                  [station]
                );
                if (pg?.selected_printer) targetPrinter = pg.selected_printer;
              } catch {}

              // 못 찾으면 name으로 시도
              if (!targetPrinter) {
                try {
                  const pg = await dbGet(
                    "SELECT selected_printer FROM printers WHERE name = ? AND is_active = 1",
                    [station]
                  );
                  if (pg?.selected_printer) targetPrinter = pg.selected_printer;
                } catch {}
              }
            }

            // 여전히 프린터 없으면 Kitchen 프린터 사용
            if (!targetPrinter) {
              const kitchenPrinter = await dbGet(
                "SELECT selected_printer FROM printers WHERE (type = 'kitchen' OR name LIKE '%Kitchen%') AND is_active = 1 LIMIT 1"
              );
              targetPrinter = kitchenPrinter?.selected_printer;
            }

            if (!targetPrinter) {
              console.warn(`🖨️ [Jobs Dispatch] No printer found for station: ${station}, skipping job ${job.id}`);
              await dbRun("UPDATE printer_jobs SET status = 'error', error = 'No printer found' WHERE id = ?", [job.id]);
              errors++;
              continue;
            }

            // 프린터 라벨 결정 (프린터 그룹명)
            let printerLabel = null;
            if (station && station !== 'default') {
              try {
                const pg = await dbGet("SELECT name FROM printers WHERE id = ?", [station]);
                if (pg?.name) printerLabel = pg.name;
              } catch {}
            }

            // 상단 마진 조회
            let topMargin = 5;
            try {
              const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
              if (layoutRow?.settings) {
                const ls = JSON.parse(layoutRow.settings);
                topMargin = ls?.kitchenTopMargin || ls?.topMargin || 5;
              }
            } catch {}

            // VOID 티켓 데이터 구성
            const voidTicketData = {
              items: payload.items || [],
              reason: payload.reason || '',
              note: payload.note || '',
              orderNumber: payload.orderNumber || '',
              tableName: payload.tableName || '',
              printerLabel: printerLabel,
              topMargin: topMargin
            };

            console.log(`🖨️ [Jobs Dispatch] Printing VOID ticket for order ${payload.orderId} to ${targetPrinter}`);

            const ticketBuffer = buildGraphicVoidTicket(voidTicketData, true);
            const bufferWithBeep = Buffer.concat([BEEP_CMD, ticketBuffer]);
            await sendRawToPrinter(targetPrinter, bufferWithBeep);

            await dbRun("UPDATE printer_jobs SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?", [job.id]);
            dispatched++;
            console.log(`✅ [Jobs Dispatch] VOID ticket printed successfully (job ${job.id})`);
          } else {
            // 알 수 없는 타입 → 스킵
            console.warn(`🖨️ [Jobs Dispatch] Unknown job type: ${job.type}, skipping job ${job.id}`);
            await dbRun("UPDATE printer_jobs SET status = 'error', error = 'Unknown job type' WHERE id = ?", [job.id]);
            errors++;
          }
        } catch (jobErr) {
          console.error(`❌ [Jobs Dispatch] Failed to dispatch job ${job.id}:`, jobErr.message);
          await dbRun("UPDATE printer_jobs SET status = 'error', error = ? WHERE id = ?", [jobErr.message, job.id]);
          errors++;
        }
      }

      res.json({ success: true, dispatched, errors, total: jobs.length });
    } catch (err) {
      console.error('Jobs dispatch failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/print-receipt - Receipt 출력 (그래픽 모드)
   * 고해상도 이미지 렌더링으로 출력
   */
  router.post('/print-receipt', async (req, res) => {
    try {
      const { receiptData, copies = 1, printerName, openDrawer = false, printMode = 'graphic', topMargin } = req.body;
      console.log(`🧾 [Printer API] Print Receipt request: ${copies} copies, openDrawer: ${openDrawer}, mode: ${printMode}`);
      
      // Business Info에서 Store 정보 가져오기
      const businessInfo = await dbGet("SELECT business_name, phone, address_line1, address_line2, city, state, zip FROM business_profile LIMIT 1");
      if (businessInfo) {
        const fullAddress = [
          businessInfo.address_line1,
          businessInfo.address_line2,
          businessInfo.city,
          businessInfo.state,
          businessInfo.zip
        ].filter(Boolean).join(', ');
        
        // receiptData에 Business Info 추가 (기존 값이 없는 경우에만)
        receiptData.header = receiptData.header || {};
        receiptData.header.storeName = receiptData.header.storeName || businessInfo.business_name;
        receiptData.header.storeAddress = receiptData.header.storeAddress || fullAddress;
        receiptData.header.storePhone = receiptData.header.storePhone || businessInfo.phone;
        // 루트 레벨에도 추가 (호환성)
        receiptData.storeName = receiptData.storeName || businessInfo.business_name;
        receiptData.storeAddress = receiptData.storeAddress || fullAddress;
        receiptData.storePhone = receiptData.storePhone || businessInfo.phone;
        
        console.log(`🧾 [Printer API] Business Info loaded: ${businessInfo.business_name}`);
      }
      
      // 동일 아이템 병합 (Receipt용)
      if (Array.isArray(receiptData.items) && receiptData.items.length > 0) {
        const beforeCount = receiptData.items.length;
        receiptData.items = mergeItemsForPrint(receiptData.items);
        console.log(`🧾 [Printer API] Receipt items merged: ${beforeCount} → ${receiptData.items.length}`);
      }
      
      // 상단 마진 추가 (mm 단위)
      if (topMargin !== undefined && topMargin > 0) {
        receiptData.topMargin = topMargin;
      }
      
      // 레이아웃 설정에서 paperWidth 읽기 (그래픽 모드에서도 필요)
      const layoutRowReceipt = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
      if (layoutRowReceipt && layoutRowReceipt.settings) {
        try {
          const layoutSettings = JSON.parse(layoutRowReceipt.settings);
          // receiptLayout에서 paperWidth 가져오기, 없으면 루트 레벨에서 가져오기
          const receiptPaperWidth = layoutSettings.receiptLayout?.paperWidth || layoutSettings.paperWidth || 80;
          receiptData.paperWidth = receiptPaperWidth;
          console.log(`🧾 [Printer API] Paper width set to: ${receiptPaperWidth}mm`);
        } catch (parseErr) {
          console.warn('🧾 [Printer API] Failed to parse layout settings for paperWidth:', parseErr);
          receiptData.paperWidth = 80; // 기본값
        }
      } else {
        receiptData.paperWidth = 80; // 기본값
      }
      
      // 프린터 이름 결정
      let targetPrinter = printerName;
      if (!targetPrinter) {
        const frontPrinter = await dbGet("SELECT selected_printer FROM printers WHERE name LIKE '%Front%' OR name LIKE '%Receipt%' LIMIT 1");
        targetPrinter = frontPrinter?.selected_printer;
      }
      
      // 프린터 이름이 없으면 에러 반환 (기본 프린터로 보내지 않음!)
      if (!targetPrinter) {
        console.error('🧾 [Printer API] ERROR: No printer configured! Check printer settings.');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured. Please set up a printer in the back office.' 
        });
      }
      
      console.log(`🧾 [Printer API] Target printer: ${targetPrinter}`);
      
      const { sendRawToPrinter } = require('../utils/printerUtils');
      
      // 그래픽 모드로 출력 시도 (실패 시 텍스트 모드로 fallback)
      let usedTextMode = false;
      if (printMode === 'graphic') {
        try {
          console.log(`🧾 [Printer API] Printing Receipt (GRAPHIC mode)...`);
          const { buildGraphicReceipt } = require('../utils/graphicPrinterUtils');
          const receiptBuffer = buildGraphicReceipt(receiptData, openDrawer, true);
          
          for (let i = 0; i < copies; i++) {
            await sendRawToPrinter(targetPrinter, receiptBuffer);
            console.log(`🧾 [Printer API] Receipt printed (copy ${i + 1}/${copies}, Graphic mode)`);
          }
        } catch (graphicErr) {
          console.warn(`🧾 [Printer API] Graphic mode failed, falling back to text mode:`, graphicErr.message);
          usedTextMode = true;
        }
      } else {
        usedTextMode = true;
      }
      
      if (usedTextMode) {
        // ESC/POS 텍스트 모드 (폴백)
        console.log(`🧾 [Printer API] Printing Receipt (ESC/POS text mode)...`);
        
        // 레이아웃 설정 읽기
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        let receiptLayout = null;
        
        if (layoutRow && layoutRow.settings) {
          try {
            const layoutSettings = JSON.parse(layoutRow.settings);
            receiptLayout = layoutSettings.receiptLayout;
          } catch (parseErr) {
            console.warn('🧾 [Printer API] Failed to parse layout settings:', parseErr);
          }
        }
        
        const { buildReceiptText, buildReceiptTextWithLayout } = require('../utils/printerUtils');
        let receiptText = receiptLayout 
          ? buildReceiptTextWithLayout(receiptData, receiptLayout, 'receipt')
          : buildReceiptText(receiptData);
        
        // Cash Drawer 열기 명령 추가
        if (openDrawer) {
          const drawerCmd = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0x19]).toString('binary');
          receiptText = drawerCmd + receiptText;
        }
        
        const receiptBuffer = Buffer.from(receiptText, 'binary');
        
        for (let i = 0; i < copies; i++) {
          await sendRawToPrinter(targetPrinter, receiptBuffer);
          console.log(`🧾 [Printer API] Receipt printed (copy ${i + 1}/${copies}, ESC/POS mode)`);
        }
      }
      
      res.json({ success: true, message: `Receipt printed (${copies} copies)${openDrawer ? ' + drawer opened' : ''}`, printer: targetPrinter });
    } catch (err) {
      console.error('Receipt print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/print-bill - Bill 출력 (그래픽 모드)
   * 고해상도 이미지 렌더링으로 출력
   */
  router.post('/print-bill', async (req, res) => {
    try {
      const { billData, copies = 1, printerName, printMode = 'graphic', topMargin } = req.body;
      console.log(`📃 [Printer API] Print Bill request: ${copies} copies, mode: ${printMode}`);
      
      // Business Info에서 Store 정보 가져오기
      const businessInfo = await dbGet("SELECT business_name, phone, address_line1, address_line2, city, state, zip FROM business_profile LIMIT 1");
      if (businessInfo) {
        const fullAddress = [
          businessInfo.address_line1,
          businessInfo.address_line2,
          businessInfo.city,
          businessInfo.state,
          businessInfo.zip
        ].filter(Boolean).join(', ');
        
        // billData에 Business Info 추가 (기존 값이 없는 경우에만)
        billData.header = billData.header || {};
        billData.header.storeName = billData.header.storeName || businessInfo.business_name;
        billData.header.storeAddress = billData.header.storeAddress || fullAddress;
        billData.header.storePhone = billData.header.storePhone || businessInfo.phone;
        // 루트 레벨에도 추가 (호환성)
        billData.storeName = billData.storeName || businessInfo.business_name;
        billData.storeAddress = billData.storeAddress || fullAddress;
        billData.storePhone = billData.storePhone || businessInfo.phone;
        
        console.log(`📃 [Printer API] Business Info loaded: ${businessInfo.business_name}`);
      }
      
      // 동일 아이템 병합 (Bill용)
      if (Array.isArray(billData.items) && billData.items.length > 0) {
        const beforeCount = billData.items.length;
        billData.items = mergeItemsForPrint(billData.items);
        console.log(`📃 [Printer API] Bill items merged: ${beforeCount} → ${billData.items.length}`);
      }
      if (Array.isArray(billData.guestSections)) {
        billData.guestSections.forEach(section => {
          if (Array.isArray(section.items) && section.items.length > 0) {
            section.items = mergeItemsForPrint(section.items);
          }
        });
      }
      
      // 상단 마진 추가 (mm 단위)
      if (topMargin !== undefined && topMargin > 0) {
        billData.topMargin = topMargin;
      }
      
      // 레이아웃 설정에서 paperWidth 읽기 (그래픽 모드에서도 필요)
      const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
      if (layoutRow && layoutRow.settings) {
        try {
          const layoutSettings = JSON.parse(layoutRow.settings);
          // billLayout에서 paperWidth 가져오기, 없으면 루트 레벨에서 가져오기
          const billPaperWidth = layoutSettings.billLayout?.paperWidth || layoutSettings.paperWidth || 80;
          billData.paperWidth = billPaperWidth;
          console.log(`📃 [Printer API] Paper width set to: ${billPaperWidth}mm`);
        } catch (parseErr) {
          console.warn('📃 [Printer API] Failed to parse layout settings for paperWidth:', parseErr);
          billData.paperWidth = 80; // 기본값
        }
      } else {
        billData.paperWidth = 80; // 기본값
      }
      
      // 프린터 이름 결정
      let targetPrinter = printerName;
      if (!targetPrinter) {
        const frontPrinter = await dbGet("SELECT selected_printer FROM printers WHERE name LIKE '%Front%' LIMIT 1");
        targetPrinter = frontPrinter?.selected_printer;
      }
      
      // 프린터 이름이 없으면 에러 반환 (기본 프린터로 보내지 않음!)
      if (!targetPrinter) {
        console.error('📃 [Printer API] ERROR: No printer configured! Check printer settings.');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured. Please set up a printer in the back office.' 
        });
      }
      
      console.log(`📃 [Printer API] Target printer: ${targetPrinter}`);
      
      const { sendRawToPrinter } = require('../utils/printerUtils');
      
      // 그래픽 모드로 출력 시도 (실패 시 텍스트 모드로 fallback)
      let usedTextMode = false;
      if (printMode === 'graphic') {
        try {
          console.log(`📃 [Printer API] Printing Bill (GRAPHIC mode)...`);
          const { buildGraphicBill } = require('../utils/graphicPrinterUtils');
          const billBuffer = buildGraphicBill(billData, true);
          
          for (let i = 0; i < copies; i++) {
            await sendRawToPrinter(targetPrinter, billBuffer);
            console.log(`📃 [Printer API] Bill printed (copy ${i + 1}/${copies}, Graphic mode)`);
          }
        } catch (graphicErr) {
          console.warn(`📃 [Printer API] Graphic mode failed, falling back to text mode:`, graphicErr.message);
          usedTextMode = true;
        }
      } else {
        usedTextMode = true;
      }
      
      if (usedTextMode) {
        // ESC/POS 텍스트 모드 (폴백)
        console.log(`📃 [Printer API] Printing Bill (ESC/POS text mode)...`);
        
        // 레이아웃 설정 읽기
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        let billLayout = null;
        
        if (layoutRow && layoutRow.settings) {
          try {
            const layoutSettings = JSON.parse(layoutRow.settings);
            billLayout = layoutSettings.billLayout;
          } catch (parseErr) {
            console.warn('📃 [Printer API] Failed to parse layout settings:', parseErr);
          }
        }
        
        const { buildReceiptText, buildReceiptTextWithLayout } = require('../utils/printerUtils');
        const billText = billLayout 
          ? buildReceiptTextWithLayout(billData, billLayout, 'bill')
          : buildReceiptText(billData);
        
        const billBuffer = Buffer.from(billText, 'binary');
        
        for (let i = 0; i < copies; i++) {
          await sendRawToPrinter(targetPrinter, billBuffer);
          console.log(`📃 [Printer API] Bill printed (copy ${i + 1}/${copies}, ESC/POS mode)`);
        }
      }
      
      res.json({ success: true, message: `Bill printed (${copies} copies)`, printer: targetPrinter });
    } catch (err) {
      console.error('Bill print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ============================================
  // Serial Port (COM) Printer APIs
  // ============================================

  // 기본 시리얼 포트 설정값
  const SERIAL_DEFAULTS = {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  };

  /**
   * GET /api/printers/serial/ports - 시스템의 시리얼 포트 목록 조회
   * 사용 가능한 COM 포트 목록을 반환합니다.
   */
  router.get('/serial/ports', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const ports = await utils.getSerialPorts();
      console.log(`[Serial] Found ${ports.length} serial ports:`, ports.map(p => p.path));
      res.json({
        success: true,
        ports,
        defaults: SERIAL_DEFAULTS
      });
    } catch (err) {
      console.error('[Serial] Failed to list ports:', err);
      res.status(500).json({ success: false, error: err.message, available: false });
    }
  });

  /**
   * GET /api/printers/serial/check/:port - 특정 시리얼 포트 사용 가능 여부 확인
   */
  router.get('/serial/check/:port', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const portPath = req.params.port.toUpperCase();
      const available = await utils.isPortAvailable(portPath);
      res.json({ success: true, port: portPath, available });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/serial/test - 시리얼 프린터 테스트 출력
   */
  router.post('/serial/test', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const { port, baudRate, dataBits, stopBits, parity } = req.body;
      
      if (!port) {
        return res.status(400).json({ success: false, error: 'Port is required' });
      }

      const options = {
        baudRate: baudRate || SERIAL_DEFAULTS.baudRate,
        dataBits: dataBits || SERIAL_DEFAULTS.dataBits,
        stopBits: stopBits || SERIAL_DEFAULTS.stopBits,
        parity: parity || SERIAL_DEFAULTS.parity
      };

      console.log(`[Serial] Testing printer on ${port} with options:`, options);
      await utils.testSerialPrinter(port, options);
      
      res.json({ success: true, message: `Test print sent to ${port}` });
    } catch (err) {
      console.error('[Serial] Test print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/serial/print - 시리얼 프린터로 출력
   */
  router.post('/serial/print', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const { port, data, options = {} } = req.body;
      
      if (!port) {
        return res.status(400).json({ success: false, error: 'Port is required' });
      }
      if (!data) {
        return res.status(400).json({ success: false, error: 'Print data is required' });
      }

      const portOptions = {
        baudRate: options.baudRate || SERIAL_DEFAULTS.baudRate,
        dataBits: options.dataBits || SERIAL_DEFAULTS.dataBits,
        stopBits: options.stopBits || SERIAL_DEFAULTS.stopBits,
        parity: options.parity || SERIAL_DEFAULTS.parity
      };

      console.log(`[Serial] Printing to ${port}`);
      await utils.printToSerialPrinter(port, data, portOptions);
      
      res.json({ success: true, message: `Print sent to ${port}` });
    } catch (err) {
      console.error('[Serial] Print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/serial/open-drawer - 시리얼 연결 Cash Drawer 열기
   */
  router.post('/serial/open-drawer', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const { port, options = {} } = req.body;
      
      if (!port) {
        return res.status(400).json({ success: false, error: 'Port is required' });
      }

      const portOptions = {
        baudRate: options.baudRate || SERIAL_DEFAULTS.baudRate,
        dataBits: options.dataBits || SERIAL_DEFAULTS.dataBits,
        stopBits: options.stopBits || SERIAL_DEFAULTS.stopBits,
        parity: options.parity || SERIAL_DEFAULTS.parity
      };

      console.log(`[Serial] Opening cash drawer on ${port}`);
      await utils.openCashDrawerSerial(port, portOptions);
      
      res.json({ success: true, message: `Cash drawer opened on ${port}` });
    } catch (err) {
      console.error('[Serial] Cash drawer open failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/serial/kitchen-ticket - 시리얼 프린터로 키친 티켓 출력
   */
  router.post('/serial/kitchen-ticket', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const { port, ticket, options = {} } = req.body;
      
      if (!port) {
        return res.status(400).json({ success: false, error: 'Port is required' });
      }
      if (!ticket) {
        return res.status(400).json({ success: false, error: 'Ticket data is required' });
      }

      const portOptions = {
        baudRate: options.baudRate || SERIAL_DEFAULTS.baudRate,
        dataBits: options.dataBits || SERIAL_DEFAULTS.dataBits,
        stopBits: options.stopBits || SERIAL_DEFAULTS.stopBits,
        parity: options.parity || SERIAL_DEFAULTS.parity
      };

      // Kitchen ticket 데이터 변환
      const printData = {
        title: ticket.title || 'KITCHEN',
        orderInfo: {
          orderNumber: ticket.orderNumber,
          tableName: ticket.tableName,
          time: ticket.time || new Date().toLocaleString()
        },
        items: ticket.items || [],
        footer: ticket.footer
      };

      console.log(`[Serial] Printing kitchen ticket to ${port} (with beep)`);
      // 비프 명령을 시리얼 프린터에도 전송
      const beepBuffer = Buffer.from([0x1B, 0x42, 0x03, 0x02]);
      await utils.sendToSerialPort(port, beepBuffer, portOptions).catch(() => {});
      await utils.printToSerialPrinter(port, printData, portOptions);
      
      res.json({ success: true, message: `Kitchen ticket sent to ${port}` });
    } catch (err) {
      console.error('[Serial] Kitchen ticket print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/printers/serial/receipt - 시리얼 프린터로 영수증 출력
   */
  router.post('/serial/receipt', async (req, res) => {
    try {
      const utils = getSerialPrinterUtils();
      const { port, receipt, options = {} } = req.body;
      
      if (!port) {
        return res.status(400).json({ success: false, error: 'Port is required' });
      }
      if (!receipt) {
        return res.status(400).json({ success: false, error: 'Receipt data is required' });
      }

      const portOptions = {
        baudRate: options.baudRate || SERIAL_DEFAULTS.baudRate,
        dataBits: options.dataBits || SERIAL_DEFAULTS.dataBits,
        stopBits: options.stopBits || SERIAL_DEFAULTS.stopBits,
        parity: options.parity || SERIAL_DEFAULTS.parity
      };

      // Receipt 데이터 변환
      const printData = {
        title: receipt.title || 'RECEIPT',
        orderInfo: receipt.orderInfo,
        items: receipt.items || [],
        subtotal: receipt.subtotal,
        taxLines: receipt.taxLines,
        total: receipt.total,
        footer: receipt.footer?.message || 'Thank you!'
      };

      console.log(`[Serial] Printing receipt to ${port}`);
      await utils.printToSerialPrinter(port, printData, portOptions);
      
      res.json({ success: true, message: `Receipt sent to ${port}` });
    } catch (err) {
      console.error('[Serial] Receipt print failed:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
