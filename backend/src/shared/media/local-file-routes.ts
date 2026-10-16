import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ensureBrowserAudio, REMUX_AUDIO_EXTS } from './audio-remux.js';

/** Isolate sendFile from the frontend static plugin while retaining HTTP range support. */
export async function localFileRoutes(app: FastifyInstance, options: { root: string }) {
  const root = path.resolve(options.root);
  await mkdir(root, { recursive: true });
  await app.register(fastifyStatic, { root, prefix: '/files/', cacheControl: true, maxAge: '365d', immutable: true });
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    const url = request.url.split('?')[0];
    if (!url.startsWith('/files/')) return;
    let relative: string;
    try { relative = decodeURIComponent(url.slice('/files/'.length)); } catch { return; }
    if (!REMUX_AUDIO_EXTS.has(path.extname(relative).slice(1).toLowerCase())) return;
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) return reply.code(400).send({ error: 'Invalid file path' });
    const playable = await ensureBrowserAudio(absolute);
    if (!playable) return;
    return reply.type('audio/mp4').sendFile(path.basename(playable), path.dirname(playable));
  });
}
