import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { mimeToExt } from './types.js';

/** Hash incrementally; documents/videos must not be duplicated as whole-file buffers. */
export async function describeUploadFile(file: string, mime: string, name?: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file, { signal })) {
    hash.update(chunk);
    size += chunk.length;
  }
  signal?.throwIfAborted();
  if (!size) throw new Error('Refusing empty storage object');
  const contentHash = hash.digest('hex');
  return { contentHash, size, key: `media/${contentHash}${name ? extname(name) : mimeToExt(mime)}` };
}
