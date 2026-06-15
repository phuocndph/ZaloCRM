import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// FE test infra (dựng cho work-scope 2026-06-15, eng-review iron rule).
// environmentMatchGlobs: logic thuần chạy 'node' (nhanh); component/watcher cần DOM
// thì đặt file *.dom.spec.ts → jsdom. Phần lớn logic work-scope là thuần → node.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['**/*.dom.spec.ts', 'jsdom'],
    ],
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/composables/**/*.ts'],
    },
  },
});
