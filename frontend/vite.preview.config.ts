// TẠM THỜI — chỉ để xem thử Phase 1 chat redesign trên cổng 5173.
// Giống vite.config.ts nhưng proxy trỏ về backend Docker ở localhost:3080.
// File này KHÔNG commit; xóa sau khi xem xong.
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const eeDir = existsSync(fileURLToPath(new URL('./src/_ee', import.meta.url)))
  ? './src/_ee'
  : './src/_ee-stubs';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@ee': fileURLToPath(new URL(eeDir, import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3080',
      '/socket.io': {
        target: 'http://localhost:3080',
        ws: true,
      },
    },
  },
});
