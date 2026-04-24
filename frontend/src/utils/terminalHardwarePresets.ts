/**
 * Field-install presets for credit card hardware (back office).
 * Merge into existing settings; does not clear contract/PIN unless preset replaces those keys.
 */

export type TerminalHardwarePresetId = 'none' | 'ingenico_move_5000_semi';

export const TERMINAL_HARDWARE_PRESET_LABELS: Record<TerminalHardwarePresetId, string> = {
  none: '— Quick setup —',
  ingenico_move_5000_semi: 'Ingenico Move 5000 (semi-integrated, USB serial defaults)',
};

/** Partial fields applied on top of current settings when a preset is chosen. */
export function getTerminalHardwarePresetPatch(
  presetId: TerminalHardwarePresetId
): Record<string, unknown> | null {
  if (presetId === 'none') return null;
  if (presetId === 'ingenico_move_5000_semi') {
    return {
      integrationMode: 'integrated',
      terminalType: 'ingenico_move_5000',
      connectionKind: 'serial',
      baudRate: 19200,
      timeout: 120,
    };
  }
  return null;
}
