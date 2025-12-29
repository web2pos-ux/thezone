const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Windows 시스템 프린터 목록 가져오기
async function getWindowsPrinters() {
  console.log('getWindowsPrinters() called');
  
  // Method 1: PowerShell Get-Printer (Windows 10+)
  try {
    console.log('Method 1: Trying PowerShell Get-Printer...');
    const { stdout, stderr } = await execPromise(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
      { timeout: 10000 }
    );
    
    if (stderr) console.log('PowerShell stderr:', stderr);
    
    if (stdout && stdout.trim()) {
      let printers = JSON.parse(stdout.trim());
      if (!Array.isArray(printers)) printers = [printers];
      
      const result = printers.map(p => ({
        name: p.Name,
        isDefault: p.Default || false
      }));
      console.log(`✅ Found ${result.length} printers via Get-Printer`);
      return result;
    }
  } catch (error) {
    console.log('Get-Printer failed:', error.message);
  }

  // Method 2: PowerShell WMI Query
  try {
    console.log('Method 2: Trying PowerShell WMI...');
    const { stdout } = await execPromise(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-WmiObject -Class Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
      { timeout: 10000 }
    );
    
    if (stdout && stdout.trim()) {
      let printers = JSON.parse(stdout.trim());
      if (!Array.isArray(printers)) printers = [printers];
      
      const result = printers.map(p => ({
        name: p.Name,
        isDefault: p.Default || false
      }));
      console.log(`✅ Found ${result.length} printers via WMI`);
      return result;
    }
  } catch (error) {
    console.log('WMI failed:', error.message);
  }

  // Method 3: WMIC (Legacy)
  try {
    console.log('Method 3: Trying WMIC...');
    const { stdout } = await execPromise('wmic printer get name', { timeout: 10000 });
    const lines = stdout.split('\n')
      .map(line => line.trim())
      .filter(line => line && line !== 'Name');
    
    if (lines.length > 0) {
      const result = lines.map(name => ({ name, isDefault: false }));
      console.log(`✅ Found ${result.length} printers via WMIC`);
      return result;
    }
  } catch (error) {
    console.log('WMIC failed:', error.message);
  }

  // Method 4: Registry Query (Last resort)
  try {
    console.log('Method 4: Trying Registry...');
    const { stdout } = await execPromise(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Print\\Printers" /s /v Name 2>nul || reg query "HKEY_CURRENT_USER\\Printers\\Connections" /s 2>nul',
      { timeout: 10000 }
    );
    
    const names = stdout.match(/Name\s+REG_SZ\s+(.+)/gi) || [];
    if (names.length > 0) {
      const result = names.map(line => {
        const match = line.match(/Name\s+REG_SZ\s+(.+)/i);
        return { name: match ? match[1].trim() : 'Unknown', isDefault: false };
      });
      console.log(`✅ Found ${result.length} printers via Registry`);
      return result;
    }
  } catch (error) {
    console.log('Registry failed:', error.message);
  }

  // No printers found
  console.log('❌ No printers found with any method');
  return [];
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

  // ============ SYSTEM PRINTERS ============

  // GET /api/printers/system - Get Windows system printers
  router.get('/system', async (req, res) => {
    try {
      const printers = await getWindowsPrinters();
      res.json(printers);
    } catch (err) {
      console.error('Failed to get system printers:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ PRINTERS ============

  // GET /api/printers - Get all printers
  router.get('/', async (req, res) => {
    try {
      const rows = await dbAll(
        'SELECT id, name, type, selected_printer as selectedPrinter, sort_order as sortOrder FROM printers WHERE is_active = 1 ORDER BY sort_order, id'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers - Create new printer
  router.post('/', async (req, res) => {
    const { name, type, selectedPrinter, sortOrder } = req.body;
    try {
      const result = await dbRun(
        'INSERT INTO printers (name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
        [name || '', type || '', selectedPrinter || '', sortOrder || 0]
      );
      res.json({ id: result.lastID, name, type, selectedPrinter, sortOrder });
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
        'UPDATE printers SET name = ?, type = ?, selected_printer = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name || '', type || '', selectedPrinter || '', sortOrder || 0, id]
      );
      res.json({ success: true, id: parseInt(id), name, type, selectedPrinter, sortOrder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/:id - Delete printer (soft delete)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE printers SET is_active = 0 WHERE id = ?', [id]);
      // Also remove from all groups
      await dbRun('DELETE FROM printer_group_links WHERE printer_id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/batch - Save all printers at once
  router.post('/batch', async (req, res) => {
    const { printers } = req.body;
    console.log(`POST /api/printers/batch: ${printers?.length} printers`);

    if (!Array.isArray(printers)) {
      return res.status(400).json({ error: 'printers must be an array' });
    }
    try {
      // 1. 기존 데이터 완전 삭제 (하드 삭제)
      await dbRun('DELETE FROM printer_group_links'); // 외래키 제약 때문에 링크 먼저 삭제
      await dbRun('DELETE FROM printers');
      
      // 2. 새 데이터 삽입
      const results = [];
      for (const printer of printers) {
        // ID는 새로 생성되도록 둠 (기존 ID 무시) 또는 그대로 사용
        // 여기서는 안전하게 새로 생성
        const result = await dbRun(
          'INSERT INTO printers (name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
          [printer.name || '', printer.type || '', printer.selectedPrinter || '', printer.sortOrder || 0]
        );
        results.push({ ...printer, id: result.lastID });
      }
      console.log('Batch save completed (Re-inserted all)');
      res.json(results);
    } catch (err) {
      console.error('Batch save error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ PRINTER GROUPS ============

  // GET /api/printers/groups - Get all printer groups
  router.get('/groups', async (req, res) => {
    try {
      const groups = await dbAll(
        'SELECT id, name FROM printer_groups WHERE is_active = 1 ORDER BY name'
      );
      
      // Get printer IDs for each group
      for (const group of groups) {
        const links = await dbAll(
          'SELECT printer_id FROM printer_group_links WHERE group_id = ?',
          [group.id]
        );
        group.printerIds = links.map(l => l.printer_id);
      }
      
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/groups - Create new printer group
  router.post('/groups', async (req, res) => {
    const { name, printerIds } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    try {
      const result = await dbRun(
        'INSERT INTO printer_groups (name, is_active) VALUES (?, 1)',
        [name]
      );
      const groupId = result.lastID;
      
      // Link printers to group
      if (printerIds && Array.isArray(printerIds)) {
        for (const printerId of printerIds) {
        await dbRun(
            'INSERT OR IGNORE INTO printer_group_links (group_id, printer_id) VALUES (?, ?)',
            [groupId, printerId]
          );
        }
      }
      
      res.json({ id: groupId, name, printerIds: printerIds || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/groups/:id - Update printer group
  router.put('/groups/:id', async (req, res) => {
    const { id } = req.params;
    const { name, printerIds } = req.body;
    try {
      if (name) {
        await dbRun(
          'UPDATE printer_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [name, id]
        );
      }
      
      // Update printer links
      if (printerIds && Array.isArray(printerIds)) {
        // Remove existing links
        await dbRun('DELETE FROM printer_group_links WHERE group_id = ?', [id]);
        // Add new links
      for (const printerId of printerIds) {
          await dbRun(
            'INSERT INTO printer_group_links (group_id, printer_id) VALUES (?, ?)',
            [id, printerId]
          );
        }
      }
      
      res.json({ success: true, id: parseInt(id), name, printerIds });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/groups/:id - Delete printer group (soft delete)
  router.delete('/groups/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE printer_groups SET is_active = 0 WHERE id = ?', [id]);
      await dbRun('DELETE FROM printer_group_links WHERE group_id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers/groups/export - Export all printer groups with printer details (for cloud sync)
  router.get('/groups/export', async (req, res) => {
    try {
      // Get all printers
      const printers = await dbAll(
        'SELECT id, name, type, selected_printer as selectedPrinter FROM printers WHERE is_active = 1'
      );
      
      // Get all groups with their linked printers
      const groups = await dbAll(
        'SELECT id, name FROM printer_groups WHERE is_active = 1 ORDER BY name'
      );
      
      for (const group of groups) {
        const links = await dbAll(
          'SELECT printer_id FROM printer_group_links WHERE group_id = ?',
          [group.id]
        );
        // Get printer details for each linked printer
        group.printers = links.map(link => {
          const printer = printers.find(p => p.id === link.printer_id);
          return printer ? { name: printer.name, type: printer.type, selectedPrinter: printer.selectedPrinter } : null;
        }).filter(Boolean);
      }
      
      res.json({ 
        success: true, 
        groups,
        printers 
      });
    } catch (err) {
      console.error('Export printer groups error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/groups/batch - Save all printer groups at once
  router.post('/groups/batch', async (req, res) => {
    const { groups } = req.body;
    console.log(`POST /api/printers/groups/batch: ${groups?.length} groups`);

    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups must be an array' });
    }
    try {
      // 1. 기존 데이터 삭제
      await dbRun('DELETE FROM printer_group_links');
      await dbRun('DELETE FROM printer_groups');
      
      const results = [];
      for (const group of groups) {
        // 2. 그룹 삽입
        const result = await dbRun(
          'INSERT INTO printer_groups (name, is_active) VALUES (?, 1)',
          [group.name]
        );
        const groupId = result.lastID;
        
        // 3. 링크 삽입
        if (group.printerIds && Array.isArray(group.printerIds)) {
          for (const printerId of group.printerIds) {
            // printerId가 유효한지 체크하지 않고 넣으면 에러날 수 있으나, 
            // 외래키 제약이 있으면 에러나고 없으면 들어감.
            // 여기서는 무시하고 넣되 에러 로그만 찍음
            try {
                await dbRun(
                'INSERT INTO printer_group_links (group_id, printer_id) VALUES (?, ?)',
                [groupId, printerId]
                );
            } catch (e) {
                console.log(`Failed to link printer ${printerId} to group ${groupId}:`, e.message);
            }
          }
        }
        
        results.push({ ...group, id: groupId });
      }
      res.json(results);
    } catch (err) {
      console.error('Group batch save error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
