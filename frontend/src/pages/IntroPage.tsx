import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const IntroPage: React.FC = () => {
  const [pin, setPin] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const navigate = useNavigate();

  const handlePinInput = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      
      if (newPin.length === 4) {
        handlePinSubmit(newPin);
      }
    }
  };

  const handlePinSubmit = (submittedPin: string) => {
    if (submittedPin === '0000') {
      // Sales Page로 이동
      navigate('/sales');
    } else if (submittedPin === '1111') {
      // Back Office로 이동
      navigate('/backoffice/tables');
    } else {
      setMessage('잘못된 PIN입니다. 다시 시도해주세요.');
      setTimeout(() => {
        setPin('');
        setMessage('');
      }, 2000);
    }
  };

  const handleClear = () => {
    setPin('');
    setMessage('');
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  useEffect(() => {
    // PIN이 4자리가 되면 자동으로 제출
    if (pin.length === 4) {
      handlePinSubmit(pin);
    }
  }, [pin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      {/* 배경 이미지와 블러 효과 */}
      <div className="absolute inset-0 z-0">
        <div 
          className="w-full h-full bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url("/images/intro.jpg")',
            filter: 'blur(8px) brightness(0.3) saturate(1.2)'
          }}
        />
      </div>

      {/* 메인 콘텐츠 */}
      <div className="relative z-10 text-center">
        {/* 로고 */}
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-white mb-2 drop-shadow-2xl">
            The Zone POS
          </h1>
          <p className="text-3xl text-blue-200 font-bold">
            One Touch, So Much
          </p>
        </div>

        {/* PIN 입력 표시 */}
        <div className="mb-8">
          <div className="flex justify-center space-x-4 mb-4">
            {[...Array(4)].map((_, index) => (
              <div
                key={index}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                  index < pin.length
                    ? 'bg-white border-white'
                    : 'border-white/50'
                }`}
              />
            ))}
          </div>
          {message && (
            <p className="text-red-300 text-lg font-medium">{message}</p>
          )}
        </div>

        {/* PIN 패드 */}
        <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/20 shadow-2xl">
          <div className="grid grid-cols-3 gap-4 max-w-xs mx-auto">
            {/* 숫자 버튼들 */}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handlePinInput(num.toString())}
                className="w-16 h-16 bg-white/20 hover:bg-white/30 text-white text-2xl font-bold rounded-full border border-white/30 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
              >
                {num}
              </button>
            ))}
            
            {/* Clear 버튼 */}
            <button
              onClick={handleClear}
              className="w-16 h-16 bg-red-500/80 hover:bg-red-500 text-white text-sm font-bold rounded-full border border-red-400/50 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              Clear
            </button>
            
            {/* 0 버튼 */}
            <button
              onClick={() => handlePinInput('0')}
              className="w-16 h-16 bg-white/20 hover:bg-white/30 text-white text-2xl font-bold rounded-full border border-white/30 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              0
            </button>
            
            {/* Backspace 버튼 */}
            <button
              onClick={handleBackspace}
              className="w-16 h-16 bg-yellow-500/80 hover:bg-yellow-500 text-white text-xl font-bold rounded-full border border-yellow-400/50 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              ←
            </button>
          </div>
        </div>

        {/* 안내 메시지 */}
        <div className="mt-8 text-white/80 text-sm">
          <p>PIN: 0000 (Sales) | 1111 (Back Office)</p>
        </div>
      </div>
    </div>
  );
};

export default IntroPage; 