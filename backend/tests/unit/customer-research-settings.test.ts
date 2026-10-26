// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { appSetting: { findUnique: mocks.find, upsert: mocks.upsert } } }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ encryptToken: (s: string) => `encrypted:${s}`, decryptToken: (s: string) => { if (!s.startsWith('encrypted:')) throw new Error('invalid credential'); return s.slice(10); } }));
import { researchSearchKey, researchCapabilities, saveResearchSearchKey } from '../../src/modules/ai/research/research-settings.js';
const actor = { orgId: 'org-a', userId: 'owner', role: 'owner' };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('RESEARCH_SERPER_API_KEY', 'env-key'); mocks.find.mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());
describe('direct research search configuration', () => {
  it('isolates each organization and stores encrypted credentials without echoing them', async () => {
    expect(await saveResearchSearchKey(actor, { apiKey: 'org-secret' })).toEqual({ configured: true });
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ orgId_settingKey: { orgId: 'org-a', settingKey: 'research_serper_api_key' } });
    expect(args.create.valueEncrypted.toString()).toBe('encrypted:org-secret');
    expect(args.update.valuePlain).toBeNull();
    mocks.find.mockResolvedValue({ valueEncrypted: Buffer.from('encrypted:org-secret') });
    expect(await researchSearchKey('org-a')).toBe('org-secret');
    expect(await researchCapabilities('org-a')).not.toHaveProperty('apiKey');
    expect(JSON.stringify(await researchCapabilities('org-a'))).not.toContain('org-secret');
  });
  it('uses the existing environment configuration when no organization key is stored', async () => {
    expect(await researchSearchKey('org-a')).toBe('env-key');
  });
  it('does not silently fall back when a stored organization secret cannot be decrypted', async () => {
    mocks.find.mockResolvedValue({ valueEncrypted: Buffer.from('broken') });
    await expect(researchSearchKey('org-a')).rejects.toThrow();
  });
  it('rejects ordinary employees and empty or whitespace-containing keys', async () => {
    await expect(saveResearchSearchKey({ ...actor, role: 'sale' }, { apiKey: 'secret' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(saveResearchSearchKey(actor, { apiKey: '' })).rejects.toThrow();
    await expect(saveResearchSearchKey(actor, { apiKey: 'two keys' })).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
