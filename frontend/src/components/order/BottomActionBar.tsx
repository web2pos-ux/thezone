import React from 'react';

interface BottomActionBarProps {
  onVoid?: () => void;
  onSplitOrder: () => void;
  onItemMemo: () => void;
  onOpenPrice: () => void;
  onSearch?: () => void;
  onDiscount?: () => void;
  onSoldOut?: () => void;
  onReprint?: () => void;
}

const btnClass = [
  "w-full py-1 flex items-center justify-center rounded-xl font-bold",
  "bg-[#e0e5ec] text-gray-600",
  "transition-all duration-150",
  "shadow-[6px_6px_12px_#b8bec7,_-6px_-6px_12px_#ffffff]",
  "hover:shadow-[8px_8px_16px_#b8bec7,_-8px_-8px_16px_#ffffff]",
  "active:shadow-[inset_4px_4px_8px_#b8bec7,_inset_-4px_-4px_8px_#ffffff]",
  "active:text-gray-500",
].join(" ");

const btnStyle: React.CSSProperties = {
  height: 'var(--bottom-bar-btn-height, clamp(44px, 6vh, 68px))',
  fontSize: 'var(--bottom-bar-btn-font, clamp(13px, 1.9vh, 17px))',
  lineHeight: '1.2',
  textAlign: 'center',
  minWidth: 0,
  wordBreak: 'keep-all',
};

const BottomActionBar: React.FC<BottomActionBarProps> = ({
  onVoid,
  onSplitOrder,
  onItemMemo,
  onOpenPrice,
  onSearch,
  onDiscount,
  onSoldOut,
  onReprint,
}) => {
  return (
    <div className="bottom-action-bar border-t-0 px-2 py-1 flex-shrink-0 bg-[#e0e5ec] rounded-xl">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 'clamp(4px, 0.8vh, 8px)' }}>
        <button className={btnClass} onClick={onReprint} style={btnStyle}>
          Reprint
        </button>

        <button className={btnClass} onClick={onVoid} style={btnStyle}>
          Void
        </button>

        <button className={btnClass} onClick={onSplitOrder} style={btnStyle}>
          Split<br/>Order
        </button>

        <button className={btnClass} onClick={onOpenPrice} style={btnStyle}>
          Open<br/>Price
        </button>

        <button className={btnClass} onClick={onDiscount} style={btnStyle}>
          D/C
        </button>

        <button className={btnClass} onClick={onItemMemo} style={btnStyle}>
          Kitchen<br/>Note
        </button>

        <button className={btnClass} onClick={onSearch} style={btnStyle}>
          Search
        </button>
      </div>
    </div>
  );
};

export default BottomActionBar;
