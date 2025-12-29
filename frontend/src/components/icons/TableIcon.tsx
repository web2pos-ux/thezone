import React from 'react';

interface TableIconProps {
  className?: string;
  size?: number;
}

const TableIcon: React.FC<TableIconProps> = ({ className = '', size = 20 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* 배경 사각형 (테이블 맵 영역) */}
      <rect x="3" y="2" width="20" height="20" rx="2" strokeDasharray="2 2" />
      
      {/* 테이블 1 (좌상단) */}
      <circle cx="8" cy="7" r="2" />
      <line x1="8" y1="9" x2="8" y2="11" />
      
      {/* 테이블 2 (우상단) */}
      <circle cx="18" cy="7" r="2" />
      <line x1="18" y1="9" x2="18" y2="11" />
      
      {/* 테이블 3 (중앙) */}
      <circle cx="13" cy="12" r="2" />
      <line x1="13" y1="14" x2="13" y2="16" />
      
      {/* 테이블 4 (좌하단) */}
      <circle cx="8" cy="17" r="2" />
      <line x1="8" y1="19" x2="8" y2="21" />
      
      {/* 테이블 5 (우하단) */}
      <circle cx="18" cy="17" r="2" />
      <line x1="18" y1="19" x2="18" y2="21" />
    </svg>
  );
};

export default TableIcon; 