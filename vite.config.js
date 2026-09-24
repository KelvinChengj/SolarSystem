import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`         → dist/ (一般靜態網站，可部署到 GitHub Pages 等)
// `npm run build:single`  → dist-single/index.html (所有資源內嵌成單一 HTML 檔，可直接離線開啟)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
    test: {
      include: ['tests/**/*.test.js'],
      testTimeout: 60_000,
    },
  };
});
