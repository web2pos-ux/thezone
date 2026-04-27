const express = require('express');
const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db, dbRun, dbAll, dbGet } = require('../db');
const { isMasterPosPin } = require('../utils/masterPosPin');

const PERMISSION_LEVELS_KEY = 'employee_permission_levels_v1';

// Firebase 서비스 (선택적 - 없으면 무시)

// Restaurant ID 조회 헬퍼
let cachedRestaurantId = null;
async function getRestaurantId() {
  if (cachedRestaurantId) return cachedRestaurantId;
  try {
    const setting = await dbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
    if (setting && setting.value) {
      cachedRestaurantId = String(setting.value).trim();
      return cachedRestaurantId;
    }
  } catch (e) { /* 테이블 없을 수 있음 */ }
  // online-orders·프론트는 business_profile.firebase_restaurant_id 를 쓰는 경우가 많음 — 여기 없으면 Firestore 서브컬렉션 갱신 실패 → Void 후에도 GET 목록에 그대로 남음
  try {
    const bp = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    if (bp?.firebase_restaurant_id && String(bp.firebase_restaurant_id).trim()) {
      cachedRestaurantId = String(bp.firebase_restaurant_id).trim();
      return cachedRestaurantId;
    }
  } catch (e) { /* */ }
  try {
    const bp2 = await dbGet('SELECT firebase_restaurant_id FROM business_profile LIMIT 1');
    if (bp2?.firebase_restaurant_id && String(bp2.firebase_restaurant_id).trim()) {
      cachedRestaurantId = String(bp2.firebase_restaurant_id).trim();
      return cachedRestaurantId;
    }
  } catch (e) { /* */ }
	return null;
}

/** table_map_elements 해제 반영 후 Sub POS/핸드헬드 동기화 (orders/table-operations와 동일 페이로드). */
function emitDeviceTableUpdatedFromElement(req, elementId, status, currentOrderId) {
	try {
		const io = req.app && req.app.get('io');
		if (!io || elementId == null || String(elementId).trim() === '') return;
		const tid = String(elementId);
		const payload = {
			table_id: tid,
			element_id: tid,
			status: String(status != null ? status : ''),
		};
		if (currentOrderId != null && currentOrderId !== '') {
			const n = Number(currentOrderId);
			if (Number.isFinite(n)) payload.current_order_id = n;
		}
		io.to('device_handheld').emit('table_updated', payload);
		io.to('device_sub_pos').emit('table_updated', payload);
	} catch (e) {
		console.warn('[voids] emitDeviceTableUpdatedFromElement:', e && e.message);
	}
}

// 테이블 생성
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS voids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0,
      reason TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'partial', -- partial | entire
      needs_approval INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT,
      approved_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS void_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      void_id INTEGER NOT NULL,
      order_line_id INTEGER,
      menu_id INTEGER,
      name TEXT,
      qty REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      printer_group_id INTEGER,
      FOREIGN KEY(void_id) REFERENCES voids(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS void_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      approval_threshold REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS printer_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      station TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME
    )
  `);

  // 보정: 단일 레코드 보장
  db.run(`INSERT OR IGNORE INTO void_policy (id, approval_threshold) VALUES (1, 0)`);
});

function clampLevel(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(5, Math.max(1, Math.round(v)));
}

function roleToLevel(roleRaw) {
  const role = String(roleRaw || '').toLowerCase().trim();
  if (!role) return 2;
  // Support both legacy roles (admin/owner/manager/supervisor/server/kitchen)
  // and UI roles (Owner, Manager, Supervisor, Server, Kitchen)
  if (role.includes('owner') || role.includes('admin')) return 5;
  if (role.includes('manager')) return 4;
  if (role.includes('supervisor')) return 3;
  if (role.includes('server') || role.includes('cashier')) return 2;
  if (role.includes('kitchen') || role.includes('bar')) return 1;
  return 2;
}

async function getPermissionOverridesFromDb() {
  try {
    const row = await dbGet(`SELECT value FROM admin_settings WHERE key = ?`, [PERMISSION_LEVELS_KEY]);
    const raw = row?.value ? String(row.value) : '';
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

async function getVoidMinRoleLevel() {
  // Mirrors Employee Manager defaults:
  // Category: "Order" / Permission: "Void Order" (default: 3 = Supervisor)
  const DEFAULT_LEVEL = 3;
  try {
    const overrides = await getPermissionOverridesFromDb();
    const saved = overrides?.Order?.['Void Order'];
    const n = Number(saved);
    if (Number.isFinite(n) && n >= 1 && n <= 5) return clampLevel(n, DEFAULT_LEVEL);
    return DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

async function resolveAuthorizedEmployeeByPin(pinStr, minLevel) {
  if (isMasterPosPin(pinStr)) {
    return { ok: true, approvedBy: 'Master PIN (1126)', role: 'ADMIN', level: 5 };
  }
  const employeesTable = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
  if (!employeesTable) return { ok: false, error: 'Employee table missing' };

  const rows = await dbAll(
    `SELECT id, name, role, status FROM employees WHERE pin = ?`,
    [pinStr]
  );
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { ok: false, error: 'Invalid PIN - no employee found with this PIN' };

  const active = list.filter((r) => {
    const st = String(r?.status || 'active').toLowerCase();
    return st === 'active';
  });
  if (active.length === 0) return { ok: false, error: 'Employee is not active' };

  // In case multiple employees share same PIN, pick the highest role level.
  let best = null;
  for (const r of active) {
    const lvl = roleToLevel(r?.role);
    if (!best || lvl > best.level) best = { row: r, level: lvl };
  }
  if (!best) return { ok: false, error: 'Invalid PIN' };

  if (best.level < minLevel) {
    return {
      ok: false,
      error: `Insufficient role: ${best.row?.role}. Level ${minLevel}+ required.`,
    };
  }

  const approvedBy = best.row?.name || `employee#${best.row?.id}`;
  return { ok: true, approvedBy, role: best.row?.role, level: best.level };
}

