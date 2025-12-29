import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CategoryModifierConnector from '../components/CategoryModifierConnector';
import { ArrowLeft, Loader2 } from 'lucide-react';

const CategoryConnectorPage: React.FC = () => {
  const { menuId } = useParams<{ menuId: string }>();
  const navigate = useNavigate();
  const [menuName, setMenuName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (menuId) {
      loadMenuInfo();
    }
  }, [menuId]);

  const loadMenuInfo = async () => {
    try {
      const response = await fetch(`http://localhost:3177/api/menus/${menuId}`);
      if (response.ok) {
        const menu = await response.json();
        setMenuName(menu.name);
      }
    } catch (error) {
      console.error('Failed to load menu info:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">메뉴 정보를 불러오는 중...</span>
      </div>
    );
  }

  if (!menuId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">메뉴 ID가 필요합니다</h1>
          <button
            onClick={() => navigate('/menus')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            메뉴 목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate(`/menus/${menuId}/edit`)}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>메뉴 편집으로 돌아가기</span>
              </button>
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-gray-900">
                {menuName} - 카테고리 옵션 연결
              </h1>
              <p className="text-sm text-gray-500">
                모디파이어 그룹을 드래그하여 카테고리에 연결하세요
              </p>
            </div>
            <div className="w-32"></div> {/* 균형을 위한 빈 공간 */}
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <CategoryModifierConnector menuId={parseInt(menuId)} />
    </div>
  );
};

export default CategoryConnectorPage; 