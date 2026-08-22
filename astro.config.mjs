import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: process.env.SITE_URL || 'https://tokenfree.example.com',
  integrations: [react(), tailwind()],
  output: 'static',
  vite: {
    resolve: {
      // React → Preact 兼容层：前台交互组件体积从 ~136KB 降到 ~13KB
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
        'react-dom/client': 'preact/compat/client',
      },
    },
  },
});
