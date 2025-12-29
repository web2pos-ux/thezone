import React from 'react';

interface BottomActionBarProps {
  onVoid?: () => void;
  onSplitOrder: () => void;
  onItemMemo: () => void;
  onOpenPrice: () => void;
  onSearch?: () => void;
  onDiscount?: () => void;
  onSoldOut?: () => void;
}

const BottomActionBar: React.FC<BottomActionBarProps> = ({
  onVoid,
  onSplitOrder,
  onItemMemo,
  onOpenPrice,
  onSearch,
  onDiscount,
  onSoldOut,
}) => {
  return (
    <div className="bottom-action-bar border-t-0 pl-2 pr-1 py-0.5 flex-shrink-0">
      <div className="grid grid-cols-7 gap-0 w-full">
        
          <button
            className="w-full h-[50px] rounded-lg bg-gray-500 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-gray-600 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
            onClick={onVoid}
          >
            Void
          </button>

          <button
            onClick={onSplitOrder}
            className="w-full h-[50px] rounded-lg bg-blue-800 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-blue-900 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
          >
            Split Order
          </button>


          <button
            className="w-full h-[50px] rounded-lg bg-blue-800 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-blue-900 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
            onClick={onOpenPrice}
          >
            Open Price
          </button>


          <button
            className="w-full h-[50px] rounded-lg bg-gray-500 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-gray-600 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
            onClick={onDiscount}
          >
            D/C
          </button>

          <button
            className="w-full h-[50px] rounded-lg bg-gray-500 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-gray-600 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
            onClick={onSoldOut}
          >
            Sold Out
          </button>
          <button
            className="w-full h-[50px] rounded-lg bg-gray-500 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-gray-600 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
            onClick={onItemMemo}
          >
            Kitchen Note
          </button>
          <button
            className="w-full h-[50px] rounded-lg bg-gray-500 text-white text-[15px] font-semibold flex items-center justify-center text-center leading-tight hover:bg-gray-600 transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20"
            onClick={onSearch}
          >
            Search
          </button>
      </div>
    </div>
  );
};

export default BottomActionBar; 