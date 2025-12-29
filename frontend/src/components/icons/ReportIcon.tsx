import React from 'react';

interface ReportIconProps {
  className?: string;
  size?: number;
}

const ReportIcon: React.FC<ReportIconProps> = ({ className = '', size = 20 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Y축 */}
      <line x1="4" y1="20" x2="4" y2="4" />
      <polyline points="4,4 2,6 4,8 6,6" />
      
      {/* X축 */}
      <line x1="4" y1="20" x2="20" y2="20" />
      <polyline points="20,20 18,18 20,16 22,18" />
      
      {/* 라인 차트 데이터 포인트들 */}
      <circle cx="6" cy="16" r="1" fill="currentColor" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <circle cx="18" cy="8" r="1" fill="currentColor" />
      
      {/* 라인 차트 선 */}
      <path d="M6 16 L9 14 L12 12 L15 10 L18 8" stroke="currentColor" fill="none" />
    </svg>
  );
};

export default ReportIcon; 