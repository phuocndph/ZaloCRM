import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guards: {
    access: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    delete: vi.fn(),
    approve: vi.fn(),
  },
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  clone: vi.fn(),
  test: vi.fn(),
  submit: vi.fn(),
  approve: vi.fn(),
  archive: vi.fn(),
  impact: vi.fn(),
  setDefault: vi.fn(),
}));

vi.mock('../../src/modules/ai/ai-control-plane-permissions.js', () => ({
  aiPermissions: { model: mocks.guards },
}));

vi.mock('../../src/modules/ai/model-config-manager-service.js', () => ({
  listModelConfigs: mocks.list,
  getModelConfig: mocks.get,
  createModelConfig: mocks.create,
}));

vi.mock('../../src/modules/ai/model-config-mutation-service.js', () => ({
  updateModelConfig: mocks.update,
  cloneModelConfig: mocks.clone,
}));

vi.mock('../../src/modules/ai/model-config-lifecycle-service.js', () => ({
  testModelConfig: mocks.test,
  submitModelConfig: mocks.submit,
  approveModelConfig: mocks.approve,
  archiveModelConfig: mocks.archive,
  getModelConfigImpact: mocks.impact,
  setDefaultModelConfig: mocks.setDefault,
}));

vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({
  AIErrorHandler: {
    normalize: vi.fn(() => ({ statusCode: 500, message: 'Internal error', code: 'UNKNOWN', retryable: false })),
  },
}));

import { modelConfigRoutes } from '../../src/modules/ai/model-config-routes.js';
import { ModelConfigError } from '../../src/modules/ai/model-config-service.js';

function harness() {
  const routes: any[] = [];
  const register = (method: string) => vi.fn((path, options, handler) => routes.push({ method, path, options, handler }));
  return {
    app: { get: register('GET'), post: register('POST'), patch: register('PATCH') },
    routes,
  };
}

function replyHarness() {
  const reply: any = { status: vi.fn(() => reply), send: vi.fn((value) => value) };
  return reply;
}

describe('model config routes', () => {
  it('registers lifecycle endpoints with granular permissions and a rate-limited test', async () => {
    const { app, routes } = harness();
    await modelConfigRoutes(app as any);
    const expected = [
      ['GET', '/api/v1/ai/model-configs', mocks.guards.access],
      ['POST', '/api/v1/ai/model-configs', mocks.guards.create],
      ['GET', '/api/v1/ai/model-configs/:id', mocks.guards.access],
      ['GET', '/api/v1/ai/model-configs/:id/impact', mocks.guards.access],
      ['PATCH', '/api/v1/ai/model-configs/:id', mocks.guards.edit],
      ['POST', '/api/v1/ai/model-configs/:id/clone', mocks.guards.create],
      ['POST', '/api/v1/ai/model-configs/:id/test', mocks.guards.edit],
      ['POST', '/api/v1/ai/model-configs/:id/submit', mocks.guards.edit],
      ['POST', '/api/v1/ai/model-configs/:id/approve', mocks.guards.approve],
      ['POST', '/api/v1/ai/model-configs/:id/archive', mocks.guards.delete],
      ['POST', '/api/v1/ai/model-configs/:id/default', mocks.guards.edit],
    ];
    for (const [method, path, guard] of expected) {
      const route = routes.find((item) => item.method === method && item.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      expect(route.options.preHandler).toBe(guard);
    }
    expect(routes.find((item) => item.path.endsWith('/:id/test')).options.config.rateLimit)
      .toEqual({ max: 5, timeWindow: '1 minute' });
  });

  it('forwards only the model create allowlist and never top-level credentials', async () => {
    const { app, routes } = harness();
    await modelConfigRoutes(app as any);
    mocks.create.mockResolvedValue({ id: 'model-1', status: 'draft' });
    const route = routes.find((item) => item.method === 'POST' && item.path === '/api/v1/ai/model-configs');
    const reply = replyHarness();
    await route.handler({
      user: { orgId: 'org-1', id: 'maker-1' },
      body: {
        connectionId: 'connection-1',
        logicalKey: 'reply-main',
        displayName: 'Reply main',
        externalModelId: 'model-a',
        credentialRef: 'env:SECRET',
        apiKey: 'must-not-leak',
        customHeaders: { Authorization: 'must-not-leak' },
      },
    }, reply);
    expect(mocks.create).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'maker-1' },
      expect.objectContaining({
        connectionId: 'connection-1',
        logicalKey: 'reply-main',
        displayName: 'Reply main',
        externalModelId: 'model-a',
      }),
    );
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('must-not-leak');
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('credentialRef');
    expect(reply.status).toHaveBeenCalledWith(201);
  });

  it('uses a distinct approve guard and preserves the tenant actor', async () => {
    const { app, routes } = harness();
    await modelConfigRoutes(app as any);
    mocks.approve.mockResolvedValue({ id: 'model-1', status: 'approved' });
    const route = routes.find((item) => item.path.endsWith('/:id/approve'));
    await route.handler(
      { user: { orgId: 'org-1', id: 'checker-1' }, params: { id: 'model-1' } },
      replyHarness(),
    );
    expect(route.options.preHandler).toBe(mocks.guards.approve);
    expect(mocks.approve).toHaveBeenCalledWith({ orgId: 'org-1', userId: 'checker-1' }, 'model-1');
  });

  it('maps stable service error codes to HTTP responses', async () => {
    const { app, routes } = harness();
    await modelConfigRoutes(app as any);
    mocks.get.mockRejectedValue(new ModelConfigError('Not found', 404, 'AI_MODEL_NOT_FOUND'));
    const route = routes.find((item) => item.method === 'GET' && item.path === '/api/v1/ai/model-configs/:id');
    const reply = replyHarness();
    await route.handler({ user: { orgId: 'org-1' }, params: { id: 'missing' } }, reply);
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Not found', code: 'AI_MODEL_NOT_FOUND' });
  });
});
