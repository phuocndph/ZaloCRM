import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ aiModelConfig: { findFirst: vi.fn() }, aiAuditLog: { findFirst: vi.fn() } }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('../../src/modules/ai/provider-connection-service.js', () => ({ getProviderConnectionRuntime: vi.fn(async () => ({ id: 'connection', vendor: 'f5quota', adapter: 'openai_compatible', baseUrl: 'https://provider.example/v1', apiKey: 'test-secret' })) }));
import { ModelRegistry } from '../../src/modules/ai/core/model-registry.js';
const registry = new ModelRegistry().registerProvider({ id: 'f5quota', complete: vi.fn() });
beforeEach(() => {
  vi.resetAllMocks();
  db.aiModelConfig.findFirst.mockImplementation(async ({ select }: any) => select.connection
    ? { connection: { status: 'connected' } }
    : { id: 'model', orgId: 'org', name: 'Tested model', provider: 'f5quota', model: 'model-id', connectionId: 'connection', parameters: {}, dataPolicy: {}, status: 'submitted' });
  db.aiAuditLog.findFirst.mockResolvedValue({ eventType: 'model_config.tested', outcome: 'success', metadata: { completionVerified: true } });
});
describe('research readiness from persisted test history', () => {
  it('uses a successful completion test without changing model approval', async () => {
    await expect(registry.resolve('org', 'model', { purpose: 'customer_research' })).resolves.toMatchObject({ id: 'model' });
    expect(db.aiAuditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org', targetId: 'model' }) }));
    await expect(registry.resolve('org', 'model')).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });
  it.each([
    null,
    { eventType: 'model_config.tested', outcome: 'failed', metadata: {} },
    { eventType: 'model_config.updated', outcome: 'success', metadata: {} },
    { eventType: 'model_config.tested', outcome: 'success', metadata: { completionVerified: false } },
  ])('rejects stale, absent or unsuccessful test history: %j', async (event) => {
    db.aiAuditLog.findFirst.mockResolvedValue(event);
    await expect(registry.resolve('org', 'model', { purpose: 'customer_research' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });
  it('rejects a connection that needs another test', async () => {
    const original = db.aiModelConfig.findFirst.getMockImplementation()!;
    db.aiModelConfig.findFirst.mockImplementation(async (args: any) => args.select.connection ? { connection: { status: 'needs_test' } } : original(args));
    await expect(registry.resolve('org', 'model', { purpose: 'customer_research' })).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });
});
