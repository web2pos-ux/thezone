import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { API_URL } from '../../config/constants';

interface TableElement {
  id: number;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  text?: string;
  fontSize?: number;
  color?: string;
  status?: string;
}

interface TableSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTableSelect: (tableId: number, tableName: string) => void;
  onTableStatusChange?: (tableId: number, tableName: string, status: 'Occupied' | 'Reserved' | 'Hold', customerName?: string) => void;
  partySize?: number;
  customerName?: string;
}

const TableSelectionModal: React.FC<TableSelectionModalProps> = ({
  isOpen,
  onClose,
  onTableSelect,
  onTableStatusChange,
  partySize = 1,
  customerName = 'Guest'
}) => {
  const [tables, setTables] = useState<TableElement[]>([]);
  const [loading, setLoading] = useState(false);

  // 테이블 상태별 색상 정의
  const getTableStatusColor = (status: string) => {
    const normalizedStatus = (status || '').toLowerCase();
    switch (normalizedStatus) {
      case 'available':
        return '#22C55E'; // 초록색
      case 'preparing':
        return '#F97316'; // 주황색
      case 'occupied':
        return '#EF4444'; // 빨간색
      case 'reserved':
        return '#EAB308'; // 노란색
      case 'hold':
        return '#EAB308'; // 노란색 (그라데이션 적용)
      default:
        return '#6B7280'; // 회색
    }
  };

  const getTableStatusText = (status: string) => {
    const normalizedStatus = (status || '').toLowerCase();
    switch (normalizedStatus) {
      case 'available':
        return 'Available';
      case 'preparing':
        return 'Preparing';
      case 'occupied':
        return 'Occupied';
      case 'reserved':
        return 'Reserved';
      default:
        return status || 'Unknown';
    }
  };

  // 테이블 목록 가져오기
  const fetchTables = async () => {
    setLoading(true);
    try {
      // 먼저 1F에서 테이블을 가져와보기
      console.log('Fetching tables from floor 1F...');
      const response = await fetch(`${API_URL}/table-map/elements?floor=1F`);
      
      if (!response.ok) {
        console.error('API response not ok:', response.status, response.statusText);
        throw new Error(`Failed to fetch tables: ${response.status} ${response.statusText}`);
      }
      
      const allTables = await response.json();
      console.log('Raw API response from 1F:', allTables);
      console.log('Number of tables received:', allTables.length);
      
      if (!Array.isArray(allTables)) {
        console.error('API response is not an array:', typeof allTables);
        setTables([]);
        return;
      }
      
      // 각 테이블의 상세 정보 로그
      allTables.forEach((table, index) => {
        console.log(`Table ${index}:`, {
          id: table.id,
          text: table.text,
          type: table.type,
          status: table.status,
          position: table.position,
          size: table.size,
          floor: table.floor
        });
      });
      
      // 테이블 타입 필터링 (rounded-rectangle 또는 circle)
      const tableTypeFiltered = allTables.filter((table: TableElement) => {
        const isValidType = table.type === 'rounded-rectangle' || table.type === 'circle';
        console.log(`Table ${table.id} type check: "${table.type}" -> ${isValidType}`);
        return isValidType;
      });
      console.log('Tables after type filtering:', tableTypeFiltered.length, 'tables');
      
      // Available과 Preparing 상태의 테이블만 필터링
      const availableTables = tableTypeFiltered.filter((table: TableElement) => {
        const originalStatus = table.status;
        const status = (originalStatus || '').toLowerCase();
        const isAvailableOrPreparing = status === 'available' || status === 'preparing';
        console.log(`Table ${table.id} (${table.text}): originalStatus="${originalStatus}" -> normalized="${status}" -> isAvailableOrPreparing=${isAvailableOrPreparing}`);
        return isAvailableOrPreparing;
      });
      
      console.log('Final filtered tables count:', availableTables.length);
      console.log('Final filtered tables:', availableTables);
      
      // 만약 필터링된 테이블이 없다면, 모든 테이블을 다시 확인
      if (availableTables.length === 0) {
        console.warn('No tables found after filtering. Checking all table statuses:');
        tableTypeFiltered.forEach(table => {
          console.warn(`Table ${table.id}: type="${table.type}", status="${table.status}"`);
        });
      }
      
      setTables(availableTables);
    } catch (error) {
      console.error('Error fetching tables:', error);
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTables();
    }
  }, [isOpen]);


  // 테이블 상태 변경 함수
  const handleTableStatusChange = async (tableId: number, newStatus: 'Occupied' | 'Reserved' | 'Hold') => {
    try {
      const response = await fetch(`${API_URL}/table-map/elements/${tableId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        // 테이블 이름 찾기
        const table = tables.find(t => t.id === tableId);
        const tableName = table?.text || `Table ${tableId}`;
        
        // 부모 컴포넌트에 상태 변경 알림
        if (onTableStatusChange) {
          onTableStatusChange(tableId, tableName, newStatus, customerName);
        }
        
        // 테이블 목록에서 해당 테이블 제거 (더 이상 선택 가능하지 않음)
        setTables(prev => prev.filter(table => table.id !== tableId));
      } else {
        throw new Error('Failed to update table status');
      }
    } catch (error) {
      console.error('Error updating table status:', error);
      alert('Failed to update table status. Please try again.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80]">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              Select Table for Arrived Guest
            </h2>
            <div className="mt-2 text-lg text-gray-600">
              <span className="font-semibold">{customerName}</span> • Party of {partySize}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-lg text-gray-600">Loading tables...</div>
            </div>
          ) : (
            <div className="p-6">
              <div className="mb-4">
                <p className="text-sm text-gray-500">
                  Select an available or preparing table for the arrived guest
                </p>
              </div>

              {tables.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-500 text-lg mb-2">No available tables</div>
                  <div className="text-gray-400 text-sm">
                    All tables are currently occupied or reserved
                  </div>
                  <div className="text-gray-400 text-xs mt-2">
                    Check console for debugging information
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
                  {tables.map((table) => (
                    <div
                      key={table.id}
                      className="relative p-4 border-2 border-gray-200 rounded-lg transition-all duration-200"
                    >
                      {/* Table Visual */}
                      <div className="flex items-center justify-center mb-3">
                        <div
                          className={`
                            ${table.type === 'circle' ? 'rounded-full' : 'rounded-lg'}
                            border-4 flex items-center justify-center text-white font-bold
                          `}
                          style={{
                            width: '80px',
                            height: '80px',
                            backgroundColor: getTableStatusColor(table.status || 'available'),
                            background: (table.status || '').toLowerCase() === 'hold' ? 
                              '#EAB308' :
                              getTableStatusColor(table.status || 'available'),
                            borderColor: (table.status || '').toLowerCase() === 'hold' ? '#F97316' : getTableStatusColor(table.status || 'available')
                          }}
                        >
                          {table.text || table.id}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTableStatusChange(table.id, 'Occupied');
                          }}
                          className="w-20 px-2 py-4 text-xs font-semibold text-red-600 bg-transparent border-2 border-red-600 rounded-lg hover:bg-red-50 active:bg-red-100 transition-colors min-h-[48px] flex items-center justify-center"
                        >
                          Occupied
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Available 테이블은 Reserved로, Preparing 테이블은 Hold로 변경
                            const currentStatus = (table.status || '').toLowerCase();
                            const newStatus = currentStatus === 'available' ? 'Reserved' : 'Hold';
                            handleTableStatusChange(table.id, newStatus);
                          }}
                          className="w-20 px-2 py-4 text-xs font-semibold text-yellow-600 bg-transparent border-2 border-yellow-600 rounded-lg hover:bg-yellow-50 active:bg-yellow-100 transition-colors min-h-[48px] flex items-center justify-center"
                        >
                          Hold
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TableSelectionModal;
