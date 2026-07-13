// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-remembered-login.ts — "Ghi nhớ đăng nhập" cho mobile/PWA: lưu tài khoản + mật khẩu
 * trên THIẾT BỊ để tự điền + tự đăng nhập, khỏi gõ lại mỗi lần.
 *
 * Bảo mật: lưu localStorage (chỉ base64 cho đỡ lộ liễu — KHÔNG phải mã hoá). Chấp nhận
 * được vì là thiết bị cá nhân của user và họ chủ động bật; app vốn đã lưu JWT ở localStorage
 * cùng mức phơi bày với XSS. Tắt "Ghi nhớ" hoặc đăng xuất → xoá sạch.
 *
 * Lưu ý: phiên chính vẫn dựa trên refresh token (30 ngày) — cái này chỉ là lớp dự phòng
 * khi phiên hết hạn/mất, để đăng nhập lại chỉ 1 chạm (hoặc tự động).
 */
const KEY = 'zc.saved-login';

// Cờ 1-lần trong 1 phiên tab (sessionStorage) — chặn vòng lặp tự-đăng-nhập nếu có sự cố.
const AUTO_FLAG = 'zc.autologin-tried';

export interface SavedLogin { identifier: string; password: string }

export function saveLogin(identifier: string, password: string): void {
  try {
    const packed = btoa(unescape(encodeURIComponent(JSON.stringify({ i: identifier, p: password }))));
    localStorage.setItem(KEY, packed);
  } catch { /* localStorage đầy/bị chặn — bỏ qua */ }
}

export function loadLogin(): SavedLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!o?.i || !o?.p) return null;
    return { identifier: String(o.i), password: String(o.p) };
  } catch { return null; }
}

export function clearLogin(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

/** True nếu chưa thử tự-đăng-nhập trong phiên tab này (và đánh dấu đã thử). */
export function consumeAutoLoginChance(): boolean {
  try {
    if (sessionStorage.getItem(AUTO_FLAG)) return false;
    sessionStorage.setItem(AUTO_FLAG, '1');
    return true;
  } catch { return false; }
}

/** Cho phép tự-đăng-nhập lại (gọi sau khi đăng xuất chủ động để phiên tab sạch). */
export function resetAutoLoginChance(): void {
  try { sessionStorage.removeItem(AUTO_FLAG); } catch { /* noop */ }
}
