// backend/utils/noShowScheduler.js
// Lightweight per-reservation no-show scheduler (no polling)

const timers = new Map(); // reservationId -> Timeout

function toMs(timeStr) {
  try {
    const [hh, mm] = String(timeStr || '00:00').split(':').map(n => Number(n));
    return hh * 60 * 60 * 1000 + mm * 60 * 1000;
  } catch { return 0; }
}

function scheduleOne(db, policyGrace, reservation) {
  try {
    const { id, reservation_date, reservation_time, status } = reservation;
    if (!id) return;
    if (String(status) !== 'pending' && String(status) !== 'confirmed') return;

    // Clear existing timer
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }

    const graceMin = Number(policyGrace || 10);
    const d = new Date(reservation_date);
    const [hh, mm] = String(reservation_time || '00:00').split(':').map(n => Number(n));
    d.setHours(hh, mm, 0, 0);
    d.setMinutes(d.getMinutes() + graceMin);
    const delay = d.getTime() - Date.now();

    const run = async () => {
      try {
        // Only transition if still pending/confirmed
        const row = await new Promise((resolve, reject) => db.get('SELECT status FROM reservations WHERE id = ?', [id], (err, r) => err ? reject(err) : resolve(r)));
        if (row && (row.status === 'pending' || row.status === 'confirmed')) {
          await new Promise((resolve, reject) => db.run("UPDATE reservations SET status='no_show', updated_at=CURRENT_TIMESTAMP WHERE id=?", [id], function(err){ err?reject(err):resolve(); }));
        }
      } catch {
      } finally {
        if (timers.has(id)) timers.delete(id);
      }
    };

    if (delay <= 0) {
      // already overdue
      setImmediate(run);
      return;
    }
    const t = setTimeout(run, delay);
    timers.set(id, t);
  } catch {}
}

async function init(db) {
  // Load grace
  const policy = await new Promise((resolve) => {
    db.get('SELECT no_show_grace_minutes FROM reservation_policy LIMIT 1', [], (err, row) => resolve(row || { no_show_grace_minutes: 10 }));
  });
  const grace = Number(policy?.no_show_grace_minutes || 10);

  // Schedule for today
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const list = await new Promise((resolve, reject) => db.all('SELECT id, reservation_date, reservation_time, status FROM reservations WHERE reservation_date = ?', [ds], (err, rows) => err?reject(err):resolve(rows || [])));
  (list||[]).forEach(r => scheduleOne(db, grace, r));

  return {
    rescheduleAllForDate: async (dateStr) => {
      const rows = await new Promise((resolve, reject) => db.all('SELECT id, reservation_date, reservation_time, status FROM reservations WHERE reservation_date = ?', [dateStr], (err, rows) => err?reject(err):resolve(rows||[])));
      rows.forEach(r => scheduleOne(db, grace, r));
    },
    scheduleForReservation: async (reservationId) => {
      const r = await new Promise((resolve, reject) => db.get('SELECT id, reservation_date, reservation_time, status FROM reservations WHERE id = ?', [reservationId], (err, row) => err?reject(err):resolve(row)));
      if (r) scheduleOne(db, grace, r);
    },
    cancelForReservation: (reservationId) => {
      if (timers.has(reservationId)) {
        clearTimeout(timers.get(reservationId));
        timers.delete(reservationId);
      }
    }
  };
}

module.exports = { init };


