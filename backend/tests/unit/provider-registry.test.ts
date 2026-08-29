import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  decryptToken: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    anthropicBaseUrl: '', anthropicAuthToken: '',
    geminiBaseUrl: '', geminiAuthToken: '',
    openaiBaseUrl: '', openaiAuthToken: '',
    qwenBaseUrl: '', qwenAuthToken: '',
    kimiBaseUrl: '', kimiAuthToken: '',
    nineRouterBaseUrl: 'https://router.example.com/v1', nineRouterApiKey: 'env-router-key',
    f5QuotaBaseUrl: 'https://f5quota.store/v1', f5QuotaApiKey: '',
  },
}));
vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: { appSetting: { findUnique: mocks.findUnique, deleteMany: vi.fn(), upsert: vi.fn() } },
}));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({
  encryptToken: vi.fn((value: string) => `encrypted:${value}`),
  decryptToken: mocks.decryptToken,
}));
vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: { warn: mocks.warn },
}));

import { resolveProviderApiKey } from '../../src/modules/ai/provider-registry.js';

describe('legacy AI provider registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      valueEncrypted: new TextEncoder().encode('old-key-ciphertext'),
      valuePlain: null,
    });
    mocks.decryptToken.mockImplementation(() => {
      throw new Error('authentication failed');
    });
  });

  it('falls back safely and warns only once for an undecryptable legacy key', async () => {
    await expect(resolveProviderApiKey('org-registry-test', '9router')).resolves.toBe('env-router-key');
    await expect(resolveProviderApiKey('org-registry-test', '9router')).resolves.toBe('env-router-key');

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(String(mocks.warn.mock.calls[0]?.[0])).not.toContain('authentication failed');
  });
});
