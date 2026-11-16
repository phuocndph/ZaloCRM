// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * socket.ts — Socket.IO client DÙNG CHUNG cho cả cửa sổ (2026-11-16).
 *
 * Trước đây mỗi composable gọi createAppSocket() lại mở MỘT kết nối WebSocket riêng
 * (danh sách hội thoại, khung chat, đếm chưa đọc, thông báo...). Mỗi kết nối bị server
 * ngắt mỗi 15' khi access token hết hạn rồi tự nối lại; tin đến trong khe đứt không được
 * tải bù nếu khe < 3s → tin trễ tới lượt quét 30s.
 *
 * Giờ:
 *   1. MỘT kết nối thật cho cả cửa sổ. createAppSocket() trả về một "tay cầm" có on/off/
 *      emit/connect/disconnect/connected/id như Socket cũ; disconnect() của tay cầm chỉ gỡ
 *      listener của chính nó. Tay cầm cuối cùng nhả → đóng kết nối sau RELEASE_GRACE_MS
 *      (chuyển trang không phải nối lại).
 *   2. Gia hạn token KHÔNG ngắt: trước khi access token hết hạn RENEW_LEAD_MS, lấy token
 *      tươi (ensureFreshToken single-flight) rồi emit('auth:renew') — server verify lại đủ
 *      và dời mốc ngắt (backend socket-auth.ts). Server cũ / gia hạn hỏng → vẫn còn nhánh
 *      cũ: bị ngắt 'io server disconnect' → healAuth → nối lại.
 *   3. Nối lại sau BẤT KỲ khe đứt nào → onReconnect của mọi tay cầm (tải bù tin lỡ), không
 *      còn ngưỡng 3s.
 *   4. Đổi người dùng (đăng xuất rồi đăng nhập user khác, không reload trang) → bỏ kết nối
 *      cũ, mở kết nối mới theo token mới (room org/user lấy từ token lúc handshake).
 *
 * ensureFreshToken là single-flight CHUNG với HTTP interceptor (api/index.ts) → không
 * refresh song song bị BE tưởng trộm token.
 */
import { io, type Socket } from 'socket.io-client';
import { ensureFreshToken, clearAuthAndRedirect } from '@/api/index';

export type SocketStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface CreateSocketOpts {
  /** Báo trạng thái cho UI (badge "mất kết nối"). */
  onStatusChange?: (status: SocketStatus) => void;
  /** Gọi mỗi lần nối lại THÀNH CÔNG sau một khe đứt — dùng refetch bù tin lỡ. */
  onReconnect?: (downMs: number) => void;
}

// Chống hammer: tối đa N lần refresh-rồi-reconnect trong 1 cửa sổ trước khi bỏ cuộc.
const MAX_AUTH_RETRIES = 5;
const RETRY_WINDOW_MS = 60_000;
// Gia hạn trước khi token hết hạn 2' (tab nền bị trình duyệt hãm timer tới ~1').
const RENEW_LEAD_MS = 120_000;
const RENEW_MIN_DELAY_MS = 5_000;
const RENEW_ACK_TIMEOUT_MS = 10_000;
// Giữ kết nối một lúc sau khi tay cầm cuối nhả (đổi trang → màn mới mount lại ngay).
const RELEASE_GRACE_MS = 5_000;

const AUTH_ERR_RE = /unauthorized|token_expired|legacy_token_rejected|invalid|jwt|auth/i;

type Listener = (...args: any[]) => void;
interface Consumer {
  opts?: CreateSocketOpts;
  listeners: Array<[string, Listener]>;
  released: boolean;
}

let shared: Socket | null = null;
let sharedIdentity = '';
const consumers = new Set<Consumer>();
let status: SocketStatus = 'disconnected';
let disconnectedAt = 0;
let healing = false;
let authRetries = 0;
let retryWindowStart = 0;
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function readToken(): string {
  return localStorage.getItem('token') ?? '';
}

function decodePayload(token: string): { id?: string; orgId?: string; exp?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return null;
  }
}

function identityOf(token: string): string {
  const p = decodePayload(token);
  return p?.id ? `${p.id}:${p.orgId ?? ''}` : '';
}

