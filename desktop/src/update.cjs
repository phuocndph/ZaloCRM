const { createHash, randomUUID } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { githubRelease } = require('./policy.cjs');

const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

async function latestGithubRelease() {
  const response = await fetch('https://api.github.com/repos/phuocndph/ZaloCRM/releases/latest', {
    redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ZaloCRM-Desktop' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Release lookup failed');
  const release = githubRelease(await response.json());
  if (!release) throw new Error('Invalid release metadata');
  return release;
}

async function installerResponse(release, signal) {
  let url = release.url;
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal, credentials: 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    if (release.source !== 'github') throw new Error('Unexpected download redirect');
    const next = new URL(response.headers.get('location') || '', url);
    if (next.protocol !== 'https:' || next.username || next.password || next.port || next.hash
      || next.hostname !== 'release-assets.githubusercontent.com') throw new Error('Untrusted download redirect');
    url = next.href;
  }
  throw new Error('Too many download redirects');
}

async function downloadVerifiedInstaller(release, tempDir, onProgress = () => {}) {
  const destination = path.join(tempDir, `ZaloCRM-Update-${release.version}-${randomUUID()}.exe`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let received = 0;
  let reportedAt = 0;
  const hash = createHash('sha256');
  try {
    onProgress({ phase: 'downloading', received: 0, total: release.bytes });
    const response = await installerResponse(release, controller.signal);
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
    controller.abort();
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { downloadVerifiedInstaller, latestGithubRelease, DOWNLOAD_TIMEOUT_MS };
