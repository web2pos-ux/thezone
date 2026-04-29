import React, { useCallback, useEffect, useState } from 'react';

import { API_URL } from '../config/constants';



type PrintKind = 'kitchen' | 'receipt' | 'bill' | 'reservation_confirm';



interface PreviewEntry {

  id: number;

  kind: PrintKind;

  payload: Record<string, unknown>;

}



function money(n: unknown): string {

  const x = Number(n);

  if (!Number.isFinite(x)) return String(n ?? '');

  return `$${x.toFixed(2)}`;

}



function buildKitchenLines(p: Record<string, unknown>): string[] {

  const out: string[] = [];

  const od = (p.orderData as Record<string, unknown>) || {};

  const items = (Array.isArray(p.items) ? p.items : (od.items as unknown[])) as Record<string, unknown>[];

  const oi =

    (p.orderInfo as Record<string, unknown>) ||

    (od.orderInfo as Record<string, unknown>) ||

    (od.header as Record<string, unknown>) ||

    {};



  const num = oi.orderNumber ?? od.orderNumber ?? '';

  const table = oi.table ?? oi.tableName ?? od.tableName ?? '';

  const server = oi.server ?? oi.serverName ?? od.serverName ?? '';

  const ch = oi.channel ?? oi.orderType ?? od.orderType ?? '';

  if (num) out.push(`Order: ${num}`);

  if (table) out.push(`Table: ${table}`);

  if (server) out.push(`Server: ${server}`);

  if (ch) out.push(`Channel: ${ch}`);

  const cn = oi.customerName ?? od.customerName;

  const cp = oi.customerPhone ?? od.customerPhone;

  if (cn) out.push(`Customer: ${cn}`);

  if (cp) out.push(`Phone: ${cp}`);

  const pick = oi.pickupTime ?? od.pickupTime;

  if (pick) out.push(`Pickup: ${pick}`);

  const kn = oi.kitchenNote ?? oi.specialInstructions ?? od.kitchenNote;

  if (kn) out.push(`Kitchen note: ${kn}`);

  const dc = oi.deliveryCompany ?? od.deliveryCompany;

  const don = oi.deliveryOrderNumber ?? od.deliveryOrderNumber;

  if (dc || don) out.push(`Delivery: ${dc || ''} ${don || ''}`.trim());

  out.push('----------------------------------------');

  if (Array.isArray(items)) {

    for (const it of items) {

      if (!it || typeof it !== 'object') continue;

      const name = String((it as any).name ?? (it as any).short_name ?? 'Item');

      const q = Number((it as any).qty ?? (it as any).quantity ?? 1);

      const gn = (it as any).guestNumber;

      const line = Number.isFinite(q) && q !== 1 ? `${q}x ${name}` : `${name}`;

      out.push(gn ? `[G${gn}] ${line}` : line);

      const mods = (it as any).modifiers;

      if (Array.isArray(mods)) {

        for (const m of mods) {

          const mn = typeof m === 'string' ? m : (m?.name ?? JSON.stringify(m));

          if (mn) out.push(`    + ${mn}`);

        }

      }

      const memo = (it as any).memo;

      if (memo && String(memo).trim()) out.push(`    * ${String(memo)}`);

    }

  } else {

    out.push('(no items in payload)');

  }

  return out;

}



