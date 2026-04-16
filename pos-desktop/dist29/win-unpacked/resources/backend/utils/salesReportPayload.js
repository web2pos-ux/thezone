/**
 * Report Dashboard / sales-report payload builder.
 * @param {object} dbGet
 * @param {object} dbAll
 * @param {{ dateFilterO: string, dateFilter: string, P: string[] }} cfg
 */
async function buildSalesReportPayload(dbGet, dbAll, cfg) {
  const { dateFilterO, dateFilter, P } = cfg;
  const paidStatuses = "UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')";
  const paidStatusesNoAlias = "UPPER(status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')";

  const paidOrders = await dbGet(
    `
        SELECT
          COUNT(*) as order_count,
          COALESCE(SUM(subtotal), 0) as subtotal,
          COALESCE(SUM(tax), 0) as tax_total,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(COALESCE(service_charge, 0)), 0) as service_charge_total
        FROM orders
        WHERE ${dateFilter} AND ${paidStatusesNoAlias}
      `,
    P
  );

  const tipData = await dbGet(
    `
        SELECT COALESCE(
          (SELECT COALESCE(SUM(COALESCE(p.tip, 0)), 0) FROM payments p JOIN orders o ON p.order_id = o.id
           WHERE ${dateFilterO}
             AND ${paidStatuses} AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID'))
          +
          (SELECT COALESCE(SUM(t.amount), 0) FROM tips t JOIN orders o ON t.order_id = o.id
           WHERE ${dateFilterO}
             AND ${paidStatuses})
        , 0) as total_tip
      `,
    [...P, ...P]
  );

  const tipByServer = await dbAll(
    `
        SELECT server_name, SUM(tips) as tips, SUM(order_count) as order_count FROM (
          SELECT COALESCE(o.server_name, 'Unknown') as server_name,
            COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips,
            COUNT(DISTINCT o.id) as order_count
          FROM payments p JOIN orders o ON p.order_id = o.id
          WHERE ${dateFilterO}
            AND ${paidStatuses} AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          GROUP BY COALESCE(o.server_name, 'Unknown')
          UNION ALL
          SELECT COALESCE(o.server_name, 'Unknown') as server_name,
            COALESCE(SUM(t.amount), 0) as tips,
            COUNT(DISTINCT o.id) as order_count
          FROM tips t JOIN orders o ON t.order_id = o.id
          WHERE ${dateFilterO}
            AND ${paidStatuses}
          GROUP BY COALESCE(o.server_name, 'Unknown')
        ) combined
        GROUP BY server_name
        HAVING tips > 0
        ORDER BY tips DESC
      `,
    [...P, ...P]
  );

  const tipByPaymentMethod = await dbAll(
    `
        SELECT payment_method, SUM(tips) as tips, SUM(cnt) as count FROM (
          SELECT p.payment_method, COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips, COUNT(*) as cnt
          FROM payments p JOIN orders o ON p.order_id = o.id
          WHERE ${dateFilterO}
            AND ${paidStatuses} AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND COALESCE(p.tip, 0) > 0
          GROUP BY p.payment_method
          UNION ALL
          SELECT t.payment_method, COALESCE(SUM(t.amount), 0) as tips, COUNT(*) as cnt
          FROM tips t JOIN orders o ON t.order_id = o.id
          WHERE ${dateFilterO}
            AND ${paidStatuses}
          GROUP BY t.payment_method
        ) combined
        GROUP BY payment_method
        ORDER BY tips DESC
      `,
    [...P, ...P]
  );

  let taxDetails = [];
  try {
    const taxRows = await dbAll(
      `
          SELECT t.name as tax_name,
            t.rate as tax_rate,
            COALESCE(SUM(oi.price * oi.quantity * t.rate / 100), 0) as tax_amount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN tax_group_links tgl ON tgl.tax_group_id = oi.tax_group_id
          JOIN taxes t ON t.tax_id = t.tax_id AND COALESCE(t.is_deleted, 0) = 0
          WHERE ${dateFilterO}
            AND ${paidStatuses}
          GROUP BY t.tax_id, t.name, t.rate
          ORDER BY t.name
        `,
      P
    );
    taxDetails = (taxRows || [])
      .filter((r) => r.tax_name && Number(r.tax_amount) > 0)
      .map((r) => ({
        name: r.tax_name,
        rate: Number(r.tax_rate || 0),
        amount: Number(Number(r.tax_amount || 0).toFixed(2)),
      }));
  } catch (e) {
    /* tax_group_links may not exist */
  }

  const taxDetailSum = taxDetails.reduce((s, t) => s + t.amount, 0);
  const dbTaxTotal = Number(paidOrders?.tax_total || 0);
  const needsFallback = taxDetails.length === 0 || (dbTaxTotal > 0 && taxDetailSum < dbTaxTotal * 0.5);
  if (needsFallback) {
    try {
      const activeTaxes = await dbAll(
        `
            SELECT DISTINCT t.name, t.rate 
            FROM taxes t 
            JOIN tax_group_links tgl ON tgl.tax_id = t.tax_id
            JOIN tax_groups tg ON tg.tax_group_id = tgl.tax_group_id AND COALESCE(tg.is_deleted, 0) = 0
            WHERE COALESCE(t.is_deleted, 0) = 0
            ORDER BY t.rate ASC
          `,
        []
      );
      const uniqueTaxes = [];
      const seenRates = new Set();
      (activeTaxes || []).forEach((t) => {
        const key = `${t.name}_${t.rate}`;
        if (!seenRates.has(key)) {
          seenRates.add(key);
          uniqueTaxes.push({ name: t.name, rate: Number(t.rate) });
        }
      });

      if (uniqueTaxes.length > 0) {
        const orders = await dbAll(
          `
              SELECT o.subtotal, o.tax
              FROM orders o
              WHERE ${dateFilterO}
                AND ${paidStatuses} AND COALESCE(o.tax, 0) > 0
            `,
          P
        );

        const taxMap = {};
        uniqueTaxes.forEach((t) => {
          taxMap[t.name] = { name: t.name, rate: t.rate, amount: 0 };
        });

        (orders || []).forEach((o) => {
          const sub = Number(o.subtotal || 0);
          const totalTax = Number(o.tax || 0);
          if (sub <= 0 || totalTax <= 0) return;
          const effRate = (totalTax / sub) * 100;

          const matchedTaxes = uniqueTaxes.filter((t) => t.rate <= effRate + 0.5);
          const matchedRateSum = matchedTaxes.reduce((s, t) => s + t.rate, 0);
          if (matchedRateSum <= 0) return;

          matchedTaxes.forEach((t) => {
            const portion = (t.rate / matchedRateSum) * totalTax;
            taxMap[t.name].amount += portion;
          });
        });

        taxDetails = Object.values(taxMap)
          .filter((t) => t.amount > 0.001)
          .map((t) => ({ name: t.name, rate: t.rate, amount: Number(t.amount.toFixed(2)) }));
      }
    } catch (e) {
      /* taxes table may not exist */
    }
  }

  const paidOrderCount = paidOrders?.order_count || 0;

  const channelRows = await dbAll(
    `
        SELECT
          CASE
            WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
            WHEN UPPER(o.order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
            WHEN UPPER(o.order_type) = 'ONLINE' THEN 'ONLINE'
            WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as ch,
          COUNT(*) as cnt,
          COALESCE(SUM(o.subtotal), 0) as subtotal,
          COALESCE(SUM(o.tax), 0) as tax,
          COALESCE(SUM(o.total), 0) as sales,
          COALESCE(SUM(
            (SELECT COALESCE(SUM(p.tip), 0) FROM payments p WHERE p.order_id = o.id AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID'))
            + (SELECT COALESCE(SUM(t.amount), 0) FROM tips t WHERE t.order_id = o.id)
          ), 0) as tips
        FROM orders o
        WHERE ${dateFilterO} AND ${paidStatuses}
        GROUP BY ch ORDER BY sales DESC
      `,
    P
  );

  const channelMap = {};
  (channelRows || []).forEach((r) => {
    const sub = Number(r.subtotal);
    const tx = Number(r.tax);
    channelMap[r.ch] = {
      count: r.cnt,
      subtotal: sub,
      tax: tx,
      sales: Number((sub + tx).toFixed(2)),
      tips: Number(r.tips),
    };
  });

  const dineInTableStats = await dbGet(
    `
        SELECT COUNT(DISTINCT o.id) as table_order_count,
               COALESCE(AVG(sub.order_paid), 0) as avg_per_table
        FROM (
          SELECT o.id, SUM(p.amount - COALESCE(p.tip, 0)) as order_paid
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE ${dateFilterO} AND ${paidStatuses}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
            AND UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN')
            AND o.table_id IS NOT NULL AND o.table_id != ''
          GROUP BY o.id
        ) sub
        JOIN orders o ON sub.id = o.id
      `,
    P
  );

  const deliveryRows = await dbAll(
    `
        SELECT COALESCE(
          UPPER(NULLIF(TRIM(o.order_source), '')),
          UPPER(NULLIF(TRIM(d.delivery_company), '')),
          'UNKNOWN'
        ) as platform,
               COUNT(DISTINCT o.id) as cnt,
               COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as sales
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        LEFT JOIN delivery_orders d ON d.order_id = o.id
        WHERE ${dateFilterO} AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
          AND UPPER(o.order_type) = 'DELIVERY'
        GROUP BY platform ORDER BY sales DESC
      `,
    P
  );

  const normalizeDeliveryPlatform = (raw) => {
    const u = String(raw || '')
      .toUpperCase()
      .replace(/\s+/g, '');
    if (u.includes('UBER')) return 'UBER';
    if (u.includes('DOORDASH') || u.includes('DDASH')) return 'DOORDASH';
    if (u.includes('SKIP')) return 'SKIP';
    if (u.includes('FANTUAN') || u.includes('FANT')) return 'FANTUAN';
    if (u.includes('GRUBHUB')) return 'GRUBHUB';
    return raw || 'OTHER';
  };

  const deliveryPlatformMap = {};
  (deliveryRows || []).forEach((r) => {
    const key = normalizeDeliveryPlatform(r.platform);
    if (!deliveryPlatformMap[key]) deliveryPlatformMap[key] = { count: 0, sales: 0 };
    deliveryPlatformMap[key].count += r.cnt;
    deliveryPlatformMap[key].sales += Number(r.sales);
  });

  const topItems = await dbAll(
    `
        SELECT oi.name, SUM(oi.quantity) as total_qty,
               SUM(oi.quantity * oi.price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE ${dateFilterO} AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) >= 0
        GROUP BY oi.name ORDER BY total_revenue DESC LIMIT 50
      `,
    P
  );

  const bottomItems = await dbAll(
    `
        SELECT oi.name, SUM(oi.quantity) as total_qty,
               SUM(oi.quantity * oi.price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE ${dateFilterO} AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) > 0
        GROUP BY oi.name ORDER BY total_revenue ASC LIMIT 20
      `,
    P
  );

  const totalItemData = await dbGet(
    `
        SELECT COALESCE(SUM(oi.quantity),0) as total_items,
               COUNT(DISTINCT oi.name) as unique_items
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE ${dateFilterO} AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) >= 0
      `,
    P
  );

  const unpaidStatuses = "UPPER(status) IN ('OPEN','PENDING','IN_PROGRESS','READY')";
  const unpaidOverall = await dbGet(
    `
        SELECT COUNT(*) as order_count,
               COALESCE(SUM(total),0) as total_amount,
               COALESCE(SUM(subtotal),0) as subtotal,
               COALESCE(SUM(tax),0) as tax_total
        FROM orders WHERE ${dateFilter} AND ${unpaidStatuses}
      `,
    P
  );

  const unpaidByChannel = await dbAll(
    `
        SELECT
          CASE
            WHEN UPPER(order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
            WHEN UPPER(order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
            WHEN UPPER(order_type) = 'ONLINE' THEN 'ONLINE'
            WHEN UPPER(order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as ch,
          COUNT(*) as cnt,
          COALESCE(SUM(total),0) as amount
        FROM orders WHERE ${dateFilter} AND ${unpaidStatuses}
        GROUP BY ch ORDER BY amount DESC
      `,
    P
  );

  const unpaidChannelMap = {};
  (unpaidByChannel || []).forEach((r) => {
    unpaidChannelMap[r.ch] = { count: r.cnt, amount: Number(r.amount) };
  });

  let unpaidTaxDetails = [];
  try {
    const unpaidTaxRows = await dbAll(
      `
          SELECT t.name as tax_name,
            t.rate as tax_rate,
            COALESCE(SUM(oi.price * oi.quantity * t.rate / 100), 0) as tax_amount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN tax_group_links tgl ON tgl.tax_group_id = oi.tax_group_id
          JOIN taxes t ON t.tax_id = tgl.tax_id AND COALESCE(t.is_deleted, 0) = 0
          WHERE ${dateFilterO}
            AND ${unpaidStatuses}
          GROUP BY t.tax_id, t.name, t.rate
          ORDER BY t.name
        `,
      P
    );
    unpaidTaxDetails = (unpaidTaxRows || [])
      .filter((r) => r.tax_name && Number(r.tax_amount) > 0)
      .map((r) => ({
        name: r.tax_name,
        rate: Number(r.tax_rate || 0),
        amount: Number(Number(r.tax_amount || 0).toFixed(2)),
      }));
  } catch (e) {
    /* tax_group_links may not exist */
  }

  if (unpaidTaxDetails.length === 0) {
    try {
      const activeTaxes = await dbAll(
        `
            SELECT DISTINCT t.name, t.rate 
            FROM taxes t 
            JOIN tax_group_links tgl ON tgl.tax_id = t.tax_id
            JOIN tax_groups tg ON tg.tax_group_id = tgl.tax_group_id AND COALESCE(tg.is_deleted, 0) = 0
            WHERE COALESCE(t.is_deleted, 0) = 0
            ORDER BY t.rate ASC
          `,
        []
      );
      const uniqueTaxes = [];
      const seenRates = new Set();
      (activeTaxes || []).forEach((t) => {
        const key = `${t.name}_${t.rate}`;
        if (!seenRates.has(key)) {
          seenRates.add(key);
          uniqueTaxes.push({ name: t.name, rate: Number(t.rate) });
        }
      });

      if (uniqueTaxes.length > 0) {
        const orders = await dbAll(
          `
              SELECT o.subtotal, o.tax
              FROM orders o
              WHERE ${dateFilterO}
                AND ${unpaidStatuses} AND COALESCE(o.tax, 0) > 0
            `,
          P
        );

        const taxMap = {};
        uniqueTaxes.forEach((t) => {
          taxMap[t.name] = { name: t.name, rate: t.rate, amount: 0 };
        });

        (orders || []).forEach((o) => {
          const sub = Number(o.subtotal || 0);
          const totalTax = Number(o.tax || 0);
          if (sub <= 0 || totalTax <= 0) return;
          const effRate = (totalTax / sub) * 100;
          const matchedTaxes = uniqueTaxes.filter((t) => t.rate <= effRate + 0.5);
          const matchedRateSum = matchedTaxes.reduce((s, t) => s + t.rate, 0);
          if (matchedRateSum <= 0) return;
          matchedTaxes.forEach((t) => {
            taxMap[t.name].amount += (t.rate / matchedRateSum) * totalTax;
          });
        });

        unpaidTaxDetails = Object.values(taxMap)
          .filter((t) => t.amount > 0.001)
          .map((t) => ({ name: t.name, rate: t.rate, amount: Number(t.amount.toFixed(2)) }));
      }
    } catch (e) {
      /* taxes table may not exist */
    }
  }

  const hourlySales = await dbAll(
    `
        SELECT strftime('%H', o.created_at) as hour,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE ${dateFilterO}
          AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY strftime('%H', o.created_at)
        ORDER BY hour
      `,
    P
  );

  const paymentBreakdown = await dbAll(
    `
        SELECT p.payment_method,
          COUNT(*) as count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as net_amount,
          COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE ${dateFilterO}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND ${paidStatuses}
        GROUP BY p.payment_method
      `,
    P
  );

  const tableTurnover = await dbAll(
    `
        SELECT COALESCE(t.name, o.table_id) as table_name,
          COUNT(*) as order_count,
          COALESCE(AVG(
            CASE WHEN o.closed_at IS NOT NULL AND o.created_at IS NOT NULL
            THEN (julianday(o.closed_at) - julianday(o.created_at)) * 24 * 60
            END
          ), 0) as avg_duration_min
        FROM orders o
        LEFT JOIN table_map_elements t ON o.table_id = t.element_id
        WHERE ${dateFilterO}
          AND ${paidStatuses}
          AND o.table_id IS NOT NULL AND o.table_id != ''
        GROUP BY COALESCE(t.name, o.table_id)
        ORDER BY order_count DESC
      `,
    P
  );

  const employeeSales = await dbAll(
    `
        SELECT COALESCE(o.server_name, 'Unknown') as employee,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE ${dateFilterO}
          AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY COALESCE(o.server_name, 'Unknown')
        ORDER BY revenue DESC
      `,
    P
  );

  const refundsVoids = await dbAll(
    `
        SELECT 'refund' as type, COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM refunds WHERE ${dateFilter}
        UNION ALL
        SELECT 'void' as type, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
        FROM voids WHERE ${dateFilter}
      `,
    [...P, ...P]
  );

  let categorySales = [];
  try {
    categorySales = await dbAll(
      `
          SELECT COALESCE(c.name, 'Uncategorized') as category,
            COALESCE(SUM(oi.quantity), 0) as quantity,
            COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          LEFT JOIN menu_items mi ON oi.item_id = mi.item_id
          LEFT JOIN menu_categories c ON mi.category_id = c.category_id
          WHERE ${dateFilterO}
            AND ${paidStatuses}
            AND COALESCE(oi.is_voided, 0) = 0
          GROUP BY c.category_id
          ORDER BY revenue DESC
        `,
      P
    );
  } catch (e) {
    /* menu_items/menu_categories may not exist */
  }

  let channelTaxDetails = {};
  try {
    const ctRows = await dbAll(
      `
          SELECT
            CASE
              WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
              WHEN UPPER(o.order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
              WHEN UPPER(o.order_type) = 'ONLINE' THEN 'ONLINE'
              WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
              ELSE 'OTHER'
            END as ch,
            t.name as tax_name,
            t.rate as tax_rate,
            COALESCE(SUM(oi.price * oi.quantity * t.rate / 100), 0) as tax_amount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN tax_group_links tgl ON tgl.tax_group_id = oi.tax_group_id
          JOIN taxes t ON t.tax_id = tgl.tax_id
          WHERE ${dateFilterO}
            AND ${paidStatuses}
            AND COALESCE(oi.is_voided, 0) = 0
            AND COALESCE(t.is_deleted, 0) = 0
          GROUP BY ch, t.tax_id, t.name, t.rate
          ORDER BY ch, t.name
        `,
      P
    );
    (ctRows || []).forEach((r) => {
      if (!channelTaxDetails[r.ch]) channelTaxDetails[r.ch] = [];
      channelTaxDetails[r.ch].push({
        name: r.tax_name,
        rate: Number(r.tax_rate || 0),
        amount: Number(r.tax_amount || 0),
      });
    });
  } catch (e) {
    /* taxes/tax_group_links may not exist */
  }

  const subTax = Number((Number(unpaidOverall?.subtotal || 0) + Number(unpaidOverall?.tax_total || 0)).toFixed(2));
  const sumTotal = Number(Number(unpaidOverall?.total_amount || 0).toFixed(2));
  const unpaidTotalAmount = Number(Math.max(subTax, sumTotal).toFixed(2));

  return {
    overall: {
      orderCount: paidOrderCount,
      subtotal: Number(paidOrders?.subtotal || 0),
      taxTotal: Number(paidOrders?.tax_total || 0),
      totalSales: Number((Number(paidOrders?.subtotal || 0) + Number(paidOrders?.tax_total || 0)).toFixed(2)),
      totalTip: Number(tipData?.total_tip || 0),
      serviceCharge: Number(paidOrders?.service_charge_total || 0),
    },
    taxDetails,
    channels: {
      'DINE-IN': channelMap['DINE-IN'] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
      TOGO: channelMap.TOGO || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
      ONLINE: channelMap.ONLINE || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
      DELIVERY: channelMap.DELIVERY || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
      OTHER: channelMap.OTHER || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
    },
    dineInTableStats: {
      tableOrderCount: dineInTableStats?.table_order_count || 0,
      avgPerTable: Number(dineInTableStats?.avg_per_table || 0),
    },
    deliveryPlatforms: deliveryPlatformMap,
    topItems: (topItems || []).map((item, idx) => ({
      rank: idx + 1,
      name: item.name,
      quantity: item.total_qty || 0,
      revenue: Number(item.total_revenue || 0),
    })),
    bottomItems: (bottomItems || []).map((item, idx) => ({
      rank: idx + 1,
      name: item.name,
      quantity: item.total_qty || 0,
      revenue: Number(item.total_revenue || 0),
    })),
    totalItems: {
      totalQuantity: totalItemData?.total_items || 0,
      uniqueItems: totalItemData?.unique_items || 0,
    },
    unpaid: {
      orderCount: unpaidOverall?.order_count || 0,
      totalAmount: unpaidTotalAmount,
      subtotal: Number(unpaidOverall?.subtotal || 0),
      taxTotal: Number(unpaidOverall?.tax_total || 0),
      taxDetails: unpaidTaxDetails,
      channels: {
        'DINE-IN': unpaidChannelMap['DINE-IN'] || { count: 0, amount: 0 },
        TOGO: unpaidChannelMap.TOGO || { count: 0, amount: 0 },
        ONLINE: unpaidChannelMap.ONLINE || { count: 0, amount: 0 },
        DELIVERY: unpaidChannelMap.DELIVERY || { count: 0, amount: 0 },
      },
    },
    hourlySales: hourlySales || [],
    paymentBreakdown: paymentBreakdown || [],
    tableTurnover: tableTurnover || [],
    employeeSales: employeeSales || [],
    refundsVoids: refundsVoids || [],
    tipBreakdown: {
      total: Number(tipData?.total_tip || 0),
      byServer: (tipByServer || []).map((r) => ({
        server: r.server_name,
        tips: Number(r.tips),
        orderCount: r.order_count,
      })),
      byChannel: Object.entries(channelMap)
        .filter(([, v]) => v.tips > 0)
        .map(([k, v]) => ({ channel: k, tips: v.tips, orderCount: v.count })),
      byPaymentMethod: (tipByPaymentMethod || []).map((r) => ({
        method: r.payment_method,
        tips: Number(r.tips),
        count: r.count,
      })),
    },
    categorySales: (categorySales || []).map((r) => ({
      category: r.category,
      quantity: r.quantity || 0,
      revenue: Number(r.revenue || 0),
    })),
    channelTaxDetails,
  };
}

function calendarCfg(startDate, endDate) {
  return {
    dateFilterO: 'date(o.created_at) >= ? AND date(o.created_at) <= ?',
    dateFilter: 'date(created_at) >= ? AND date(created_at) <= ?',
    P: [startDate, endDate],
  };
}

function rangeCfg(rangeStart, rangeEnd) {
  return {
    dateFilterO: 'datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) <= datetime(?)',
    dateFilter: 'datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)',
    P: [rangeStart, rangeEnd],
  };
}

module.exports = { buildSalesReportPayload, calendarCfg, rangeCfg };
