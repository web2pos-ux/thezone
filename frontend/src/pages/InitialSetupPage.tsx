import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';

interface ServiceOption {
  type: 'QSR' | 'FSR';
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  icon: React.ReactNode;
  gradient: string;
  examples: string;
}

const InitialSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<'QSR' | 'FSR' | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  const serviceOptions: ServiceOption[] = [
    {
      type: 'QSR',
      title: 'Quick Service',
      subtitle: 'QSR Mode',
      description: 'Fast casual, café, and counter service restaurants',
      features: [
        'Counter-based ordering',
        'Order number system',
        'Fast checkout flow',
        'No table management',
        'For Here / To-Go options',
        'Kitchen display ready'
      ],
      icon: (
        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
            d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      gradient: 'from-amber-500 via-orange-500 to-red-500',
      examples: 'Coffee shops, Fast food, Bakeries, Food trucks'
    },
    {
      type: 'FSR',
      title: 'Full Service',
      subtitle: 'FSR Mode',
      description: 'Traditional dine-in restaurants with table service',
      features: [
        'Table map management',
        'Guest splitting',
        'Server assignments',
        'Course ordering',
        'Reservation support',
        'Pay-at-table ready'
      ],
      icon: (
        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
            d="M3 3h18v18H3V3zm3 6h12M6 15h12M12 9v6" />
        </svg>
      ),
      gradient: 'from-blue-500 via-indigo-500 to-purple-500',
      examples: 'Fine dining, Casual dining, Bars, Family restaurants'
    }
  ];

  const handleTypeSelect = (type: 'QSR' | 'FSR') => {
    setSelectedType(type);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!selectedType) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/admin-settings/service-type`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Role': 'MANAGER'
        },
        body: JSON.stringify({ 
          serviceType: selectedType,
          businessName: businessName.trim()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      const data = await response.json();
      
      if (data.success) {
        // Navigate based on service type
        if (selectedType === 'QSR') {
          navigate('/qsr');
        } else {
          navigate('/sales');
        }
      } else {
        throw new Error(data.error || 'Failed to save settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setStep(1);
    setSelectedType(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-6 shadow-2xl shadow-purple-500/25">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
            Welcome to <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">WEB2POS</span>
          </h1>
          <p className="text-slate-400 text-lg">
            {step === 1 ? 'Choose your restaurant service type to get started' : 'Almost there! Enter your business name'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
              step >= 1 ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white' : 'bg-slate-700 text-slate-400'
            }`}>
              1
            </div>
            <div className={`w-16 h-1 rounded-full transition-all ${
              step >= 2 ? 'bg-gradient-to-r from-blue-500 to-purple-500' : 'bg-slate-700'
            }`} />
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
              step >= 2 ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white' : 'bg-slate-700 text-slate-400'
            }`}>
              2
            </div>
          </div>
        </div>

        {/* Step 1: Service Type Selection */}
        {step === 1 && (
          <div className="grid md:grid-cols-2 gap-6 animate-fadeIn">
            {serviceOptions.map((option) => (
              <button
                key={option.type}
                onClick={() => handleTypeSelect(option.type)}
                className={`group relative bg-slate-800/50 backdrop-blur-xl rounded-3xl p-8 border-2 border-slate-700/50 hover:border-transparent transition-all duration-300 text-left overflow-hidden hover:shadow-2xl hover:-translate-y-1`}
              >
                {/* Gradient overlay on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${option.gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`} />
                
                {/* Icon */}
                <div className={`inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br ${option.gradient} text-white mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  {option.icon}
                </div>

                {/* Title */}
                <div className="mb-4">
                  <h2 className="text-2xl font-bold text-white mb-1">{option.title}</h2>
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r ${option.gradient} text-white`}>
                    {option.subtitle}
                  </span>
                </div>

                {/* Description */}
                <p className="text-slate-400 mb-6">{option.description}</p>

                {/* Features */}
                <ul className="space-y-2 mb-6">
                  {option.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-slate-300">
                      <svg className={`w-4 h-4 flex-shrink-0 bg-gradient-to-r ${option.gradient} rounded-full p-0.5 text-white`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Examples */}
                <div className="pt-4 border-t border-slate-700/50">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold">Examples:</span> {option.examples}
                  </p>
                </div>

                {/* Arrow indicator */}
                <div className="absolute bottom-8 right-8 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Business Name */}
        {step === 2 && selectedType && (
          <div className="max-w-lg mx-auto animate-fadeIn">
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-3xl p-8 border border-slate-700/50">
              {/* Selected type badge */}
              <div className="flex items-center justify-center mb-6">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r ${
                  selectedType === 'QSR' ? 'from-amber-500 to-orange-500' : 'from-blue-500 to-purple-500'
                } text-white font-semibold`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {selectedType === 'QSR' ? 'Quick Service Mode' : 'Full Service Mode'}
                </div>
              </div>

              {/* Business name input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Business Name <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Enter your restaurant name"
                  className="w-full px-4 py-4 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-lg"
                  autoFocus
                />
                <p className="text-xs text-slate-500 mt-2">
                  You can change this later in Back Office → Basic Info
                </p>
              </div>

              {/* Error message */}
              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-4">
                <button
                  onClick={handleBack}
                  className="flex-1 py-4 px-6 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className={`flex-1 py-4 px-6 bg-gradient-to-r ${
                    selectedType === 'QSR' ? 'from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600' : 'from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600'
                  } text-white rounded-xl font-bold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
                >
                  {isSubmitting ? (
                    <>
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Setting up...
                    </>
                  ) : (
                    <>
                      Get Started
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Info note */}
            <p className="text-center text-slate-500 text-sm mt-6">
              💡 You can switch between modes later in settings
            </p>
          </div>
        )}
      </div>

      {/* CSS for fade animation */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.4s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default InitialSetupPage;
