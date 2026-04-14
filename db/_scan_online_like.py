import sqlite3

p = r"c:\Users\User\Thezone\web2pos\db\web2pos.db"
c = sqlite3.connect(p)

def cnt(sql, params=()):
    return c.execute(sql, params).fetchone()[0]

print("total orders", cnt("SELECT COUNT(*) FROM orders"))
print("order_type=ONLINE", cnt("SELECT COUNT(*) FROM orders WHERE UPPER(TRIM(COALESCE(order_type,'')))='ONLINE'"))
print("fulfillment online", cnt("SELECT COUNT(*) FROM orders WHERE LOWER(TRIM(COALESCE(fulfillment_mode,'')))='online'"))
print("firebase_order_id nonempty", cnt("SELECT COUNT(*) FROM orders WHERE COALESCE(TRIM(firebase_order_id),'')<>''"))
print("online_order_number nonempty", cnt("SELECT COUNT(*) FROM orders WHERE COALESCE(TRIM(online_order_number),'')<>''"))
print("order_source has online", cnt("SELECT COUNT(*) FROM orders WHERE LOWER(COALESCE(order_source,'')) LIKE '%online%'"))

# combined broad
broad = """
SELECT COUNT(*) FROM orders WHERE
  UPPER(TRIM(COALESCE(order_type,''))) = 'ONLINE'
  OR UPPER(TRIM(COALESCE(fulfillment_mode,''))) IN ('ONLINE','DELIVERY')
  OR UPPER(TRIM(COALESCE(order_type,''))) IN ('DELIVERY','UBEREATS','UBER','DOORDASH','SKIP','SKIPTHEDISHES','SKIP_THE_DISHES','FANTUAN')
  OR (COALESCE(TRIM(firebase_order_id),'') <> '')
  OR (COALESCE(TRIM(online_order_number),'') <> '')
"""
print("BROAD online-like total:", cnt(broad))

for ot, n in c.execute(
    "SELECT order_type, COUNT(*) AS cnt FROM orders GROUP BY 1 ORDER BY cnt DESC LIMIT 15"
):
    print("type:", repr(ot), n)

c.close()
