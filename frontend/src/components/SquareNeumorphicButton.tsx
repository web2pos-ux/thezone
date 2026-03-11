import React from 'react';

type Props = {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  ariaLabel?: string;
  gradient?: string; // tailwind gradient classes for inner icon circle
  children?: React.ReactNode; // icon element
  compact?: boolean; // use compact height (h-10 instead of h-20)
};

const SquareNeumorphicButton: React.FC<Props> = ({ onClick, title, ariaLabel, gradient = 'from-pink-400 to-yellow-400', children, compact = false }) => {
  const heightClass = compact ? 'h-10' : 'h-20';
  const innerHeightClass = compact ? 'h-8' : 'h-11';
  const innerWidthClass = compact ? 'w-full' : 'w-11';
  const textSizeClass = compact ? 'text-xs' : 'text-2xl';

  return (
    <button
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      className={`square-neu flex items-center justify-center w-20 ${heightClass}`}
    >
      <div className={`${innerWidthClass} ${innerHeightClass} rounded-lg flex items-center justify-center bg-gradient-to-br ${gradient} px-1`}>
        <div className={`text-white ${textSizeClass} leading-none font-bold`}>{children}</div>
      </div>
    </button>
  );
};

export default SquareNeumorphicButton;
