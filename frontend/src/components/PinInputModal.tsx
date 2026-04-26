import React, { useState, useEffect } from 'react';
import {
  PAY_NEO,
  PAY_NEO_CANVAS,
  PAY_KEYPAD_KEY,
  OH_ACTION_NEO,
  PAY_NEO_PRIMARY_BLUE,
  NEO_MODAL_BTN_PRESS,
  NEO_PREP_TIME_BTN_PRESS,
  NEO_COLOR_BTN_PRESS_NO_SHIFT,
} from '../utils/softNeumorphic';

interface PinInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => void;
  title: string;
  message?: string;
  isLoading?: boolean;
  error?: string;
  /** 기본 4. 데모 백오피스 전용 길이(예: 10) 전달 시 해당 자리수까지 입력 후 제출 */
  pinLength?: number;
}

const PinInputModal: React.FC<PinInputModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  message,
  isLoading = false,
  error,
  pinLength = 4,
}) => {
  const [pin, setPin] = useState<string>('');
  const len = Math.max(4, Math.min(16, Math.floor(Number(pinLength)) || 4));

  useEffect(() => {
    if (isOpen) {
      setPin('');
    }
  }, [isOpen]);

  const handleSubmit = () => {
    if (pin.length === len) {
      onSubmit(pin);
    }
  };

  useEffect(() => {
    if (pin.length === len) {
      handleSubmit();
    }
  }, [pin, len]);

  const handleNumberClick = (number: string) => {
    if (pin.length < len) {
      setPin(pin + number);
    }
  };

  const handleClear = () => {
    setPin('');
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') {
      handleNumberClick(e.key);
    } else if (e.key === 'Backspace') {
      handleBackspace();
    } else if (e.key === 'Enter' && pin.length === len) {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  /** 패드·하단 — `active:brightness` 대신 인셋 오목 (위치 이동 없음은 컬러키에만 `NO_SHIFT`) */
  const padBase =
    'h-14 rounded-[10px] font-semibold touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-[1.02]';
  const padNeoPress = `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`;

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/50">
      <div
        className="w-96 max-w-[92vw] overflow-hidden outline-none"
        style={PAY_NEO.modalShell}
        onKeyDown={handleKeyPress}
        tabIndex={0}
      >
        <div
          className="px-5 py-4 flex items-start justify-between gap-2"
          style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}
        >
          <h2 className="text-xl font-extrabold text-slate-800 leading-tight pr-2">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className={`flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl border-[3px] border-red-500 transition-all hover:brightness-[1.03] disabled:opacity-50 disabled:translate-y-0 disabled:scale-100 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
            style={{ ...PAY_NEO.raised }}
            aria-label="Close"
            title="Close"
          >
            <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-5 pt-2" style={{ background: PAY_NEO_CANVAS }}>
          {message && (
            <p className="text-slate-600 mb-4 text-center text-sm font-medium">{message}</p>
          )}

          <div className="mb-5">
            <div
              className={`flex justify-center gap-2 flex-wrap ${len > 6 ? 'max-w-[22rem] mx-auto' : ''}`}
            >
              {Array.from({ length: len }, (_, index) => (
                <div
                  key={index}
                  style={PAY_NEO.inset}
                  className={`${len > 6 ? 'w-11 h-11 text-2xl' : 'w-14 h-14 text-3xl'} flex items-center justify-center rounded-[14px] ${
                    pin.length > index ? 'text-blue-700' : 'text-slate-400'
                  }`}
                >
                  {pin.length > index ? '•' : ''}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div
              className="mb-4 p-3 rounded-[14px] border border-red-200/80"
              style={PAY_NEO.inset}
            >
              <p className="text-red-600 text-center text-sm font-semibold">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mb-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleNumberClick(num)}
                disabled={isLoading}
                className={`${padBase} text-2xl text-gray-800 ${padNeoPress}`}
                style={PAY_KEYPAD_KEY}
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              disabled={isLoading}
              className={`${padBase} text-sm text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
              style={{ ...OH_ACTION_NEO.red, borderRadius: 10 }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleNumberClick('0')}
              disabled={isLoading}
              className={`${padBase} text-2xl text-gray-800 ${padNeoPress}`}
              style={PAY_KEYPAD_KEY}
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              disabled={isLoading}
              className={`${padBase} text-xl text-white ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
              style={{ ...OH_ACTION_NEO.orange, borderRadius: 10 }}
            >
              ⌫
            </button>
          </div>

          {isLoading && (
            <div className="flex justify-center items-center py-2 text-sm text-slate-600 font-medium">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
              <span className="ml-2">처리 중...</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className={`flex-1 touch-manipulation rounded-[14px] px-4 py-3 font-bold text-gray-700 hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${padNeoPress}`}
              style={PAY_NEO.key}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pin.length !== len || isLoading}
              className={`flex-1 touch-manipulation rounded-[14px] px-4 py-3 font-bold hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                pin.length === len && !isLoading ? NEO_COLOR_BTN_PRESS_NO_SHIFT : padNeoPress
              }`}
              style={
                pin.length !== len || isLoading
                  ? { ...PAY_NEO.inset, color: '#64748b' }
                  : PAY_NEO_PRIMARY_BLUE
              }
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PinInputModal;

