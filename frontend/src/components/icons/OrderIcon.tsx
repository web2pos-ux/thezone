import React from 'react';

interface OrderIconProps {
  className?: string;
  size?: number;
}

const OrderIcon: React.FC<OrderIconProps> = ({ className = '', size = 20 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* POS 화면 배경 */}
      <rect x="3" y="3" width="18" height="18" rx="2" />
      
      {/* 9개의 작은 네모들 */}
      <rect x="6" y="6" width="3" height="3" />
      <rect x="10" y="6" width="3" height="3" />
      <rect x="14" y="6" width="3" height="3" />
      
      <rect x="6" y="10" width="3" height="3" />
      <rect x="10" y="10" width="3" height="3" />
      <rect x="14" y="10" width="3" height="3" />
      
      <rect x="6" y="14" width="3" height="3" />
      <rect x="10" y="14" width="3" height="3" />
      <rect x="14" y="14" width="3" height="3" />
    </svg>
  );
};

export default OrderIcon; 