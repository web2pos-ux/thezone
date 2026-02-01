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

  // POST /api/printers/batch - Save all printers at once
  router.post('/batch', async (req, res) => {
    const { printers } = req.body;
    if (!Array.isArray(printers)) {
      return res.status(400).json({ error: 'printers must be an array' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('DELETE FROM printer_group_links');
      await dbRun('DELETE FROM printers');
      
      const results = [];
      for (const printer of printers) {
        const newPrinterId = await generateNextId(db, ID_RANGES.PRINTER);
        await dbRun(
          'INSERT INTO printers (printer_id, name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
          [newPrinterId, printer.name || '', printer.type || '', printer.selectedPrinter || '', printer.sortOrder || 0]
        );
        results.push({ ...printer, id: newPrinterId });
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
      let query = 'SELECT printer_group_id as id, name, menu_id FROM printer_groups WHERE is_active = 1';
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
          `SELECT p.printer_id, p.name, p.type, p.selected_printer as ip_address 
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
    const { name, printerIds, printers, menu_id } = req.body;
    // Allow both printerIds (array of IDs) or printers (array of objects with printer_id)
    const finalPrinterIds = printerIds || (printers && Array.isArray(printers) ? printers.map(p => p.printer_id || p.id) : []);

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');
      const newGroupId = await generateNextId(db, ID_RANGES.PRINTER_GROUP);
      await dbRun(
        'INSERT INTO printer_groups (printer_group_id, name, menu_id, is_active) VALUES (?, ?, ?, 1)',
        [newGroupId, name, menu_id || null]
      );
      
      if (finalPrinterIds && Array.isArray(finalPrinterIds)) {
        for (const printerId of finalPrinterIds) {
          if (!printerId) continue;
          await dbRun(
            'INSERT OR IGNORE INTO printer_group_links (printer_group_id, printer_id) VALUES (?, ?)',
            [newGroupId, printerId]
          );
        }
      }
      await dbRun('COMMIT');
      res.json({ id: newGroupId, name, printerIds: finalPrinterIds });
    } catch (err) {
      if (db.inTransaction) await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/groups/:id - Update printer group
  router.put('/groups/:id', async (req, res) => {
    const { id } = req.params;
    const { name, printerIds, printers } = req.body;
    // Allow both printerIds (array of IDs) or printers (array of objects with printer_id)
    const finalPrinterIds = printerIds || (printers && Array.isArray(printers) ? printers.map(p => p.printer_id || p.id) : []);

    try {
      await dbRun('BEGIN TRANSACTION');
      if (name) {
        await dbRun(
          'UPDATE printer_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE printer_group_id = ?',
          [name, id]
        );
      }
      
      await dbRun('DELETE FROM printer_group_links WHERE printer_group_id = ?', [id]);
      if (finalPrinterIds && Array.isArray(finalPrinterIds)) {
        for (const printerId of finalPrinterIds) {
          if (!printerId) continue;
          await dbRun(
            'INSERT INTO printer_group_links (printer_group_id, printer_id) VALUES (?, ?)',
            [id, printerId]
          );
        }
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

  // Batch for groups
  router.post('/groups/batch', async (req, res) => {
    const { groups } = req.body;
    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups must be an array' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('DELETE FROM printer_group_links');
      await dbRun('DELETE FROM printer_groups');
      
      const results = [];
      for (const group of groups) {
        const newGroupId = await generateNextId(db, ID_RANGES.PRINTER_GROUP);
        await dbRun(
          'INSERT INTO printer_groups (printer_group_id, name, is_active) VALUES (?, ?, 1)',
          [newGroupId, group.name]
        );
        
        if (group.printerIds && Array.isArray(group.printerIds)) {
          for (const printerId of group.printerIds) {
                await dbRun(
              'INSERT INTO printer_group_links (printer_group_id, printer_id) VALUES (?, ?)',
              [newGroupId, printerId]
                );
            }
          }
        results.push({ ...group, id: newGroupId });
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

      console.log(`[Serial] Printing kitchen ticket to ${port}`);
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
