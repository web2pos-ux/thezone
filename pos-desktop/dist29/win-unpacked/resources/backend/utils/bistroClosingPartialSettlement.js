/**
 * Bistro-only: when enabled, Z-report / shift / day closing include approved payments
 * even if the order is not fully PAID yet (void/cancel/merge orders excluded).
 * Requires business_profile.service_type = BISTRO and app_settings flag ON.
 */

'use strict';

const SETTING_KEY = 'bistro_closing_partial_settlement';

const PAY_OK = `UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')`;
const PAY_EXC = `UPPER(COALESCE(p.payment_method,'')) != 'NO_SHOW_FORFEITED'`;

async function isBistroPartialSettlementMode(dbGet) {
  try {
    const bp = await dbGet(`SELECT service_type FROM business_profile WHERE id = 1`);
    const st = String(bp?.service_type || 'FSR').toUpperCase();
    if (st !== 'BISTRO') return false;
    const row = await dbGet(
      `SELECT setting_value FROM app_settings WHERE setting_key = ?`,
      [SETTING_KEY]
    );
    const v = String(row?.setting_value || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  } catch (e) {
    return false;
  }
}

/** For payments JOIN orders o — order side filter */
function sqlOrderStatusForPaymentJoin(bistroPartial) {
  return bistroPartial
    ? `UPPER(COALESCE(o.status,'')) NOT IN ('VOIDED','VOID','CANCELLED','CANCELED','MERGED')`
    : `UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')`;
}

/** WHERE fragment for FROM orders (table name orders) */
function sqlSessionOrdersTableFilter(bistroPartial) {
  if (!bistroPartial) {
    return `UPPER(orders.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')`;
  }
  return (
    `UPPER(COALESCE(orders.status,'')) NOT IN ('VOIDED','VOID','CANCELLED','CANCELED','MERGED') ` +
    `AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND ${PAY_OK} AND ${PAY_EXC})`
  );
}

/** WHERE fragment for orders aliased as o (no payment join) */
function sqlSessionOrderAliasFilter(alias, bistroPartial) {
  const a = alias || 'o';
  if (!bistroPartial) {
    return `UPPER(${a}.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')`;
  }
  return (
    `UPPER(COALESCE(${a}.status,'')) NOT IN ('VOIDED','VOID','CANCELLED','CANCELED','MERGED') ` +
    `AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = ${a}.id AND ${PAY_OK} AND ${PAY_EXC})`
  );
}

/** Terminal / non-open order statuses: safe to unlink table element after day close */
const TABLE_UNLINK_ORDER_STATUSES = `(
  'PAID','PICKED_UP','CLOSED','COMPLETED',
  'VOIDED','VOID','CANCELLED','CANCELED','MERGED'
)`;

/**
 * Day close: SQLite UPDATE for table_map_elements.
 * Legacy: clear every current_order_id (FSR/QSR fresh tables).
 * Bistro partial: keep tabs for orders still open / unpaid; clear paid, voided, or orphan links only.
 */
function dayCloseTableMapClearSql(bistroPartial) {
  if (bistroPartial) {
    return {
      sql: `UPDATE table_map_elements SET current_order_id = NULL, status = 'Available'
            WHERE current_order_id IS NOT NULL
            AND (
              NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = table_map_elements.current_order_id)
              OR EXISTS (
                SELECT 1 FROM orders o
                WHERE o.id = table_map_elements.current_order_id
                AND UPPER(COALESCE(o.status,'')) IN ${TABLE_UNLINK_ORDER_STATUSES}
              )
            )`,
      mode: 'bistro_partial',
    };
  }
  return {
    sql: `UPDATE table_map_elements SET current_order_id = NULL, status = 'Available' WHERE current_order_id IS NOT NULL`,
    mode: 'legacy_all',
  };
}

module.exports = {
  SETTING_KEY,
  isBistroPartialSettlementMode,
  sqlOrderStatusForPaymentJoin,
  sqlSessionOrdersTableFilter,
  sqlSessionOrderAliasFilter,
  dayCloseTableMapClearSql,
};
