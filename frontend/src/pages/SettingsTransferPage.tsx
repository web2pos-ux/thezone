import React, { useState, useRef } from 'react';
import { API_URL } from '../config/constants';

interface PreviewData {
  version: string;
  exportedAt: string;
  sections: {
    menu?: { menus: number; categories: number; items: number; modifierGroups: number; modifiers: number; taxGroups: number; printerGroups: number };
    tablemap?: { elements: number; screenSettings: number };
    layout?: { orderPageSetups: number; layoutSettings: number; menuItemColors: number };
  };
}

interface ImportResult {
  success: boolean;
  message?: string;
  backup?: string;
  summary?: {
    menu?: { menus: number; categories: number; items: number; modifierGroups: number; modifiers: number; taxGroups: number; printerGroups: number } | null;
    tablemap?: { elements: number; screenSettings: number } | null;
    layout?: { orderPageSetups: number; layoutSettings: number; menuItemColors: number } | null;
  };
  error?: string;
}

const SECTION_LABELS: Record<string, string> = {
  menu: 'Menu',
  tablemap: 'Table Map',
  layout: 'Order Page Layout'
};

const SettingsTransferPage: React.FC = () => {
  // Export
  const [exportSections, setExportSections] = useState<Record<string, boolean>>({ menu: true, tablemap: true, layout: true });
  const [exporting, setExporting] = useState(false);

  // Import
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importSections, setImportSections] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Export ---
  const handleExport = async () => {
    const sections = Object.entries(exportSections).filter(([, v]) => v).map(([k]) => k);
    if (sections.length === 0) {
      alert('Please select at least one section to export.');
      return;
    }

    setExporting(true);
    try {
      const res = await fetch(`${API_URL}/settings-transfer/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ sections })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Export failed');

      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `pos-settings-${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);

      alert(`Export completed!\n\nSections: ${sections.map(s => SECTION_LABELS[s]).join(', ')}`);
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  // --- File Select & Preview ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPreview(null);
    setImportResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/settings-transfer/preview`, {
        method: 'POST',
        headers: { 'X-Role': 'MANAGER' },
        body: formData
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Preview failed');

      setPreview(data.preview);
      const secs: Record<string, boolean> = {};
      Object.keys(data.preview.sections).forEach(k => { secs[k] = true; });
      setImportSections(secs);
    } catch (err: any) {
      alert(`Failed to read file: ${err.message}`);
      setSelectedFile(null);
    }
  };

  // --- Import ---
  const handleImport = async () => {
    if (!selectedFile || !preview) return;

    const sections = Object.entries(importSections).filter(([, v]) => v).map(([k]) => k);
    if (sections.length === 0) {
      alert('Please select at least one section to import.');
      return;
    }

    const sectionNames = sections.map(s => SECTION_LABELS[s]).join(', ');
    if (!window.confirm(`⚠️ Import Settings\n\nThe following sections will be REPLACED:\n${sectionNames}\n\nA backup will be created before import.\n\nContinue?`)) return;

    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('sections', JSON.stringify(sections));

      const res = await fetch(`${API_URL}/settings-transfer/import`, {
        method: 'POST',
        headers: { 'X-Role': 'MANAGER' },
        body: formData
      });
      const data: ImportResult = await res.json();
      setImportResult(data);

      if (data.success) {
        alert(`Import completed!\n\nBackup: ${data.backup}\n\nImported: ${sectionNames}`);
      } else {
        alert(`Import failed: ${data.error}`);
      }
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => {
    setSelectedFile(null);
    setPreview(null);
    setImportSections({});
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings Transfer</h1>
      <p className="text-gray-600 mb-8">
        Export POS settings (Menu, Table Map, Order Page Layout) to a JSON file, then import on another POS.
      </p>

      {/* ===== EXPORT ===== */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="text-blue-600 text-xl">↑</span> Export Settings
        </h2>
        <p className="text-sm text-gray-500 mb-4">Select sections to export and download as a JSON file.</p>

        <div className="flex gap-4 mb-4">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exportSections[key] || false}
                onChange={e => setExportSections(prev => ({ ...prev, [key]: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium">{label}</span>
            </label>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={exporting || !Object.values(exportSections).some(v => v)}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>

      {/* ===== IMPORT ===== */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="text-green-600 text-xl">↓</span> Import Settings
        </h2>
        <p className="text-sm text-gray-500 mb-4">Select a previously exported JSON file to import settings.</p>

        {/* File Select */}
        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelect}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
          />
        </div>

        {/* Preview */}
        {preview && (
          <div className="border rounded-lg p-4 mb-4 bg-gray-50">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">File Preview</h3>
              <span className="text-xs text-gray-400">
                v{preview.version} | Exported: {new Date(preview.exportedAt).toLocaleString()}
              </span>
            </div>

            <div className="space-y-3">
              {preview.sections.menu && (
                <label className="flex items-start gap-3 p-3 bg-white rounded border cursor-pointer hover:bg-blue-50">
                  <input
                    type="checkbox"
                    checked={importSections.menu || false}
                    onChange={e => setImportSections(prev => ({ ...prev, menu: e.target.checked }))}
                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <div>
                    <div className="font-medium text-sm">Menu</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {preview.sections.menu.menus} menu(s), {preview.sections.menu.categories} categories, {preview.sections.menu.items} items, {preview.sections.menu.modifierGroups} modifier groups, {preview.sections.menu.taxGroups} tax groups, {preview.sections.menu.printerGroups} printer groups
                    </div>
                  </div>
                </label>
              )}

              {preview.sections.tablemap && (
                <label className="flex items-start gap-3 p-3 bg-white rounded border cursor-pointer hover:bg-blue-50">
                  <input
                    type="checkbox"
                    checked={importSections.tablemap || false}
                    onChange={e => setImportSections(prev => ({ ...prev, tablemap: e.target.checked }))}
                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <div>
                    <div className="font-medium text-sm">Table Map</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {preview.sections.tablemap.elements} elements, {preview.sections.tablemap.screenSettings} floor(s)
                    </div>
                  </div>
                </label>
              )}

              {preview.sections.layout && (
                <label className="flex items-start gap-3 p-3 bg-white rounded border cursor-pointer hover:bg-blue-50">
                  <input
                    type="checkbox"
                    checked={importSections.layout || false}
                    onChange={e => setImportSections(prev => ({ ...prev, layout: e.target.checked }))}
                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <div>
                    <div className="font-medium text-sm">Order Page Layout</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {preview.sections.layout.orderPageSetups} setup(s), {preview.sections.layout.layoutSettings} layout setting(s), {preview.sections.layout.menuItemColors} item color(s)
                    </div>
                  </div>
                </label>
              )}
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleImport}
                disabled={importing || !Object.values(importSections).some(v => v)}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
              <button
                onClick={resetImport}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Import Result */}
        {importResult && (
          <div className={`border rounded-lg p-4 mt-4 ${importResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <h3 className={`font-semibold text-sm mb-2 ${importResult.success ? 'text-green-700' : 'text-red-700'}`}>
              {importResult.success ? 'Import Successful' : 'Import Failed'}
            </h3>
            {importResult.success && importResult.summary && (
              <div className="text-xs text-gray-600 space-y-1">
                {importResult.summary.menu && (
                  <div>Menu: {importResult.summary.menu.menus} menu(s), {importResult.summary.menu.categories} categories, {importResult.summary.menu.items} items</div>
                )}
                {importResult.summary.tablemap && (
                  <div>Table Map: {importResult.summary.tablemap.elements} elements</div>
                )}
                {importResult.summary.layout && (
                  <div>Layout: {importResult.summary.layout.orderPageSetups} setup(s), {importResult.summary.layout.layoutSettings} settings, {importResult.summary.layout.menuItemColors} colors</div>
                )}
                {importResult.backup && (
                  <div className="mt-2 text-gray-400">Backup: {importResult.backup}</div>
                )}
              </div>
            )}
            {importResult.error && (
              <div className="text-xs text-red-600">{importResult.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsTransferPage;
