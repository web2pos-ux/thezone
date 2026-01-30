import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * InitialSetupPage - Redirects to SetupPage
 * 모든 초기 설정은 SetupPage에서 통합 처리됩니다.
 */
const InitialSetupPage: React.FC = () => {
  const navigate = useNavigate();

  // Redirect to unified setup page
  useEffect(() => {
    console.log('🔄 InitialSetupPage: Redirecting to /setup...');
    navigate('/setup', { replace: true });
  }, [navigate]);

  // Show loading while redirecting
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-white/70 text-lg">Redirecting to Setup...</p>
      </div>
    </div>
  );
};

export default InitialSetupPage;
