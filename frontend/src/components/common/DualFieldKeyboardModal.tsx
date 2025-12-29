import React from 'react';
import { createPortal } from 'react-dom';
import VirtualKeyboard from '../order/VirtualKeyboard';
import { Keyboard as KeyboardIcon } from 'lucide-react';

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
}: DualFieldKeyboardModalProps) {
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

  return (
    <>
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg p-6 w-[540px] max-h-[80vh] overflow-y-auto" id="dualfield-modal" style={{ transform: offsetYPx ? `translateY(-${offsetYPx}px)` : undefined }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          <button onClick={() => { setSoftKbTarget && setSoftKbTarget(null); onCancel(); }} className="text-gray-600 hover:text-gray-800 text-3xl font-bold w-10 h-10 flex items-center justify-center">×</button>
        </div>
        <div className="space-y-3">
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
                className="w-full border border-gray-300 rounded px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder={field1.placeholder || ''}
              />
                 <button
                   type="button"
                   onClick={() => { 
                     setSoftKbTarget && setSoftKbTarget('f1');
                   }}
                   className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
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
                  className="w-full border border-gray-300 rounded px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder={field2.placeholder || ''}
                />
                 <button
                   type="button"
                   onClick={() => { 
                     setSoftKbTarget && setSoftKbTarget('f2');
                   }}
                   className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
                   title="Open Virtual Keyboard"
                 >
                   <KeyboardIcon size={20} className="text-gray-500" />
                 </button>
              </div>
            </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setSoftKbTarget && setSoftKbTarget(null); onCancel(); }} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">Cancel</button>
            <button onClick={() => { setSoftKbTarget && setSoftKbTarget(null); onSave(); }} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Save</button>
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






