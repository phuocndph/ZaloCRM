import { access, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadMediaBatch,
  downloadMediaToTemp,
  filenameFromUrl,
} from '../src/modules/chat/chat-media-helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat media download helpers', () => {
  it('streams a media response to a temporary file and cleans it up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    ));

    const tmp = await downloadMediaToTemp({ url: 'https://cdn.example/image.jpg' }, 'image');
    expect([...await readFile(tmp.path)]).toEqual([1, 2, 3, 4]);
    await tmp.cleanup();
    await expect(access(tmp.path)).rejects.toThrow();
  });

  it('downloads a batch concurrently while preserving source order', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const value = url.includes('first') ? 11 : url.includes('second') ? 22 : 33;
      return new Response(new Uint8Array([value]), { status: 200 });
    }));

    const tmps = await downloadMediaBatch([
      { media: { url: 'https://cdn.example/first.jpg' }, contentType: 'image' },
      { media: { url: 'https://cdn.example/second.jpg' }, contentType: 'image' },
      { media: { url: 'https://cdn.example/third.jpg' }, contentType: 'image' },
    ], 2);
    try {
      expect(await Promise.all(tmps.map(async (tmp) => (await readFile(tmp.path))[0]))).toEqual([11, 22, 33]);
    } finally {
      await Promise.all(tmps.map((tmp) => tmp.cleanup()));
    }
  });

  it('keeps a real filename when forwarding documents', () => {
    expect(filenameFromUrl('https://cdn.example/blob', 'file', 'Bang bao gia.xlsx')).toBe('Bang bao gia.xlsx');
  });
});
