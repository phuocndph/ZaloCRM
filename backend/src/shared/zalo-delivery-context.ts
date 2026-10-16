import { AsyncLocalStorage } from 'node:async_hooks';

const deliveryScope = new AsyncLocalStorage<AbortSignal>();
const boundCallbacks = new WeakSet<object>();

/** Remove only callbacks registered by this delivery scope, not another caller's upload. */
export function bindDeliveryUploadCallbacks(api: any): void {
  const callbacks = api.getContext?.()?.uploadCallbacks;
  if (!callbacks || boundCallbacks.has(callbacks)) return;
  boundCallbacks.add(callbacks);
  const originalSet = callbacks.set.bind(callbacks);
  callbacks.set = (key: string, callback: (...args: any[]) => unknown, ttl?: number) => {
    const signal = deliveryScope.getStore();
    if (!signal) return originalSet(key, callback, ttl);
    signal.throwIfAborted();
    const aborted = () => callbacks.delete(key);
    signal.addEventListener('abort', aborted, { once: true });
    return originalSet(key, (...args: any[]) => {
      signal.removeEventListener('abort', aborted);
      signal.throwIfAborted();
      return callback(...args);
    }, ttl);
  };
}

export class DeliveryDeadlineError extends Error {
  constructor() {
    super('Zalo delivery deadline exceeded; result is not confirmed');
    this.name = 'DeliveryDeadlineError';
  }
}

/** Abort transport and fence SDK continuations that resume after a lost upload callback. */
export const scopedZaloFetch: typeof fetch = (input, init) => {
  const signal = deliveryScope.getStore();
  signal?.throwIfAborted();
  return fetch(input, signal ? {
    ...init,
    signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
  } : init);
};

export async function withDeliveryDeadline<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs = 90_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await deliveryScope.run(controller.signal, () => Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new DeliveryDeadlineError();
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]));
  } finally {
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(new Error('Delivery scope finished'));
  }
}