// 정책 조회
router.get('/settings/void-policy', async (req, res) => {
  try {
    const row = await dbGet('SELECT approval_threshold FROM void_policy WHERE id=1');
    res.json({ approval_threshold: row?.approval_threshold ?? 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 정책 저장
router.put('/settings/void-policy', async (req, res) => {
  try {
    const approval_threshold = Number(req.body?.approval_threshold ?? 0);
    await dbRun('UPDATE void_policy SET approval_threshold=?, updated_at=CURRENT_TIMESTAMP WHERE id=1', [approval_threshold]);
    res.json({ ok: true, approval_threshold });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Permission levels (saved from Employee Manager UI)
router.get('/settings/permission-levels', async (req, res) => {
  try {
    const row = await dbGet(`SELECT value FROM admin_settings WHERE key = ?`, [PERMISSION_LEVELS_KEY]);
    const raw = row?.value ? String(row.value) : '';
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    res.json({ success: true, levels: parsed || {} });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/settings/permission-levels', async (req, res) => {
  try {
    const incoming = req.body?.levels ?? req.body ?? {};
    const levels = incoming && typeof incoming === 'object' ? incoming : {};

    // Light sanitize: ensure numeric levels are 1..5 (keep shape flexible)
    const sanitized = {};
    for (const [cat, perms] of Object.entries(levels)) {
      if (!cat || !perms || typeof perms !== 'object') continue;
      const bucket = {};
      for (const [permName, lvl] of Object.entries(perms)) {
        if (!permName) continue;
        bucket[String(permName)] = clampLevel(lvl, 0);
      }
      sanitized[String(cat)] = bucket;
    }

    await dbRun(
      `INSERT INTO admin_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [PERMISSION_LEVELS_KEY, JSON.stringify(sanitized)]
    );

    res.json({ success: true, levels: sanitized });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 주문 Void 생성 (부분/전체)
router.post('/orders/:orderId/void', async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      lines = [], // [{ order_line_id, menu_id, name, qty, amount, tax, printer_group_id }]
      reason = '',
      note = '',
      source = 'partial', // 'partial' | 'entire'
      manager_pin = null,
      created_by = null,
    } = req.body || {};

    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'Invalid lines payload' });
    }
    const srcLower = String(source || '').toLowerCase();
    // 좀비 주문( order_items 없음 / API 미동기 )은 라인 없이 전체 void만 허용
    if (lines.length === 0 && srcLower !== 'entire') {
      return res.status(400).json({ error: 'No lines to void' });
    }

    const subtotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const tax_total = lines.reduce((s, l) => s + Number(l.tax || 0), 0);
    const grand_total = subtotal + tax_total;

    const policy = await dbGet('SELECT approval_threshold FROM void_policy WHERE id=1');
    const threshold = Number(policy?.approval_threshold || 0);
    const isEntireVoid = String(source || '').toLowerCase() === 'entire';
    // Entire order void must ALWAYS require manager+ PIN (per POS policy)
    const needsApproval = isEntireVoid || (threshold > 0 && grand_total >= threshold);

    // Always enforce "Void Order" minimum permission level (configured in Employee Manager).
    // The same PIN can serve as: (1) authorization, (2) approval when approval is needed.
    const minLevel = await getVoidMinRoleLevel();
    const pinStr = String(manager_pin || '').trim();
    if (!pinStr) {
      return res.status(403).json({ error: `Authorization PIN required (Void Level ${minLevel}+)` });
    }
    const auth = await resolveAuthorizedEmployeeByPin(pinStr, minLevel);
    if (!auth.ok) return res.status(403).json({ error: auth.error || 'Forbidden' });

    const approvedBy = auth.approvedBy;
    if (needsApproval) {
      console.log(`[VOID] Approved by ${approvedBy} (role: ${auth.role}, level: ${auth.level})`);
    }

    // void 헤더 생성
    const vRes = await dbRun(
      `INSERT INTO voids (order_id, subtotal, tax_total, grand_total, reason, note, source, needs_approval, approved_by, approved_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        subtotal,
        tax_total,
        grand_total,
        reason,
        note,
        source,
        needsApproval ? 1 : 0,
        approvedBy,
        approvedBy ? new Date().toISOString() : null,
        created_by || approvedBy,
      ]
    );
    const voidId = vRes.lastID;

    // 라인 생성
    const stmt = db.prepare(`INSERT INTO void_lines (void_id, order_line_id, menu_id, name, qty, amount, tax, printer_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    lines.forEach(l => stmt.run(voidId, l.order_line_id ?? null, l.menu_id ?? null, l.name ?? null, Number(l.qty||0), Number(l.amount||0), Number(l.tax||0), l.printer_group_id ?? null));
    await new Promise((resolve, reject) => stmt.finalize(err => err ? reject(err) : resolve()));

    let tableElRowsForSocket = [];
    try {
      tableElRowsForSocket = await dbAll(`SELECT element_id FROM table_map_elements WHERE current_order_id = ?`, [orderId]);
    } catch (e) {
      tableElRowsForSocket = [];
    }
    let shouldEmitTableSocket = false;
    // 주문 항목( order_items )에 수량 반영 및 합계 재계산
    try {
      await dbRun('BEGIN');
      for (const l of lines) {
        const qty = Number(l.qty || 0);
        const olid = l.order_line_id != null && l.order_line_id !== '' ? String(l.order_line_id) : null;
        if (olid) {
          // 라인ID 기준으로 정확히 차감
          await dbRun(
            `UPDATE order_items
             SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END
             WHERE order_id = ? AND order_line_id = ?`,
            [qty, qty, orderId, olid]
          );
        } else {
          // 폴백: item_id + name 기준(동일 항목 여러개면 모두 차감 가능성 있음)
          await dbRun(
            `UPDATE order_items
             SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END
             WHERE order_id = ? AND item_id = ? AND name = ?`,
            [qty, qty, orderId, String(l.menu_id ?? ''), String(l.name ?? '')]
          );
        }
      }
      // 수량 0인 라인 정리
      await dbRun(`DELETE FROM order_items WHERE order_id = ? AND (quantity IS NULL OR quantity <= 0)`, [orderId]);
      // 주문 합계 재계산 (단순 합계: 수량*단가)
      const sumRow = await dbGet(`SELECT COALESCE(SUM(quantity * price), 0) AS total FROM order_items WHERE order_id = ?`, [orderId]);
      const newTotal = Number(sumRow?.total || 0);
      await dbRun(`UPDATE orders SET total = ? WHERE id = ?`, [newTotal, orderId]);

      // If voiding results in an empty table (no remaining items), mark the table as Preparing.
      // This is safe even when the order has no table: the UPDATE simply affects 0 rows.
      if (newTotal <= 0) {
        await dbRun(
          `UPDATE table_map_elements
           SET current_order_id = NULL, status = 'Available'
           WHERE current_order_id = ?`,
          [orderId]
        );
      }

      // Entire void: mark order as VOIDED and release linked table so Day Closing can proceed
      if (isEntireVoid) {
        const closedAt = new Date().toISOString();
        await dbRun(`UPDATE orders SET status = 'VOIDED', closed_at = ?, subtotal = 0, tax = 0, total = 0 WHERE id = ?`, [closedAt, orderId]);
        await dbRun(
          `UPDATE table_map_elements
           SET current_order_id = NULL, status = 'Available'
           WHERE current_order_id = ?`,
          [orderId]
        );
        // 배달 메타(delivery_orders)가 남아 GET /delivery-orders에 계속 나오면 패널 좀비 — 동기 종료
        try {
          await dbRun(
            `UPDATE delivery_orders SET status = 'CANCELLED' WHERE order_id = ?
             OR id IN (
               SELECT CAST(SUBSTR(UPPER(TRIM(o.table_id)), 3) AS INTEGER)
               FROM orders o
               WHERE o.id = ? AND LENGTH(TRIM(o.table_id)) >= 3 AND UPPER(TRIM(o.table_id)) LIKE 'DL%'
             )`,
            [orderId, orderId]
          );
        } catch (dErr) {
          console.warn('[VOID] delivery_orders sync:', dErr && dErr.message ? dErr.message : dErr);
        }
      }
      await dbRun('COMMIT');
      shouldEmitTableSocket = (newTotal <= 0 || isEntireVoid);
    } catch (adjErr) {
      try { await dbRun('ROLLBACK'); } catch {}
      // 수량 반영 실패는 Void 자체를 실패시키진 않지만, 클라이언트에 경고 제공
      console.warn('Failed to adjust order_items after void:', adjErr && adjErr.message ? adjErr.message : adjErr);
    }

    if (shouldEmitTableSocket) {
      for (const row of tableElRowsForSocket || []) {
        if (row && row.element_id != null) {
          emitDeviceTableUpdatedFromElement(req, row.element_id, 'Available', null);
        }
      }
    }

    // 감사 로그
    await dbRun(
      'INSERT INTO audit_logs (entity_type, entity_id, action, payload_json, user_id) VALUES (?, ?, ?, ?, ?)',
      [ 'void', String(voidId), 'create', JSON.stringify({ orderId, lines, reason, note, source, totals: { subtotal, tax_total, grand_total } }), created_by || null ]
    );

    // 프린터 통지: 스테이션별 페이로드 (주문번호/테이블명 포함)
    let orderNumber = '';
    let tableName = '';
    try {
      const orderRow = await dbGet('SELECT order_number, table_id FROM orders WHERE id = ?', [orderId]);
      if (orderRow) {
        orderNumber = orderRow.order_number || '';
        if (orderRow.table_id) {
          const tableRow = await dbGet('SELECT name FROM table_map_elements WHERE element_id = ?', [orderRow.table_id]);
          tableName = tableRow?.name || '';
        }
      }
    } catch (e) { /* 주문 정보 조회 실패 무시 */ }

    // 전체 Void 후 Firebase cancelled + void 문서 (오프라인 시 큐)
    let firebaseOrderIdForVoid = '';
    if (isEntireVoid) {
      try {
        const chk = await dbGet(`SELECT status, firebase_order_id FROM orders WHERE id = ?`, [orderId]);
        const st = String(chk?.status || '').toUpperCase();
        const fid =
          chk?.firebase_order_id != null && String(chk.firebase_order_id).trim() !== ''
            ? String(chk.firebase_order_id).trim()
            : '';
        if (st === 'VOIDED' && fid) firebaseOrderIdForVoid = fid;
      } catch (fbErr) {
        console.warn('[VOID] Firebase cancelled prep:', fbErr && fbErr.message ? fbErr.message : fbErr);
      }
    }

    // Build station payloads.
    // If client didn't provide printer_group_id (common for "void unpaid order" flows),
    // resolve it from menu/category printer links so VOID prints to the correct group.
    const byStation = {};
    for (const l of lines) {
      let stationIds = [];

      const explicit = l?.printer_group_id;
      if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
        stationIds = [String(explicit)];
      }

      if (!stationIds.length) {
        const menuId = l?.menu_id ?? l?.menuId ?? null;
        if (menuId !== null && menuId !== undefined && String(menuId).trim() !== '') {
          // 1) menu-level printer links
          try {
            const links = await dbAll(
              'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
              [menuId]
            );
            stationIds = (links || []).map(r => String(r.printer_group_id)).filter(Boolean);
          } catch {}

          // 2) category-level printer links fallback
          if (!stationIds.length) {
            try {
              const mi = await dbGet('SELECT category_id FROM menu_items WHERE item_id = ?', [menuId]);
              const catId = mi?.category_id;
              if (catId !== undefined && catId !== null && String(catId).trim() !== '') {
                const catLinks = await dbAll(
                  'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
                  [catId]
                );
                stationIds = (catLinks || []).map(r => String(r.printer_group_id)).filter(Boolean);
              }
            } catch {}
          }
        }
      }

      if (!stationIds.length) stationIds = ['default'];

      for (const sid of stationIds) {
        const key = String(sid || 'default');
        byStation[key] = byStation[key] || [];
        byStation[key].push({ name: l.name, qty: l.qty, amount: l.amount });
      }
    }
    // 실제 프린터 연동 지점: 큐에 등록
    const createdJobIds = [];
    for (const [station, stationItems] of Object.entries(byStation)) {
      const job = { orderId, voidId, station, items: stationItems, reason, note, orderNumber, tableName };
      const ins = await dbRun('INSERT INTO printer_jobs (type, station, payload_json) VALUES (?, ?, ?)', [ 'VOID_TICKET', String(station), JSON.stringify(job) ]);
      if (ins && ins.lastID) createdJobIds.push(ins.lastID);
    }

    // Best-effort immediate dispatch so VOID prints reliably (even if background dispatcher isn't running).
    // Non-blocking: printing failure should not fail the VOID API response.
    void (async () => {
      try {
        const { sendRawToPrinter } = require('../utils/printerUtils');
        const { buildGraphicVoidTicket } = require('../utils/graphicPrinterUtils');

        // ESC/POS beep: 3 beeps, 200ms
        const BEEP_CMD = Buffer.from([0x1B, 0x42, 0x03, 0x02]);

        for (const jobId of createdJobIds) {
          try {
            const jobRow = await dbGet('SELECT id, station, payload_json, status FROM printer_jobs WHERE id = ?', [jobId]);
            if (!jobRow || String(jobRow.status || '') !== 'queued') continue;
            const payload = JSON.parse(jobRow.payload_json || '{}');

            // Find target printer(s) from printer_group_links.
            // This ensures VOID prints to the configured printer group, even when the payload only has a group id.
            const station = jobRow.station || payload.station;
            let printerLabel = null;
            let targets = []; // [{ printer: string, copies: number }]

            if (station && station !== 'default') {
              try {
                const groupRow = await dbGet(
                  "SELECT name FROM printer_groups WHERE printer_group_id = ? AND is_active = 1",
                  [station]
                );
                if (groupRow?.name) printerLabel = groupRow.name;
              } catch {}

              try {
                const links = await dbAll(
                  `SELECT p.selected_printer as selected_printer, COALESCE(pgl.copies, 1) as copies
                   FROM printer_group_links pgl
                   JOIN printers p ON pgl.printer_id = p.printer_id AND p.is_active = 1
                   JOIN printer_groups pg ON pgl.printer_group_id = pg.printer_group_id AND pg.is_active = 1
                   WHERE pgl.printer_group_id = ? AND p.selected_printer IS NOT NULL`,
                  [station]
                );
                targets = (links || [])
                  .map(r => ({ printer: r.selected_printer, copies: Number(r.copies || 1) }))
                  .filter(t => t.printer);
              } catch {}
            }

            // Fallback to a kitchen printer
            if (!targets.length) {
              const kitchenPrinter = await dbGet(
                "SELECT selected_printer FROM printers WHERE (type = 'kitchen' OR name LIKE '%Kitchen%') AND is_active = 1 AND selected_printer IS NOT NULL LIMIT 1"
              );
              if (kitchenPrinter?.selected_printer) {
                targets = [{ printer: kitchenPrinter.selected_printer, copies: 1 }];
              }
            }

            if (!targets.length) {
              await dbRun("UPDATE printer_jobs SET status = 'error', error = 'No printer found' WHERE id = ?", [jobId]);
              continue;
            }

            // Top margin from layout settings
            let topMargin = 5;
            try {
              const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
              if (layoutRow?.settings) {
                const ls = JSON.parse(layoutRow.settings);
                topMargin = ls?.kitchenTopMargin || ls?.topMargin || 5;
              }
            } catch {}

            const voidTicketData = {
              items: payload.items || [],
              reason: payload.reason || '',
              note: payload.note || '',
              orderNumber: payload.orderNumber || '',
              tableName: payload.tableName || '',
              printerLabel,
              topMargin
            };

            const ticketBuffer = buildGraphicVoidTicket(voidTicketData, true);
            const bufferWithBeep = Buffer.concat([BEEP_CMD, ticketBuffer]);

            for (const t of targets) {
              const copies = Number.isFinite(t.copies) && t.copies > 0 ? t.copies : 1;
              for (let i = 0; i < copies; i++) {
                await sendRawToPrinter(t.printer, bufferWithBeep);
              }
            }

            await dbRun("UPDATE printer_jobs SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?", [jobId]);
          } catch (jobErr) {
            try {
              await dbRun("UPDATE printer_jobs SET status = 'error', error = ? WHERE id = ?", [String(jobErr?.message || jobErr), jobId]);
            } catch {}
          }
        }
      } catch {
        // ignore
      }
    })();

    // Firebase 동기화 (비차단, 오프라인 시 큐)
    try {
      const restaurantId = await getRestaurantId();
      if (restaurantId) {
        const firebaseSyncOrchestrator = require('../services/firebaseSyncOrchestrator');
        await firebaseSyncOrchestrator.syncOrQueue(
          'void_cancel_and_void_doc',
          Number(orderId),
          {
            restaurantId,
            firebaseOrderId: firebaseOrderIdForVoid || null,
            voidData: {
              voidId,
              orderId: Number(orderId),
              orderNumber,
              tableName,
              subtotal,
              tax_total,
              grand_total,
              reason,
              note,
              source,
              lines: lines.map(l => ({ name: l.name, qty: l.qty, amount: l.amount })),
              created_by: created_by || null,
              created_at: new Date().toISOString(),
            },
          },
        );
      }
    } catch (fbErr) {
      console.warn('Firebase void sync failed (non-blocking):', fbErr?.message);
    }

    res.json({
      ok: true,
      void_id: voidId,
      needs_approval: needsApproval,
      approved_by: approvedBy || null,
      totals: { subtotal, tax_total, grand_total },
      printer_jobs: byStation
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 주문의 Void 목록 조회
router.get('/orders/:orderId/voids', async (req, res) => {
  try {
    const { orderId } = req.params;
    const header = await dbAll('SELECT * FROM voids WHERE order_id = ? ORDER BY created_at DESC', [orderId]);
    const ids = header.map(v => v.id);
    const lines = ids.length ? await dbAll(`SELECT * FROM void_lines WHERE void_id IN (${ids.map(()=>'?').join(',')})`, ids) : [];
    res.json({ header, lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Void 승인(API 단독 승인 경로)
router.post('/voids/:voidId/approve', async (req, res) => {
  try {
    const { voidId } = req.params;
    const { manager_pin } = req.body || {};
    if (!manager_pin) return res.status(400).json({ error: 'PIN required' });
    const employeesTable = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
    if (!employeesTable) return res.status(403).json({ error: 'Manager approval table missing' });
    
    // Supervisor 이상 등급에서 VOID 승인 가능
    const pinStr = String(manager_pin).trim();
    
    if (isMasterPosPin(pinStr)) {
      await dbRun('UPDATE voids SET needs_approval=0, approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?', [
        'Master PIN (1126)',
        voidId,
      ]);
      return res.json({ ok: true });
    }

    // 먼저 PIN이 존재하는지 확인
    const empByPin = await dbGet(
      `SELECT id, name, role, status FROM employees WHERE pin = ?`,
      [pinStr]
    );
    
    if (!empByPin) {
      console.log(`[VOID APPROVE] PIN not found: ${pinStr}`);
      return res.status(403).json({ error: 'Invalid PIN - no employee found with this PIN' });
    }
    
    // status 확인
    if (empByPin.status && empByPin.status.toLowerCase() !== 'active') {
      console.log(`[VOID APPROVE] Employee ${empByPin.name} is not active (status: ${empByPin.status})`);
      return res.status(403).json({ error: 'Employee is not active' });
    }
    
    // role 확인 (supervisor, manager, owner, admin 허용)
    const roleNorm = (empByPin.role || '').toLowerCase().trim();
    const allowedRoles = ['supervisor', 'manager', 'owner', 'admin'];
    if (!allowedRoles.includes(roleNorm)) {
      console.log(`[VOID APPROVE] Employee ${empByPin.name} has insufficient role: ${empByPin.role} (normalized: ${roleNorm})`);
      return res.status(403).json({ error: `Insufficient role: ${empByPin.role}. Supervisor, Manager, Owner, or Admin required.` });
    }
    
    const approvedBy = empByPin.name || `employee#${empByPin.id}`;
    console.log(`[VOID APPROVE] Approved by ${approvedBy} (role: ${empByPin.role})`);
    
    await dbRun('UPDATE voids SET needs_approval=0, approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?', [approvedBy, voidId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


