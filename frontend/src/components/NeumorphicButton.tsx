import React from 'react';

type Props = {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
};

const sizeMap: Record<NonNullable<Props['size']>, string> = {
  sm: 'w-12 h-12 text-sm',
  md: 'w-14 h-14 text-base',
  lg: 'w-full py-3 text-lg',
};

const NeumorphicButton: React.FC<Props> = ({ children, icon, size = 'md', className = '', onClick, disabled, title }) => {
  const sizeCls = sizeMap[size];

  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`neu-square ${size === 'lg' ? 'rounded-xl px-4' : 'rounded-2xl'} ${sizeCls} flex items-center justify-center gap-2 disabled:opacity-60 ${className}`}
    >
      {icon && <span className="flex items-center justify-center">{icon}</span>}
      {children && <span className="leading-none">{children}</span>}
    </button>
  );
};

export default NeumorphicButton;
