import React from 'react';
import type { ClockedInEmployee } from '../services/clockInOutApi';

interface ServerSelectionModalProps {
  open: boolean;
  loading: boolean;
  error?: string;
  employees: ClockedInEmployee[];
  onClose: () => void;
  onSelect: (employee: ClockedInEmployee) => void;
}

const ServerSelectionModal: React.FC<ServerSelectionModalProps> = ({
  open,
  loading,
  error,
  employees,
  onClose,
  onSelect,
}) => {
  const formatEmployeeName = (fullName: string) => {
    const name = (fullName || '').trim();
    if (!name) return '';

    const parts = name.split(/\s+/);
    if (parts.length === 1) return parts[0];

    const firstName = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0] ?? '';
    return lastInitial ? `${firstName} ${lastInitial.toUpperCase()}` : firstName;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black bg-opacity-60 px-2">
      <div className="w-full max-w-[576px] rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Select Server</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-16 w-16 items-center justify-center text-gray-500 hover:text-gray-700 text-5xl leading-none rounded-full transition-transform hover:scale-105"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <span className="text-xs text-gray-500">Clocked-in: {employees.length}</span>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 max-h-[558px] overflow-y-auto pr-1 pt-2 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600 mb-3" />
              Loading...
            </div>
          ) : employees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              No clocked-in servers found. Please make sure the staff clocks in first.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...employees]
                .sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'en', { sensitivity: 'base' }))
                .map((employee) => (
                  <button
                    key={employee.employee_id}
                    onClick={() => onSelect(employee)}
                    className="w-full rounded-xl bg-[#c1c7d6] text-slate-900 px-4 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,23,42,0.24)] min-h-[72px] flex items-center justify-center text-center font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-[#b3b8c8]"
                  >
                    <div className="text-lg font-semibold text-inherit">
                      {formatEmployeeName(employee.employee_name)}
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default ServerSelectionModal;

