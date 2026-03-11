import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard as KeyboardIcon } from 'lucide-react';

export interface SearchModalItem {
  id: string | number;
  name: string;
  short_name?: string;
  category?: string;
  price?: number;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: SearchModalItem[];
  onSelect: (item: SearchModalItem) => void;
  query: string;
  onChangeQuery: (value: string) => void;
  onOpenKeyboard: () => void;
  keyboardOpen?: boolean;
  itemsIndexed?: Array<{ id: string | number; name: string; short_name?: string; category?: string; price?: number; normName: string; normShort: string; normCat: string }>;
}

const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, items, onSelect, query, onChangeQuery, onOpenKeyboard, keyboardOpen = false, itemsIndexed }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && keyboardOpen && inputRef.current) {
      try {
        inputRef.current.focus();
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
      } catch {}
    }
  }, [keyboardOpen, isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const collator = new Intl.Collator(['ko', 'en'], { sensitivity: 'base', numeric: true });
    const base = (() => {
      if (!q) return items;
      if (itemsIndexed && itemsIndexed.length) {
        const matchedIds = new Set(
          itemsIndexed
            .filter(itx => itx.normName.includes(q) || itx.normShort.includes(q) || itx.normCat.includes(q))
            .map(itx => String(itx.id))
        );
        return items.filter(it => matchedIds.has(String(it.id)));
      }
      return items.filter(it => {
        const name = (it.name || '').toLowerCase();
        const shortName = (it.short_name || '').toLowerCase();
        const cat = (it.category || '').toLowerCase();
        return name.includes(q) || shortName.includes(q) || cat.includes(q);
      });
    })();
    const sorted = [...base].sort((a, b) => {
      const an = a.name || '';
      const bn = b.name || '';
      const primary = collator.compare(an, bn);
      if (primary !== 0) return primary;
      const asn = a.short_name || '';
      const bsn = b.short_name || '';
      const secondary = collator.compare(asn, bsn);
      if (secondary !== 0) return secondary;
      const ac = a.category || '';
      const bc = b.category || '';
      return collator.compare(ac, bc);
    });
    return sorted.slice(0, 500);
  }, [query, items, itemsIndexed]);

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) onSelect(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-8">
      <div className="bg-white rounded-xl p-4 w-[490px] max-w-[95vw] shadow-2xl relative">
        <button className="w-12 h-12 flex items-center justify-center rounded-full border-2 border-red-500 hover:border-red-600 active:border-red-700 absolute z-10" style={{ background: 'rgba(156,163,175,0.25)', top: '2px', right: '2px' }} onClick={onClose} title="Close"><svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="red" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold text-gray-900">Search Menu</h3>
        </div>
        <div className="mb-3">
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onChangeQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메뉴명, 약칭, 카테고리 검색"
              className="w-full h-12 rounded-lg border border-gray-300 pr-12 px-3 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-1 w-10 flex items-center justify-center text-gray-500 hover:text-gray-700"
              onClick={() => {
                try { inputRef.current?.focus(); } catch {}
                try { onOpenKeyboard(); } catch {}
              }}
              title="Open Keyboard"
            >
              <KeyboardIcon size={22} />
            </button>
          </div>
        </div>
        <div className={`max-h-[336px] overflow-y-auto rounded-lg border border-gray-200`}>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-gray-500">검색 결과가 없습니다.</div>
          ) : (
            <ul>
              {filtered.map((it, idx) => (
                <li key={String(it.id)}>
                  <button
                    className={`w-full h-12 px-3 flex items-center justify-between text-left ${idx === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    onClick={() => onSelect(it)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <div className="min-w-0">
                      <div className="text-gray-900 font-medium truncate">{it.name}</div>
                      <div className="text-xs text-gray-500 truncate">{it.short_name || ''} {it.category ? `• ${it.category}` : ''}</div>
                    </div>
                    <div className="text-gray-700 font-semibold whitespace-nowrap">{typeof it.price === 'number' ? `$${it.price.toFixed(2)}` : ''}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchModal;


