// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { compareDesktopVersions, useDesktopRelease } from './use-desktop-release';

vi.mock('@/api', () => ({ api: { get: vi.fn() } }));

const manifest = {
  version: '0.10.0', publishedAt: '2026-10-15T00:00:00.000Z', notes: ['Update'],
  platform: 'win32', arch: 'x64', filename: 'ZaloCRM-Setup-0.10.0.exe', bytes: 123,
  sha256: 'a'.repeat(64), downloadUrl: '/api/v1/desktop/releases/0.10.0/download',
};

describe('desktop release state', () => {
  const release = useDesktopRelease();
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: { available: true, release: manifest } } as never);
    window.zaloDesktop = { role: 'main', appInfo: vi.fn().mockResolvedValue({ version: '0.2.1', platform: 'win32', arch: 'x64' }) } as never;
  });
  afterEach(() => {
    release.stop();
    localStorage.clear();
    delete window.zaloDesktop;
    vi.clearAllMocks();
  });

  it('compares numeric versions instead of lexical strings', () => {
    expect(compareDesktopVersions('0.10.0', '0.2.1')).toBe(1);
    expect(compareDesktopVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareDesktopVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('detects an update using the installed desktop version', async () => {
    release.start('org:user');
    await vi.waitFor(() => expect(release.latest.value?.version).toBe('0.10.0'));
    expect(release.currentVersion.value).toBe('0.2.1');
    expect(release.hasUpdate.value).toBe(true);
  });

  it('uses per-account seen state when an older desktop cannot report its version', async () => {
    delete window.zaloDesktop;
    release.start('org:user');
    await vi.waitFor(() => expect(release.latest.value?.version).toBe('0.10.0'));
    expect(release.hasUpdate.value).toBe(true);
    release.markSeen();
    expect(release.hasUpdate.value).toBe(false);
    expect(localStorage.getItem('desktop-release-seen:org:user')).toBe('0.10.0');
  });

  it('uses the native installer bridge when the desktop client supports it', async () => {
    const installUpdate = vi.fn().mockResolvedValue({ ok: false, error: 'Không thể mở bộ cài đặt.' });
    window.zaloDesktop = { role: 'main', appInfo: vi.fn().mockResolvedValue({ version: '0.2.1', platform: 'win32', arch: 'x64' }), installUpdate } as never;
    release.start('org:user');
    await vi.waitFor(() => expect(release.latest.value?.version).toBe('0.10.0'));
    await expect(release.install()).resolves.toBe(false);
    expect(installUpdate).toHaveBeenCalledWith(manifest);
    expect(release.error.value).toBe('Không thể mở bộ cài đặt.');
  });
});
