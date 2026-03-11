/**
 * Trace printer-group routing for a given order in a given DB.
 *
 * Usage:
 *   node backend/scripts/trace-printer-links.js "C:\path\to\web2pos.db" 2
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

function openDb(dbPath) {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
}

function qAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function qGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function pickOrder(db, preferredId) {
  if (Number.isFinite(preferredId) && preferredId > 0) {
    const byId = await qGet(db, 'SELECT * FROM orders WHERE id = ?', [preferredId]);
    if (byId) return { order: byId, why: `id=${preferredId}` };
  }
  // Common: order_number like "002"
  if (Number.isFinite(preferredId) && preferredId > 0) {
    const num = String(preferredId).padStart(3, '0');
    const byNum = await qGet(db, 'SELECT * FROM orders WHERE order_number = ?', [num]);
    if (byNum) return { order: byNum, why: `order_number=${num}` };
  }
  const latest = await qGet(db, 'SELECT * FROM orders ORDER BY id DESC LIMIT 1');
  if (latest) return { order: latest, why: 'latest' };
  return { order: null, why: 'none' };
}

async function main() {
  const dbPath = process.argv[2];
  const preferredId = Number(process.argv[3] || 2);

  if (!dbPath) {
    console.error('Missing dbPath.\nUsage: node trace-printer-links.js "C:\\path\\web2pos.db" 2');
    process.exit(2);
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`DB file not found: ${dbPath}`);
    process.exit(2);
  }

  const db = openDb(dbPath);
  try {
    const meta = await qGet(db, 'SELECT COUNT(*) as ordersCount, COALESCE(MAX(id), 0) as maxOrderId FROM orders');
    console.log('DB_PATH', dbPath);
    console.log('ORDERS_META', meta);

    const picked = await pickOrder(db, preferredId);
    console.log('PICKED_BY', picked.why);
    if (!picked.order) {
      console.log('NO_ORDERS');
      return;
    }

    const order = picked.order;
    console.log('ORDER', {
      id: order.id,
      order_number: order.order_number,
      order_type: order.order_type,
      status: order.status,
      total: order.total,
      subtotal: order.subtotal,
      tax: order.tax,
      created_at: order.created_at,
      table_id: order.table_id,
      order_source: order.order_source,
      fulfillment_mode: order.fulfillment_mode,
    });

    const items = await qAll(db, 'SELECT id, item_id, name, quantity, price FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
    console.log('ITEM_COUNT', items.length);

    const traced = [];

    for (const it of items) {
      const itemId = String(it.item_id || '').trim();

      let groupIds = (await qAll(db, 'SELECT printer_group_id FROM menu_printer_links WHERE CAST(item_id AS TEXT) = ?', [itemId]))
        .map((r) => Number(r.printer_group_id))
        .filter(Boolean);

      let source = 'menu_printer_links';
      let categoryId = null;

      if (groupIds.length === 0) {
        const mi = await qGet(db, 'SELECT category_id FROM menu_items WHERE CAST(item_id AS TEXT) = ?', [itemId]);
        categoryId = mi && mi.category_id != null ? Number(mi.category_id) : null;
        if (categoryId != null) {
          groupIds = (await qAll(db, 'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?', [categoryId]))
            .map((r) => Number(r.printer_group_id))
            .filter(Boolean);
          source = `category_printer_links(cat=${categoryId})`;
        } else {
          source = 'no_menu_item_row';
        }
      }

      const groups = [];
      for (const gid of groupIds) {
        const g = await qGet(db, 'SELECT printer_group_id, name, is_active FROM printer_groups WHERE printer_group_id = ?', [gid]);
        const printers = await qAll(
          db,
          'SELECT pgl.printer_id, COALESCE(pgl.copies, 1) as copies, p.name as printer_name, p.type as printer_type, p.is_active as printer_active, p.selected_printer as selected_printer ' +
            'FROM printer_group_links pgl ' +
            'JOIN printers p ON pgl.printer_id = p.printer_id ' +
            'WHERE pgl.printer_group_id = ?',
          [gid]
        );
        groups.push({
          printer_group_id: gid,
          group_name: g ? g.name : null,
          group_active: g ? g.is_active : null,
          printers,
        });
      }

      traced.push({
        item_id: itemId,
        item_name: it.name,
        qty: it.quantity,
        price: it.price,
        category_id: categoryId,
        printer_group_source: source,
        printer_group_ids: groupIds,
        groups,
      });
    }

    console.log('---TRACE');
    for (const r of traced) {
      console.log(`ITEM ${r.item_id} | ${r.item_name} x${r.qty} | src=${r.printer_group_source}`);
      console.log(`  groupIds: ${r.printer_group_ids.length ? r.printer_group_ids.join(', ') : '(none)'}`);
      for (const g of r.groups) {
        console.log(`   GROUP ${g.printer_group_id} | ${g.group_name || '(missing)'} | active=${g.group_active}`);
        if (!g.printers.length) {
          console.log('     printers: (no printer_group_links)');
          continue;
        }
        for (const p of g.printers) {
          console.log(
            '     PRINTER ' +
              JSON.stringify({
                printer_id: p.printer_id,
                name: p.printer_name,
                type: p.printer_type,
                active: p.printer_active,
                selected_printer: p.selected_printer,
                copies: p.copies,
              })
          );
        }
      }
    }

    // Summary per group
    const uniqueGids = [...new Set(traced.flatMap((r) => r.printer_group_ids || []))];
    console.log('===GROUP_SUMMARY');
    for (const gid of uniqueGids) {
      const g = await qGet(db, 'SELECT printer_group_id, name, is_active FROM printer_groups WHERE printer_group_id = ?', [gid]);
      const links = await qAll(
        db,
        'SELECT pgl.printer_id, COALESCE(pgl.copies, 1) as copies, p.name as printer_name, p.type as printer_type, p.is_active as printer_active, p.selected_printer as selected_printer ' +
          'FROM printer_group_links pgl ' +
          'JOIN printers p ON pgl.printer_id = p.printer_id ' +
          'WHERE pgl.printer_group_id = ?',
        [gid]
      );
      console.log('GROUP', gid, g ? g.name : '(missing)', `active=${g ? g.is_active : ''}`, `printers=${links.length}`);
      for (const l of links) {
        console.log(
          '  ' +
            JSON.stringify({
              printer_id: l.printer_id,
              name: l.printer_name,
              type: l.printer_type,
              active: l.printer_active,
              selected_printer: l.selected_printer,
              copies: l.copies,
            })
        );
      }
    }
  } catch (e) {
    console.error('ERR', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();

