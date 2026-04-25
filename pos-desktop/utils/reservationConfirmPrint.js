/**
 * Graphic reservation confirmation slip → Front/Receipt printer (after online accept).
 */

async function printReservationConfirmSlipAfterAccept(dbGet, slipPayload) {
  try {
    const { sendRawToPrinter } = require('./printerUtils');
    const { buildGraphicReservationConfirm } = require('./graphicPrinterUtils');

    const frontPrinter = await dbGet(
      "SELECT selected_printer FROM printers WHERE name LIKE '%Front%' OR name LIKE '%Receipt%' LIMIT 1"
    );
    const targetPrinter = frontPrinter?.selected_printer;
    if (!targetPrinter) {
      console.warn('[Reservation slip] No Front/Receipt printer configured — skipped');
      return;
    }

    const printData = { ...(slipPayload && typeof slipPayload === 'object' ? slipPayload : {}) };
    const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
    if (layoutRow?.settings) {
      try {
        const ls = JSON.parse(layoutRow.settings);
        const rw = ls.receiptLayout?.paperWidth ?? ls.receipt?.paperWidth ?? ls.paperWidth;
        if (rw === 58 || rw === 80) printData.paperWidth = rw;
        const tm = Number(ls.receiptLayout?.topMargin ?? ls.receipt?.topMargin ?? ls.topMargin);
        if (Number.isFinite(tm) && tm >= 0 && printData.topMargin == null) printData.topMargin = tm;
        const rp = Number(
          ls.receiptLayout?.rightPaddingPx ??
            ls.receiptLayout?.rightPadding ??
            ls.receipt?.rightPaddingPx ??
            ls.receipt?.rightPadding ??
            ls.rightPaddingPx ??
            ls.rightPadding
        );
        if (Number.isFinite(rp) && rp >= 0 && printData.rightPaddingPx == null) {
          printData.rightPaddingPx = Math.round(rp);
        }
      } catch {
        /* ignore */
      }
    }
    if (printData.paperWidth == null) printData.paperWidth = 80;
    if (printData.topMargin == null) printData.topMargin = 5;

    try {
      const row = await dbGet(
        'SELECT graphic_scale FROM printers WHERE is_active = 1 AND selected_printer = ? LIMIT 1',
        [targetPrinter]
      );
      const gs = Number(row?.graphic_scale);
      if (Number.isFinite(gs) && gs > 0) {
        printData.graphicScale = Math.min(1.5, Math.max(0.5, gs));
      }
    } catch {
      /* ignore */
    }

    const buf = buildGraphicReservationConfirm(printData, false, true);
    await sendRawToPrinter(targetPrinter, buf);
    console.log(`[Reservation slip] Printed to ${targetPrinter}`);
  } catch (e) {
    console.error('[Reservation slip] Print failed:', e?.message || e);
  }
}

module.exports = { printReservationConfirmSlipAfterAccept };
