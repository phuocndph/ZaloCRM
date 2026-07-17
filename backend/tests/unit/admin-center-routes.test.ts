import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userHasGrant: vi.fn(),
  getAiReadiness: vi.fn(),
  testProviderConnection: vi.fn(),
  adminCenterSummary: vi.fn(),
  adminCenterAudit: vi.fn(),
  setAdminEmergencyStop: vi.fn(),
}));

vi.mock('../../src/modules/rbac/permission-group-service.js', () => ({
  userHasGrant: mocks.userHasGrant,
}));
vi.mock('../../src/modules/ai/ai-readiness-service.js', () => {
  class AiReadinessError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'AI_READINESS_ERROR') {
      super(message);
    }
  }
  return {
    AiReadinessError,
    getAiReadiness: mocks.getAiReadiness,
    testProviderConnection: mocks.testProviderConnection,
  };
});
vi.mock('../../src/modules/ai/admin-center-service.js', () => {
  class AiAdminCenterError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'AI_ADMIN_CENTER_ERROR') {
      super(message);
    }
  }
  return {
    AiAdminCenterError,
    adminCenterSummary: mocks.adminCenterSummary,
    adminCenterAudit: mocks.adminCenterAudit,
    setAdminEmergencyStop: mocks.setAdminEmergencyStop,
  };
});
vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({
  AIErrorHandler: {
    normalize: vi.fn(() => ({ statusCode: 500, message: 'Internal AI error', code: 'UNKNOWN' })),
  },
}));

import { adminCenterRoutes } from '../../src/modules/ai/admin-center-routes.js';

type RegisteredRoute = {
  method: 'GET' | 'POST';
  path: string;
  options: { preHandler: (request: any, reply: any) => Promise<any>; [key: string]: any };
  handler: (request: any, reply: any) => Promise<any>;
};

function routeHarness() {
  const routes: RegisteredRoute[] = [];
  const app = {
    get: vi.fn((path, options, handler) => routes.push({ method: 'GET', path, options, handler })),
    post: vi.fn((path, options, handler) => routes.push({ method: 'POST', path, options, handler })),
  };
  return { app, routes };
}

function replyHarness() {
  const reply: any = {
    statusCode: 200,
    payload: undefined,
    status: vi.fn((statusCode: number) => {
      reply.statusCode = statusCode;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      return payload;
    }),
  };
  return reply;
}

describe('AI admin center RBAC routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies and allows each sensitive endpoint using its granular AI grant', async () => {
    const { app, routes } = routeHarness();
    await adminCenterRoutes(app as any);
    const cases = [
      ['GET', '/api/v1/ai/admin/readiness', 'ai', 'access'],
      ['POST', '/api/v1/ai/admin/providers/:provider/test', 'ai_model', 'manage_secret'],
      ['GET', '/api/v1/ai/admin-center/audit', 'ai_audit', 'access'],
      ['POST', '/api/v1/ai/admin-center/emergency-stop', 'ai_auto_reply', 'emergency_stop'],
    ] as const;

    for (const [method, path, resource, action] of cases) {
      const route = routes.find((item) => item.method === method && item.path === path);
      expect(route, `${method} ${path}`).toBeDefined();

      mocks.userHasGrant.mockReset().mockResolvedValueOnce(false);
      const deniedReply = replyHarness();
      await route!.options.preHandler({ user: { id: 'user-1', role: 'member' } }, deniedReply);
      expect(mocks.userHasGrant).toHaveBeenCalledWith('user-1', resource, action);
      expect(deniedReply.status).toHaveBeenCalledWith(403);
      expect(deniedReply.payload).toMatchObject({ code: 'RBAC_FORBIDDEN', resource, action });

      mocks.userHasGrant.mockReset().mockResolvedValueOnce(true);
      const allowedReply = replyHarness();
      const result = await route!.options.preHandler({ user: { id: 'user-1', role: 'member' } }, allowedReply);
      expect(result).toBeUndefined();
      expect(mocks.userHasGrant).toHaveBeenCalledWith('user-1', resource, action);
      expect(allowedReply.status).not.toHaveBeenCalled();
    }
  });

  it('returns readiness for the authenticated organization', async () => {
    const { app, routes } = routeHarness();
    await adminCenterRoutes(app as any);
    mocks.getAiReadiness.mockResolvedValue({ ready: false, status: 'needs_test' });
    const route = routes.find((item) => item.path === '/api/v1/ai/admin/readiness')!;

    const result = await route.handler({ user: { orgId: 'org-1', role: 'admin' } }, replyHarness());

    expect(mocks.getAiReadiness).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({ ready: false, status: 'needs_test' });
  });

  it('maps a sanitized failed provider probe to HTTP 502', async () => {
    const { app, routes } = routeHarness();
    await adminCenterRoutes(app as any);
    const failure = {
      ok: false,
      status: 'failed',
      provider: 'openai',
      errorCode: 'AI_PROVIDER_CONNECTION_FAILED',
      message: 'Không thể kết nối nhà cung cấp AI.',
    };
    mocks.testProviderConnection.mockResolvedValue(failure);
    const route = routes.find((item) => item.path === '/api/v1/ai/admin/providers/:provider/test')!;
    const reply = replyHarness();

    await route.handler({
      user: { orgId: 'org-1', role: 'admin' },
      params: { provider: 'openai' },
      body: { model: 'gpt-test' },
    }, reply);

    expect(mocks.testProviderConnection).toHaveBeenCalledWith('org-1', 'openai', 'gpt-test');
    expect(reply.status).toHaveBeenCalledWith(502);
    expect(reply.payload).toEqual(failure);
  });
});
