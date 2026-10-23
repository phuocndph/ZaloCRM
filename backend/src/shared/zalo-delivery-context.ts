// SPDX-License-Identifier: AGPL-3.0-or-later
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDecipheriv } from 'node:crypto';

export type DeliveryPhase = 'before_send' | 'after_send';
export interface DeliveryRequest {
  kind: 'image' | 'file' | 'other'; index: number; clientId: string | null;
}
export interface DeliveryObserver {
  beforeSend?: (request: DeliveryRequest) => Promise<void>;
  accepted?: (request: DeliveryRequest, messageId: string) => Promise<void>;
}
type Scope = { signal: AbortSignal; submitted: boolean; trackTransport: boolean; secretKey?: string;
  observer?: DeliveryObserver; indices: Record<DeliveryRequest['kind'], number> };
const deliveryScope = new AsyncLocalStorage<Scope>();
const failurePhases = new WeakMap<object, DeliveryPhase>();
export function deliveryFailurePhase(error: unknown): DeliveryPhase | undefined {
  return typeof error === 'object' && error !== null ? failurePhases.get(error) : undefined;
}

// Matches the installed SDK's AES-CBC envelope. Never expose decoded payloads or keys.
function decodeEnvelope(secretKey: string | undefined, encrypted: string | null): Record<string, unknown> | null {
  if (!secretKey || !encrypted) return null;
  try {
    const key = Buffer.from(secretKey, 'base64');
    if (![16, 24, 32].includes(key.length)) return null;
    const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, Buffer.alloc(16));
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}
function messageId(value: unknown): string | null {
  return (typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) && !/^0+$/.test(String(value)) ? String(value) : null;
}
function describeRequest(scope: Scope, input: Parameters<typeof fetch>[0], init?: RequestInit): DeliveryRequest | null {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  // Uploading bytes alone cannot deliver a message to the recipient.
  if (/\/(?:photo_original|asyncfile)\/upload\/?$/.test(url.pathname) || /\/upthumb\/?$/.test(url.pathname)) return null;
  const kind = /\/(?:photo_original\/send|gif)\/?$/.test(url.pathname) ? 'image'
    : /\/asyncfile\/msg\/?$/.test(url.pathname) ? 'file' : 'other';
  const body = init?.body;
  const params = body instanceof URLSearchParams ? body : typeof body === 'string' ? new URLSearchParams(body) : null;
  const decoded = decodeEnvelope(scope.secretKey, params?.get('params') ?? url.searchParams.get('params'));
  return { kind, index: scope.indices[kind]++, clientId: messageId(decoded?.clientId) };
}
const boundCallbacks = new WeakSet<object>();

/** Remove only callbacks registered by this delivery scope, not another caller's upload. */
export function bindDeliveryUploadCallbacks(api: any): void {
  const callbacks = api.getContext?.()?.uploadCallbacks;
  if (!callbacks || boundCallbacks.has(callbacks)) return;
  boundCallbacks.add(callbacks);
  const originalSet = callbacks.set.bind(callbacks);
  callbacks.set = (key: string, callback: (...args: any[]) => unknown, ttl?: number) => {
    const signal = deliveryScope.getStore()?.signal;
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
export const scopedZaloFetch: typeof fetch = async (input, init) => {
  const scope = deliveryScope.getStore();
  const signal = scope?.signal;
  signal?.throwIfAborted();
  const request = scope ? describeRequest(scope, input, init) : null;
  if (request && scope) {
    await scope.observer?.beforeSend?.(request);
    signal?.throwIfAborted();
    scope.submitted = true;
  }
  const response = await fetch(input, signal ? {
    ...init,
    signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
  } : init);
  if (request && scope?.observer?.accepted && response.ok) {
    // One failed sibling causes SDK Promise.all to discard other successful
    // replies. Preserve each exact acceptance before handing the body to SDK.
    let acceptedId: string | null = null;
    try {
      const envelope = await response.clone().json() as { error_code?: number; data?: unknown };
      const decoded = typeof envelope.data === 'string' ? decodeEnvelope(scope.secretKey, envelope.data) : null;
      const data = decoded?.data as { msgId?: unknown } | undefined;
      if (envelope.error_code === 0 && decoded?.error_code === 0) acceptedId = messageId(data?.msgId);
    } catch { /* SDK remains responsible for decoding or rejecting this response. */ }
    if (acceptedId) await scope.observer.accepted(request, acceptedId);
  }
  return response;
};

export async function withDeliveryDeadline<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs = 90_000, options: { trackTransport?: boolean; secretKey?: string; observer?: DeliveryObserver } = {}): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scope: Scope = { signal: controller.signal, submitted: false, trackTransport: options.trackTransport === true,
    secretKey: options.secretKey, observer: options.observer, indices: { image: 0, file: 0, other: 0 } };
  try {
    return await deliveryScope.run(scope, () => Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new DeliveryDeadlineError();
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]));
  } catch (error) {
    if (scope.trackTransport && error && typeof error === 'object') failurePhases.set(error, scope.submitted ? 'after_send' : 'before_send');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(new Error('Delivery scope finished'));
  }
}
