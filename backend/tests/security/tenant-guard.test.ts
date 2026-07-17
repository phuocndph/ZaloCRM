/**
 * tenant-guard.test.ts — Phase 1a (Bảo mật xác thực 2026-06-07)
 * Verify quyết định guard: off=noop, warn=log, enforce=throw, có context/bypass=pass,
 * model không org-scoped=pass.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkTenantGuard } from '../../src/shared/tenant/tenant-guard.js';
import { withTenant, runSystemQuery } from '../../src/shared/tenant/tenant-context.js';
import { config } from '../../src/config/index.js';
import { logger } from '../../src/shared/utils/logger.js';

afterEach(() => {
  config.tenantGuardMode = 'off';
  vi.restoreAllMocks();
});

describe('tenant-guard', () => {
  it('off → no-op kể cả org-scoped model ngoài context', () => {
    config.tenantGuardMode = 'off';
    expect(() => checkTenantGuard('Contact', 'findMany')).not.toThrow();
  });

  it('enforce + org-scoped + KHÔNG context → throw', () => {
    config.tenantGuardMode = 'enforce';
    expect(() => checkTenantGuard('Contact', 'findMany')).toThrowError(/tenant context/i);
  });

  it('treats AiProviderConnection as org-scoped defense in depth', () => {
    config.tenantGuardMode = 'enforce';
    expect(() => checkTenantGuard('AiProviderConnection', 'findMany')).toThrowError(/tenant context/i);
  });

  it('enforce + model KHÔNG org-scoped → pass', () => {
    config.tenantGuardMode = 'enforce';
    // Organization không có orgId → không nằm trong ORG_SCOPED_MODELS.
    expect(() => checkTenantGuard('Organization', 'findMany')).not.toThrow();
  });

  it('enforce + trong withTenant → pass', async () => {
    config.tenantGuardMode = 'enforce';
    await withTenant('org-A', async () => {
      expect(() => checkTenantGuard('Contact', 'findMany')).not.toThrow();
    });
  });

  it('enforce + runSystemQuery bypass → pass (auth-path)', async () => {
    config.tenantGuardMode = 'enforce';
    await runSystemQuery(async () => {
      expect(() => checkTenantGuard('User', 'findUnique')).not.toThrow();
    });
  });

  it('warn + org-scoped + KHÔNG context → log, KHÔNG throw', () => {
    config.tenantGuardMode = 'warn';
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    expect(() => checkTenantGuard('Contact', 'updateMany')).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
  });
});
