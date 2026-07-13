// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-theme.ts — Bật/tắt Sáng / Tối / Theo hệ thống (2026-07-13).
 *
 * Cơ chế:
 *   • `data-theme="dark"|"light"` gắn lên <html> → CSS token đổi bảng màu (dark-theme.css).
 *   • Đồng bộ tên theme Vuetify (hsLight ↔ hsDark) cho component Vuetify.
 *   • Lưu lựa chọn vào localStorage; chế độ "system" tự theo prefers-color-scheme.
 *
 * State ở cấp module (singleton) — mọi component gọi useTheme() dùng chung.
 */
import { ref, computed, watch } from 'vue';
import { vuetify } from '@/plugins/vuetify';

export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'zalocrm-theme';

const mode = ref<ThemeMode>('system');
const systemDark = ref(false);

/** Theme thực tế đang áp (đã giải chế độ "system"). */
const resolved = computed<'light' | 'dark'>(() =>
  mode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : mode.value,
);

function apply(): void {
  const r = resolved.value;
  document.documentElement.setAttribute('data-theme', r);
  document.documentElement.style.colorScheme = r; // scrollbar/form control native theo theme
  try {
    vuetify.theme.global.name.value = r === 'dark' ? 'hsDark' : 'hsLight';
  } catch {
    /* Vuetify chưa sẵn sàng (init sớm) — apply() gọi lại sau vẫn đồng bộ. */
  }
}

/** Gọi MỘT lần lúc khởi động app (main.ts) trước khi mount. */
export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') mode.value = saved;
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  systemDark.value = mql.matches;
  mql.addEventListener('change', (e) => { systemDark.value = e.matches; });
  apply();
}

// Đổi mode / đổi cài đặt hệ thống → áp lại.
watch(resolved, apply);

export function useTheme() {
  function setMode(m: ThemeMode): void {
    mode.value = m;
    localStorage.setItem(STORAGE_KEY, m);
    apply();
  }
  return {
    mode,
    resolved,
    isDark: computed(() => resolved.value === 'dark'),
    setMode,
  };
}
