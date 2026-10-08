/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans"', 'system-ui', 'Segoe UI', 'sans-serif'] },
      colors: { canvas: '#F4F6F3', ink: '#14221C', field: { 600: '#1F6F4A', 700: '#185A3C', 50: '#EAF3EE' } },
    },
  },
  plugins: [],
};
