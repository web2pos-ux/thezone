/**
 * Client-side required fields for "Save & test terminal (info)" on integrated Tetra.
 * Mirrors backend `tetraTransportConfig` + install fields expected before testing.
 */

export type TetraSaveTestFieldKey =
  | 'terminalType'
  | 'deviceContractRef'
  | 'connectionPort'
  | 'tcpHost'
  | 'tcpPort'
  | 'apiEndpoint';

export interface TetraSaveTestSettingsShape {
  integrationMode?: string;
  terminalType?: string;
  deviceContractRef?: string;
  connectionKind?: string;
  connectionPort?: string;
  tcpHost?: string;
  tcpPort?: number;
  apiEndpoint?: string;
}

function resolvedTcpFromSettings(s: TetraSaveTestSettingsShape): { host: string; port: number } {
  let tcpHost = String(s.tcpHost || '').trim();
  let tcpPort = Number(s.tcpPort) || 0;
  const ep = String(s.apiEndpoint || '').trim();
  if ((!tcpHost || !tcpPort) && ep) {
    const m = ep.match(/^([^:\s]+):(\d{1,5})$/);
    if (m) {
      tcpHost = m[1];
      tcpPort = parseInt(m[2], 10);
    }
  }
  return { host: tcpHost, port: tcpPort };
}

export function getIntegratedTetraSaveTestMissingFieldKeys(
  s: TetraSaveTestSettingsShape
): TetraSaveTestFieldKey[] {
  const out: TetraSaveTestFieldKey[] = [];
  if (String(s.integrationMode) !== 'integrated') return out;

  if (!String(s.terminalType || '').trim()) out.push('terminalType');
  if (!String(s.deviceContractRef || '').trim()) out.push('deviceContractRef');

  const kind = String(s.connectionKind || 'serial').toLowerCase();
  const { host, port } = resolvedTcpFromSettings(s);
  const hasTcp = !!(host && Number.isFinite(port) && port > 0);

  if (kind === 'tcp') {
    if (!hasTcp) {
      out.push('tcpHost', 'tcpPort');
      const ep = String(s.apiEndpoint || '').trim();
      if (ep && !/^([^:\s]+):(\d{1,5})$/.test(ep)) out.push('apiEndpoint');
    }
  } else if (!String(s.connectionPort || '').trim()) {
    out.push('connectionPort');
  }

  const deduped: TetraSaveTestFieldKey[] = [];
  const seen: Record<string, true> = {};
  for (let i = 0; i < out.length; i += 1) {
    const k = out[i];
    if (!seen[k]) {
      seen[k] = true;
      deduped.push(k);
    }
  }
  return deduped;
}
