import React from 'react';
import { createPortal } from 'react-dom';
import VirtualKeyboard from '../order/VirtualKeyboard';
import { Keyboard as KeyboardIcon } from 'lucide-react';
import { PAY_NEO, PAY_NEO_CANVAS, PAY_NEO_PRIMARY_BLUE, NEO_PREP_TIME_BTN_PRESS_SNAP, NEO_COLOR_BTN_PRESS_SNAP } from '../../utils/softNeumorphic';

type FieldMode = 'text' | 'numeric';

export interface DualFieldKeyboardModalProps {
  isOpen: boolean;
  title?: string;
  field1: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    mode?: FieldMode;
    placeholder?: string;
  };
  field2?: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    mode?: FieldMode;
    placeholder?: string;
  };
  onSave: () => void;
  onCancel: () => void;
  languages?: string[];
  currentLanguage?: string;
  onToggleLanguage?: (next: string) => void;
  softKbTarget?: 'f1' | 'f2' | null;
  setSoftKbTarget?: (target: 'f1' | 'f2' | null) => void;
  kbBottomOffset?: number;
  offsetYPx?: number; // shift modal upward by pixels when centered
  /** PaymentModal과 동일 PAY_NEO 셸·inset·키 스타일 */
  usePayNeoShell?: boolean;
}

function KeyboardPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null as any;
  return createPortal(children as any, document.body);
}

