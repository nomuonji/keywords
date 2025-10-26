import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        'primary-dark': '#1d4ed8',
        secondary: '#f97316',
        success: '#10b981',
        danger: '#ef4444',
        warning: '#eab308'
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 15px 35px rgba(15, 23, 42, 0.08)'
      }
    }
  },
  plugins: []
};

export default config;
