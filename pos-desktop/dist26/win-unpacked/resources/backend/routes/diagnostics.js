const express = require('express');
const fs = require('fs');

// Lightweight diagnostics endpoints to quickly verify:
// - Which SQLite DB file this server is using
// - Whether the DB has orders/payments data
// - Whether a Day Opening (daily_closings session) exists / is active

module.exports = (db) => {
  const router = express.Router();

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });

  const tableExists = async (name) => {
    try {
      const row = await dbGet(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [name],
      );
      return !!row?.name;
    } catch {
      return false;
    }
  };

  const PAID_STATUSES_SQL = "UPPER(status) IN ('PAID','COMPLETED','CLOSED','PICKED_UP')";

  router.get('/closing', async (req, res) => {
    try {
      const dbPath = process.env.DB_PATH || null;
      let dbFile = { exists: false, sizeBytes: null };
      if (dbPath) {
        try {
          const st = fs.statSync(dbPath);
          dbFile = { exists: true, sizeBytes: st.size };
        } catch {
          dbFile = { exists: false, sizeBytes: null };
        }
      }

      const hasOrders = await tableExists('orders');
      const hasPayments = await tableExists('payments');
      const hasDailyClosings = await tableExists('daily_closings');

      let activeSession = null;
      let lastSession = null;
      if (hasDailyClosings) {
        try {
          activeSession = await dbGet(
            "SELECT * FROM daily_closings WHERE status = 'open' ORDER BY id DESC LIMIT 1",
          );
        } catch {}
        try {
          lastSession = await dbGet(
            'SELECT * FROM daily_closings ORDER BY id DESC LIMIT 1',
          );
        } catch {}
      }

      const summarize = async () => {
        const out = {
          orders: null,
          payments: null,
          session: null,
        };

        if (hasOrders) {
          const oTotal = await dbGet('SELECT COUNT(*) AS c FROM orders');
          const oPaid = await dbGet(`SELECT COUNT(*) AS c FROM orders WHERE ${PAID_STATUSES_SQL}`);
          const oPaidSum = await dbGet(`SELECT COALESCE(SUM(total), 0) AS s FROM orders WHERE ${PAID_STATUSES_SQL}`);
          const oLatest = await dbGet('SELECT MAX(created_at) AS t FROM orders');
          out.orders = {
            totalRows: oTotal?.c || 0,
            paidRows: oPaid?.c || 0,
            paidTotalSum: oPaidSum?.s || 0,
            latestCreatedAt: oLatest?.t || null,
          };
        }

        if (hasPayments) {
          const pTotal = await dbGet('SELECT COUNT(*) AS c FROM payments');
          const pApproved = await dbGet("SELECT COUNT(*) AS c FROM payments WHERE status = 'APPROVED'");
          const pApprovedGross = await dbGet("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE status = 'APPROVED'");
          const pApprovedNet = await dbGet("SELECT COALESCE(SUM(amount - COALESCE(tip, 0)), 0) AS s FROM payments WHERE status = 'APPROVED'");
          const pLatest = await dbGet('SELECT MAX(created_at) AS t FROM payments');
          out.payments = {
            totalRows: pTotal?.c || 0,
            approvedRows: pApproved?.c || 0,
            approvedGrossSum: pApprovedGross?.s || 0,
            approvedNetSum: pApprovedNet?.s || 0,
            latestCreatedAt: pLatest?.t || null,
          };
        }

        if (activeSession) {
          try {
            const start = activeSession.opened_at;
            const end = activeSession.closed_at || new Date().toISOString();
            const o = hasOrders
              ? await dbGet(
                `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS s
                 FROM orders
                 WHERE created_at >= ? AND created_at <= ? AND ${PAID_STATUSES_SQL}`,
                [start, end],
              )
              : null;
            const p = hasPayments
              ? await dbGet(
                `SELECT COUNT(*) AS c, COALESCE(SUM(amount - COALESCE(tip, 0)), 0) AS net
                 FROM payments
                 WHERE created_at >= ? AND created_at <= ? AND status = 'APPROVED'`,
                [start, end],
              )
              : null;

            out.session = {
              session_id: activeSession.session_id,
              date: activeSession.date,
              status: activeSession.status,
              opened_at: activeSession.opened_at,
              closed_at: activeSession.closed_at || null,
              paidOrdersCount: o?.c || 0,
              paidOrdersTotalSum: o?.s || 0,
              approvedPaymentsCount: p?.c || 0,
              approvedPaymentsNetSum: p?.net || 0,
            };
          } catch {
            out.session = {
              session_id: activeSession.session_id,
              date: activeSession.date,
              status: activeSession.status,
              opened_at: activeSession.opened_at,
              closed_at: activeSession.closed_at || null,
              paidOrdersCount: null,
              paidOrdersTotalSum: null,
              approvedPaymentsCount: null,
              approvedPaymentsNetSum: null,
            };
          }
        }

        return out;
      };

      const summary = await summarize();

      res.json({
        success: true,
        now: new Date().toISOString(),
        env: {
          node: process.version,
          pid: process.pid,
          cwd: process.cwd(),
        },
        db: {
          path: dbPath,
          file: dbFile,
          tables: {
            orders: hasOrders,
            payments: hasPayments,
            daily_closings: hasDailyClosings,
          },
        },
        dailyClosings: {
          activeSession: activeSession
            ? { session_id: activeSession.session_id, date: activeSession.date, opened_at: activeSession.opened_at, status: activeSession.status }
            : null,
          lastSession: lastSession
            ? { session_id: lastSession.session_id, date: lastSession.date, opened_at: lastSession.opened_at, closed_at: lastSession.closed_at || null, status: lastSession.status }
            : null,
        },
        summary,
      });
    } catch (error) {
      console.error('[diagnostics/closing] error:', error);
      res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  return router;
};