function buildReceiptLikeLines(label: string, src: Record<string, unknown> | null | undefined): string[] {

  const out: string[] = [];

  if (!src) {

    out.push(`(${label}: empty)`);

    return out;

  }

  const h = (src.header as Record<string, unknown>) || {};

  const title = src.title ?? h.title;

  const ord = src.orderNumber ?? h.orderNumber;

  if (title) out.push(String(title));

  if (ord) out.push(`Order#: ${ord}`);

  const ch = src.channel ?? h.channel;

  if (ch) out.push(`Channel: ${ch}`);

  const tbl = src.tableName ?? h.tableName;

  if (tbl) out.push(`Table: ${tbl}`);

  const sn = src.serverName ?? h.serverName;

  if (sn) out.push(`Server: ${sn}`);

  out.push('----------------------------------------');

  const items = src.items as unknown[] | undefined;

  const guestSections = src.guestSections as { guestNumber?: number; items?: unknown[] }[] | undefined;

  if (Array.isArray(guestSections) && guestSections.length > 0) {

    for (const g of guestSections) {

      out.push(`--- Guest ${g.guestNumber ?? '?'} ---`);

      const git = g.items || [];

      for (const it of git) {

        const row = it as Record<string, unknown>;

        if (!row) continue;

        const nm = String(row.name ?? 'Item');

        const q = Number(row.quantity ?? row.qty ?? 1);

        const pr = row.totalPrice ?? row.lineTotal ?? row.price;

        out.push(`${Number.isFinite(q) && q > 1 ? `${q}x ` : ''}${nm}  ${pr != null ? money(pr) : ''}`.trim());

      }

    }

  } else if (Array.isArray(items)) {

    for (const it of items) {

      const row = it as Record<string, unknown>;

      if (!row) continue;

      const nm = String(row.name ?? 'Item');

      const q = Number(row.quantity ?? row.qty ?? 1);

      const pr = row.totalPrice ?? row.lineTotal ?? row.price;

      out.push(`${Number.isFinite(q) && q > 1 ? `${q}x ` : ''}${nm}  ${pr != null ? money(pr) : ''}`.trim());

    }

  }

  out.push('----------------------------------------');

  if (src.subtotal != null) out.push(`Subtotal: ${money(src.subtotal)}`);

  const adj = src.adjustments as { label?: string; amount?: number }[] | undefined;

  if (Array.isArray(adj)) {

    for (const a of adj) {

      if (a?.label != null) out.push(`${a.label}: ${money(a.amount)}`);

    }

  }

  const tls = src.taxLines as { name?: string; amount?: number }[] | undefined;

  if (Array.isArray(tls)) {

    for (const t of tls) {

      if (t?.name != null) out.push(`${t.name}: ${money(t.amount)}`);

    }

  }

  if (src.taxesTotal != null) out.push(`Tax total: ${money(src.taxesTotal)}`);

  if (src.total != null) out.push(`TOTAL: ${money(src.total)}`);

  const pays = src.payments as { method?: string; amount?: number }[] | undefined;

  if (Array.isArray(pays)) {

    for (const pay of pays) {

      if (pay?.method) out.push(`${pay.method}: ${money(pay.amount)}`);

    }

  }

  if (src.change != null) out.push(`Change: ${money(src.change)}`);

  const foot = src.footer as { message?: string } | undefined;

  if (foot?.message) out.push(String(foot.message));

  return out;

}



function buildPreviewText(kind: PrintKind, payload: Record<string, unknown>): string {

  if (kind === 'kitchen') {

    return buildKitchenLines(payload).join('\n');

  }

  if (kind === 'reservation_confirm') {

    const rc =

      (payload.reservationConfirm as Record<string, unknown>) ||

      (payload as Record<string, unknown>);

    const lines: string[] = ['=== RESERVATION CONFIRM (fallback text) ==='];

    const gn = rc.customerName ?? rc.customer_name;

    if (gn) lines.push(`Guest: ${gn}`);

    const rd = rc.reservationDate ?? rc.reservation_date;

    if (rd) lines.push(`Date: ${rd}`);

    const rt = rc.reservationTime ?? rc.reservation_time;

    if (rt) lines.push(`Time: ${rt}`);

    const ps = rc.partySize ?? rc.party_size;

    if (ps != null) lines.push(`Party: ${ps}`);

    const ref = rc.reservationNumber ?? rc.reservation_number;

    if (ref) lines.push(`Ref: ${ref}`);

    const ca = rc.confirmedAtISO ?? rc.confirmedAt;

    if (ca) lines.push(`Confirmed at: ${ca}`);

    return lines.join('\n');

  }

  if (kind === 'receipt') {

    const lines = payload.lines as string[] | undefined;

    if (Array.isArray(lines)) {

      return ['=== RECEIPT (raw lines) ===', ...lines].join('\n');

    }

    const rd = (payload.receiptData as Record<string, unknown>) || payload;

    return buildReceiptLikeLines('Receipt', rd).join('\n');

  }

  const bd = (payload.billData as Record<string, unknown>) || payload;

  return buildReceiptLikeLines('Bill', bd).join('\n');

}



