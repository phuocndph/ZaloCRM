// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ZaloCRM is free software under the GNU Affero General Public License v3.0 (see LICENSE).
// Commercial (dual) licensing available: locnt@locnguyendata.com
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
import './assets/tokens.css';
import './assets/main.css';
import './assets/rbac-page.css';
import './assets/hs-crm-theme.css'; // HS Holding redesign — load LAST để token/component HS thắng cascade (migration 2026-06-05)
import './assets/report-kit.css'; // Module Báo cáo — design system scoped .rpt-scope (2026-06-17)
import './assets/mobile.css'; // Mobile Design System — token scoped .m-scope (PR1, 2026-07-11)
import './assets/dark-theme.css'; // Dark mode — override token khi <html data-theme="dark"> (2026-07-13). Load SAU cùng để thắng cascade.
import { initTheme } from './composables/use-theme';

// Áp theme (localStorage / prefers-color-scheme) TRƯỚC khi mount → không nháy nền sáng.
initTheme();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.mount('#app');

// ── PWA ─────────────────────────────────────────────────────────────────────
// (Comment "chờ vite-plugin-pwa hỗ trợ vite 8" đã hết hiệu lực: 1.3.0 peer ^8.0.0.)
// SW chỉ đăng ký ở bản build (devOptions.enabled=false) và cần secure context
// (https hoặc localhost) — nơi khác trình duyệt tự bỏ qua, không lỗi.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => { /* không có SW cũng không sao — app vẫn chạy */ });
}

// Sau mỗi lần deploy, các chunk cũ bị xoá khỏi server; tab đang mở vẫn giữ tên chunk
// cũ → dynamic import trả về index.html (text/html) → route chết IM LẶNG.
// Bắt sự kiện của Vite và reload đúng MỘT lần (cờ sessionStorage chống lặp vô hạn).
const RELOAD_FLAG = 'chunk-reload-once';
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem(RELOAD_FLAG));
