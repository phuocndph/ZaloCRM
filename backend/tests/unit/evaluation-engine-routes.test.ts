import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runServerEvaluation: vi.fn(),
  seedInitialEvaluationCases: vi.fn(),
}));

vi.mock('../../src/modules/ai/ai-control-plane-permissions.js', () => ({
  aiPermissions: {
    evaluation: {
      create: vi.fn(async () => undefined),
    },
  },
}));

vi.mock('../../src/modules/ai/evaluation-engine-service.js', () => {
  class EvaluationEngineError extends Error {
    constructor(
      message: string,
      public readonly statusCode = 400,
      public readonly code = 'EVALUATION_ENGINE_ERROR',
    ) {
      super(message);
    }
  }

  return {
    EvaluationEngineError,
    seedInitialEvaluationCases: mocks.seedInitialEvaluationCases,
  };
});

vi.mock('../../src/modules/ai/evaluation-server-runner-service.js', () => ({
  runServerEvaluation: mocks.runServerEvaluation,
}));

vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({
  AIErrorHandler: {
    normalize: vi.fn(() => ({
      statusCode: 500,
      message: 'Internal AI error',
      code: 'UNKNOWN',
    })),
  },
}));

import { evaluationEngineRoutes } from '../../src/modules/ai/evaluation-engine-routes.js';

function routeHarness() {
  const routes: Array<{
    path: string;
    options: unknown;
    handler: (request: any, reply: any) => Promise<any>;
  }> = [];
  const app = {
    get: vi.fn(),
    post: vi.fn((path, options, handler) =>
      routes.push({ path, options, handler }),
    ),
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

describe('Evaluation routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects client-authored outputs before invoking the server runner', async () => {
    const { app, routes } = routeHarness();
    await evaluationEngineRoutes(app as any);
    const route = routes.find(
      (item) => item.path === '/api/v1/ai/evaluations/runs',
    )!;
    const reply = replyHarness();

    await route.handler(
      {
        user: { orgId: 'org-1', id: 'admin-1' },
        body: {
          name: 'Forged pass',
          targetType: 'prompt',
          targetId: 'prompt-version-1',
          modelConfigId: 'model-1',
          outputs: { safety: { replyText: 'perfect' } },
        },
      },
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.payload).toMatchObject({
      code: 'CLIENT_OUTPUTS_NOT_ALLOWED',
    });
    expect(mocks.runServerEvaluation).not.toHaveBeenCalled();
  });

  it('passes only target identifiers and settings to the server runner', async () => {
    mocks.runServerEvaluation.mockResolvedValue({
      runId: 'run-1',
      passed: true,
      executionSource: 'server',
      clientOutputsAccepted: false,
    });
    const { app, routes } = routeHarness();
    await evaluationEngineRoutes(app as any);
    const route = routes.find(
      (item) => item.path === '/api/v1/ai/evaluations/runs',
    )!;

    const result = await route.handler(
      {
        user: { orgId: 'org-1', id: 'admin-1' },
        body: {
          name: 'Release gate',
          targetType: 'prompt',
          targetId: 'prompt-version-1',
          promptVersionId: 'prompt-version-1',
          modelConfigId: 'model-1',
          threshold: 85,
        },
      },
      replyHarness(),
    );

    expect(mocks.runServerEvaluation).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'admin-1' },
      {
        name: 'Release gate',
        targetType: 'prompt',
        targetId: 'prompt-version-1',
        promptVersionId: 'prompt-version-1',
        modelConfigId: 'model-1',
        threshold: 85,
      },
    );
    expect(result).toMatchObject({
      runId: 'run-1',
      executionSource: 'server',
    });
  });

  it('requires name, target type and target id', async () => {
    const { app, routes } = routeHarness();
    await evaluationEngineRoutes(app as any);
    const route = routes.find(
      (item) => item.path === '/api/v1/ai/evaluations/runs',
    )!;
    const reply = replyHarness();

    await route.handler(
      {
        user: { orgId: 'org-1', id: 'admin-1' },
        body: { name: 'Incomplete' },
      },
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.payload).toMatchObject({
      code: 'EVALUATION_INPUT_REQUIRED',
    });
    expect(mocks.runServerEvaluation).not.toHaveBeenCalled();
  });
});
