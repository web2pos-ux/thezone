import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard as KeyboardIcon } from 'lucide-react';
import { PAY_NEO, PAY_NEO_CANVAS, NEO_PREP_TIME_BTN_PRESS_SNAP } from '../utils/softNeumorphic';

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black bg-opacity-50 pt-8">
      <div
        className="relative w-[490px] max-w-[95vw] overflow-hidden"
        style={PAY_NEO.modalShell}
      >
        <button
          type="button"
          className={`absolute right-3 top-3 z-10 flex h-11 w-11 touch-manipulation items-center justify-center rounded-[10px] hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
          style={{ ...PAY_NEO.key, borderRadius: 10 }}
          onClick={onClose}
          title="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div className="px-5 py-3 pr-14" style={{ ...PAY_NEO.raised, borderRadius: '16px 16px 0 0' }}>
          <h3 className="text-lg font-extrabold text-slate-800">Search Menu</h3>
        </div>
        <div className="space-y-3 p-4" style={{ background: PAY_NEO_CANVAS }}>
          <div className="relative rounded-[14px] focus-within:ring-2 focus-within:ring-blue-400/50 focus-within:ring-offset-2 focus-within:ring-offset-[#e0e5ec]">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onChangeQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="메뉴명, 약칭, 카테고리 검색"
              className="h-12 w-full rounded-[14px] border-0 bg-transparent pr-12 pl-3 text-base text-gray-900 outline-none focus:ring-0"
              style={PAY_NEO.inset}
            />
            <button
              type="button"
              className={`absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-[10px] text-gray-600 hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
              style={PAY_NEO.key}
              onClick={() => {
                try { inputRef.current?.focus(); } catch {}
                try { onOpenKeyboard(); } catch {}
              }}
              title="Open Keyboard"
            >
              <KeyboardIcon size={22} />
            </button>
          </div>
          <div
            className="max-h-[336px] space-y-1 overflow-y-auto rounded-[14px] p-1"
            style={PAY_NEO.inset}
          >
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-gray-500">검색 결과가 없습니다.</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((it, idx) => (
                  <li key={String(it.id)}>
                    <button
                      type="button"
                      className={`flex min-h-12 w-full items-center justify-between rounded-[10px] px-3 py-2 text-left touch-manipulation hover:brightness-[1.02] ${NEO_PREP_TIME_BTN_PRESS_SNAP} ${idx === activeIndex ? 'ring-2 ring-blue-400/70 ring-offset-2 ring-offset-[#e0e5ec]' : ''}`}
                      style={idx === activeIndex ? PAY_NEO.inset : PAY_NEO.key}
                      onClick={() => onSelect(it)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900">{it.name}</div>
                        <div className="truncate text-xs text-gray-500">{it.short_name || ''} {it.category ? `• ${it.category}` : ''}</div>
                      </div>
                      <div className="whitespace-nowrap font-semibold text-gray-700">{typeof it.price === 'number' ? `$${it.price.toFixed(2)}` : ''}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchModal;


