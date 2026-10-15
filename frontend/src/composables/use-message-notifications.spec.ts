// @vitest-environment jsdom
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyConversationState, setConversationNotificationMute } from './use-conversation-state';
import { useMessageNotifications } from './use-message-notifications';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  get: vi.fn(), patch: vi.fn(), refresh: vi.fn(), read: vi.fn(), native: vi.fn(), sound: vi.fn(),
  route: { path: '/work-items', name: 'WorkItems', params: {} },
}));
vi.hoisted(() => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window, 'Notification', { configurable: true, value: class {
    static permission = 'granted';
  } });
});
vi.mock('@/api/index', () => ({ api: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/api/socket', () => ({ createAppSocket: () => ({
  on: (event: string, fn: (...args: any[]) => any) => mocks.handlers.set(event, fn),
  off: (event: string) => mocks.handlers.delete(event), disconnect: vi.fn(),
}) }));
vi.mock('@/router', () => ({ router: { currentRoute: { value: mocks.route }, push: vi.fn() } }));
vi.mock('@/composables/use-chat', () => ({ useChat: () => ({ selectedConvId: { value: '' } }) }));
vi.mock('@/composables/use-message-notification-inbox', () => ({ useMessageNotificationInbox: () => ({
  scheduleRefresh: mocks.refresh, markConversationRead: mocks.read,
}) }));

const payload = (id = 'message') => ({ conversationId: 'conv', message: { id, senderType: 'contact', senderName: 'Customer', content: 'Hello' } });
const muted = (until: string | null = null) => ({ ...emptyConversationState('conv'), flags: {
  notificationMute: { mode: until ? 'until' : 'forever', until, mutedAt: new Date().toISOString() },
} });
const notifications = useMessageNotifications();

beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers.clear();
  mocks.get.mockResolvedValue({ data: emptyConversationState('conv') });
  mocks.patch.mockResolvedValue({ data: muted() });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  vi.stubGlobal('AudioContext', class {
    currentTime = 0;
    destination = {};
    createOscillator() { return { connect: vi.fn(), frequency: {}, start: mocks.sound, stop: vi.fn() }; }
    createGain() { return { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }; }
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ showNotification: mocks.native }) } });
  notifications.setEnabled(true); notifications.setSound(true); notifications.permission.value = 'granted';
  notifications.start();
});
afterEach(() => { notifications.stop(); delete window.zaloDesktop; vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.assign(mocks.route, { name: 'WorkItems', path: '/work-items', params: {} }); });

