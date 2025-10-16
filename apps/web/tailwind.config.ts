import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        secondary: '#7c3aed',
        success: '#16a34a',
        warning: '#f97316',
        danger: '#dc2626'
      }
    }
  },
  plugins: []
};

export default config;
