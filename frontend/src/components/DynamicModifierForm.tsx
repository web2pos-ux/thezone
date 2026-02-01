import React, { useState, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import { nanoid } from 'nanoid';
import { Plus, Trash2, Loader2, Minus } from 'lucide-react';

export interface ModifierRowData {
  id: string;
  name: string;
  // Allow string to accommodate empty input fields
  rate: number | string;
  rate2?: number | string;  // Price2 for second price tier (optional)
}

interface DynamicModifierFormProps {
  initialData?: Omit<ModifierRowData, 'id'>[];
  onSave: (data: Omit<ModifierRowData, 'id'>[]) => void;
  isLoading: boolean;
  // Make labels and keys configurable for reusability
  fieldConfig?: {
    nameLabel?: string;
    rateLabel?: string;
    nameKey?: keyof Omit<ModifierRowData, 'id'>;
    rateKey?: keyof Omit<ModifierRowData, 'id'>;
  };
  onCancel?: () => void;
}

export interface DynamicModifierFormRef {
  triggerSave: () => void;
}

const DynamicModifierForm = forwardRef<DynamicModifierFormRef, DynamicModifierFormProps>(({ 
  initialData = [], 
  onSave, 
  isLoading,
  fieldConfig = {},
  onCancel
}, ref) => {
  const { 
    nameLabel = 'Name', 
    rateLabel = '%',
    nameKey = 'name',
    rateKey = 'rate'
  } = fieldConfig;

  const [rows, setRows] = useState<ModifierRowData[]>([]);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const inputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  useEffect(() => {
    // When initialData changes, update the internal state
    const processedData = initialData.map(item => ({
      ...item,
      id: nanoid(), // Assign a unique UI ID
      [rateKey]: item[rateKey], // Ensure rate is preserved as-is
      rate2: (item as any).rate2 || 0 // Ensure rate2 is preserved
    }));
    
    // Start with 2 rows if no initial data, otherwise use processed data
    setRows(processedData.length > 0 ? processedData : [
      { id: nanoid(), name: '', rate: 0, rate2: 0 },
      { id: nanoid(), name: '', rate: 0, rate2: 0 }
    ]);
  }, [initialData, rateKey]);

  // Focus on the newly added row when it's created
  useEffect(() => {
    if (focusRowId && inputRefs.current[focusRowId]) {
      inputRefs.current[focusRowId]?.focus();
      setFocusRowId(null); // Reset focus state after focusing
    }
  }, [focusRowId, rows]);

  // Auto-capitalize first letter and after spaces
  const capitalizeInput = (value: string): string => {
    return value.replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
  };

  const handleInputChange = (id: string, field: 'name' | 'rate' | 'rate2', value: string) => {
    console.log('🔍 handleInputChange:', { id, field, value });
    setRows(prevRows => 
      prevRows.map(row => {
        if (row.id === id) {
          if (field === 'name') {
            // Auto-capitalize name input
            return { ...row, [field]: capitalizeInput(value) };
          } else if (field === 'rate' || field === 'rate2') {
            // Keep value as string during input to allow typing decimals like "1."
            // The value will be parsed to number in handleSave
            return { ...row, [field]: value };
          }
        }
        return row;
      })
    );
  };

  const addRow = () => {
    const newId = nanoid();
    setRows(prev => [...prev, { id: newId, name: '', rate: 0, rate2: 0 }]);
    setFocusRowId(newId); // Set focus to the newly added row
  };

  const removeRow = (id: string) => {
    if (rows.length > 1) {
      setRows(prev => prev.filter(row => row.id !== id));
    }
  };

  const handlePriceChange = (id: string, direction: 'increase' | 'decrease') => {
    setRows(prevRows => 
      prevRows.map(row => {
        if (row.id === id) {
          const currentRate = typeof row.rate === 'string' ? parseFloat(row.rate) || 0 : row.rate;
          const newRate = direction === 'increase' ? currentRate + 0.25 : currentRate - 0.25;
          return { ...row, rate: Math.max(0, newRate) }; // Limit minimum to 0
        }
        return row;
      })
    );
  };

  const handleSave = () => {
    // Validate: ensure all rows have names (rate can be empty, defaults to 0)
    const validRows = rows.filter(row => {
      const name = row.name.trim();
      // Only require name - empty rate will be treated as 0
      return name.length > 0;
    });

    if (validRows.length === 0) {
      alert('Please add at least one valid option with a name.');
      return;
    }

    // Convert to final format - ensure empty/invalid rates become 0
    const finalData = validRows.map(row => {
      const rateStr = String(row.rate ?? '');
      const rate2Str = String(row.rate2 ?? '');
      const rateValue = rateStr === '' ? 0 : parseFloat(rateStr);
      const rate2Value = rate2Str === '' ? 0 : parseFloat(rate2Str);
      return {
        name: row.name.trim(),
        rate: isNaN(rateValue) ? 0 : rateValue,
        rate2: isNaN(rate2Value) ? 0 : rate2Value
      };
    });

    console.log('🔍 DynamicModifierForm - data to save:', finalData);
    onSave(finalData);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      handleSave();
    }
  };

  useImperativeHandle(ref, () => ({
    triggerSave: handleSave
  }));

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-medium text-gray-700">Options</h4>
      </div>
      
      {/* Header row for price columns */}
      <div className="flex items-center space-x-2 text-xs text-gray-500 font-medium mb-1">
        <div className="flex-1 min-w-[120px] mr-2">Option Name</div>
        <div className="w-16 text-center">Price_Modi1</div>
        <div className="w-16 text-center">Price_Modi2</div>
        <div className="w-8"></div>
      </div>
      
      <div className="space-y-1">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center space-x-2">
            <div className="flex-1 min-w-[120px] mr-2">
              <input
                ref={(el) => { inputRefs.current[row.id] = el; }}
                type="text"
                value={row.name}
                onChange={(e) => handleInputChange(row.id, 'name', e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`${nameLabel} ${index + 1}`}
                className="w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-16">
              <input
                type="text"
                inputMode="decimal"
                value={row.rate}
                onChange={(e) => handleInputChange(row.id, 'rate', e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0"
                title="Price 1"
                className="w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
              />
            </div>
            <div className="w-16">
              <input
                type="text"
                inputMode="decimal"
                value={row.rate2 ?? ''}
                onChange={(e) => handleInputChange(row.id, 'rate2', e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0"
                title="Price 2"
                className="w-full p-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 border-green-200 text-center"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              disabled={rows.length === 1}
              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add Options button moved below the input fields */}
      <button
        type="button"
        onClick={addRow}
        className="mt-4 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
      >
        <Plus size={16} /> Add Options
      </button>

      <div className="flex justify-end space-x-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors disabled:opacity-50 flex items-center space-x-1"
        >
          {isLoading && <Loader2 size={14} className="animate-spin" />}
          <span>Save</span>
        </button>
      </div>
    </div>
  );
});

DynamicModifierForm.displayName = 'DynamicModifierForm';

export default DynamicModifierForm; 