function expMsOf(token: string): number | null {
  const exp = decodePayload(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

function setStatus(next: SocketStatus) {
  status = next;
  for (const c of consumers) c.opts?.onStatusChange?.(next);
}

function noteRetry(): boolean {
  const now = Date.now();
  if (now - retryWindowStart > RETRY_WINDOW_MS) {
    retryWindowStart = now;
    authRetries = 0;
  }
  authRetries += 1;
  return authRetries <= MAX_AUTH_RETRIES;
}

function clearRenew() {
  if (renewTimer) clearTimeout(renewTimer);
  renewTimer = null;
}

function scheduleRenew() {
  clearRenew();
  const exp = expMsOf(readToken());
  if (!exp) return;
  const delay = Math.max(RENEW_MIN_DELAY_MS, exp - Date.now() - RENEW_LEAD_MS);
  renewTimer = setTimeout(() => { void renewNow(); }, delay);
}

async function renewNow() {
  renewTimer = null;
  const s = shared;
  if (!s || !s.connected) return;
  try {
    let token = readToken();
    const exp = expMsOf(token);
    // Tab khác có thể đã refresh sẵn → dùng luôn token đó, khỏi xoay refresh token lần nữa.
    if (!exp || exp - Date.now() <= RENEW_LEAD_MS + 5_000) token = await ensureFreshToken();
    if (s !== shared || !s.connected) return;
    const res = await s.timeout(RENEW_ACK_TIMEOUT_MS).emitWithAck('auth:renew', { token }) as { ok?: boolean } | undefined;
    if (s !== shared) return;
    if (res?.ok) {
      scheduleRenew();
      return;
    }
    // Server từ chối (đổi user, token hỏng) → nối lại sạch bằng token hiện tại.
    s.disconnect();
    s.connect();
  } catch {
    // Server cũ chưa có auth:renew / hết giờ chờ / refresh lỗi → để nhánh cũ lo:
    // server ngắt đúng hạn → 'io server disconnect' → healAuth.
  }
}

// Heal: refresh token (single-flight chung) rồi connect lại. KHÔNG log err object
// (chứa handshake.auth.token). Vượt ngưỡng retry → để badge hiện, socket-io tự backoff.
async function healAuth() {
  const s = shared;
  if (!s || healing) return;
  if (!noteRetry()) {
    setStatus('disconnected'); // hết lượt → đứng yên, badge hiện
    return;
  }
  healing = true;
  setStatus('reconnecting');
  try {
    await ensureFreshToken();
    if (s === shared && !s.active) s.connect(); // guard !active chống đua với auto-reconnect
  } catch {
    // refresh thất bại hẳn (RT hết hạn/bị thu hồi) → logout sạch.
    clearAuthAndRedirect();
  } finally {
    healing = false;
  }
}

function closeShared() {
  clearRenew();
  const s = shared;
  shared = null;
  sharedIdentity = '';
  disconnectedAt = 0;
  status = 'disconnected';
  if (s) {
    s.removeAllListeners();
    s.disconnect();
  }
}

function ensureShared(): Socket {
  const identity = identityOf(readToken());
  // Đổi người dùng mà không reload trang → không dùng lại kết nối (room) của user cũ.
  if (shared && identity && sharedIdentity && identity !== sharedIdentity) closeShared();
  if (shared) return shared;

  const s = io({
    transports: ['websocket', 'polling'],
    auth: (cb: (data: { token: string }) => void) => cb({ token: readToken() }),
  });
  shared = s;
  sharedIdentity = identity;
  status = 'disconnected';

  s.on('connect', () => {
    authRetries = 0;
    const tokenIdentity = identityOf(readToken());
    if (tokenIdentity) sharedIdentity = tokenIdentity;
    setStatus('connected');
    scheduleRenew();
    if (disconnectedAt > 0) {
      const downMs = Date.now() - disconnectedAt;
      disconnectedAt = 0;
      for (const c of [...consumers]) c.opts?.onReconnect?.(downMs); // bù tin lỡ trong lúc đứt
    }
  });

  s.on('disconnect', (reason: string) => {
    clearRenew();
    if (disconnectedAt === 0) disconnectedAt = Date.now();
    setStatus('disconnected');
    // Server chủ động đá (token hết hạn, chưa gia hạn kịp) → socket-io KHÔNG tự reconnect
    // → tự refresh + connect lại. Reason khác: socket-io tự reconnect, không can thiệp.
    if (reason === 'io server disconnect') void healAuth();
  });

  s.on('connect_error', (err: Error) => {
    if (AUTH_ERR_RE.test(err?.message ?? '')) void healAuth();
  });

  // Kết nối thật mới → gắn lại listener của mọi tay cầm đang sống.
  for (const c of consumers) {
    for (const [event, fn] of c.listeners) s.on(event, fn);
  }
  return s;
}

function acquire(consumer: Consumer): Socket {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  const wasReleased = consumer.released;
  consumer.released = false;
  consumers.add(consumer);
  const before = shared;
  const s = ensureShared(); // kết nối MỚI tự gắn listener của mọi tay cầm trong consumers
  // Dùng tiếp kết nối cũ mà tay cầm vừa quay lại → gắn lại listener của nó.
  if (wasReleased && before === s) for (const [event, fn] of consumer.listeners) s.on(event, fn);
  if (s.connected) {
    queueMicrotask(() => { if (!consumer.released) consumer.opts?.onStatusChange?.('connected'); });
  }
  return s;
}

function release(consumer: Consumer) {
  if (consumer.released) return;
  consumer.released = true;
  consumers.delete(consumer);
  if (shared) for (const [event, fn] of consumer.listeners) shared.off(event, fn);
  if (consumers.size === 0 && !releaseTimer) {
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (consumers.size === 0) closeShared();
    }, RELEASE_GRACE_MS);
  }
}

export function createAppSocket(opts?: CreateSocketOpts): Socket {
  const consumer: Consumer = { opts, listeners: [], released: true };
  acquire(consumer);

  const handle = {
    on(event: string, fn: Listener) {
      consumer.listeners.push([event, fn]);
      if (!consumer.released) shared?.on(event, fn);
      return handle;
    },
    off(event: string, fn?: Listener) {
      const removed = consumer.listeners.filter(([e, f]) => e === event && (!fn || f === fn));
      consumer.listeners = consumer.listeners.filter((entry) => !removed.includes(entry));
      if (shared) for (const [e, f] of removed) shared.off(e, f);
      return handle;
    },
    emit(event: string, ...args: any[]) {
      if (!consumer.released) shared?.emit(event, ...args);
      return handle;
    },
    connect() {
      const s = acquire(consumer);
      if (!s.connected && !s.active) s.connect();
      return handle;
    },
    disconnect() {
      release(consumer);
      return handle;
    },
    get connected() {
      return !consumer.released && !!shared?.connected;
    },
    get active() {
      return !consumer.released && !!shared?.active;
    },
    get id() {
      return consumer.released ? undefined : shared?.id;
    },
  };
  return handle as unknown as Socket;
}

/** Chỉ cho test: trạng thái kết nối dùng chung. */
export function __socketDebug() {
  return { consumers: consumers.size, hasShared: !!shared, status };
}