export default function DualFieldKeyboardModal({
  isOpen,
  title = '',
  field1,
  field2,
  onSave,
  onCancel,
  languages = [],
  currentLanguage,
  onToggleLanguage,
  softKbTarget,
  setSoftKbTarget,
  kbBottomOffset = 0,
  offsetYPx = 0,
  usePayNeoShell = false,
}: DualFieldKeyboardModalProps) {
  const neo = !!usePayNeoShell;
  const VirtualKeyboardComponent = (VirtualKeyboard as unknown as React.ComponentType<any>);
  const f1Ref = React.useRef<HTMLInputElement | null>(null);
  const f2Ref = React.useRef<HTMLInputElement | null>(null);

  // Focus management when softKbTarget changes
  React.useEffect(() => {
    if (softKbTarget === 'f1' && f1Ref.current) {
      f1Ref.current.focus();
      f1Ref.current.setSelectionRange(f1Ref.current.value.length, f1Ref.current.value.length);
    } else if (softKbTarget === 'f2' && f2Ref.current) {
      f2Ref.current.focus();
      f2Ref.current.setSelectionRange(f2Ref.current.value.length, f2Ref.current.value.length);
    }
  }, [softKbTarget]);

  const displayText = (() => {
    if (softKbTarget === 'f1') return field1.value || '';
    return softKbTarget === 'f2' ? (field2 ? (field2.value || '') : '') : '';
  })();

  const sanitizeNumeric = (next: string, prev: string) => {
    const sanitized = next.replace(/[^0-9.]/g, '');
    const dotCount = (sanitized.match(/\./g) || []).length;
    if (dotCount > 1) return prev;
    return sanitized;
  };

  if (!isOpen) return null;

  const shellTransform = offsetYPx ? `translateY(-${offsetYPx}px)` : undefined;
  const inputClass = neo
    ? 'w-full rounded-[14px] px-3 py-2 pr-10 border-0 focus:outline-none focus:ring-2 focus:ring-blue-400/60'
    : 'w-full border border-gray-300 rounded px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-400';
  const kbIconWrapClass = neo
    ? `absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-[10px] hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS_SNAP}`
    : 'absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded';

  return (
    <>
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div
        id="dualfield-modal"
        className={
          neo
            ? 'w-[540px] max-h-[80vh] overflow-hidden relative'
            : 'bg-white rounded-lg p-6 w-[540px] max-h-[80vh] overflow-y-auto relative'
        }
        style={
          neo
            ? { ...PAY_NEO.modalShell, transform: shellTransform }
            : { transform: shellTransform }
        }
      >
        <button
          type="button"
          className={
            neo
              ? `w-11 h-11 flex items-center justify-center absolute z-10 touch-manipulation hover:brightness-[1.03] top-3 right-3 ${NEO_PREP_TIME_BTN_PRESS_SNAP}`
              : 'w-12 h-12 flex items-center justify-center rounded-full border-2 border-red-500 hover:border-red-600 active:border-red-700 absolute z-10'
          }
          style={neo ? { ...PAY_NEO.key, borderRadius: 12 } : { background: 'rgba(156,163,175,0.25)', top: '2px', right: '2px' }}
          onClick={() => { setSoftKbTarget && setSoftKbTarget(null); onCancel(); }}
          title="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={neo ? 'w-6 h-6' : 'w-7 h-7'} viewBox="0 0 24 24" fill="none" stroke={neo ? '#dc2626' : 'red'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        {neo ? (
          <div className="px-5 py-3 pr-14" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
            <h3 className="text-lg font-extrabold text-slate-800">{title}</h3>
          </div>
        ) : (
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          </div>
        )}
        <div
          className={neo ? 'p-5 space-y-3 overflow-y-auto max-h-[calc(80vh-7rem)]' : 'space-y-3'}
          style={neo ? { background: PAY_NEO_CANVAS } : undefined}
        >
          <div className="grid grid-cols-10 gap-3 items-end">
            <div className="col-span-7">
              <label className="block text-sm text-gray-700 mb-1">{field1.label}</label>
              <div className="relative">
              <input
                ref={f1Ref}
                value={field1.value}
                onChange={(e) => field1.onChange((field1.mode === 'numeric') ? sanitizeNumeric(e.target.value, field1.value) : e.target.value)}
                onFocus={() => { setSoftKbTarget && setSoftKbTarget('f1'); }}
                onMouseDown={(e) => { 
                  setSoftKbTarget && setSoftKbTarget('f1'); 
                  try { 
                    // 강제 포커스 이동
                    if (f1Ref.current) { f1Ref.current.focus(); setTimeout(()=>{ try { f1Ref.current && f1Ref.current.setSelectionRange((f1Ref.current.value||'').length, (f1Ref.current.value||'').length); } catch {} }, 0); }
                  } catch {}
                }}
                onTouchStart={(e) => { 
                  setSoftKbTarget && setSoftKbTarget('f1'); 
                  try { 
                    if (f1Ref.current) { f1Ref.current.focus(); setTimeout(()=>{ try { f1Ref.current && f1Ref.current.setSelectionRange((f1Ref.current.value||'').length, (f1Ref.current.value||'').length); } catch {} }, 0); }
                  } catch {}
                }}
                inputMode={field1.mode === 'numeric' ? 'decimal' : undefined}
                type="text"
                className={inputClass}
                style={neo ? PAY_NEO.inset : undefined}
                placeholder={field1.placeholder || ''}
              />
                 <button
                   type="button"
                   onClick={() => { 
                     setSoftKbTarget && setSoftKbTarget('f1');
                   }}
                   className={kbIconWrapClass}
                   style={neo ? PAY_NEO.key : undefined}
                   title="Open Virtual Keyboard"
                 >
                   <KeyboardIcon size={20} className="text-gray-500" />
                 </button>
              </div>
            </div>
            {field2 && (
            <div className="col-span-3">
              <label className="block text-sm text-gray-700 mb-1">{field2.label}</label>
              <div className="relative">
                <input
                  ref={f2Ref}
                  value={field2.value}
                  onChange={(e) => field2.onChange((field2.mode === 'numeric') ? sanitizeNumeric(e.target.value, field2.value) : e.target.value)}
                  onFocus={() => { setSoftKbTarget && setSoftKbTarget('f2'); }}
                  onMouseDown={(e) => { 
                    setSoftKbTarget && setSoftKbTarget('f2'); 
                    try { 
                      if (f2Ref.current) { f2Ref.current.focus(); setTimeout(()=>{ try { f2Ref.current && f2Ref.current.setSelectionRange((f2Ref.current.value||'').length, (f2Ref.current.value||'').length); } catch {} }, 0); }
                    } catch {}
                  }}
                  onTouchStart={(e) => { 
                    setSoftKbTarget && setSoftKbTarget('f2'); 
                    try { 
                      if (f2Ref.current) { f2Ref.current.focus(); setTimeout(()=>{ try { f2Ref.current && f2Ref.current.setSelectionRange((f2Ref.current.value||'').length, (f2Ref.current.value||'').length); } catch {} }, 0); }
                    } catch {}
                  }}
                  inputMode={field2.mode === 'numeric' ? 'decimal' : undefined}
                  type="text"
                  className={inputClass}
                  style={neo ? PAY_NEO.inset : undefined}
                  placeholder={field2.placeholder || ''}
                />
                 <button
                   type="button"
                   onClick={() => { 
                     setSoftKbTarget && setSoftKbTarget('f2');
                   }}
                   className={kbIconWrapClass}
                   style={neo ? PAY_NEO.key : undefined}
                   title="Open Virtual Keyboard"
                 >
                   <KeyboardIcon size={20} className="text-gray-500" />
                 </button>
              </div>
            </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setSoftKbTarget && setSoftKbTarget(null); onCancel(); }}
              className={
                neo
                  ? 'px-4 py-3 rounded-[14px] font-bold text-gray-700 touch-manipulation transition-[box-shadow,filter] duration-0 ease-out hover:brightness-[1.02] [-webkit-tap-highlight-color:transparent] active:!shadow-[inset_5px_5px_10px_#babecc,inset_-5px_-5px_10px_#ffffff] active:brightness-[0.93]'
                  : 'px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-800'
              }
              style={neo ? PAY_NEO.inset : undefined}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { setSoftKbTarget && setSoftKbTarget(null); onSave(); }}
              className={
                neo
                  ? `px-4 py-3 rounded-[14px] font-bold text-white touch-manipulation hover:brightness-[1.02] ${NEO_COLOR_BTN_PRESS_SNAP}`
                  : 'px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white'
              }
              style={neo ? PAY_NEO_PRIMARY_BLUE : undefined}
            >
              Save
            </button>
          </div>
        </div>
      </div>

    </div>
    {/* Virtual Keyboard Portal */}
    <KeyboardPortal>
      {VirtualKeyboardComponent && (
      <VirtualKeyboardComponent
        open={!!softKbTarget}
        centerOffsetPx={60}
        onType={(text: string) => {
          if (softKbTarget === 'f1') {
            const next = (field1.mode === 'numeric') ? sanitizeNumeric((field1.value || '') + text, field1.value) : ((field1.value || '') + text);
            field1.onChange(next);
          } else if (softKbTarget === 'f2' && field2) {
            const next = (field2.mode === 'numeric') ? sanitizeNumeric((field2.value || '') + text, field2.value) : ((field2.value || '') + text);
            field2.onChange(next);
          }
        }}
        onBackspace={() => {
          if (softKbTarget === 'f1') {
            field1.onChange((field1.value || '').slice(0, -1));
          } else if (softKbTarget === 'f2' && field2) {
            field2.onChange((field2.value || '').slice(0, -1));
          }
        }}
        onClear={() => {
          if (softKbTarget === 'f1') field1.onChange('');
          else if (softKbTarget === 'f2' && field2) field2.onChange('');
        }}
        onEnter={() => { 
          try { onSave(); } catch {}
          try { setSoftKbTarget && setSoftKbTarget(null); } catch {}
        }}
        onRequestClose={() => { setSoftKbTarget && setSoftKbTarget(null); }}
        zIndex={6000}
        languages={languages}
        currentLanguage={currentLanguage}
        onToggleLanguage={onToggleLanguage}
        displayText={displayText}
        center={true}
      />)}
    </KeyboardPortal>
    </>
  );
}






