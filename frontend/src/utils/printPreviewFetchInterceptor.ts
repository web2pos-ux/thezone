/**

 * print preview 모드일 때

 * - POST /printers/print-order|print-receipt|print-bill

 * - POST /online-orders/order/:id/print (온라인·배달/픽업 Firebase 주문)
 * - POST /reservations/accept-online (온라인 예약 확정 슬립 — 미리보기 시 실제 출력 생략)

 * 를 가로채 실제 프린터로 보내지 않고 미리보기 이벤트만 발생시킵니다.

 * 주문 페이지 등 보호 코드는 수정하지 않습니다.

 */



import { API_URL } from '../config/constants';

import { isPrintPreviewModeEnabled } from './printPreviewMode';



const W = '__web2posPrintPreviewFetchPatched' as const;



function getUrlString(input: RequestInfo | URL): string {

  if (typeof input === 'string') return input;

  if (input instanceof URL) return input.toString();

  return input.url;

}



function isTargetPrintPost(urlStr: string, method: string): 'kitchen' | 'receipt' | 'bill' | null {

  if ((method || 'GET').toUpperCase() !== 'POST') return null;

  try {

    const u = urlStr.split('?')[0] || '';

    if (u.includes('/printers/print-order')) return 'kitchen';

    if (u.includes('/printers/print-receipt')) return 'receipt';

    if (u.includes('/printers/print-bill')) return 'bill';

  } catch {}

  return null;

}



/** POST .../online-orders/order/:orderId/print */

function parseOnlineOrderPrintPost(urlStr: string, method: string): string | null {

  if ((method || 'GET').toUpperCase() !== 'POST') return null;

  try {

    const u = urlStr.split('?')[0] || '';

    const m = u.match(/\/online-orders\/order\/([^/]+)\/print$/);

    return m ? m[1] : null;

  } catch {

    return null;

  }

}



async function parseJsonBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown> | null> {

  try {

    const b = init?.body;

    if (typeof b === 'string') return JSON.parse(b) as Record<string, unknown>;

    if (input instanceof Request && (input.method || 'GET').toUpperCase() === 'POST') {

      const t = await input.clone().text();

      if (t) return JSON.parse(t) as Record<string, unknown>;

    }

  } catch {}

  return null;

}



export function installPrintPreviewFetchInterceptor(): void {

  if (typeof window === 'undefined') return;

  const win = window as unknown as Record<string, unknown>;

  if (win[W]) return;

  win[W] = true;



  const orig = window.fetch.bind(window);



  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {

    if (!isPrintPreviewModeEnabled()) {

      return orig(input, init);

    }



    const urlStr = getUrlString(input);

    const method = (

      init?.method ||

      (input instanceof Request ? input.method : undefined) ||

      'GET'

    ).toUpperCase();



    const onlineOrderId = parseOnlineOrderPrintPost(urlStr, method);

    if (onlineOrderId) {

      const postBody = await parseJsonBody(input, init);

      const restaurantId =

        postBody && postBody.restaurantId != null ? String(postBody.restaurantId).trim() : '';

      const qs = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : '';

      let kitchenPayload: Record<string, unknown> = {};

      try {

        const r = await orig(`${API_URL}/online-orders/order/${encodeURIComponent(onlineOrderId)}/kitchen-print-payload${qs}`);

        const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;

        if (j && typeof j === 'object') {

          const { success: _s, ...rest } = j;

          kitchenPayload = rest as Record<string, unknown>;

        }

      } catch {

        kitchenPayload = {};

      }

      try {

        window.dispatchEvent(

          new CustomEvent('web2pos-print-preview', {

            detail: { kind: 'kitchen' as const, url: urlStr, payload: kitchenPayload },

          })

        );

      } catch {}

      const body = JSON.stringify({

        success: true,

        message: 'Print preview (online kitchen) — not sent to printer',

      });

      return new Response(body, {

        status: 200,

        statusText: 'OK',

        headers: { 'Content-Type': 'application/json' },

      });

    }



    if (urlStr.includes('/reservations/accept-online') && method === 'POST') {

      const hdr = new Headers();

      if (init?.headers) {

        try {

          new Headers(init.headers as HeadersInit).forEach((v, k) => {

            hdr.set(k, v);

          });

        } catch {

          /* ignore */

        }

      }

      hdr.set('X-Web2POS-Print-Preview', '1');

      const mergedInit: RequestInit = { ...(init || {}), headers: hdr };

      let bodyStr = '';

      try {

        const b = init?.body;

        if (typeof b === 'string') bodyStr = b;

        else if (input instanceof Request) bodyStr = await input.clone().text();

      } catch {

        bodyStr = '';

      }



      const res = await orig(input, mergedInit);

      try {

        const j = (await res.clone().json()) as {

          success?: boolean;

          confirmedAt?: string;

          assignedTable?: { tableName?: string; name?: string };

        } | null;

        if (res.ok && j?.success) {

          let post: Record<string, unknown> = {};

          try {

            post = bodyStr ? (JSON.parse(bodyStr) as Record<string, unknown>) : {};

          } catch {

            post = {};

          }

          const assigned = j.assignedTable;

          const assignedName =

            (assigned &&

              (String((assigned as { tableName?: string }).tableName || '').trim() ||

                String((assigned as { name?: string }).name || '').trim())) ||

            '';

          const reservationConfirm: Record<string, unknown> = {

            reservation_number: post.reservation_number,

            reservationNumber: post.reservation_number,

            customer_name: post.customer_name,

            customerName: post.customer_name,

            phone_number: post.phone_number,

            phoneNumber: post.phone_number,

            reservation_date: post.reservation_date,

            reservationDate: post.reservation_date,

            reservation_time: post.reservation_time,

            reservationTime: post.reservation_time,

            party_size: post.party_size,

            partySize: post.party_size,

            tables_needed: post.tables_needed,

            tablesNeeded: post.tables_needed,

            special_requests: post.special_requests,

            specialRequests: post.special_requests,

            deposit_amount: post.deposit_amount,

            confirmedAtISO: j.confirmedAt || new Date().toISOString(),

            assignedTableName: assignedName || undefined,

          };

          window.dispatchEvent(

            new CustomEvent('web2pos-print-preview', {

              detail: {

                kind: 'reservation_confirm' as const,

                url: urlStr,

                payload: {

                  kind: 'reservation_confirm',

                  reservationConfirm,

                },

              },

            })

          );

        }

      } catch {

        /* ignore */

      }

      return res;

    }



    const kind = isTargetPrintPost(urlStr, method);

    if (!kind) {

      return orig(input, init);

    }



    const payload = await parseJsonBody(input, init);

    try {

      window.dispatchEvent(

        new CustomEvent('web2pos-print-preview', {

          detail: { kind, url: urlStr, payload: payload || {} },

        })

      );

    } catch {}



    const respBody =

      kind === 'kitchen'

        ? JSON.stringify({ success: true, message: 'Print preview (kitchen) — not sent to printer' })

        : JSON.stringify({ success: true, message: `Print preview (${kind}) — not sent to printer` });



    return new Response(respBody, {

      status: 200,

      statusText: 'OK',

      headers: { 'Content-Type': 'application/json' },

    });

  };

}

