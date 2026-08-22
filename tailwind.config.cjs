/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0a0f',
          secondary: '#12121a',
          tertiary: '#1a1a25',
        },
        accent: {
          DEFAULT: '#7c5cfc',
          hover: '#6a4ce6',
          muted: 'rgba(124, 92, 252, 0.1)',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          hover: 'rgba(255, 255, 255, 0.1)',
        },
        text: {
          primary: '#e8e8ed',
          secondary: '#8888a0',
          muted: '#55556a',
        },
        status: {
          stable: '#22c55e',
          unstable: '#f59e0b',
          offline: '#ef4444',
        },
        model: {
          gpt: '#10b981',
          claude: '#f59e0b',
          gemini: '#3b82f6',
          grok: '#8b5cf6',
          deepseek: '#06b6d4',
          qwen: '#ec4899',
          llama: '#f97316',
          mistral: '#f43f5e',
          other: '#6b7280',
        },
      },
      fontFamily: {
        // 系统字体栈：零外部请求，国内无被墙风险
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI',
          'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