describe('personal conversation notification mute', () => {
  it.each([null, new Date(Date.now() + 3600_000).toISOString()])('blocks cards, sound, native notifications and inbox refresh when muted (%s)', async (until) => {
    mocks.get.mockResolvedValue({ data: muted(until) });
    await mocks.handlers.get('chat:message')!(payload());
    expect(notifications.cards.value).toEqual([]);
    expect(mocks.sound).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('delivers notifications for expired mute without writing an unmute', async () => {
    mocks.get.mockResolvedValue({ data: muted(new Date(Date.now() - 1000).toISOString()) });
    await mocks.handlers.get('chat:message')!(payload());
    await flushPromises();
    expect(notifications.cards.value).toHaveLength(1); expect(mocks.sound).toHaveBeenCalled();
    expect(mocks.native).toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled(); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it('keeps Zalo mute authoritative and does not look up personal state', async () => {
    await mocks.handlers.get('chat:message')!({ ...payload(), notificationMuted: true });
    expect(mocks.get).not.toHaveBeenCalled(); expect(notifications.cards.value).toHaveLength(0);
  });
  it('removes existing cards on another-device mute and rejects a stale in-flight lookup', async () => {
    await mocks.handlers.get('chat:message')!(payload());
    let resolve!: (value: any) => void;
    mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = mocks.handlers.get('chat:message')!(payload('next'));
    mocks.handlers.get('conversation:state')!(muted());
    expect(notifications.cards.value).toHaveLength(0);
    resolve({ data: emptyConversationState('conv') }); await pending;
    expect(notifications.cards.value).toHaveLength(0);
  });
  it('observes local mute even if the state socket event has not arrived', async () => {
    await mocks.handlers.get('chat:message')!(payload());
    await setConversationNotificationMute('conv', null);
    expect(notifications.cards.value).toHaveLength(0);
  });
  it('coalesces concurrent album lookups but fetches fresh settings on the next message', async () => {
    let resolve!: (value: any) => void;
    mocks.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const handler = mocks.handlers.get('chat:message')!;
    const pending = [handler(payload('a')), handler(payload('b'))];
    expect(mocks.get).toHaveBeenCalledTimes(1);
    resolve({ data: muted() }); await Promise.all(pending);
    await handler(payload('c'));
    expect(mocks.get).toHaveBeenCalledTimes(2); expect(notifications.cards.value).toHaveLength(1);
  });
  it('does not notify after logout/restart while a lookup is pending', async () => {
    let resolve!: (value: any) => void;
    mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = mocks.handlers.get('chat:message')!(payload());
    notifications.stop(); notifications.start();
    resolve({ data: emptyConversationState('conv') }); await pending;
    expect(notifications.cards.value).toHaveLength(0);
  });
  it('fails quietly when state cannot be checked', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    await mocks.handlers.get('chat:message')!(payload()); await flushPromises();
    expect(notifications.cards.value).toHaveLength(0); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('forwards authorized previews without duplicate native cards', async () => {
    const notify = vi.fn();
    window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    await mocks.handlers.get('chat:message')!(payload());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: 'message', convId: 'conv', name: 'Customer' }));
    expect(notify.mock.calls[0][0].preview).toBe('Hello'); expect(notify.mock.calls[0][0].avatarUrl).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith('/conversations/conv');
    expect(notifications.cards.value).toHaveLength(0); expect(mocks.native).not.toHaveBeenCalled();
  });
  it('does not forward personally-muted messages to the desktop bubble', async () => {
    const notify = vi.fn(), dismiss = vi.fn();
    window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss } as any;
    mocks.get.mockResolvedValue({ data: muted() });
    await mocks.handlers.get('chat:message')!(payload());
    expect(notify).not.toHaveBeenCalled(); expect(dismiss).toHaveBeenCalledWith('conv');
  });
  it('clears bubble labels on privacy/access changes', () => {
    const clear = vi.fn(); window.zaloDesktop = { role: 'main', clear } as any;
    mocks.handlers.get('conversation:privacy-changed')!({}); expect(clear).toHaveBeenCalled();
  });
  it('does not start a second notification receiver inside compact chat', () => {
    notifications.stop(); mocks.handlers.clear();
    window.zaloDesktop = { role: 'chat' } as any;
    notifications.start(); expect(mocks.handlers.size).toBe(0);
    delete window.zaloDesktop;
  });
  it('redacts private nick notifications even with an unlocked raw payload', async () => {
    const notify = vi.fn(); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    mocks.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/state') ? emptyConversationState('conv') : { zaloAccount: { privacyMode: 'main' } } }));
    await mocks.handlers.get('chat:message')!(payload());
    expect(notify.mock.calls[0][0]).toMatchObject({ name: 'Tin nhắn mới', preview: 'Bạn có tin nhắn mới', avatarUrl: null, redacted: true });
  });
  it('never forwards preview when the authorized conversation endpoint denies access', async () => {
    const notify = vi.fn(); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    mocks.get.mockImplementation((path: string) => path.endsWith('/state') ? Promise.resolve({ data: emptyConversationState('conv') }) : Promise.reject(new Error('forbidden')));
    await mocks.handlers.get('chat:message')!(payload()); expect(notify).not.toHaveBeenCalled();
  });
  it('updates unread for every message while limiting preview bursts', async () => {
    const notify = vi.fn().mockResolvedValue(true); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    const handler = mocks.handlers.get('chat:message')!;
    for (let i = 0; i < 5; i++) await handler(payload(`burst-${i}`));
    expect(notify).toHaveBeenCalledTimes(5); expect(notify.mock.calls[4][0].announce).toBe(false); expect(mocks.sound).toHaveBeenCalledTimes(3);
  });
  it('uses CRM customer names when the incoming message has no sender name', async () => {
    const notify = vi.fn(); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    mocks.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/state') ? emptyConversationState('conv') : {
      threadType: 'user', contact: { crmName: 'Chị Lan - Đại lý', avatarUrl: 'https://example.com/lan.png' }, zaloAccount: { displayName: 'Minh Tư vấn' },
    } }));
    const value = payload(); value.message.senderName = ''; value.message.content = 'a'.repeat(200);
    await mocks.handlers.get('chat:message')!(value);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chị Lan - Đại lý', context: 'Minh Tư vấn', preview: 'a'.repeat(200), avatarUrl: 'https://example.com/lan.png' }));
  });
  it('separates the group title, receiving nick and member who sent the message', async () => {
    const notify = vi.fn(); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    mocks.get.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith('/state') ? emptyConversationState('conv') : {
      threadType: 'group', groupName: 'Đại lý Miền Nam', zaloAccount: { displayName: 'Nick CSKH' },
    } }));
    await mocks.handlers.get('chat:message')!(payload());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ name: 'Đại lý Miền Nam', senderName: 'Customer', context: 'Nick CSKH', preview: 'Hello' }));
  });
  it('still previews when the main CRM chat is behind another Windows app', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    Object.assign(mocks.route, { name: 'Chat', path: '/chat/conv', params: { convId: 'conv' } });
    const notify = vi.fn(); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    await mocks.handlers.get('chat:message')!(payload()); expect(notify).toHaveBeenCalled();
  });
  it('preserves receipt order when customer profile lookups finish out of order', async () => {
    const notify = vi.fn(); window.zaloDesktop = { role: 'main', notify, clear: vi.fn(), dismiss: vi.fn() } as any;
    const lookups: Array<(value: any) => void> = [];
    mocks.get.mockImplementation((path: string) => path.endsWith('/state')
      ? Promise.resolve({ data: emptyConversationState('conv') })
      : new Promise((resolve) => lookups.push(resolve)));
    const handler = mocks.handlers.get('chat:message')!;
    const older = handler(payload('older'));
    const newer = handler(payload('newer'));
    await flushPromises();
    lookups[1]({ data: {} }); await newer;
    lookups[0]({ data: {} }); await older;
    const [newerNotification, olderNotification] = notify.mock.calls.map(([value]) => value);
    expect(newerNotification.id).toBe('newer'); expect(olderNotification.id).toBe('older');
    expect(newerNotification.sequence).toBeGreaterThan(olderNotification.sequence);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
