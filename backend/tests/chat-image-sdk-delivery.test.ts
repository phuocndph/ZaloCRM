// SPDX-License-Identifier: AGPL-3.0-or-later
import { createCipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ instance: vi.fn(), limit: vi.fn(), sent: vi.fn() }));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({ zaloPool: { getInstance: mocks.instance } }));
vi.mock('../src/modules/zalo/zalo-rate-limiter.js', () => ({ zaloRateLimiter: { checkLimits: mocks.limit, recordSend: mocks.sent } }));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
import { exec, isZaloDeliveryUncertain } from '../src/shared/zalo-operations.js';
import { scopedZaloFetch, type DeliveryRequest, type DeliveryObserver } from '../src/shared/zalo-delivery-context.js';
// Real installed SDK; all HTTP requests go to an isolated fake transport.
const require = createRequire(import.meta.url);
const dist = path.dirname(path.dirname(require.resolve('zca-js')));
const { sendMessageFactory } = require(path.join(dist, 'cjs/apis/sendMessage.cjs'));
const { uploadAttachmentFactory } = require(path.join(dist, 'cjs/apis/uploadAttachment.cjs'));
const key = Buffer.alloc(16, 7), secretKey = key.toString('base64');
function encrypt(value: unknown) {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64');
}
function response(data: unknown) {
  return new Response(JSON.stringify({ error_code: 0, data: encrypt({ error_code: 0, data }) }), { status: 200 });
}
function sdk() {
  const ctx = { secretKey, imei: 'isolated-test-imei', userAgent: 'isolated-test-agent', API_TYPE: 30, API_VERSION: 671,
    options: { polyfill: scopedZaloFetch, logging: false }, uploadCallbacks: new Map(),
    settings: { features: { sharefile: { max_file: 10, max_size_share_file_v3: 100, chunk_size_file: 1024 * 1024, restricted_ext_file: [] } } } };
  const api: any = { zpwServiceMap: { chat: ['https://sdk.invalid'], group: ['https://sdk.invalid'], file: ['https://sdk.invalid'] }, getContext: () => ctx };
  api.uploadAttachment = uploadAttachmentFactory(ctx, api); api.sendMessage = sendMessageFactory(ctx, api);
  mocks.instance.mockReturnValue({ api, status: 'connected' }); return api;
}
const images = Array.from({ length: 3 }, (_, i) => ({ filename: `image-${i}.png`, data: Buffer.from('test-image'), metadata: { width: 1, height: 1, totalSize: 10 } }));
function send(api: any, observer?: DeliveryObserver) {
  return exec({ accountId: 'isolated-test', category: 'message', operation: 'sendImage', deliveryOperation: true, deliveryObserver: observer },
    () => api.sendMessage({ msg: '', attachments: images }, 'isolated-thread', 0));
}
beforeEach(() => { vi.resetAllMocks(); mocks.limit.mockResolvedValue({ allowed: true }); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('image delivery through the real SDK', () => {
  it('classifies upload failures as not delivered instead of making every image uncertain', async () => {
    const api = sdk(), before = vi.fn(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await send(api, { beforeSend: before }).catch((e) => e);
    expect(isZaloDeliveryUncertain(error)).toBe(false); expect(error).toMatchObject({ deliveryPhase: 'before_send' });
    expect(before).not.toHaveBeenCalled();
  });
  it('records each exact SDK client ID before the image send starts', async () => {
    const api = sdk(), recorded: DeliveryRequest[] = [], accepted = vi.fn(); let uploads = 0, sends = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (new URL(url).pathname.endsWith('/upload')) return response({ photoId: String(++uploads), normalUrl: 'https://sdk.invalid/photo', finished: 1 });
      expect(recorded).toHaveLength(3); return response({ msgId: String(1000 + sends++) });
    }));
    await send(api, { beforeSend: async (r) => { recorded.push(r); }, accepted });
    expect(recorded.map((r) => r.index)).toEqual([0, 1, 2]); expect(new Set(recorded.map((r) => r.clientId)).size).toBe(3);
    expect(recorded.every((r) => r.kind === 'image' && /^\d+$/.test(r.clientId!))).toBe(true); expect(accepted).toHaveBeenCalledTimes(3);
  });
  it('does not send if its identity could not be saved', async () => {
    const api = sdk(); let sends = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (new URL(url).pathname.endsWith('/upload')) return response({ photoId: '12', normalUrl: 'https://sdk.invalid/photo', finished: 1 });
      sends++; return response({ msgId: '1000' });
    }));
    const error = await send(api, { beforeSend: async () => { throw new Error('Database unavailable'); } }).catch((e) => e);
    expect(sends).toBe(0); expect(isZaloDeliveryUncertain(error)).toBe(false);
  });
  it('keeps final-send response loss uncertain without replaying', async () => {
    const api = sdk(); let sends = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (new URL(url).pathname.endsWith('/upload')) return response({ photoId: '12', normalUrl: 'https://sdk.invalid/photo', finished: 1 });
      sends++; throw new TypeError('fetch failed');
    }));
    const error = await send(api).catch((e) => e);
    expect(isZaloDeliveryUncertain(error)).toBe(true); expect(error).toMatchObject({ deliveryPhase: 'after_send' }); expect(sends).toBe(3);
  });
  it('preserves successful siblings when SDK Promise.all rejects another image', async () => {
    const api = sdk(), accepted = vi.fn(); let sends = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (new URL(url).pathname.endsWith('/upload')) return response({ photoId: '12', normalUrl: 'https://sdk.invalid/photo', finished: 1 });
      const index = sends++;
      if (index === 1) { await new Promise((resolve) => setTimeout(resolve, 30)); throw new TypeError('socket closed'); }
      return response({ msgId: String(2000 + index) });
    }));
    const error = await send(api, { accepted }).catch((e) => e);
    expect(isZaloDeliveryUncertain(error)).toBe(true); expect(accepted.mock.calls.map(([r, id]) => [r.index, id])).toEqual([[0, '2000'], [2, '2002']]);
  });
});
