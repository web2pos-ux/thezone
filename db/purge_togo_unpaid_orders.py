"""
Delete TOGO orders that are still unpaid (payment pending/unpaid) and not completed.

Criteria (미결제 투고 정리):
  - order_type = TOGO (case-insensitive)
  - payment_status IN ('pending', 'unpaid')
  - status NOT IN ('PAID', 'VOIDED')  -- 완결·취소 기록은 유지

Child rows (payments, order_items, …) are removed first. Backup before run.
Stop backend if it may re-insert orders.
"""
from __future__ import annotations

import shutil
import sqlite3
import time
from pathlib import Path

DB = Path(__file__).resolve().parent / "web2pos.db"


def select_target_ids(conn: sqlite3.Connection) -> list[int]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id FROM orders
        WHERE UPPER(TRIM(COALESCE(order_type, ''))) = 'TOGO'
          AND LOWER(TRIM(COALESCE(payment_status, ''))) IN ('pending', 'unpaid')
          AND UPPER(TRIM(COALESCE(status, ''))) NOT IN ('PAID', 'VOIDED')
        """
    )
    return [r[0] for r in cur.fetchall()]


def delete_batch(conn: sqlite3.Connection, ids: list[int]) -> int:
    if not ids:
        return 0
    ph = ",".join("?" * len(ids))
    cur = conn.cursor()
    cur.execute(f"DELETE FROM void_lines WHERE void_id IN (SELECT id FROM voids WHERE order_id IN ({ph}))", ids)
    cur.execute(f"DELETE FROM voids WHERE order_id IN ({ph})", ids)
    cur.execute(
        f"DELETE FROM refund_items WHERE refund_id IN (SELECT id FROM refunds WHERE order_id IN ({ph}))", ids
    )
    cur.execute(f"DELETE FROM refunds WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM tips WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM payments WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM order_adjustments WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM order_guest_status WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM order_items WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM delivery_orders WHERE order_id IN ({ph})", ids)
    cur.execute(f"DELETE FROM orders WHERE id IN ({ph})", ids)
    return cur.rowcount


def main() -> None:
    if not DB.is_file():
        raise SystemExit(f"Database not found: {DB}")

    ts = time.strftime("%Y%m%d_%H%M%S")
    bak = DB.with_suffix(f".db.bak_togo_unpaid_{ts}")
    shutil.copy2(DB, bak)
    print(f"Backup: {bak}")

    conn = sqlite3.connect(str(DB))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 8000")

    ids = select_target_ids(conn)
    print(f"TOGO unpaid (pending/unpaid, not PAID/VOIDED) orders: {len(ids)}")
    if not ids:
        conn.close()
        print("Nothing to delete.")
        return

    conn.execute("BEGIN IMMEDIATE")
    try:
        n = delete_batch(conn, ids)
        conn.commit()
        print(f"Deleted orders: {n}")
    except Exception:
        conn.rollback()
        conn.close()
        raise

    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception as e:
        print("wal_checkpoint:", e)

    rem = select_target_ids(conn)
    print(f"Remaining matching: {len(rem)}")
    print("integrity_check:", conn.execute("PRAGMA integrity_check").fetchone()[0])
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
