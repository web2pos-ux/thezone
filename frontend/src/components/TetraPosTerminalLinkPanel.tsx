import React, { useState, useCallback } from 'react';
import { loadTetraBridgeReady } from '../utils/tetraIntegratedPayment';
import { probeTetraTerminalInfo, probeTetraDetailedReport } from '../utils/tetraHardwareTest';

type Props = {
  apiPrefix: string;
};

/**
 * Shows whether saved POS settings can reach the Tetra terminal (semi-integrated).
 * Does not save the form — uses last-saved hardware settings on the server.
 */
export function TetraPosTerminalLinkPanel({ apiPrefix }: Props) {
  const [loading, setLoading] = useState(false);
  const [bridgeReady, setBridgeReady] = useState<boolean | null>(null);
  const [terminalOk, setTerminalOk] = useState<boolean | null>(null);
  const [probeAttempted, setProbeAttempted] = useState(false);
  const [detail, setDetail] = useState<string>('');

  const runDetailedOnly = useCallback(async () => {
    setLoading(true);
    setDetail('');
    setTerminalOk(null);
    setProbeAttempted(false);
    try {
      const ready = await loadTetraBridgeReady(apiPrefix);
      setBridgeReady(ready);
      if (!ready) {
        setDetail(
          'Saved settings are not ready for semi-integrated. Save integrated mode, Tetra / Move 5000 type, and Serial or TCP, then try again.'
        );
        setProbeAttempted(true);
        return;
      }
      const dr = await probeTetraDetailedReport(apiPrefix);
      setTerminalOk(dr.ok);
      setDetail(`[Idle / type 30] ${dr.message}`);
      setProbeAttempted(true);
    } catch (e) {
      setTerminalOk(false);
      setDetail(e instanceof Error ? e.message : 'An error occurred while checking.');
      setProbeAttempted(true);
    } finally {
      setLoading(false);
    }
  }, [apiPrefix]);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setDetail('');
    setTerminalOk(null);
    setProbeAttempted(false);
    try {
      const ready = await loadTetraBridgeReady(apiPrefix);
      setBridgeReady(ready);
      if (!ready) {
        setDetail(
          'Saved settings are not ready for semi-integrated. Save integrated mode, a Tetra / Move 5000–class terminal type, and Serial (COM) or TCP (host + port), then check again.'
        );
        setProbeAttempted(true);
        return;
      }
      const pr = await probeTetraTerminalInfo(apiPrefix);
      let combined = `[Terminal info / type 42] ${pr.message}`;
      if (pr.ok) {
        try {
          const dr = await probeTetraDetailedReport(apiPrefix);
          combined += `\n[Idle / type 30] ${dr.message}`;
          setTerminalOk(pr.ok && dr.ok);
        } catch {
          combined += '\n[Idle / type 30] (skipped — error)';
          setTerminalOk(false);
        }
      } else {
        setTerminalOk(false);
      }
      setDetail(combined);
      setProbeAttempted(true);
    } catch (e) {
      setTerminalOk(false);
      setDetail(e instanceof Error ? e.message : 'An error occurred while checking.');
      setProbeAttempted(true);
    } finally {
      setLoading(false);
    }
  }, [apiPrefix]);

  const terminalBadgeLabel =
    !probeAttempted
      ? 'Unknown'
      : bridgeReady === false
        ? 'Skipped'
        : terminalOk
          ? 'Connected'
          : 'Failed';
  const terminalBadgeClass =
    !probeAttempted
      ? 'bg-white/80 text-cyan-800 border border-cyan-200'
      : bridgeReady === false
        ? 'bg-slate-100 text-slate-800 border border-slate-300'
        : terminalOk
          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
          : 'bg-red-100 text-red-900 border border-red-300';

  return (
    <section className="rounded-xl border border-cyan-200/90 bg-cyan-50/50 p-5 shadow-sm">
      <h4 className="text-sm font-bold text-cyan-950 mb-2 pb-2 border-b border-cyan-200/80">POS ↔ card terminal link</h4>
      <p className="text-xs text-cyan-900/90 mb-3">
        Queries the terminal using <strong>saved</strong> hardware settings on the server (no sale). If you only edited
        this form, save first or use <strong>Save &amp; test terminal (info)</strong> below to persist.
      </p>
      <ul className="text-sm text-cyan-950 space-y-1.5 mb-3">
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-semibold shrink-0">Settings / path</span>
          <span
            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
              bridgeReady === null
                ? 'bg-white/80 text-cyan-800 border border-cyan-200'
                : bridgeReady
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                  : 'bg-amber-100 text-amber-900 border border-amber-300'
            }`}
          >
            {bridgeReady === null ? 'Unknown' : bridgeReady ? 'Ready' : 'Incomplete'}
          </span>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-semibold shrink-0">Terminal response</span>
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${terminalBadgeClass}`}>
            {terminalBadgeLabel}
          </span>
        </li>
      </ul>
      {detail ? <p className="text-sm text-cyan-950 mb-3 whitespace-pre-wrap">{detail}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="px-4 py-2 bg-cyan-700 text-white rounded-lg text-sm font-semibold hover:bg-cyan-800 disabled:bg-cyan-400 transition-colors"
        >
          {loading ? 'Checking…' : 'Check link status'}
        </button>
        <button
          type="button"
          onClick={runDetailedOnly}
          disabled={loading}
          className="px-3 py-2 bg-cyan-600/90 text-white rounded-lg text-sm font-semibold hover:bg-cyan-700 disabled:bg-cyan-400 transition-colors border border-cyan-800/30"
        >
          Idle test (30)
        </button>
        <span className="text-xs text-cyan-900/80 w-full sm:w-auto">
          <strong>Check link</strong> runs terminal info (42) then idle detailed report (30). Use{' '}
          <strong>Save &amp; test</strong> below after changing the form.
        </span>
      </div>
    </section>
  );
}
