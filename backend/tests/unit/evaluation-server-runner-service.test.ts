import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiPromptVersion: { findFirst: vi.fn() },
    aiModelConfig: { findFirst: vi.fn() },
    aiAgent: { findFirst: vi.fn() },
    aiEvaluationCase: { findMany: vi.fn() },
    aiAuditLog: { create: vi.fn() },
  };
  return {
    prisma,
    complete: vi.fn(),
    runEvaluation: vi.fn(),
  };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: mocks.prisma,
}));

vi.mock('../../src/modules/ai/core/index.js', () => ({
  aiClient: { complete: mocks.complete },
}));

vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({
  AIErrorHandler: {
    normalize: (error: any) => ({
      code: error?.code ?? 'UPSTREAM_ERROR',
      message: error?.message ?? 'failed',
      statusCode: 502,
    }),
  },
}));

vi.mock(
  '../../src/modules/integrations/_shared/token-encryption.util.js',
  () => ({
    decryptToken: (value: string) => value.replace(/^enc:/, ''),
  }),
);

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
    runEvaluation: mocks.runEvaluation,
  };
});

import { runServerEvaluation } from '../../src/modules/ai/evaluation-server-runner-service.js';

const actor = { orgId: 'org-1', userId: 'reviewer-1' };
const encrypted = (value: string) => new TextEncoder().encode(`enc:${value}`);

describe('Server-side evaluation runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.aiPromptVersion.findFirst.mockResolvedValue({
      id: 'prompt-version-1',
      version: 2,
      status: 'approved',
      contentEncrypted: encrypted('System prompt'),
      prompt: { key: 'reply', name: 'Reply' },
    });
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue({
      id: 'model-1',
      provider: 'openai_compatible',
      model: 'router-model',
      status: 'active',
    });
    mocks.prisma.aiEvaluationCase.findMany.mockResolvedValue([
      {
        id: 'case-1',
        key: 'normal_case',
        inputEncrypted: encrypted('Khách cần tư vấn'),
        tags: ['sales'],
      },
      {
        id: 'case-2',
        key: 'private_case',
        inputEncrypted: encrypted('Dữ liệu riêng tư'),
        tags: ['private_conversation', 'privacy'],
      },
    ]);
    mocks.complete
      .mockResolvedValueOnce({ text: 'Dạ, anh chị cho em xin thêm thông tin.' })
      .mockResolvedValueOnce({ text: 'Em không thể truy cập dữ liệu riêng tư.' });
    mocks.runEvaluation.mockResolvedValue({
      runId: 'run-1',
      passed: true,
      averageScore: 92,
      threshold: 80,
      criticalFailures: [],
      results: [],
    });
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
  });

  it('generates every output on the server and passes only generated values to scoring', async () => {
    const result = await runServerEvaluation(actor, {
      name: 'Release candidate',
      targetType: 'prompt',
      targetId: 'prompt-version-1',
      modelConfigId: 'model-1',
    });

    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        modelConfigId: 'model-1',
        taskType: 'evaluation_reply_draft',
        temperature: 0,
      }),
    );

    const scoredInput = mocks.runEvaluation.mock.calls[0][1];
    expect(scoredInput.outputs.normal_case.replyText).toContain('xin thêm');
    expect(scoredInput.outputs.private_case.accessAllowed).toBe(false);
    expect(result.executionSource).toBe('server');
    expect(result.clientOutputsAccepted).toBe(false);
    expect(result.generationFailures).toEqual([]);
  });

  it('records a safe blank output when one provider call fails', async () => {
    mocks.complete
      .mockReset()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }))
      .mockResolvedValueOnce({ text: 'Không thể truy cập.' });

    const result = await runServerEvaluation(actor, {
      name: 'Failure is evidence',
      targetType: 'prompt',
      targetId: 'prompt-version-1',
      modelConfigId: 'model-1',
    });

    const scoredInput = mocks.runEvaluation.mock.calls[0][1];
    expect(scoredInput.outputs.normal_case.replyText).toBe('');
    expect(result.generationFailures).toEqual([
      { key: 'normal_case', code: 'TIMEOUT' },
    ]);
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            generationFailureCount: 1,
            rawOutputsStored: false,
          }),
        }),
      }),
    );
  });

  it('binds an agent evaluation to the current same-organization prompt and model', async () => {
    mocks.prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent-1',
      promptVersionId: 'prompt-version-1',
      modelConfigId: 'model-1',
    });

    await runServerEvaluation(actor, {
      name: 'Agent gate',
      targetType: 'agent',
      targetId: 'agent-1',
    });

    expect(mocks.prisma.aiAgent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agent-1', orgId: 'org-1', deletedAt: null },
    }));
    expect(mocks.runEvaluation).toHaveBeenCalledWith(actor, expect.objectContaining({
      targetType: 'agent',
      targetId: 'agent-1',
      promptVersionId: 'prompt-version-1',
      modelConfigId: 'model-1',
    }));
  });

  it('rejects an agent evaluation that tries to substitute another prompt or model', async () => {
    mocks.prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent-1',
      promptVersionId: 'prompt-version-1',
      modelConfigId: 'model-1',
    });

    await expect(runServerEvaluation(actor, {
      name: 'Substituted config',
      targetType: 'agent',
      targetId: 'agent-1',
      promptVersionId: 'other-prompt',
      modelConfigId: 'model-1',
    })).rejects.toMatchObject({ code: 'EVALUATION_TARGET_CONFIG_MISMATCH', statusCode: 409 });

    expect(mocks.prisma.aiPromptVersion.findFirst).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('requires both a prompt version and a model configuration', async () => {
    await expect(
      runServerEvaluation(actor, {
        name: 'Missing model',
        targetType: 'prompt',
        targetId: 'prompt-version-1',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_CONFIG_REQUIRED', statusCode: 400 });

    expect(mocks.prisma.aiPromptVersion.findFirst).not.toHaveBeenCalled();
    expect(mocks.runEvaluation).not.toHaveBeenCalled();
  });
});
