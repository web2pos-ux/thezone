import React, { useMemo, useState } from 'react';
import { PAY_NEO, PAY_NEO_CANVAS } from '../../utils/softNeumorphic';

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
  /** 모달 내부 등: #pos-canvas-anchor 기준 absolute 고정 대신 부모 플로우에 배치 */
  layoutMode?: 'canvasBottom' | 'parentFlow';
}

/** 눌림: 볼록 → inset 그림자 + 살짝 하강 (인라인 boxShadow는 active를 막으므로 class로만 그림자 처리) */
const keyPressFx =
  'transition-[box-shadow,transform] duration-100 ease-out [-webkit-tap-highlight-color:transparent] active:shadow-[inset_5px_5px_10px_#babecc,inset_-5px_-5px_10px_#ffffff] active:translate-y-px active:scale-[0.98]';

/** PAY_NEO.key와 동일 톤 */
const keyClass = `h-[53px] min-w-[48px] px-3 text-[17px] font-semibold select-none border-0 outline-none text-gray-800 touch-manipulation rounded-[10px] bg-[#e0e5ec] shadow-[4px_4px_8px_#c4c8d4,-4px_-4px_8px_#ffffff] ${keyPressFx}`;

/** PAY_NEO.raised와 동일 톤 */
const raisedClass = `h-[53px] min-w-[64px] px-3 text-[17px] font-semibold select-none border-0 outline-none text-gray-800 touch-manipulation rounded-[12px] bg-[#e0e5ec] shadow-[5px_5px_10px_#babecc,-5px_-5px_10px_#ffffff] ${keyPressFx}`;

/** PAY_KEYPAD_KEY와 동일 톤 (숫자 패드) */
const numpadKeyClass = `h-[53px] min-w-[48px] px-3 text-[17px] font-semibold select-none border-0 outline-none text-gray-800 touch-manipulation rounded-[10px] bg-[#d4d9e4] shadow-[5px_5px_10px_#b0b6c4,-4px_-4px_9px_#ffffff] ${keyPressFx}`;

const closeKeyClass = `flex h-9 min-w-[40px] items-center justify-center px-3 text-[15px] font-bold text-gray-700 touch-manipulation rounded-[12px] bg-[#e0e5ec] shadow-[5px_5px_10px_#babecc,-5px_-5px_10px_#ffffff] ${keyPressFx}`;

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
  layoutMode = 'canvasBottom',
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
  const anchorEl =
    layoutMode === 'parentFlow'
      ? null
      : typeof document !== 'undefined'
        ? (document.getElementById('pos-canvas-anchor') as HTMLElement | null)
        : null;

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    if (layoutMode === 'parentFlow') {
      return (
        <div className="w-full pointer-events-none" style={{ position: 'relative', zIndex }}>
          {children}
        </div>
      );
    }
    if (anchorEl) {
      return (
        <div
          className={'pointer-events-none'}
          style={{ position: 'absolute', left: 0, right: 0, bottom: bottomOffsetPx || 0, zIndex, paddingBottom: 'env(safe-area-inset-bottom)' }}
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
          className="mx-auto inline-block w-full max-w-[90vw] min-w-[600px] px-[2px] pointer-events-auto border-0 overflow-hidden rounded-t-2xl"
          style={{
            maxWidth: maxWidthPx ? `${maxWidthPx}px` : undefined,
            background: PAY_NEO_CANVAS,
            ...PAY_NEO.modalShell,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
        >
          {onRequestClose && (
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                className={closeKeyClass}
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
                        type="button"
                        className={keyClass}
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
                    type="button"
                    className={raisedClass}
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
                        type="button"
                        className={keyClass}
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
                    type="button"
                    className={`${raisedClass} w-[85px]`}
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
                    type="button"
                    className={raisedClass}
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
                        type="button"
                        className={keyClass}
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
                    type="button"
                    className={raisedClass}
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
                    type="button"
                    className={raisedClass}
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
                    type="button"
                    className={`${raisedClass} flex-none w-[262px] px-6`}
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
                    type="button"
                    className={raisedClass}
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
                    type="button"
                    className={raisedClass}
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
                        type="button"
                        className={isNumpadBackspace ? raisedClass : numpadKeyClass}
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


