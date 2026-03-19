// backend/scripts/fix_invalid_tax_links.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

(async () => {
  try {
    console.log('DB:', dbPath);

    // 1) Find invalid links where the referenced tax_group_id doesn't exist in tax_groups
    const invalidLinks = await all(`
      SELECT mtl.link_id, mtl.item_id, mtl.tax_group_id
      FROM menu_tax_links mtl
      LEFT JOIN tax_groups tg ON tg.group_id = mtl.tax_group_id
      WHERE tg.group_id IS NULL
    `);

    if (invalidLinks.length === 0) {
      console.log('No invalid tax links found. Nothing to fix.');
      db.close();
      return;
    }

    console.log(`Found ${invalidLinks.length} invalid links.`);

    await run('BEGIN TRANSACTION');

    let fixes = 0;
    for (const link of invalidLinks) {
      // Find the menu_id of this item
      const item = await get('SELECT item_id, menu_id FROM menu_items WHERE item_id = ?', [link.item_id]);
      if (!item) {
        console.warn(`Item ${link.item_id} not found; deleting invalid link ${link.link_id}`);
        await run('DELETE FROM menu_tax_links WHERE link_id = ?', [link.link_id]);
        fixes++;
        continue;
      }

      // Prefer a group named 'Food' for this menu; fallback to the first available group for the same menu
      const preferred = await get('SELECT group_id FROM tax_groups WHERE is_deleted = 0 AND menu_id = ? AND name LIKE ? ORDER BY name LIMIT 1', [item.menu_id, '%Food%']);
      let replacement = preferred;
      if (!replacement) {
        replacement = await get('SELECT group_id FROM tax_groups WHERE is_deleted = 0 AND menu_id = ? ORDER BY name LIMIT 1', [item.menu_id]);
      }

      if (!replacement) {
        console.warn(`No valid tax group found for menu ${item.menu_id}; deleting invalid link ${link.link_id}`);
        await run('DELETE FROM menu_tax_links WHERE link_id = ?', [link.link_id]);
        fixes++;
        continue;
      }

      // If the (item_id, replacement_group_id) pair already exists, delete the invalid link to avoid unique violation
      const exists = await get('SELECT 1 FROM menu_tax_links WHERE item_id = ? AND tax_group_id = ?', [link.item_id, replacement.group_id]);
      if (exists) {
        await run('DELETE FROM menu_tax_links WHERE link_id = ?', [link.link_id]);
        fixes++;
        continue;
      }

      // Update invalid link to point to the replacement group
      await run('UPDATE menu_tax_links SET tax_group_id = ? WHERE link_id = ?', [replacement.group_id, link.link_id]);
      fixes++;
    }

    await run('COMMIT');
    console.log(`Completed. Fixed ${fixes} links.`);
  } catch (err) {
    console.error('Error fixing tax links:', err.message);
    try { await run('ROLLBACK'); } catch {}
  } finally {
    db.close();
  }
})(); 