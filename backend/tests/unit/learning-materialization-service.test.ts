import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    $transaction: vi.fn(),
    aiLearningCandidate: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    aiEvaluationCase: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    aiAuditLog: {
      create: vi.fn(),
    },
  };
  prisma.$transaction.mockImplementation(async (callback: any) =>
    callback(prisma),
  );
  return { prisma };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: mocks.prisma,
}));

vi.mock(
  '../../src/modules/integrations/_shared/token-encryption.util.js',
  () => ({
    encryptToken: (value: string) => `enc:${value}`,
    decryptToken: (value: string) => value.replace(/^enc:/, ''),
  }),
);

import {
  LearningMaterializationError,
  materializeLearningCandidate,
} from '../../src/modules/ai/learning-materialization-service.js';

const actor = {
  orgId: 'org-1',
  userId: 'reviewer-1',
  role: 'admin',
};

const encryptedPayload = (payload: unknown) =>
  new TextEncoder().encode(`enc:${JSON.stringify(payload)}`);

describe('Learning materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(mocks.prisma),
    );
    mocks.prisma.aiLearningCandidate.findFirst.mockResolvedValue({
      id: 'candidate-1',
      orgId: 'org-1',
      status: 'approved',
      kind: 'prompt_improvement',
      riskTier: 'medium',
      payloadHash: 'payload-hash',
      payloadEncrypted: encryptedPayload({
        type: 'too_robotic',
        reason: 'Liên hệ 0901234567, otp: 123456',
        proposedReply: 'Chào khách 0901234567',
        finalReply: 'Chào anh/chị',
        context: { channel: 'zalo' },
        knowledgeRefs: [],
      }),
      evidence: [],
    });
    mocks.prisma.aiLearningCandidate.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.aiLearningCandidate.update.mockResolvedValue({
      id: 'candidate-1',
      status: 'published',
    });
    mocks.prisma.aiEvaluationCase.upsert.mockResolvedValue({
      id: 'case-1',
      key: 'learning-candidate-1',
      status: 'draft',
    });
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
  });

  it('creates a draft evaluation case and never reports a production change', async () => {
    const result = await materializeLearningCandidate(
      actor,
      'candidate-1',
      'Đã kiểm tra',
    );

    expect(mocks.prisma.aiLearningCandidate.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'candidate-1',
        orgId: 'org-1',
        status: 'approved',
      },
      data: {
        status: 'published',
        reviewedAt: expect.any(Date),
      },
    });

    const create =
      mocks.prisma.aiEvaluationCase.upsert.mock.calls[0][0].create;
    expect(create).toEqual(
      expect.objectContaining({
        key: 'learning-candidate-1',
        status: 'draft',
        taskType: 'reply_draft',
        createdByUserId: 'reviewer-1',
      }),
    );
    expect(Buffer.from(create.inputEncrypted).toString()).not.toContain(
      '0901234567',
    );
    expect(Buffer.from(create.inputEncrypted).toString()).not.toContain(
      '123456',
    );
    expect(result.productionChanged).toBe(false);
    expect(result.materialization).toEqual(
      expect.objectContaining({
        type: 'evaluation_case',
        id: 'case-1',
        status: 'draft',
      }),
    );
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalled();
  });

  it('requires manager approval before materialization', async () => {
    mocks.prisma.aiLearningCandidate.findFirst.mockResolvedValueOnce({
      id: 'candidate-1',
      orgId: 'org-1',
      status: 'pending_review',
      kind: 'knowledge_gap',
      riskTier: 'high',
      payloadHash: 'payload-hash',
      payloadEncrypted: encryptedPayload({}),
      evidence: [],
    });

    await expect(
      materializeLearningCandidate(actor, 'candidate-1'),
    ).rejects.toMatchObject<Partial<LearningMaterializationError>>({
      statusCode: 409,
      code: 'APPROVAL_REQUIRED',
    });
    expect(mocks.prisma.aiEvaluationCase.upsert).not.toHaveBeenCalled();
  });

  it('is idempotent after the candidate was published', async () => {
    mocks.prisma.aiLearningCandidate.findFirst.mockResolvedValueOnce({
      id: 'candidate-1',
      orgId: 'org-1',
      status: 'published',
      kind: 'prompt_improvement',
      riskTier: 'medium',
      payloadHash: 'payload-hash',
      payloadEncrypted: encryptedPayload({}),
      evidence: [],
    });
    mocks.prisma.aiEvaluationCase.findUnique.mockResolvedValueOnce({
      id: 'case-1',
      key: 'learning-candidate-1',
      status: 'draft',
    });

    const result = await materializeLearningCandidate(actor, 'candidate-1');

    expect(result.idempotent).toBe(true);
    expect(mocks.prisma.aiLearningCandidate.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.aiEvaluationCase.upsert).not.toHaveBeenCalled();
  });
});
