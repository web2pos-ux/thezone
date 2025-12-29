import React, { useMemo, useState } from 'react';

export interface VirtualKeyboardProps {
  open: boolean;
  onType: (text: string) => void;
  onBackspace?: () => void;
  onClear?: () => void;
  onEnter?: () => void;
  onTab?: () => void;
  onRequestClose?: () => void;
  title?: string;
  bottomOffsetPx?: number;
  zIndex?: number;
  languages?: string[];
  currentLanguage?: string;
  onToggleLanguage?: (next: string) => void;
  displayText?: string;
  keepOpen?: boolean; // when true, ignore outside clicks (parent closes)
  showNumpad?: boolean; // show numeric pad on the right
  center?: boolean; // center on screen (ignore bottom offset)
  centerOffsetPx?: number; // when centered, shift down by pixels
  maxWidthPx?: number;
}

const keyStyle =
  'h-[53px] min-w-[48px] px-3 rounded bg-[#3a3a3a] hover:bg-[#4a4a4a] active:bg-red-600 text-white font-semibold select-none shadow-inner border-2 border-gray-300';

const controlKeyStyle =
  'h-[53px] min-w-[64px] px-3 rounded bg-[#111111] hover:bg-[#1f1f1f] active:bg-red-600 text-white font-semibold select-none shadow-inner border-2 border-gray-500';

