/**
 * socket-auth-renew.test.ts — 2026-11-16: gia hạn access token trên socket đang mở
 * (auth:renew) thay vì để server ngắt mỗi 15'. Kiểm: dời mốc ngắt, chặn đổi danh tính,
 * chặn token hỏng/hết hạn, không gia hạn thì vẫn bị ngắt đúng hạn.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { registerSocketAuth, getSocketAuth } from '../../src/shared/realtime/socket-auth.js';

type MwFn = (socket: any, next: (err?: Error) => void) => void;
type ConnFn = (socket: any) => void;

function setup(verify: (t: string) => any) {
  let mw: MwFn | undefined;
  let conn: ConnFn | undefined;
  const io = {
    use: (fn: MwFn) => { mw = fn; },
    on: (ev: string, fn: ConnFn) => { if (ev === 'connection') conn = fn; },
  } as any;
  registerSocketAuth(io, { jwt: { verify } } as any);
  const handlers = new Map<string, (...a: any[]) => void>();
  const socket = {
    id: 's1',
    handshake: { auth: { token: 'first' }, headers: {} },
    data: {} as Record<string, any>,
    join: vi.fn(),
    disconnect: vi.fn(),
    on: (ev: string, fn: (...a: any[]) => void) => { handlers.set(ev, fn); },
  };
  const next = vi.fn();
  mw!(socket, next);
  conn!(socket);
  return { socket, next, handlers };
}

const secs = (ms: number) => Math.floor((Date.now() + ms) / 1000);

describe('socket auth:renew', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('token mới hợp lệ cùng user → dời mốc ngắt, không bị đá lúc token cũ hết hạn', () => {
    const tokens: Record<string, any> = {
      first: { id: 'u1', orgId: 'o1', role: 'sale', typ: 'access', exp: secs(60_000) },
      second: { id: 'u1', orgId: 'o1', role: 'sale', typ: 'access', exp: secs(900_000) },
    };
    const { socket, next, handlers } = setup((t) => tokens[t]);
    expect(next).toHaveBeenCalledWith();
    const ack = vi.fn();
    handlers.get('auth:renew')!({ token: 'second' }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    vi.advanceTimersByTime(120_000);
    expect(socket.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('token của user khác → từ chối, giữ nguyên danh tính và mốc ngắt cũ', () => {
    const tokens: Record<string, any> = {
      first: { id: 'u1', orgId: 'o1', role: 'sale', typ: 'access', exp: secs(60_000) },
      other: { id: 'u2', orgId: 'o1', role: 'admin', typ: 'access', exp: secs(900_000) },
    };
    const { socket, handlers } = setup((t) => tokens[t]);
    const ack = vi.fn();
    handlers.get('auth:renew')!({ token: 'other' }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'identity_mismatch' });
    expect(getSocketAuth(socket as any)?.userId).toBe('u1');
    vi.advanceTimersByTime(61_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('token sai chữ ký / thiếu token → từ chối', () => {
    const { handlers } = setup((t) => {
      if (t === 'first') return { id: 'u1', orgId: 'o1', role: 'sale', typ: 'access', exp: secs(60_000) };
      throw new Error('bad signature');
    });
    const ack = vi.fn();
    handlers.get('auth:renew')!({ token: 'forged' }, ack);
    handlers.get('auth:renew')!({}, ack);
    handlers.get('auth:renew')!(null, ack);
    expect(ack.mock.calls.map((c) => c[0].ok)).toEqual([false, false, false]);
  });

  it('không có ack callback → không ném lỗi', () => {
    const { handlers } = setup(() => ({ id: 'u1', orgId: 'o1', role: 'sale', typ: 'access', exp: secs(60_000) }));
    expect(() => handlers.get('auth:renew')!({ token: 'x' })).not.toThrow();
  });

  it('không gia hạn → vẫn bị ngắt đúng hạn như cũ', () => {
    const { socket } = setup(() => ({ id: 'u1', orgId: 'o1', role: 'sale', typ: 'access', exp: secs(60_000) }));
    vi.advanceTimersByTime(59_000);
    expect(socket.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
