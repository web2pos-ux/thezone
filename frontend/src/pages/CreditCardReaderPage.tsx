import React, { useState, useEffect } from 'react';
import { TetraPosTerminalLinkPanel } from '../components/TetraPosTerminalLinkPanel';
import { useSerialPorts, SerialPort } from '../hooks/useSerialPorts';
import { saveAndTestTetraTerminal } from '../utils/tetraHardwareTest';
import { getIntegratedTetraSaveTestMissingFieldKeys } from '../utils/integratedTetraSaveTestValidation';
import {
  getTerminalHardwarePresetPatch,
  TERMINAL_HARDWARE_PRESET_LABELS,
  type TerminalHardwarePresetId,
} from '../utils/terminalHardwarePresets';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface CreditCardReaderSettings {
  integrationMode: 'integrated' | 'standalone';
  terminalType: string;
  terminalId: string;
  deviceContractRef: string;
  deviceAdminPin: string;
  merchantId: string;
  apiKey: string;
  apiEndpoint: string;
  connectionPort: string;
  connectionKind: 'serial' | 'tcp';
  tcpHost: string;
  tcpPort: number;
  baudRate: number;
  timeout: number;
}

const CreditCardReaderPage = () => {
  const { ports, loading: serialLoading, error: serialError, fetchPorts } = useSerialPorts(API_URL);

  const [settings, setSettings] = useState<CreditCardReaderSettings>({
    integrationMode: 'standalone',
    terminalType: '',
    terminalId: '',
    deviceContractRef: '',
    deviceAdminPin: '',
    merchantId: '',
    apiKey: '',
    apiEndpoint: '',
    connectionPort: '',
    connectionKind: 'serial',
    tcpHost: '',
    tcpPort: 0,
    baudRate: 19200,
    timeout: 120
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tetraTestStatus, setTetraTestStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [tetraTestMessage, setTetraTestMessage] = useState<string>('');
  const [tetraSaveTestFieldErrors, setTetraSaveTestFieldErrors] = useState<string[]>([]);
  const [terminalPresetDraft, setTerminalPresetDraft] = useState<TerminalHardwarePresetId>('none');

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_URL}/settings/hardware/credit-card`);
        if (response.ok) {
          const data = await response.json();
          if (data.settings) {
            setSettings((prev) => ({ ...prev, ...data.settings }));
          }
        }
      } catch (error) {
        console.error('Failed to load credit card settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Save settings
  const handleSaveSettings = async () => {
    setSaveStatus('saving');
    try {
      const response = await fetch(`${API_URL}/settings/hardware/credit-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      if (response.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Credit Card Reader</h1>
          <p className="text-gray-600 mt-1">Configure credit card terminal integration</p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saved' && (
            <span className="text-green-600 font-medium">✓ Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-600 font-medium">Error saving</span>
          )}
          <button
            onClick={handleSaveSettings}
            disabled={saveStatus === 'saving'}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Integration Mode Selection */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Integration Mode</label>
          <div className="grid grid-cols-2 gap-4">
            {/* Standalone (Non-Integrated) */}
            <div
              onClick={() => setSettings({ ...settings, integrationMode: 'standalone' })}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                settings.integrationMode === 'standalone'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  settings.integrationMode === 'standalone'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-800">Standalone (Non-Integrated)</h3>
                </div>
                {settings.integrationMode === 'standalone' && (
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* Integrated */}
            <div
              onClick={() => setSettings({ ...settings, integrationMode: 'integrated' })}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                settings.integrationMode === 'integrated'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  settings.integrationMode === 'integrated'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-800">Integrated Terminal</h3>
                </div>
                {settings.integrationMode === 'integrated' && (
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Integrated Mode Settings */}
        {settings.integrationMode === 'integrated' && (
          <div className="border-t border-gray-200 pt-6 space-y-5">
            <h3 className="text-lg font-bold text-gray-800">Integrated terminal — settings</h3>

            <section className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-5 shadow-sm">
              <h4 className="text-sm font-bold text-amber-950 mb-3">Before you start</h4>
              <div className="flex items-center gap-2 text-amber-900">
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="font-semibold">Configuration Required</span>
              </div>
              <p className="text-amber-900/90 text-sm mt-2">
                Please configure the terminal settings below to enable integrated payments.
              </p>
            </section>

            <section className="rounded-xl border border-stone-200 bg-stone-50/90 p-5 shadow-sm">
              <h4 className="text-sm font-bold text-stone-800 mb-3">Quick setup (optional)</h4>
              <label className="block text-sm font-semibold text-stone-700 mb-2">
                Field install — quick setup (optional)
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={terminalPresetDraft}
                  onChange={(e) => {
                    const id = e.target.value as TerminalHardwarePresetId;
                    setTerminalPresetDraft('none');
                    const patch = getTerminalHardwarePresetPatch(id);
                    if (patch) {
                      setSettings((prev) => ({ ...prev, ...patch }) as CreditCardReaderSettings);
                    }
                  }}
                  className="px-4 py-2 border-2 border-stone-300 rounded-lg max-w-xl bg-white"
                >
                  {(Object.keys(TERMINAL_HARDWARE_PRESET_LABELS) as TerminalHardwarePresetId[]).map((k) => (
                    <option key={k} value={k}>
                      {TERMINAL_HARDWARE_PRESET_LABELS[k]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-stone-600 max-w-md">
                  Applies model + integrated + serial defaults. You still choose COM (or switch to TCP), enter contract
                  ID, then Save.
                </span>
              </div>
            </section>

            <section className="rounded-xl border border-sky-200/90 bg-sky-50/80 p-5 shadow-sm">
              <h4 className="text-sm font-bold text-sky-900 mb-4 pb-2 border-b border-sky-200/80">Terminal &amp; device</h4>
              <div className="grid grid-cols-2 gap-6">
              {/* Terminal Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Terminal Type</label>
                <select
                  value={settings.terminalType}
                  onChange={(e) => setSettings({ ...settings, terminalType: e.target.value })}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${
                    tetraSaveTestFieldErrors.includes('terminalType')
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-blue-500'
                  }`}
                >
                  <option value="">Select Terminal Type</option>
                  <option value="ingenico">Ingenico</option>
                  <option value="ingenico_tetra_semi">Ingenico Tetra (Semi-Integrated)</option>
                  <option value="ingenico_move_5000">Ingenico Move 5000 (Semi-Integrated)</option>
                  <option value="verifone">Verifone</option>
                  <option value="pax">PAX</option>
                  <option value="clover">Clover</option>
                  <option value="square">Square</option>
                  <option value="stripe">Stripe Terminal</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Terminal ID */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Terminal ID</label>
                <input
                  type="text"
                  value={settings.terminalId}
                  onChange={(e) => setSettings({ ...settings, terminalId: e.target.value })}
                  placeholder="Enter Terminal ID"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Device software / contract ID
                </label>
                <input
                  type="text"
                  value={settings.deviceContractRef}
                  onChange={(e) => setSettings({ ...settings, deviceContractRef: e.target.value })}
                  placeholder="From vendor email (optional)"
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${
                    tetraSaveTestFieldErrors.includes('deviceContractRef')
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-blue-500'
                  }`}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Stored for your records and support calls; not sent on the ECR purchase wire.
                </p>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Terminal admin PIN (optional)
                </label>
                <input
                  type="password"
                  value={settings.deviceAdminPin}
                  onChange={(e) => setSettings({ ...settings, deviceAdminPin: e.target.value })}
                  placeholder="Only if the device prompts on the keypad"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  For on-device menus only. Leave blank if passwords were disabled. Not used by integrated sale commands.
                </p>
              </div>
            </div>
            </section>

            <section className="rounded-xl border border-violet-200/90 bg-violet-50/70 p-5 shadow-sm">
              <h4 className="text-sm font-bold text-violet-900 mb-4 pb-2 border-b border-violet-200/80">Merchant &amp; API</h4>
              <div className="grid grid-cols-2 gap-6">
              {/* Merchant ID */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Merchant ID</label>
                <input
                  type="text"
                  value={settings.merchantId}
                  onChange={(e) => setSettings({ ...settings, merchantId: e.target.value })}
                  placeholder="Enter Merchant ID"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">API Key</label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  placeholder="Enter API Key"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* API Endpoint */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">API Endpoint URL</label>
                <input
                  type="text"
                  value={settings.apiEndpoint}
                  onChange={(e) => setSettings({ ...settings, apiEndpoint: e.target.value })}
                  placeholder="https://api.terminal.com/v1"
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none ${
                    tetraSaveTestFieldErrors.includes('apiEndpoint')
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-blue-500'
                  }`}
                />
              </div>
              </div>
            </section>

            <section className="rounded-xl border border-emerald-200/90 bg-emerald-50/60 p-5 shadow-sm">
              <h4 className="text-sm font-bold text-emerald-900 mb-4 pb-2 border-b border-emerald-200/80">Connection (Serial / TCP)</h4>
              <div className="grid grid-cols-2 gap-6">
              {/* Transport */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Tetra transport</label>
                <select
                  value={settings.connectionKind}
                  onChange={(e) =>
                    setSettings({ ...settings, connectionKind: e.target.value as 'serial' | 'tcp' })
                  }
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value="serial">Serial (COM / USB)</option>
                  <option value="tcp">TCP (LAN / Wi‑Fi — terminal IP)</option>
                </select>
                <p className="text-xs text-gray-600 mt-2 space-y-1.5">
                  <span className="block">
                    On the terminal (ADMIN, etc.), connect Wi‑Fi or LAN so it gets an IP, then choose <strong>TCP</strong>{' '}
                    and enter the <strong>ECR / semi-integrated TCP host and port</strong> from your processor manual. For
                    USB, use <strong>Serial</strong> and a COM port.
                  </span>
                  <span className="block text-amber-900/90 font-medium">
                    This POS uses <strong>cleartext TCP only</strong> (no TLS). Use the manual&apos;s{' '}
                    <strong>non‑SSL / cleartext</strong> ECR port when two ports are listed; if only SSL is documented, use{' '}
                    <strong>Serial</strong> or obtain a cleartext ECR port from support.
                  </span>
                  <span className="block">
                    <strong>Serial:</strong> 7E1 at the selected baud (default 19200) — must match the device.
                  </span>
                </p>
              </div>

              {/* Connection Port */}
              <div className="col-span-2 space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Serial port (e.g. COM3)</label>
                {settings.connectionKind === 'serial' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fetchPorts()}
                      disabled={serialLoading}
                      className="px-3 py-2 text-sm bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      {serialLoading ? 'Scanning…' : 'Refresh COM list'}
                    </button>
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) setSettings({ ...settings, connectionPort: v });
                      }}
                      className="px-3 py-2 text-sm border-2 border-gray-300 rounded-lg min-w-[12rem]"
                      aria-label="Pick detected COM port"
                    >
                      <option value="">Pick detected port…</option>
                      {ports.map((p: SerialPort) => (
                        <option key={p.path} value={p.path}>
                          {p.displayName || p.path}
                        </option>
                      ))}
                    </select>
                    {serialError && <span className="text-xs text-red-600">COM list: {serialError}</span>}
                  </div>
                )}
                <input
                  type="text"
                  value={settings.connectionPort}
                  onChange={(e) => setSettings({ ...settings, connectionPort: e.target.value })}
                  placeholder="COM3"
                  disabled={settings.connectionKind !== 'serial'}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none disabled:bg-gray-100 ${
                    tetraSaveTestFieldErrors.includes('connectionPort')
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">TCP host</label>
                <input
                  type="text"
                  value={settings.tcpHost}
                  onChange={(e) => setSettings({ ...settings, tcpHost: e.target.value })}
                  placeholder="192.168.x.x"
                  disabled={settings.connectionKind !== 'tcp'}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none disabled:bg-gray-100 ${
                    tetraSaveTestFieldErrors.includes('tcpHost')
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">TCP port</label>
                <input
                  type="number"
                  value={settings.tcpPort || ''}
                  onChange={(e) =>
                    setSettings({ ...settings, tcpPort: parseInt(e.target.value, 10) || 0 })
                  }
                  placeholder="5000"
                  disabled={settings.connectionKind !== 'tcp'}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:outline-none disabled:bg-gray-100 ${
                    tetraSaveTestFieldErrors.includes('tcpPort')
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-blue-500'
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Serial baud rate</label>
                <select
                  value={settings.baudRate}
                  onChange={(e) => setSettings({ ...settings, baudRate: parseInt(e.target.value, 10) || 19200 })}
                  disabled={settings.connectionKind !== 'serial'}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
                >
                  <option value={4800}>4800</option>
                  <option value={9600}>9600</option>
                  <option value={19200}>19200 (default)</option>
                  <option value={38400}>38400</option>
                  <option value={115200}>115200</option>
                </select>
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Transaction Timeout (seconds)</label>
                <input
                  type="number"
                  value={settings.timeout}
                  onChange={(e) => setSettings({ ...settings, timeout: parseInt(e.target.value, 10) || 120 })}
                  min={30}
                  max={600}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            </section>

            <TetraPosTerminalLinkPanel apiPrefix={API_URL} />

            <section className="rounded-xl border border-slate-200 bg-slate-50/90 p-5 shadow-sm">
              <h4 className="text-sm font-bold text-slate-800 mb-3 pb-2 border-b border-slate-200/80">Verify connection</h4>
              <p className="text-sm text-gray-600 mb-4">
                API Endpoint can be <code className="bg-white/80 px-1 rounded border border-slate-200">host:port</code> for TCP if TCP host/port are empty.
              </p>

              <div className="flex flex-col items-end gap-2">
              {tetraTestMessage && (
                <p
                  className={`text-sm max-w-xl text-right ${
                    tetraTestStatus === 'error' ? 'text-red-600' : 'text-gray-700'
                  }`}
                >
                  {tetraTestMessage}
                </p>
              )}
              <button
                type="button"
                disabled={tetraTestStatus === 'running'}
                onClick={async () => {
                  const missing = getIntegratedTetraSaveTestMissingFieldKeys(settings);
                  if (missing.length) {
                    setTetraSaveTestFieldErrors(missing);
                    setTetraTestStatus('error');
                    setTetraTestMessage('Please fill in all required fields and try again.');
                    return;
                  }
                  setTetraSaveTestFieldErrors([]);
                  setTetraTestStatus('running');
                  setTetraTestMessage('');
                  try {
                    const r = await saveAndTestTetraTerminal(API_URL, settings as unknown as Record<string, unknown>);
                    setTetraTestStatus(r.ok ? 'done' : 'error');
                    setTetraTestMessage(r.message);
                    if (r.ok) setTetraSaveTestFieldErrors([]);
                  } catch (e: unknown) {
                    setTetraTestStatus('error');
                    setTetraTestMessage(e instanceof Error ? e.message : 'Test failed');
                  }
                }}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-all disabled:bg-gray-400"
              >
                {tetraTestStatus === 'running' ? 'Testing…' : 'Save & test terminal (info)'}
              </button>
            </div>
            </section>
          </div>
        )}

        {/* Standalone Mode Info */}
        {settings.integrationMode === 'standalone' && (
          <div className="border-t border-gray-200 pt-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-bold text-blue-800 mb-2">Standalone Mode Active</h3>
              <p className="text-blue-700 mb-4">
                In standalone mode, card transactions are processed manually without terminal integration.
              </p>
              <div className="space-y-2 text-blue-600">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Card payments: Use external terminal and enter approval code</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Refunds: Enter card last 4 digits and authorization code manually</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>No additional hardware configuration needed</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditCardReaderPage;
