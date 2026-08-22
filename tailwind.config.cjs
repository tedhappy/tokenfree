/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主题色走 CSS 变量，亮/暗由 BaseLayout 里的变量集切换
        bg: { DEFAULT: 'var(--c-bg)', secondary: 'var(--c-bg2)', tertiary: 'var(--c-bg3)' },
        accent: {
          DEFAULT: 'var(--c-accent)',
          hover: 'var(--c-accent-h)',
          muted: 'var(--c-accent-muted)',
        },
        border: { DEFAULT: 'var(--c-border)', hover: 'var(--c-border-h)' },
        text: { primary: 'var(--c-t1)', secondary: 'var(--c-t2)', muted: 'var(--c-t3)' },
        status: { stable: '#22c55e', unstable: '#f59e0b', offline: '#ef4444' },
      },
      fontFamily: {
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
