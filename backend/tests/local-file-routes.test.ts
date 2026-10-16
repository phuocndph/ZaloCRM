import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localFileRoutes } from '../src/shared/media/local-file-routes.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) { expect(root.startsWith(path.join(tmpdir(), 'zcrm-audio-http-'))).toBe(true); await rm(root, { recursive: true, force: true }); } });
describe('local browser audio HTTP', () => {
  it('serves converted audio with byte ranges, HEAD and no frontend decorator conflicts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zcrm-audio-http-')); roots.push(root);
    const bytes = Buffer.from('0000ftyp-audio-fixture'); await writeFile(path.join(root, 'voice.aac'), 'original'); await writeFile(path.join(root, 'voice.aac.browser.m4a'), bytes);
    const app = Fastify(); app.register(localFileRoutes, { root }); app.register(fastifyStatic, { root, prefix: '/' });
    try {
      const response = await app.inject({ url: '/files/voice.aac', headers: { range: 'bytes=0-7' } });
      expect(response.statusCode).toBe(206); expect(response.headers['content-type']).toContain('audio/mp4'); expect(response.headers['content-range']).toBe(`bytes 0-7/${bytes.length}`); expect(response.rawPayload).toEqual(bytes.subarray(0, 8));
      const suffix = await app.inject({ url: '/files/voice.aac', headers: { range: 'bytes=-4' } }); expect(suffix.rawPayload).toEqual(bytes.subarray(-4));
      const head = await app.inject({ method: 'HEAD', url: '/files/voice.aac' }); expect(head.statusCode).toBe(200); expect(head.headers['content-length']).toBe(String(bytes.length)); expect(head.body).toBe('');
      expect((await app.inject({ url: '/files/voice.aac', headers: { range: 'bytes=9999-' } })).statusCode).toBe(416);
      expect((await app.inject({ url: '/files/missing.aac' })).statusCode).toBe(404);
      const original = await app.inject({ url: '/voice.aac' }); expect(original.body).toBe('original');
    } finally { await app.close(); }
  });
});
