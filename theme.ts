// PAGA.AI Theme Configuration
export const theme = {
  colors: {
    primary: {
      purple: '#7C3AED',
      purpleHover: '#6D28D9',
      purpleLight: '#EDE9FE',
    },
    accent: {
      blue: '#3B82F6',
      blueHover: '#2563EB',
      blueLight: '#DBEAFE',
    },
    success: {
      green: '#10B981',
      greenHover: '#059669',
      greenLight: '#D1FAE5',
    },
    neutral: {
      black: '#111827',
      white: '#FFFFFF',
      bgMain: '#F9FAFB',
      gray50: '#F9FAFB',
      gray100: '#F3F4F6',
      gray200: '#E5E7EB',
      gray300: '#D1D5DB',
      gray400: '#9CA3AF',
      gray500: '#6B7280',
      gray600: '#4B5563',
      gray700: '#374151',
      gray800: '#1F2937',
    },
    status: {
      pending: '#3B82F6',
      paid: '#10B981',
      overdue: '#EF4444',
    },
  },
  shadows: {
    card: '0 10px 15px -3px rgba(0, 0, 0, 0.04)',
    cardHover: '0 20px 25px -5px rgba(0, 0, 0, 0.08)',
    button: '0 4px 12px rgba(124, 58, 237, 0.3)',
  },
  borderRadius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    full: '9999px',
  },
};

export const cardClass = 'bg-white rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.08)] hover:-translate-y-1';

export const buttonPrimaryClass = 'bg-[#111827] text-white rounded-xl px-6 py-3 font-semibold transition-all duration-300 hover:bg-[#7C3AED] hover:shadow-[0_4px_12px_rgba(124,58,237,0.3)] active:scale-95';

export const buttonSecondaryClass = 'bg-white text-[#111827] border border-slate-200 rounded-xl px-6 py-3 font-semibold transition-all duration-300 hover:border-[#7C3AED] hover:text-[#7C3AED] active:scale-95';

export const inputClass = 'bg-white border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-[#7C3AED] focus:border-[#7C3AED] outline-none transition-all duration-200';