export default function VirtualKeyboard({
  open,
  onType,
  onBackspace,
  onClear,
  onEnter,
  onTab,
  onRequestClose,
  title = 'Keyboard',
  bottomOffsetPx = 0,
  zIndex = 2000,
  languages = [],
  currentLanguage,
  onToggleLanguage,
  displayText = '',
  keepOpen = true,
  showNumpad = true,
  center = false,
  centerOffsetPx = 0,
  maxWidthPx = 900,
}: VirtualKeyboardProps) {
  const [shift, setShift] = useState<boolean>(false);
  const [symbolMode, setSymbolMode] = useState<boolean>(false);
  const [activeLang, setActiveLang] = useState<string>(currentLanguage || (languages[0] || 'EN'));
  const [autoShiftArmed, setAutoShiftArmed] = useState<boolean>(false);

  React.useEffect(() => {
    if (currentLanguage && currentLanguage !== activeLang) {
      setActiveLang(currentLanguage);
    } else if (!currentLanguage && languages.length > 0 && !languages.includes(activeLang)) {
      setActiveLang(languages[0]);
    }
  }, [currentLanguage, languages]);

  // Auto-shift on open: first alphabetic keypress uses uppercase, then disable shift
  React.useEffect(() => {
    if (open) {
      setShift(true);
      setAutoShiftArmed(true);
    } else {
      setAutoShiftArmed(false);
      setShift(false);
    }
  }, [open]);

  // Left: language-aware letter rows (EN default, KO supported)
  const alphaRows = useMemo(() => {
    if ((activeLang || '').toUpperCase() === 'KO') {
      const row1 = ['ㅂ','ㅈ','ㄷ','ㄱ','ㅅ','ㅛ','ㅕ','ㅑ','ㅐ','ㅔ'];
      const row2 = ['ㅁ','ㄴ','ㅇ','ㄹ','ㅎ','ㅗ','ㅓ','ㅏ','ㅣ'];
      const row3 = ['ㅋ','ㅌ','ㅊ','ㅍ','ㅠ','ㅜ','ㅡ'];
      return [row1, row2, row3];
    }
    const row1 = ['q','w','e','r','t','y','u','i','o','p'];
    const row2 = ['a','s','d','f','g','h','j','k','l'];
    const row3 = ['z','x','c','v','b','n','m'];
    return [row1, row2, row3];
  }, [activeLang]);

  const symbolRows = useMemo(() => {
    const row1 = ['1','2','3','4','5','6','7','8','9','0'];
    const row2 = ['@','#','$','%','&','*','-','+','(',')'];
    const row3 = ['!','"','\'',';','/',':','?'];
    return [row1, row2, row3];
  }, []);

  const numpadLayout = useMemo(() => (
    [
      ['1','2','3'],
      ['4','5','6'],
      ['7','8','9'],
      ['0','.', '⌫'],
    ]
  ), []);

  if (!open) return null;

  // Anchor to logical screen (canvasRef container) if available to keep at BO screen bottom
  const anchorEl = typeof document !== 'undefined' ? document.getElementById('pos-canvas-anchor') as HTMLElement | null : null;

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    if (anchorEl) {
      return (
        <div
          className={'pointer-events-none'}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex, paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {children}
        </div>
      );
    }
    return (
      <div
        className={'fixed inset-x-0 pointer-events-none'}
        style={{ bottom: bottomOffsetPx, zIndex, paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children}
      </div>
    );
  };

  return (
    <Wrapper>
      <div className={'w-full px-0 pb-2 flex justify-center pointer-events-none'} style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div
          className="bg-[#1f1f1f] text-white rounded-t-xl shadow-2xl border border-[#333] mx-auto inline-block w-full max-w-[90vw] min-w-[600px] px-[2px] pointer-events-auto"
          style={{ maxWidth: maxWidthPx ? `${maxWidthPx}px` : undefined }}
        >
          {onRequestClose && (
            <div className="flex justify-end px-2 pt-2">
              <button
                className="h-8 px-3 rounded bg-[#2f2f2f] hover:bg-[#3a3a3a] active:bg-red-600 text-white text-sm border border-gray-500"
                onClick={onRequestClose}
                title="Close"
              >
                ✕
              </button>
            </div>
          )}

          <div className="px-1 py-2 select-none">
            <div className="flex gap-2 justify-center w-full">
              <div className="flex flex-col items-center">
                {/* Left: English alpha rows */}
                <div className="flex gap-1.5 justify-center">
                  {alphaRows[0].map((raw) => {
                    const key = /[a-z]/i.test(raw) ? (shift ? raw.toUpperCase() : raw) : raw;
                    return (
                      <button
                        key={raw}
                        className={keyStyle}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onType(key);
                          if (autoShiftArmed && /[a-z]/i.test(raw)) {
                            setShift(false);
                            setAutoShiftArmed(false);
                          }
                        }}
                      >{key}</button>
                    );
                  })}
                  <button 
                    className={controlKeyStyle} 
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onBackspace && onBackspace();
                    }}
                  >⌫</button>
                </div>
                <div className="mt-1.5 flex gap-1.5 justify-center">
                  {alphaRows[1].map((raw) => {
                    const key = /[a-z]/i.test(raw) ? (shift ? raw.toUpperCase() : raw) : raw;
                    return (
                      <button
                        key={raw}
                        className={keyStyle}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onType(key);
                          if (autoShiftArmed && /[a-z]/i.test(raw)) {
                            setShift(false);
                            setAutoShiftArmed(false);
                          }
                        }}
                      >{key}</button>
                    );
                  })}
                  <button 
                    className={`${controlKeyStyle} w-[85px]`} 
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onEnter && onEnter();
                    }}
                  >ENTER</button>
                </div>
                <div className="mt-1.5 flex gap-1.5 justify-center">
                  <button 
                    className={controlKeyStyle} 
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTab && onTab();
                    }}
                  >Tab</button>
                  {alphaRows[2].map((raw) => {
                    const key = /[a-z]/i.test(raw) ? (shift ? raw.toUpperCase() : raw) : raw;
                    return (
                      <button
                        key={raw}
                        className={keyStyle}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onType(key);
                          if (autoShiftArmed && /[a-z]/i.test(raw)) {
                            setShift(false);
                            setAutoShiftArmed(false);
                          }
                        }}
                      >{key}</button>
                    );
                  })}
                  <button 
                    className={controlKeyStyle} 
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShift((s) => !s);
                    }}
                  >Shift</button>
                </div>

                {/* Bottom row: Space and Clear */}
                <div className="mt-3 flex gap-2 items-center justify-center w-full">
                  <button
                    className={controlKeyStyle}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onType('#');
                    }}
                  >
                    #
                  </button>
                  <button
                    className={`${controlKeyStyle} flex-none w-[262px] px-6`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onType(' ');
                    }}
                  >
                    Space
                  </button>
                  <button
                    className={controlKeyStyle}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onType('-');
                    }}
                  >
                    -
                  </button>
                  <button
                    className={controlKeyStyle}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const list = (languages || []).map((c) => (c || '').toUpperCase());
                        if (!list || list.length === 0) return;
                        const cur = (activeLang || 'EN').toUpperCase();
                        const idx = Math.max(0, list.indexOf(cur));
                        const next = list[(idx + 1) % list.length];
                        setActiveLang(next);
                        onToggleLanguage && onToggleLanguage(next);
                      } catch {}
                    }}
                    title="Toggle Language"
                  >
                    {String(activeLang || 'EN').toUpperCase()}
                  </button>
                </div>
              </div>

              {/* Right: Numeric pad */}
              {showNumpad && (
                <div className="grid grid-cols-3 gap-2 content-start min-w-[200px]">
                  {numpadLayout.flat().map((cell, idx) => {
                    const isNumpadBackspace = cell === '⌫';
                    return (
                      <button
                        key={`np-${idx}-${cell}`}
                        className={isNumpadBackspace ? controlKeyStyle : keyStyle}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (cell === '⌫') {
                            onBackspace && onBackspace();
                            return;
                          }
                          onType(cell);
                        }}
                      >{cell}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}


