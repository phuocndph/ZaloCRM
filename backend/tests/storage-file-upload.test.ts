import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const root = await mkdtemp(path.join(os.tmpdir(), 'zalocrm-stream-storage-test-'));
vi.stubEnv('UPLOAD_DIR', path.join(root, 'objects'));
const { localDriver } = await import('../src/shared/storage/local-driver.js');
afterAll(async () => {
  const absolute = path.resolve(root);
  if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(absolute).startsWith('zalocrm-stream-storage-test-')) throw new Error('Unsafe cleanup');
  await rm(absolute, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('streamed durable storage', () => {
  it('copies exact source bytes with content-hash deduplication', async () => {
    const bytes = Buffer.alloc(512 * 1024, 17);
    const source = path.join(root, 'source.pdf');
    await writeFile(source, bytes);
    const first = await localDriver.uploadFile(source, 'application/pdf', 'quote.pdf');
    expect(first.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(first.size).toBe(bytes.length);
    expect(first.deduped).toBe(false);
    expect(await readFile(path.join(root, 'objects', first.key))).toEqual(bytes);
    const second = await localDriver.uploadFile(source, 'application/pdf', 'quote.pdf');
    expect(second.key).toBe(first.key);
    expect(second.deduped).toBe(true);
    expect(await readdir(path.join(root, 'objects', 'media'))).toHaveLength(1);
  });
  it('does not publish a partial object after cancellation', async () => {
    const source = path.join(root, 'aborted.zip');
    await writeFile(source, Buffer.alloc(2048, 23));
    const controller = new AbortController(); controller.abort();
    await expect(localDriver.uploadFile(source, 'application/zip', 'aborted.zip', controller.signal)).rejects.toThrow();
    expect(await readdir(path.join(root, 'objects', 'media'))).toHaveLength(1);
  });
});