const PrintPreviewModalHost: React.FC = () => {

  const [queue, setQueue] = useState<PreviewEntry[]>([]);

  const [graphicUrl, setGraphicUrl] = useState<string | null>(null);

  const [fallbackText, setFallbackText] = useState<string | null>(null);

  const [loadingGraphic, setLoadingGraphic] = useState(false);

  const [metaDims, setMetaDims] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });



  const onPreview = useCallback((ev: Event) => {

    const e = ev as CustomEvent<{ kind: PrintKind; url?: string; payload: Record<string, unknown> }>;

    const kind = e.detail?.kind;

    const payload = e.detail?.payload;

    if (!kind || !payload) return;

    setQueue((q) => [...q, { id: Date.now() + Math.random(), kind, payload }]);

  }, []);



  useEffect(() => {

    window.addEventListener('web2pos-print-preview', onPreview as EventListener);

    return () => window.removeEventListener('web2pos-print-preview', onPreview as EventListener);

  }, [onPreview]);



  const current = queue[0];

  const closeOne = () => {

    setGraphicUrl(null);

    setFallbackText(null);

    setMetaDims({ w: null, h: null });

    setQueue((q) => q.slice(1));

  };



  useEffect(() => {

    if (!current) {

      setGraphicUrl(null);

      setFallbackText(null);

      setLoadingGraphic(false);

      setMetaDims({ w: null, h: null });

      return;

    }



    let cancelled = false;

    setLoadingGraphic(true);

    setGraphicUrl(null);

    setFallbackText(null);

    setMetaDims({ w: null, h: null });



    const body = { ...current.payload, kind: current.kind };



    fetch(`${API_URL}/printers/preview-graphic-print`, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      credentials: 'same-origin',

      body: JSON.stringify(body),

    })

      .then(async (r) => {

        const j = (await r.json().catch(() => null)) as {

          success?: boolean;

          imageBase64?: string;

          mimeType?: string;

          width?: number;

          height?: number;

          error?: string;

        } | null;

        if (cancelled) return;

        if (r.ok && j?.success && j.imageBase64) {

          const mime = j.mimeType || 'image/png';

          setGraphicUrl(`data:${mime};base64,${j.imageBase64}`);

          setFallbackText(null);

          setMetaDims({

            w: typeof j.width === 'number' ? j.width : null,

            h: typeof j.height === 'number' ? j.height : null,

          });

        } else {

          setGraphicUrl(null);

          setFallbackText(buildPreviewText(current.kind, current.payload));

        }

      })

      .catch(() => {

        if (!cancelled) {

          setGraphicUrl(null);

          setFallbackText(buildPreviewText(current.kind, current.payload));

        }

      })

      .finally(() => {

        if (!cancelled) setLoadingGraphic(false);

      });



    return () => {

      cancelled = true;

    };

  }, [current?.id, current?.kind, current?.payload]);



  if (!current) return null;



  const title =

    current.kind === 'kitchen'

      ? 'Kitchen ticket (preview)'

      : current.kind === 'receipt'

        ? 'Receipt (preview)'

        : current.kind === 'reservation_confirm'

          ? 'Reservation confirm (preview)'

          : 'Bill (preview)';



  const fallbackBody = fallbackText ?? '';

  /** Thermal graphic preview: ~30% narrower panel vs previous max-w-2xl (42rem); content scaled down proportionally */
  const PREVIEW_SCALE = 0.7;


  return (

    <div

      className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/50 p-2 sm:p-3"

      role="dialog"

      aria-modal="true"

      aria-labelledby="print-preview-title"

    >

      <div className="flex h-[calc(100vh-16px)] max-h-[calc(100vh-16px)] w-full max-w-[470px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">

        <div className="flex items-center justify-between border-b px-4 py-3 bg-slate-50">

          <div>

            <h2 id="print-preview-title" className="text-lg font-bold text-slate-800">

              {title}

            </h2>

            {metaDims.w != null && metaDims.h != null && graphicUrl && (

              <p className="text-xs text-slate-500 mt-0.5">

                Graphic preview {metaDims.w}×{metaDims.h}px (same renderer as thermal graphic print)

              </p>

            )}

            {fallbackBody && !loadingGraphic && !graphicUrl && (

              <p className="text-xs text-amber-700 mt-0.5">

                Graphic preview unavailable — showing text fallback.

              </p>

            )}

          </div>

          <button

            type="button"

            className="rounded-md px-3 py-1.5 text-sm font-medium bg-slate-200 hover:bg-slate-300 text-slate-800"

            onClick={closeOne}

          >

            Close{queue.length > 1 ? ` (${queue.length - 1} more)` : ''}

          </button>

        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-neutral-200">

          {loadingGraphic && (

            <div className="flex items-center justify-center py-16 text-slate-600 text-sm">Loading print preview…</div>

          )}

          {!loadingGraphic && graphicUrl && (

            <div className="flex min-h-0 flex-1 justify-center overflow-auto p-3 sm:p-4">

              <img

                src={graphicUrl}

                alt=""

                className="h-auto shadow-md border border-neutral-400 bg-white"

                style={{
                  imageRendering: 'pixelated',
                  width:
                    metaDims.w != null && metaDims.w > 0
                      ? `${Math.max(1, Math.round(metaDims.w * PREVIEW_SCALE))}px`
                      : '70%',
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 140px)',
                  objectFit: 'contain',
                }}

              />

            </div>

          )}

          {!loadingGraphic && !graphicUrl && fallbackBody && (

            <pre
              className="min-h-0 flex-1 overflow-auto p-4 font-mono text-slate-900 whitespace-pre-wrap break-words leading-relaxed bg-white"
              style={{ fontSize: `${Math.round(12 * PREVIEW_SCALE)}px` }}
            >

              {fallbackBody}

            </pre>

          )}

        </div>

      </div>

    </div>

  );

};



export default PrintPreviewModalHost;

