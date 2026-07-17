import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guards: {
    access: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    deploy: vi.fn(),
    rollback: vi.fn(),
  },
  createRelease: vi.fn(),
  listReleases: vi.fn(),
  getRelease: vi.fn(),
  submitRelease: vi.fn(),
  approveRelease: vi.fn(),
  deployRelease: vi.fn(),
  rollbackRelease: vi.fn(),
}));

vi.mock('../../src/modules/ai/ai-control-plane-permissions.js', () => ({
  aiPermissions: { deployment: mocks.guards },
}));
vi.mock('../../src/modules/ai/release-service.js', () => {
  class ReleaseError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'AI_RELEASE_ERROR') {
      super(message);
    }
  }
  return {
    AI_RELEASE_STATUSES: ['draft', 'pending_approval', 'approved', 'production', 'superseded', 'rolled_back', 'failed'],
    ReleaseError,
    createRelease: mocks.createRelease,
    listReleases: mocks.listReleases,
    getRelease: mocks.getRelease,
    submitRelease: mocks.submitRelease,
    approveRelease: mocks.approveRelease,
    deployRelease: mocks.deployRelease,
    rollbackRelease: mocks.rollbackRelease,
  };
});
vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({
  AIErrorHandler: { normalize: vi.fn(() => ({ statusCode: 500, message: 'Internal error', code: 'UNKNOWN' })) },
}));

import { releaseRoutes } from '../../src/modules/ai/release-routes.js';

function harness() {
  const routes: any[] = [];
  const app = {
    get: vi.fn((path, options, handler) => routes.push({ method: 'GET', path, options, handler })),
    post: vi.fn((path, options, handler) => routes.push({ method: 'POST', path, options, handler })),
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

describe('AI release routes', () => {
  it('registers every lifecycle endpoint with its granular deployment permission', async () => {
    const { app, routes } = harness();
    await releaseRoutes(app as any);
    const expected = [
      ['GET', '/api/v1/ai/releases', mocks.guards.access],
      ['POST', '/api/v1/ai/releases', mocks.guards.create],
      ['GET', '/api/v1/ai/releases/:id', mocks.guards.access],
      ['POST', '/api/v1/ai/releases/:id/submit', mocks.guards.create],
      ['POST', '/api/v1/ai/releases/:id/approve', mocks.guards.approve],
      ['POST', '/api/v1/ai/releases/:id/deploy', mocks.guards.deploy],
      ['POST', '/api/v1/ai/releases/:id/rollback', mocks.guards.rollback],
    ];
    for (const [method, path, guard] of expected) {
      const route = routes.find((item) => item.method === method && item.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      expect(route.options.preHandler).toBe(guard);
    }
  });

  it('creates a draft from component references without accepting a client-built resolved manifest', async () => {
    const { app, routes } = harness();
    await releaseRoutes(app as any);
    mocks.createRelease.mockResolvedValue({ id: 'release-1', status: 'draft' });
    const route = routes.find((item) => item.method === 'POST' && item.path === '/api/v1/ai/releases');
    const reply = replyHarness();
    const snapshot = { promptVersionIds: ['prompt-v1'], modelConfigIds: ['model-1'] };

    await route.handler({
      user: { orgId: 'org-1', id: 'maker-1' },
      body: { snapshot, evaluationRunId: 'eval-1' },
    }, reply);

    expect(mocks.createRelease).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'maker-1' },
      { snapshot, evaluationRunId: 'eval-1' },
    );
    expect(reply.status).toHaveBeenCalledWith(201);
  });
});
