import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guards: {
    access: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    delete: vi.fn(),
    manageSecret: vi.fn(),
  },
  listProviderConnections: vi.fn(),
  getProviderConnection: vi.fn(),
  createProviderConnection: vi.fn(),
  updateProviderConnection: vi.fn(),
  setProviderConnectionSecret: vi.fn(),
  revokeProviderConnectionSecret: vi.fn(),
  getProviderConnectionImpact: vi.fn(),
  deleteProviderConnection: vi.fn(),
  discoverProviderConnectionModels: vi.fn(),
  testProviderConnection: vi.fn(),
}));

vi.mock('../../src/modules/ai/ai-control-plane-permissions.js', () => ({
  aiPermissions: { model: mocks.guards },
}));

vi.mock('../../src/modules/ai/provider-connection-service.js', () => {
  class ProviderConnectionError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'AI_PROVIDER_CONNECTION_ERROR') {
      super(message);
    }
  }
  return {
    ProviderConnectionError,
    listProviderConnections: mocks.listProviderConnections,
    getProviderConnection: mocks.getProviderConnection,
    createProviderConnection: mocks.createProviderConnection,
    updateProviderConnection: mocks.updateProviderConnection,
    setProviderConnectionSecret: mocks.setProviderConnectionSecret,
    revokeProviderConnectionSecret: mocks.revokeProviderConnectionSecret,
    getProviderConnectionImpact: mocks.getProviderConnectionImpact,
    deleteProviderConnection: mocks.deleteProviderConnection,
    discoverProviderConnectionModels: mocks.discoverProviderConnectionModels,
    testProviderConnection: mocks.testProviderConnection,
  };
});

vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({
  AIErrorHandler: {
    normalize: vi.fn(() => ({
      statusCode: 500,
      message: 'Internal error',
      code: 'UNKNOWN',
      retryable: false,
    })),
  },
}));

import { providerConnectionRoutes } from '../../src/modules/ai/provider-connection-routes.js';
import { ProviderConnectionError } from '../../src/modules/ai/provider-connection-service.js';

function harness() {
  const routes: any[] = [];
  const register = (method: string) => vi.fn((path, options, handler) => {
    routes.push({ method, path, options, handler });
  });
  const app = {
    get: register('GET'),
    post: register('POST'),
    patch: register('PATCH'),
    put: register('PUT'),
    delete: register('DELETE'),
  };
  return { app, routes };
}

function replyHarness() {
  const reply: any = {
    status: vi.fn(() => reply),
    send: vi.fn((value) => value),
  };
  return reply;
}

describe('provider connection routes', () => {
  it('registers CRUD, impact and secret endpoints with granular model permissions', async () => {
    const { app, routes } = harness();
    await providerConnectionRoutes(app as any);

    const expected = [
      ['GET', '/api/v1/ai/provider-connections', mocks.guards.access],
      ['POST', '/api/v1/ai/provider-connections', mocks.guards.create],
      ['GET', '/api/v1/ai/provider-connections/:id', mocks.guards.access],
      ['GET', '/api/v1/ai/provider-connections/:id/impact', mocks.guards.access],
      ['GET', '/api/v1/ai/provider-connections/:id/models', mocks.guards.manageSecret],
      ['POST', '/api/v1/ai/provider-connections/:id/test', mocks.guards.manageSecret],
      ['PATCH', '/api/v1/ai/provider-connections/:id', mocks.guards.edit],
      ['PUT', '/api/v1/ai/provider-connections/:id/secret', mocks.guards.manageSecret],
      ['DELETE', '/api/v1/ai/provider-connections/:id/secret', mocks.guards.manageSecret],
      ['DELETE', '/api/v1/ai/provider-connections/:id', mocks.guards.delete],
    ];
    for (const [method, path, guard] of expected) {
      const route = routes.find((item) => item.method === method && item.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      expect(route.options.preHandler).toBe(guard);
    }
    expect(routes.find((item) => item.path.endsWith('/:id/models')).options.config.rateLimit)
      .toEqual({ max: 10, timeWindow: '1 minute' });
    expect(routes.find((item) => item.path.endsWith('/:id/test')).options.config.rateLimit)
      .toEqual({ max: 5, timeWindow: '1 minute' });
  });

  it('never forwards an API key submitted through the metadata create endpoint', async () => {
    const { app, routes } = harness();
    await providerConnectionRoutes(app as any);
    mocks.createProviderConnection.mockResolvedValue({ id: 'connection-1', status: 'draft' });
    const route = routes.find((item) => item.method === 'POST' && item.path === '/api/v1/ai/provider-connections');
    const reply = replyHarness();

    await route.handler({
      user: { orgId: 'org-1', id: 'admin-1' },
      body: {
        name: '9Router',
        vendor: '9router',
        baseUrl: 'http://host.docker.internal:20128/v1',
        apiKey: 'must-not-be-forwarded',
      },
    }, reply);

    expect(mocks.createProviderConnection).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'admin-1' },
      {
        key: undefined,
        name: '9Router',
        adapter: undefined,
        vendor: '9router',
        baseUrl: 'http://host.docker.internal:20128/v1',
      },
    );
    expect(JSON.stringify(mocks.createProviderConnection.mock.calls)).not.toContain('must-not-be-forwarded');
    expect(reply.status).toHaveBeenCalledWith(201);
  });

  it('passes a secret only to the manage_secret service endpoint', async () => {
    const { app, routes } = harness();
    await providerConnectionRoutes(app as any);
    mocks.setProviderConnectionSecret.mockResolvedValue({ id: 'connection-1', apiKeyConfigured: true });
    const route = routes.find((item) => item.method === 'PUT' && item.path === '/api/v1/ai/provider-connections/:id/secret');

    await route.handler({
      user: { orgId: 'org-1', id: 'admin-1' },
      params: { id: 'connection-1' },
      body: { apiKey: 'sk-secret' },
    }, replyHarness());

    expect(mocks.setProviderConnectionSecret).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'admin-1' },
      'connection-1',
      'sk-secret',
    );
  });

  it('passes the optional model and tenant actor to the rate-limited probe service', async () => {
    const { app, routes } = harness();
    await providerConnectionRoutes(app as any);
    mocks.testProviderConnection.mockResolvedValue({
      connection: { id: 'connection-1', status: 'connected' },
      probe: { selectedModel: 'model-a', completionVerified: true },
    });
    const route = routes.find((item) => item.method === 'POST' && item.path === '/api/v1/ai/provider-connections/:id/test');

    await route.handler({
      user: { orgId: 'org-1', id: 'admin-1' },
      params: { id: 'connection-1' },
      body: { model: 'model-a' },
    }, replyHarness());

    expect(mocks.testProviderConnection).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'admin-1' },
      'connection-1',
      { model: 'model-a' },
    );
  });

  it('maps service errors to stable HTTP status and code', async () => {
    const { app, routes } = harness();
    await providerConnectionRoutes(app as any);
    mocks.getProviderConnection.mockRejectedValue(
      new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND'),
    );
    const route = routes.find((item) => item.method === 'GET' && item.path === '/api/v1/ai/provider-connections/:id');
    const reply = replyHarness();

    await route.handler({
      user: { orgId: 'org-1', id: 'admin-1' },
      params: { id: 'missing' },
    }, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'Provider connection not found',
      code: 'AI_CONNECTION_NOT_FOUND',
    });
  });
});
