import React, { useState, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { Plus, Trash2, Loader2 } from 'lucide-react';

export interface RowData {
  id: string;
  name: string;
  // Allow string to accommodate empty input fields
  rate: number | string;
}

interface DynamicInputFormProps {
  initialData?: Omit<RowData, 'id'>[];
  onSave: (data: Omit<RowData, 'id'>[]) => void;
  isLoading: boolean;
  // Make labels and keys configurable for reusability
  fieldConfig?: {
    nameLabel?: string;
    rateLabel?: string;
    nameKey?: keyof Omit<RowData, 'id'>;
    rateKey?: keyof Omit<RowData, 'id'>;
  };
  onCancel?: () => void;
  minRows?: number;
}

const DynamicInputForm: React.FC<DynamicInputFormProps> = ({ 
  initialData = [], 
  onSave, 
  isLoading,
  fieldConfig = {},
  onCancel,
  minRows = 1
}) => {
  const { 
    nameLabel = 'Name', 
    rateLabel = '%',
    nameKey = 'name',
    rateKey = 'rate'
  } = fieldConfig;

  const [rows, setRows] = useState<RowData[]>([]);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  useEffect(() => {
    // When initialData changes, update the internal state
    const processedData = initialData.map(item => ({
      ...item,
      id: nanoid(), // Assign a unique UI ID
      [rateKey]: item.rate?.toString() ?? '',
    }));
    
    // Always ensure at least minRows empty rows are available
    while (processedData.length < minRows) {
      processedData.push({ id: nanoid(), name: '', rate: '' });
    }
    
    setRows(processedData);
  }, [initialData, rateKey, minRows]);

  // Focus on newly added row
  useEffect(() => {
    if (focusRowId && inputRefs.current[focusRowId]) {
      inputRefs.current[focusRowId]?.focus();
      setFocusRowId(null);
    }
  }, [focusRowId, rows]);

  // Auto-capitalize first letter and after spaces
  const capitalizeInput = (value: string): string => {
    return value.replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
  };

  const handleInputChange = (id: string, field: 'name' | 'rate', value: string) => {
    const processedValue = field === 'name' ? capitalizeInput(value) : value;
    setRows(rows.map(row => (row.id === id ? { ...row, [field]: processedValue } : row)));
  };

  const addRow = () => {
    const newId = nanoid();
    setRows([...rows, { id: newId, name: '', rate: '' }]);
    setFocusRowId(newId);
  };

  const removeRow = (id: string) => {
    // Always keep at least 1 row
    if (rows.length > 1) {
      setRows(rows.filter(row => row.id !== id));
    }
  };

  const handleSave = () => {
    // 1. Filter out "ghost rows" where both name and rate are empty
    const filteredRows = rows.filter(row => row.name.trim() !== '' || (row.rate.toString().trim() !== '' && row.rate.toString().trim() !== '0'));

    // 2. Validate the remaining rows
    for (const row of filteredRows) {
      const name = row.name.trim();
      const rate = parseFloat(row.rate.toString());

      if (!name) {
        alert('Tax name is required for all entries.');
        return;
      }
      if (isNaN(rate) || rate < 0) {
        alert(`Invalid rate for '${name}'. Rate must be a positive number.`);
        return;
      }
    }

    // 3. Check for duplicate names
    const names = filteredRows.map(row => row.name.trim().toLowerCase());
    const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicateNames.length > 0) {
      alert('Duplicate tax names are not allowed.');
      return;
    }

    // 4. Convert to final format
    const finalData = filteredRows.map(row => ({
      name: row.name.trim(),
      rate: parseFloat(row.rate.toString())
    }));

    onSave(finalData);
  };

  return (
    <div>
      <div className="grid grid-cols-[60%,26%,auto] gap-x-2 mb-2 font-semibold text-gray-600 text-sm">
        <label>{nameLabel}</label>
        <label>{rateLabel}</label>
        <div /> {/* Placeholder for delete button column */}
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[60%,26%,auto] gap-x-2 items-center">
            <input
              ref={el => { inputRefs.current[row.id] = el; }}
              type="text"
              value={row.name}
              onChange={(e) => handleInputChange(row.id, 'name', e.target.value)}
              placeholder="e.g., Sales Tax"
              className="p-2 border rounded-md w-full"
            />
            <input
              type="number"
              value={row.rate}
              onChange={(e) => handleInputChange(row.id, 'rate', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder="e.g., 8.25"
              className="p-2 border rounded-md w-full"
              min="0"
              step="0.25"
            />
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              disabled={rows.length <= 1}
              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="mt-4 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
      >
        <Plus size={16} /> Add More Taxes
      </button>

      <div className="mt-6 flex justify-end gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-6 py-2 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={isLoading}
          className="flex items-center justify-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </button>
      </div>
    </div>
  );
};

export default DynamicInputForm; 