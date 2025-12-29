import React from 'react';

interface MenuIconProps {
  className?: string;
  size?: number;
}

const MenuIcon: React.FC<MenuIconProps> = ({ className = '', size = 20 }) => {
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
      {/* 웍 - 깊고 둥근 모양, 기울어진 상태 */}
      <path d="M4 20 L20 20 L20 14 C20 12 18 10 12 10 C6 10 4 12 4 14 Z" />
      
      {/* 웍 손잡이 - 길고 직선 */}
      <line x1="20" y1="17" x2="24" y2="17" />
      
      {/* 웍 안의 음식들 - 작은 사각형들 */}
      <rect x="6" y="12" width="1" height="1" fill="currentColor" />
      <rect x="10" y="11" width="1" height="1" fill="currentColor" />
      <rect x="14" y="12" width="1" height="1" fill="currentColor" />
      <rect x="8" y="14" width="1" height="1" fill="currentColor" />
      <rect x="12" y="13" width="1" height="1" fill="currentColor" />
      <rect x="16" y="14" width="1" height="1" fill="currentColor" />
      
      {/* 날아가는 큰 음식 조각 - 곡선 */}
      <path d="M8 6 Q10 4 12 6 Q14 4 16 6" stroke="currentColor" fill="none" strokeWidth="3" />
      
      {/* 날아가는 작은 음식들 */}
      <rect x="7" y="4" width="1" height="1" fill="currentColor" />
      <rect x="11" y="2" width="1" height="1" fill="currentColor" />
      <rect x="15" y="4" width="1" height="1" fill="currentColor" />
      
      {/* 움직임 표시 - 점선 */}
      <line x1="6" y1="8" x2="8" y2="8" strokeDasharray="1 1" />
      <line x1="10" y1="6" x2="12" y2="6" strokeDasharray="1 1" />
      <line x1="14" y1="8" x2="16" y2="8" strokeDasharray="1 1" />
    </svg>
  );
};

export default MenuIcon; 