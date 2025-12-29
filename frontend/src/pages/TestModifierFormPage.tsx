import React, { useState } from 'react';
import DynamicModifierForm from '../components/DynamicModifierForm';

const TestModifierFormPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [savedData, setSavedData] = useState<any[]>([]);

  const handleSave = (data: any[]) => {
    setIsLoading(true);
    console.log('Saving data:', data);
    
    // 실제 저장 로직 시뮬레이션
    setTimeout(() => {
      setSavedData(data);
      setIsLoading(false);
      alert('데이터가 저장되었습니다!');
    }, 1000);
  };

  const handleCancel = () => {
    console.log('Cancel clicked');
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          DynamicModifierForm 테스트 페이지
        </h1>
        
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">모디파이어 옵션 관리</h2>
          
          <DynamicModifierForm
            initialData={[
              { name: '사이즈 업', rate: 1.50 },
              { name: '추가 토핑', rate: 0.75 }
            ]}
            onSave={handleSave}
            isLoading={isLoading}
            fieldConfig={{
              nameLabel: '옵션명',
              rateLabel: '추가 가격 ($)'
            }}
            onCancel={handleCancel}
          />
        </div>

        {savedData.length > 0 && (
          <div className="mt-8 bg-green-50 border border-green-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-green-800 mb-4">저장된 데이터:</h3>
            <pre className="text-sm text-green-700 bg-green-100 p-4 rounded overflow-x-auto">
              {JSON.stringify(savedData, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default TestModifierFormPage; 