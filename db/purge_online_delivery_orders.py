"""
Remove ONLINE and DELIVERY-channel orders from web2pos.db (SQLite).
Also clears delivery_orders rows. Does not remove TOGO (in-store pickup) unless order_type is ONLINE.

IMPORTANT: Stop the Node/POS backend (npm start) before running, or Firebase/sync may re-insert
online orders immediately after delete.
"""
from __future__ import annotations

import shutil
import sqlite3
import time
from pathlib import Path

DB = Path(__file__).resolve().parent / "web2pos.db"

DELIVERY_ORDER_TYPES = (
    "DELIVERY",
    "UBEREATS",
    "UBER",
    "DOORDASH",
    "SKIP",
    "SKIPTHEDISHES",
    "SKIP_THE_DISHES",
    "FANTUAN",
)


def select_target_ids(conn: sqlite3.Connection) -> list[int]:
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT id FROM orders WHERE
          UPPER(TRIM(COALESCE(order_type, ''))) = 'ONLINE'
          OR UPPER(TRIM(COALESCE(fulfillment_mode, ''))) IN ('ONLINE', 'DELIVERY')
          OR UPPER(TRIM(COALESCE(order_type, ''))) IN ({",".join("?" * len(DELIVERY_ORDER_TYPES))})
        """,
        DELIVERY_ORDER_TYPES,
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
    cur.execute("DELETE FROM delivery_orders")
    cur.execute(f"DELETE FROM orders WHERE id IN ({ph})", ids)
    return cur.rowcount


def main() -> None:
    if not DB.is_file():
        raise SystemExit(f"Database not found: {DB}")

    ts = time.strftime("%Y%m%d_%H%M%S")
    bak = DB.with_suffix(f".db.bak_{ts}")
    shutil.copy2(DB, bak)
    print(f"Backup: {bak}")

    conn = sqlite3.connect(str(DB))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 8000")

    total_deleted = 0
    for round_i in range(1, 25):
        ids = select_target_ids(conn)
        if not ids:
            if round_i == 1:
                print("Nothing to delete.")
            break
        print(f"Round {round_i}: deleting {len(ids)} orders…")
        conn.execute("BEGIN IMMEDIATE")
        try:
            n = delete_batch(conn, ids)
            conn.commit()
            total_deleted += n
            print(f"  deleted orders: {n}")
        except Exception:
            conn.rollback()
            conn.close()
            raise
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception as e:
            print("  wal_checkpoint:", e)
        # 다른 프로세스가 동시에 다시 넣는 경우 짧게 반복
        time.sleep(0.15)

    print(f"Total orders deleted (all rounds): {total_deleted}")

    remaining = select_target_ids(conn)
    print(f"Remaining matching orders: {len(remaining)}")
    if remaining:
        print(
            "WARNING: 아직 ONLINE/DELIVERY 조건에 맞는 주문이 남았습니다. "
            "온라인 동기화 중인 Node 백엔드(npm start 등)를 중지한 뒤 이 스크립트를 다시 실행하세요."
        )

    chk = conn.execute("PRAGMA integrity_check").fetchone()[0]
    print(f"integrity_check: {chk}")
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
