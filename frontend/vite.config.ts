import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Open-core: `@ee` resolves to the extension bundle when present (private repo)
// and falls back to no-op stubs in the Community edition (where src/_ee is
// stripped). Same config in both editions — auto-detected, no env flag needed.
const eeDir = existsSync(fileURLToPath(new URL('./src/_ee', import.meta.url)))
  ? './src/_ee'
  : './src/_ee-stubs';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    // PWA Mobile — injectManifest (KHÔNG dùng generateSW) vì cần tự viết handler
    // 'push' / 'notificationclick' cho Web Push trong src/sw.ts.
    // manifest: false → dùng public/manifest.json sẵn có (index.html đã link tới).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null, // tự đăng ký trong main.ts để kiểm soát vòng đời
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Không precache các chunk CHỈ dùng ở desktop — mobile không bao giờ mở tới,
        // mà chúng chiếm phần lớn dung lượng (exceljs 908KB, ChatView 468KB…).
        // Chúng vẫn tải bình thường qua mạng khi desktop cần (hash immutable → HTTP cache lo).
        globIgnores: [
          '**/assets/exceljs*',
          '**/assets/ChatView-*',
          '**/assets/rich-text-editor-*',
          '**/assets/AnalyticsView-*',
          '**/assets/ZaloAccountsView-*',
          '**/assets/ContactsView-*',
          '**/assets/ListDetailView-*',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false }, // không chạy SW ở dev để khỏi cache nhiễu
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@ee': fileURLToPath(new URL(eeDir, import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      // Media driver local trả URL tương đối /files/... → dev server phải chuyển tiếp
      // sang backend, nếu không ảnh trong chat/kho media 404 khi chạy `vite dev`.
      '/files': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
