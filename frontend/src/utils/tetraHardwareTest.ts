/** Save credit-card hardware settings then hit Tetra bridge (terminal info). */

/**
 * Uses **already saved** hardware settings (DB). Does not POST save.
 * POST /terminal-tetra/terminal-info — ECR type 42, no payment.
 */
export async function probeTetraTerminalInfo(
  apiPrefix: string
): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  const testRes = await fetch(`${apiPrefix}/terminal-tetra/terminal-info`, { method: 'POST' });
  const body = await testRes.json().catch(() => ({}));
  if (!testRes.ok) {
    return {
      ok: false,
      message: (body as { error?: string }).error || 'Could not reach the terminal.',
      detail: body,
    };
  }
  const approved = (body as { approved?: boolean }).approved;
  const status = (body as { parsed?: { status?: string } }).parsed?.status;
  return {
    ok: true,
    message: approved
      ? 'Terminal responded (OK).'
      : `Terminal responded (status ${status ?? 'unknown'}).`,
    detail: body,
  };
}

/**
 * POST /terminal-tetra/detailed-report — ECR type 30 (idle / connectivity; no sale).
 */
export async function probeTetraDetailedReport(
  apiPrefix: string
): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  const testRes = await fetch(`${apiPrefix}/terminal-tetra/detailed-report`, { method: 'POST' });
  const body = await testRes.json().catch(() => ({}));
  if (!testRes.ok) {
    return {
      ok: false,
      message: (body as { error?: string }).error || 'Detailed report request failed.',
      detail: body,
    };
  }
  const approved = (body as { approved?: boolean }).approved;
  const status = (body as { parsed?: { status?: string } }).parsed?.status;
  return {
    ok: true,
    message: approved
      ? 'Detailed report OK (idle path).'
      : `Detailed report responded (status ${status ?? 'unknown'}).`,
    detail: body,
  };
}

export async function saveAndTestTetraTerminal(
  apiPrefix: string,
  settings: Record<string, unknown>
): Promise<{ ok: boolean; message: string; detail?: unknown }> {
  const saveRes = await fetch(`${apiPrefix}/settings/hardware/credit-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  if (!saveRes.ok) {
    const err = await saveRes.json().catch(() => ({}));
    return { ok: false, message: (err as { error?: string }).error || 'Failed to save settings' };
  }
  const testRes = await fetch(`${apiPrefix}/terminal-tetra/terminal-info`, { method: 'POST' });
  const body = await testRes.json().catch(() => ({}));
  if (!testRes.ok) {
    return {
      ok: false,
      message: (body as { error?: string }).error || 'Terminal test failed',
      detail: body,
    };
  }
  const approved = (body as { approved?: boolean }).approved;
  const status = (body as { parsed?: { status?: string } }).parsed?.status;
  return {
    ok: true,
    message: approved
      ? 'Terminal responded (OK).'
      : `Terminal responded (status ${status ?? 'unknown'}).`,
    detail: body,
  };
}
