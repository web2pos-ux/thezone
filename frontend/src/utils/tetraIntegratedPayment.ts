/** Ingenico Tetra semi-integrated: settings probe + purchase (ECR total in cents). */

/** Host ref + optional auth code, stored in DB `payments.ref` (tab-separated). */
export function joinTetraPaymentReference(hostReference: string, authCode?: string): string {
  const h = String(hostReference || '').trim();
  const a = String(authCode || '').trim();
  if (!h) return a;
  if (!a) return h;
  return `${h}\t${a}`;
}

export async function loadTetraIntegrationActive(apiPrefix: string): Promise<boolean> {
  try {
    const r = await fetch(`${apiPrefix}/settings/hardware/credit-card`);
    if (!r.ok) return false;
    const d = (await r.json().catch(() => ({}))) as { settings?: Record<string, unknown> };
    const s = d.settings || {};
    if (String(s.integrationMode || '') !== 'integrated') return false;
    const tt = String(s.terminalType || '').toLowerCase();
    return (
      tt.includes('tetra') ||
      tt === 'ingenico_tetra_semi' ||
      tt === 'ingenico_move_5000' ||
      tt.includes('move_5000')
    );
  } catch {
    return false;
  }
}

/**
 * Same as {@link loadTetraIntegrationActive} plus transport readiness from
 * `GET /terminal-tetra/config` so we do not call `purchase` when no serial/TCP path is configured.
 */
export async function loadTetraBridgeReady(apiPrefix: string): Promise<boolean> {
  try {
    const [cardR, cfgR] = await Promise.all([
      fetch(`${apiPrefix}/settings/hardware/credit-card`),
      fetch(`${apiPrefix}/terminal-tetra/config`),
    ]);
    if (!cardR.ok || !cfgR.ok) return false;
    const d = (await cardR.json().catch(() => ({}))) as { settings?: Record<string, unknown> };
    const cfg = (await cfgR.json().catch(() => ({}))) as {
      connectionKind?: string;
      hasSerialPath?: boolean;
      hasTcpPath?: boolean;
    };
    const s = d.settings || {};
    if (String(s.integrationMode || '') !== 'integrated') return false;
    const tt = String(s.terminalType || '').toLowerCase();
    if (
      !(
        tt.includes('tetra') ||
        tt === 'ingenico_tetra_semi' ||
        tt === 'ingenico_move_5000' ||
        tt.includes('move_5000')
      )
    ) {
      return false;
    }

    const kind = String(cfg.connectionKind || s.connectionKind || 'serial').toLowerCase();
    const port = String(s.connectionPort || '').trim();
    const host = String(s.tcpHost || '').trim();
    const portNum = Number(s.tcpPort) || 0;
    const hasSerial = !!cfg.hasSerialPath || !!port;
    const hasTcp = !!cfg.hasTcpPath || (!!host && portNum > 0);

    if (kind === 'tcp') return hasTcp;
    return hasSerial;
  } catch {
    return false;
  }
}

/**
 * Runs sale (00) on terminal for total amount (food + tip) in cents.
 * @returns host/terminal reference string when present
 */
export async function purchaseOnTetraTerminal(
  apiPrefix: string,
  amountCents: number,
  invoice?: string
): Promise<string> {
  const r = await fetch(`${apiPrefix}/terminal-tetra/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amountCents,
      invoice: invoice && String(invoice).trim() ? String(invoice).trim().slice(0, 40) : undefined,
      tenderType: '0',
    }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & {
    approved?: boolean;
    fields?: Record<string, string>;
    hostReference?: string;
    authCode?: string;
    error?: string;
  };
  if (!r.ok) {
    throw new Error(String(j.error || 'Terminal purchase request failed'));
  }
  if (!j.approved) {
    const f = j.fields || {};
    const hostMsg = f['402'] || f['401'] || j.error;
    throw new Error(String(hostMsg || 'Card declined on terminal'));
  }
  return joinTetraPaymentReference(String(j.hostReference || '').trim(), String(j.authCode || '').trim());
}
