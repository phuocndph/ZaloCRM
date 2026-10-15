import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDesktopRelease, getLatestDesktopRelease, isDesktopReleaseVersion } from '../src/modules/desktop/desktop-release-service.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zalocrm-release-'));
  roots.push(root);
  const version = '1.2.3';
  const bytes = Buffer.from('installer');
  const manifest = {
    version,
    publishedAt: '2026-10-15T00:00:00.000Z',
    notes: ['Fix chat'],
    platform: 'win32',
    arch: 'x64',
    filename: 'ZaloCRM-Setup-1.2.3.exe',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...overrides,
  };
  const releaseDir = join(root, 'releases', version);
  await mkdir(releaseDir, { recursive: true });
  await writeFile(join(releaseDir, manifest.filename as string), bytes);
  await writeFile(join(releaseDir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'latest.json'), JSON.stringify(manifest));
  return { root, version, manifest };
}

describe('desktop release storage', () => {
  it('loads a valid immutable release and latest pointer', async () => {
    const { root, version } = await fixture();
    expect((await getDesktopRelease(version, root))?.manifest.version).toBe(version);
    expect((await getLatestDesktopRelease(root))?.manifest.version).toBe(version);
  });

  it('fails closed for traversal, malformed manifests and wrong artifact sizes', async () => {
    expect(isDesktopReleaseVersion('../1.2.3')).toBe(false);
    expect(await getDesktopRelease('../1.2.3', 'C:/tmp')).toBeNull();
    const invalid = await fixture({ filename: '../outside.exe' });
    expect(await getLatestDesktopRelease(invalid.root)).toBeNull();
    const wrongSize = await fixture({ bytes: 999 });
    expect(await getLatestDesktopRelease(wrongSize.root)).toBeNull();
  });
});
