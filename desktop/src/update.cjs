const { createHash, randomUUID } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

async function downloadVerifiedInstaller(release, tempDir, onProgress = () => {}) {
  const destination = path.join(tempDir, `ZaloCRM-Update-${release.version}-${randomUUID()}.exe`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let received = 0;
  let reportedAt = 0;
  const hash = createHash('sha256');
  try {
    onProgress({ phase: 'downloading', received: 0, total: release.bytes });
    const response = await fetch(release.url, { redirect: 'error', signal: controller.signal, credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error('Download failed');
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== release.bytes) throw new Error('Unexpected installer size');
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > release.bytes) return callback(new Error('Installer is larger than declared'));
        hash.update(chunk);
        const now = Date.now();
        if (now - reportedAt >= 120 || received === release.bytes) {
          reportedAt = now;
          onProgress({ phase: 'downloading', received, total: release.bytes });
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(destination, { flags: 'wx' }));
    if (received !== release.bytes || hash.digest('hex') !== release.sha256) throw new Error('Installer verification failed');
    onProgress({ phase: 'verified', received, total: release.bytes });
    return destination;
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { downloadVerifiedInstaller, DOWNLOAD_TIMEOUT_MS };
