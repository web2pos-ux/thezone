import React, { useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { API_URL } from '../config/constants';

export interface PrinterRowData {
  id: string;
  name: string;
  ip_address?: string;
  selectedPrinter?: string;
  selected_printer?: string;
}

interface DynamicPrinterFormProps {
  initialData?: Omit<PrinterRowData, 'id'>[];
  onSave: (data: Omit<PrinterRowData, 'id'>[]) => void;
  isLoading: boolean;
  onCancel?: () => void;
}

const PRINTER_TYPES = ['RECEIPT', 'KDS', 'ORDER', 'LABEL', 'OTHER'];

const DynamicPrinterForm: React.FC<DynamicPrinterFormProps> = ({ 
  initialData = [], 
  onSave, 
  isLoading,
  onCancel
}) => {
  const [rows, setRows] = useState<PrinterRowData[]>([]);
  const [systemPrinters, setSystemPrinters] = useState<any[]>([]);
  const [loadingSystemPrinters, setLoadingSystemPrinters] = useState(false);

  useEffect(() => {
    // When initialData or systemPrinters changes, update the internal state
    const processedData = initialData.map(item => {
      // Find matching system printer for selectedPrinter field
      const matchingSystemPrinter = systemPrinters.find(sp => 
        sp.name === item.name || 
        (item.ip_address && sp.ip_address === item.ip_address)
      );
      
      return {
        ...item,
        id: nanoid(), // Assign a unique UI ID
        ip_address: item.ip_address || '',
        selectedPrinter: item.selected_printer || (matchingSystemPrinter ? matchingSystemPrinter.name : '')
      };
    });
    
    // Always ensure at least 2 empty rows are available for new groups
    const minRows = initialData.length > 0 ? 1 : 2;
    while (processedData.length < minRows) {
      processedData.push({ id: nanoid(), name: '', ip_address: '', selectedPrinter: '' });
    }
    
    setRows(processedData);
  }, [initialData, systemPrinters]);

  // Load system printers on component mount
  useEffect(() => {
    const fetchSystemPrinters = async () => {
      setLoadingSystemPrinters(true);
      try {
        const response = await fetch(`${API_URL}/printers/system`);
        if (response.ok) {
          const data = await response.json();
          setSystemPrinters(data);
        }
      } catch (error) {
        console.error('Failed to load system printers:', error);
      } finally {
        setLoadingSystemPrinters(false);
      }
    };

    fetchSystemPrinters();
  }, []);

  // Update selectedPrinter when systemPrinters are loaded
  useEffect(() => {
    if (systemPrinters.length > 0 && initialData.length > 0) {
      setRows(prevRows => prevRows.map(row => {
        if (row.name && !row.selectedPrinter) {
          // Find matching system printer for existing rows
          const matchingSystemPrinter = systemPrinters.find(sp => 
            sp.name === row.name || 
            (row.ip_address && sp.ip_address === row.ip_address)
          );
          return {
            ...row,
            selectedPrinter: matchingSystemPrinter ? matchingSystemPrinter.name : ''
          };
        }
        return row;
      }));
    }
  }, [systemPrinters, initialData]);

  // Auto-capitalize first letter and after spaces
  const capitalizeInput = (value: string): string => {
    return value.replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
  };

  const handleInputChange = (id: string, field: keyof Omit<PrinterRowData, 'id'>, value: string) => {
    const processedValue = field === 'name' ? capitalizeInput(value) : value;
    setRows(rows.map(row => (row.id === id ? { ...row, [field]: processedValue } : row)));
  };

  const addRow = () => {
    setRows([...rows, { id: nanoid(), name: '', ip_address: '', selectedPrinter: '' }]);
  };

  const removeRow = (id: string) => {
    // Always keep at least 1 row for existing groups, 2 rows for new groups
    const minRows = initialData.length > 0 ? 1 : 2;
    if (rows.length > minRows) {
      setRows(rows.filter(row => row.id !== id));
    }
  };

  const validateIpAddress = (ip: string): boolean => {
    if (!ip.trim()) return true; // IP address is optional
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    return ipRegex.test(ip.trim());
  };

  const handleSave = () => {
    // 1. Filter out "ghost rows" where name is empty (강제 필터링)
    let filteredRows = rows.filter(row => row.name && row.name.trim() !== '');
    // 혹시라도 중복된 이름이 있으면 한 번만 남기기 (선택적 안전장치)
    filteredRows = filteredRows.filter((row, idx, arr) =>
      arr.findIndex(r => r.name.trim() === row.name.trim()) === idx
    );

    // 2. Validate the remaining rows
    for (const row of filteredRows) {
      const name = row.name.trim();
      const ip_address = row.ip_address?.trim() || '';

      if (!name) {
        alert('Printer name is required for all entries.');
        return;
      }
      if (ip_address && !validateIpAddress(ip_address)) {
        alert(`Invalid IP address format for '${name}'. Please use format like 192.168.1.100`);
        return;
      }
    }

    // 3. Check for duplicate IP addresses (if provided)
    const ipAddresses = filteredRows
      .map(row => row.ip_address?.trim() || '')
      .filter(ip => ip !== '');
    const uniqueIps = new Set(ipAddresses);
    if (ipAddresses.length !== uniqueIps.size) {
      alert('Duplicate IP addresses are not allowed.');
      return;
    }

    // 4. Prepare data for saving (remove UI 'id')
    const dataToSave = filteredRows.map(({ id, ...rest }) => ({
      name: rest.name.trim(),
      ip_address: rest.ip_address?.trim() || undefined,
      selected_printer: rest.selectedPrinter || undefined,
    }));

    // 디버깅용: 실제로 저장되는 printers 배열을 콘솔에 출력
    console.log('최종 전송 printers:', dataToSave);

    onSave(dataToSave);
  };

  return (
    <>
      {/* 라벨을 전체 박스 바깥에 한 번만 표시 */}
      <div className="flex gap-x-0 mb-2 font-semibold text-gray-600 text-sm">
        <label className="w-full text-left pl-0 ml-0">Printer Name</label>
        <label className="w-full text-left pl-0 ml-0">Select</label>
        <div className="w-8" />
      </div>
      <div className="p-4 border rounded-lg">
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr,1fr,auto] gap-x-2 items-center">
              <input
                type="text"
                value={row.name}
                onChange={(e) => handleInputChange(row.id, 'name', e.target.value)}
                placeholder="e.g., Order Printer 1"
                className="p-2 border rounded-md w-full"
              />
              <select
                value={row.selectedPrinter || ''}
                onChange={(e) => {
                  const selectedPrinter = systemPrinters.find(p => p.name === e.target.value);
                  if (selectedPrinter) {
                    handleInputChange(row.id, 'name', selectedPrinter.name);
                    handleInputChange(row.id, 'ip_address', selectedPrinter.ip_address || '');
                  }
                  handleInputChange(row.id, 'selectedPrinter', e.target.value);
                }}
                className="p-2 border rounded-md w-full"
              >
                <option value="">Select System Printer</option>
                {systemPrinters.map((printer) => (
                  <option key={printer.name} value={printer.name}>{printer.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="p-2 text-red-500 hover:bg-red-100 rounded-full"
                onClick={() => removeRow(row.id)}
                disabled={isLoading}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => { console.log('Add More Printers 버튼 클릭됨'); addRow(); }}
          className="mt-4 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
        >
          <Plus size={16} /> Add More Printers
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
    </>
  );
};

export default DynamicPrinterForm; 