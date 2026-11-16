// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sockets: [] as any[],
  ensureFreshToken: vi.fn(),
  clearAuthAndRedirect: vi.fn(),
  renewReply: { ok: true } as any,
}));

function fakeSocket() {
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  const s: any = {
    connected: false,
    active: true,
    id: `sid-${mocks.sockets.length}`,
    emitted: [] as any[],
    on(ev: string, fn: any) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev)!.add(fn); return s; },
    off(ev: string, fn: any) { listeners.get(ev)?.delete(fn); return s; },
    removeAllListeners() { listeners.clear(); return s; },
    emit: vi.fn((...args: any[]) => { s.emitted.push(args); return s; }),
    connect: vi.fn(() => { s.active = true; return s; }),
    disconnect: vi.fn(() => { s.connected = false; s.active = false; return s; }),
    timeout: () => ({ emitWithAck: vi.fn(async (ev: string, body: any) => { s.emitted.push([ev, body]); return mocks.renewReply; }) }),
    fire(ev: string, ...args: any[]) { for (const fn of [...(listeners.get(ev) ?? [])]) fn(...args); },
    count(ev: string) { return listeners.get(ev)?.size ?? 0; },
  };
  return s;
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => { const s = fakeSocket(); mocks.sockets.push(s); return s; }) }));
vi.mock('@/api/index', () => ({ ensureFreshToken: mocks.ensureFreshToken, clearAuthAndRedirect: mocks.clearAuthAndRedirect }));

function jwt(payload: Record<string, unknown>) {
  const b = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b({ alg: 'HS256' })}.${b(payload)}.sig`;
}
const token = (id = 'u1', minutes = 15) => jwt({ id, orgId: 'o1', exp: Math.floor(Date.now() / 1000) + minutes * 60 });

async function load() {
  vi.resetModules();
  return import('./socket');
}
function connect(s: any) { s.connected = true; s.fire('connect'); }

describe('shared app socket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sockets.length = 0;
    mocks.renewReply = { ok: true };
    mocks.ensureFreshToken.mockReset();
    mocks.clearAuthAndRedirect.mockReset();
    localStorage.setItem('token', token());
  });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('opens ONE real connection for many consumers and only removes the releasing consumer listeners', async () => {
    const { createAppSocket } = await load();
    const a = createAppSocket(), b = createAppSocket();
    const fa = vi.fn(), fb = vi.fn();
    a.on('chat:message', fa); b.on('chat:message', fb);
    expect(mocks.sockets).toHaveLength(1);
    const s = mocks.sockets[0];
    s.fire('chat:message', 1);
    expect(fa).toHaveBeenCalledTimes(1); expect(fb).toHaveBeenCalledTimes(1);
    a.disconnect();
    s.fire('chat:message', 2);
    expect(fa).toHaveBeenCalledTimes(1); expect(fb).toHaveBeenCalledTimes(2);
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('closes after the last consumer leaves, but reuses the connection when a screen remounts quickly', async () => {
    const { createAppSocket } = await load();
    const a = createAppSocket();
    a.disconnect();
    await vi.advanceTimersByTimeAsync(2_000);
    const b = createAppSocket();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sockets).toHaveLength(1);
    expect(mocks.sockets[0].disconnect).not.toHaveBeenCalled();
    b.disconnect();
    await vi.advanceTimersByTimeAsync(5_100);
    expect(mocks.sockets[0].disconnect).toHaveBeenCalled();
    createAppSocket();
    expect(mocks.sockets).toHaveLength(2);
  });

  it('renews the token on the open connection before expiry instead of dropping it', async () => {
    const fresh = token('u1', 30);
    mocks.ensureFreshToken.mockImplementation(async () => { localStorage.setItem('token', fresh); return fresh; });
    const { createAppSocket } = await load();
    createAppSocket();
    const s = mocks.sockets[0];
    connect(s);
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    expect(s.emitted.find((e: any[]) => e[0] === 'auth:renew')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000 + 1_000);
    expect(mocks.ensureFreshToken).toHaveBeenCalledTimes(1);
    expect(s.emitted.find((e: any[]) => e[0] === 'auth:renew')?.[1]).toEqual({ token: fresh });
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('reconnects cleanly when the server rejects a renewal', async () => {
    mocks.renewReply = { ok: false, error: 'identity_mismatch' };
    mocks.ensureFreshToken.mockResolvedValue(token());
    const { createAppSocket } = await load();
    createAppSocket();
    const s = mocks.sockets[0];
    connect(s);
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });

  it('calls onReconnect for every consumer after any gap, even a short one', async () => {
    const { createAppSocket } = await load();
    const r1 = vi.fn(), r2 = vi.fn();
    createAppSocket({ onReconnect: r1 }); createAppSocket({ onReconnect: r2 });
    const s = mocks.sockets[0];
    connect(s);
    expect(r1).not.toHaveBeenCalled();
    s.connected = false; s.fire('disconnect', 'transport close');
    await vi.advanceTimersByTimeAsync(500);
    connect(s);
    expect(r1).toHaveBeenCalledTimes(1); expect(r2).toHaveBeenCalledTimes(1);
  });

  it('heals after a server kick: refresh token then connect again', async () => {
    mocks.ensureFreshToken.mockResolvedValue(token());
    const { createAppSocket } = await load();
    const status = vi.fn();
    createAppSocket({ onStatusChange: status });
    const s = mocks.sockets[0];
    connect(s);
    s.connected = false; s.active = false;
    s.fire('disconnect', 'io server disconnect');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.ensureFreshToken).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith('reconnecting');
  });

  it('opens a new connection when a different user logs in without reloading', async () => {
    const { createAppSocket } = await load();
    const a = createAppSocket();
    const f = vi.fn();
    a.on('chat:message', f);
    localStorage.setItem('token', token('u2'));
    const b = createAppSocket();
    expect(mocks.sockets).toHaveLength(2);
    expect(mocks.sockets[0].disconnect).toHaveBeenCalled();
    mocks.sockets[1].fire('chat:message', 1);
    expect(f).toHaveBeenCalledTimes(1);
    b.disconnect();
  });

  it('reports connected status to a consumer joining an already open connection', async () => {
    const { createAppSocket } = await load();
    createAppSocket();
    connect(mocks.sockets[0]);
    const status = vi.fn();
    const late = createAppSocket({ onStatusChange: status });
    await Promise.resolve();
    expect(status).toHaveBeenCalledWith('connected');
    expect(late.connected).toBe(true);
  });
});
