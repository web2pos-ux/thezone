const express = require('express');
const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db, dbRun, dbAll, dbGet } = require('../db');

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

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'No lines to void' });
    }

    const subtotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const tax_total = lines.reduce((s, l) => s + Number(l.tax || 0), 0);
    const grand_total = subtotal + tax_total;

    const policy = await dbGet('SELECT approval_threshold FROM void_policy WHERE id=1');
    const threshold = Number(policy?.approval_threshold || 0);
    const needsApproval = threshold > 0 && grand_total >= threshold;

    // 승인 필요 시 PIN 검증(선택): employees 테이블이 있으면 검증, 없으면 거절
    let approvedBy = null;
    if (needsApproval) {
      const employeesTable = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
      if (!manager_pin) return res.status(403).json({ error: 'Manager approval required' });
      if (employeesTable) {
        const mgr = await dbGet('SELECT id, name, role FROM employees WHERE pin = ? AND role IN ("manager","owner","admin")', [String(manager_pin)]);
        if (!mgr) return res.status(403).json({ error: 'Invalid PIN or insufficient role' });
        approvedBy = mgr.name || `employee#${mgr.id}`;
      } else {
        // 직원 테이블이 없으면 보수적으로 차단
        return res.status(403).json({ error: 'Manager approval table missing' });
      }
    }

    // void 헤더 생성
    const vRes = await dbRun(
      `INSERT INTO voids (order_id, subtotal, tax_total, grand_total, reason, note, source, needs_approval, approved_by, approved_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, subtotal, tax_total, grand_total, reason, note, source, needsApproval ? 1 : 0, approvedBy, approvedBy ? new Date().toISOString() : null, created_by]
    );
    const voidId = vRes.lastID;

    // 라인 생성
    const stmt = db.prepare(`INSERT INTO void_lines (void_id, order_line_id, menu_id, name, qty, amount, tax, printer_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    lines.forEach(l => stmt.run(voidId, l.order_line_id ?? null, l.menu_id ?? null, l.name ?? null, Number(l.qty||0), Number(l.amount||0), Number(l.tax||0), l.printer_group_id ?? null));
    await new Promise((resolve, reject) => stmt.finalize(err => err ? reject(err) : resolve()));

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
      await dbRun(`UPDATE orders SET total = ? WHERE id = ?`, [Number(sumRow?.total || 0), orderId]);
      await dbRun('COMMIT');
    } catch (adjErr) {
      try { await dbRun('ROLLBACK'); } catch {}
      // 수량 반영 실패는 Void 자체를 실패시키진 않지만, 클라이언트에 경고 제공
      console.warn('Failed to adjust order_items after void:', adjErr && adjErr.message ? adjErr.message : adjErr);
    }

    // 감사 로그
    await dbRun(
      'INSERT INTO audit_logs (entity_type, entity_id, action, payload_json, user_id) VALUES (?, ?, ?, ?, ?)',
      [ 'void', String(voidId), 'create', JSON.stringify({ orderId, lines, reason, note, source, totals: { subtotal, tax_total, grand_total } }), created_by || null ]
    );

    // 프린터 통지(간이): 스테이션별 페이로드 로그
    const byStation = {};
    lines.forEach(l => {
      const key = String(l.printer_group_id ?? 'default');
      byStation[key] = byStation[key] || [];
      byStation[key].push({ name: l.name, qty: l.qty, amount: l.amount });
    });
    // 실제 프린터 연동 지점: 큐에 등록
    for (const [station, items] of Object.entries(byStation)) {
      const job = { orderId, voidId, station, items, reason, note };
      await dbRun('INSERT INTO printer_jobs (type, station, payload_json) VALUES (?, ?, ?)', [ 'VOID_TICKET', String(station), JSON.stringify(job) ]);
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
    const mgr = await dbGet('SELECT id, name, role FROM employees WHERE pin = ? AND role IN ("manager","owner","admin")', [String(manager_pin)]);
    if (!mgr) return res.status(403).json({ error: 'Invalid PIN or insufficient role' });
    await dbRun('UPDATE voids SET needs_approval=0, approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?', [mgr.name || `employee#${mgr.id}`, voidId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


