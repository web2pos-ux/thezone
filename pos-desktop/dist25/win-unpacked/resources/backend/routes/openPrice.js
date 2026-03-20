const express = require('express');
const router = express.Router();

module.exports = (db) => {

  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // Config: thresholds (env overridable)
  const OPEN_PRICE_LIMIT = parseFloat(process.env.OPEN_PRICE_APPROVAL_LIMIT || '50000');
  const NOTE_REQUIRED_OVER = parseFloat(process.env.OPEN_PRICE_NOTE_LIMIT || '10000');

  // POST /api/open-price/line - save an Open Price line snapshot
  router.post('/line', async (req, res) => {
    try {
      const {
        order_id = null,
        menu_id = null,
        name_label,
        amount,
        note = null,
        tax_group_id = null,
        printer_group_id = null,
        entered_by_user_id = null,
        approved_by_user_id = null,
        manager_pin = null
      } = req.body || {};

      if (!name_label || typeof amount !== 'number' || !(amount > 0)) {
        return res.status(400).json({ error: 'name_label and positive amount are required.' });
      }

      if (amount > NOTE_REQUIRED_OVER && (!note || String(note).trim() === '')) {
        return res.status(400).json({ error: 'note is required for this amount.' });
      }

      // Approval check
      let approvedFlag = 0;
      let approvedAt = null;
      let approverId = approved_by_user_id;
      if (amount > OPEN_PRICE_LIMIT) {
        // Simple PIN check stub (replace with real user auth lookup)
        const VALID_PINS = (process.env.OPEN_PRICE_MANAGER_PINS || '1234,0000').split(',').map(s => s.trim());
        if (!manager_pin || !VALID_PINS.includes(String(manager_pin))) {
          return res.status(403).json({ error: 'manager approval required' });
        }
        approvedFlag = 1;
        approvedAt = new Date().toISOString();
        if (!approverId) approverId = -1; // unknown manager id
      }

      await dbRun(
        `INSERT INTO OpenPrice_Lines (order_id, menu_id, name_label, unit_price_entered, price_source, open_price_note, tax_group_id_at_sale, printer_group_id_at_sale, entered_by_user_id, approved_by_user_id, approved_flag, approved_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
        [order_id, menu_id, name_label, amount, note, tax_group_id, printer_group_id, entered_by_user_id, approverId, approvedFlag, approvedAt]
      );
      const row = await dbGet('SELECT last_insert_rowid() AS id');

      return res.status(201).json({
        id: row.id,
        order_id,
        menu_id,
        name_label,
        unit_price_entered: amount,
        price_source: 'open',
        open_price_note: note,
        tax_group_id_at_sale: tax_group_id,
        printer_group_id_at_sale: printer_group_id,
        entered_by_user_id,
        approved_by_user_id: approverId,
        approved_flag: approvedFlag,
        approved_at: approvedAt,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('Failed to save open price line:', err);
      return res.status(500).json({ error: 'Failed to save open price line', details: err.message });
    }
  });

  // GET /api/open-price/library?menu_id=... - Clean options for Open Price
  router.get('/library', async (req, res) => {
    try {
      const menuId = req.query.menu_id ? parseInt(req.query.menu_id, 10) : null;
      if (!menuId) return res.status(400).json({ error: 'menu_id is required' });

      // Tax groups (active only)
      const taxGroups = await new Promise((resolve, reject) => {
        db.all('SELECT tax_group_id, name FROM tax_groups WHERE is_deleted = 0 ORDER BY name', [], (err, rows) => {
          if (err) reject(err); else resolve(rows);
        });
      });

      // Printer groups: only for this menu, must have at least one active printer, de-dup by name
      const printerGroups = await new Promise((resolve, reject) => {
        const sql = `
          SELECT MIN(pg.printer_group_id) AS printer_group_id, pg.name
          FROM printer_groups pg
          WHERE pg.menu_id = ?
            AND EXISTS (
              SELECT 1
              FROM printer_group_links pgl
              JOIN printers p ON p.printer_id = pgl.printer_id
              WHERE pgl.printer_group_id = pg.printer_group_id AND p.is_active = 1
            )
          GROUP BY pg.name
          ORDER BY pg.name
        `;
        db.all(sql, [menuId], (err, rows) => {
          if (err) reject(err); else resolve(rows);
        });
      });

      console.log(`[GET /api/open-price/library] menu_id=${menuId} -> tax_groups=${taxGroups.length}, printer_groups=${printerGroups.length}`);
      res.json({ tax_groups: taxGroups, printer_groups: printerGroups });
    } catch (err) {
      console.error('Failed to get open price library:', err);
      res.status(500).json({ error: 'Failed to get open price library', details: err.message });
    }
  });

  // GET /api/open-price/settings - Get Open Price default settings
  router.get('/settings', async (req, res) => {
    try {
      // Get settings from database or return defaults
      const settings = await dbGet('SELECT default_tax_group_id, default_printer_group_id FROM OpenPrice_Settings LIMIT 1');
      
      if (settings) {
        res.json({
          defaultTaxGroupId: settings.default_tax_group_id,
          defaultPrinterGroupId: settings.default_printer_group_id
        });
      } else {
        // Return default values if no settings exist
        res.json({
          defaultTaxGroupId: null,
          defaultPrinterGroupId: null
        });
      }
    } catch (err) {
      console.error('Failed to get open price settings:', err);
      res.status(500).json({ error: 'Failed to get open price settings', details: err.message });
    }
  });

  // POST /api/open-price/settings - Save Open Price default settings
  router.post('/settings', async (req, res) => {
    try {
      const { defaultTaxGroupId, defaultPrinterGroupId } = req.body;
      
      console.log('Received settings:', { defaultTaxGroupId, defaultPrinterGroupId });

      // Check if settings exist - use a more reliable method
      const existingSettings = await dbGet('SELECT id FROM OpenPrice_Settings LIMIT 1');
      console.log('Existing settings check:', existingSettings);
      
      if (existingSettings) {
        // Update existing settings
        console.log('Updating existing settings...');
        await dbRun(
          'UPDATE OpenPrice_Settings SET default_tax_group_id = ?, default_printer_group_id = ?, updated_at = CURRENT_TIMESTAMP',
          [defaultTaxGroupId, defaultPrinterGroupId]
        );
      } else {
        // Insert new settings
        console.log('Inserting new settings...');
        await dbRun(
          'INSERT INTO OpenPrice_Settings (default_tax_group_id, default_printer_group_id) VALUES (?, ?)',
          [defaultTaxGroupId, defaultPrinterGroupId]
        );
      }

      console.log('Settings saved successfully');
      res.json({ 
        message: 'Settings saved successfully',
        defaultTaxGroupId,
        defaultPrinterGroupId
      });
    } catch (err) {
      console.error('Failed to save open price settings:', err);
      console.error('Error details:', err.message);
      res.status(500).json({ error: 'Failed to save open price settings', details: err.message });
    }
  });

  return router;
}; 