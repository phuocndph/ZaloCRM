import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDeliveryUploadCallbacks, DeliveryDeadlineError, scopedZaloFetch, withDeliveryDeadline } from '../src/shared/zalo-delivery-context.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('delivery deadline fencing', () => {
  it('does not replay a task when its callback never arrives', async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise<never>(() => {}));
    const pending = withDeliveryDeadline(send, 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(DeliveryDeadlineError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('blocks an SDK continuation that wakes up after the deadline', async () => {
    vi.useFakeTimers();
    const transport = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', transport);
    let resume!: () => void;
    let late!: Promise<unknown>;
    const upload = new Promise<void>((resolve) => { resume = resolve; });
    const pending = withDeliveryDeadline(() => {
      late = upload.then(() => scopedZaloFetch('https://example.invalid/file-send'));
      return late;
    }, 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(DeliveryDeadlineError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    resume();
    await expect(late).rejects.toBeInstanceOf(DeliveryDeadlineError);
    expect(transport).not.toHaveBeenCalled();
  });

  it('aborts the in-flight fetch signal and cleans only the owning callbacks', async () => {
    vi.useFakeTimers();
    const callbacks = new Map<string, (...args: any[]) => unknown>();
    callbacks.set('another-upload', () => {});
    bindDeliveryUploadCallbacks({ getContext: () => ({ uploadCallbacks: callbacks }) });
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }));
    const pending = withDeliveryDeadline(async () => {
      callbacks.set('my-upload', () => {});
      return scopedZaloFetch('https://example.invalid/upload');
    }, 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(DeliveryDeadlineError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(callbacks.has('my-upload')).toBe(false);
    expect(callbacks.has('another-upload')).toBe(true);
  });

  it('returns a successful result without keeping a deadline timer', async () => {
    vi.useFakeTimers();
    await expect(withDeliveryDeadline(async () => 'accepted', 100)).resolves.toBe('accepted');
    expect(vi.getTimerCount()).toBe(0);
  });
});
