import React, { useState, useEffect } from 'react';

interface PinInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => void;
  title: string;
  message?: string;
  isLoading?: boolean;
  error?: string;
}

const PinInputModal: React.FC<PinInputModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  title,
  message,
  isLoading = false,
  error,
}) => {
  const [pin, setPin] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setPin('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (pin.length === 4) {
      handleSubmit();
    }
  }, [pin]);

  const handleSubmit = () => {
    if (pin.length === 4) {
      onSubmit(pin);
    }
  };

  const handleNumberClick = (number: string) => {
    if (pin.length < 4) {
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
    } else if (e.key === 'Enter' && pin.length === 4) {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="bg-white rounded-lg shadow-xl p-6 w-96"
        onKeyDown={handleKeyPress}
        tabIndex={0}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        {/* Message */}
        {message && (
          <p className="text-gray-600 mb-4 text-center">{message}</p>
        )}

        {/* PIN Display */}
        <div className="mb-6">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className={`w-14 h-14 rounded-lg border-2 flex items-center justify-center text-3xl ${
                  pin.length > index
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 bg-gray-50'
                }`}
              >
                {pin.length > index ? '•' : ''}
              </div>
            ))}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-center text-sm">{error}</p>
          </div>
        )}

        {/* Number Pad */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              onClick={() => handleNumberClick(num)}
              disabled={isLoading}
              className="h-14 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 rounded-lg text-2xl font-semibold text-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleClear}
            disabled={isLoading}
            className="h-14 bg-red-100 hover:bg-red-200 active:bg-red-300 rounded-lg text-sm font-semibold text-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <button
            onClick={() => handleNumberClick('0')}
            disabled={isLoading}
            className="h-14 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 rounded-lg text-2xl font-semibold text-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            disabled={isLoading}
            className="h-14 bg-yellow-100 hover:bg-yellow-200 active:bg-yellow-300 rounded-lg text-sm font-semibold text-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ⌫
          </button>
        </div>

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-center items-center py-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-gray-600">처리 중...</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={pin.length !== 4 || isLoading}
            className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

export default PinInputModal;

