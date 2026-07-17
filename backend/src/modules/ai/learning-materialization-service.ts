import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { decryptToken, encryptToken } from '../integrations/_shared/token-encryption.util.js';

export type LearningMaterializationActor = {
  orgId: string;
  userId: string;
  role: string;
};

export class LearningMaterializationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'LEARNING_MATERIALIZATION_ERROR',
  ) {
    super(message);
    this.name = 'LearningMaterializationError';
  }
}

type CandidatePayload = {
  type?: string;
  reason?: string;
  proposedReply?: string;
  finalReply?: string;
  context?: Record<string, unknown>;
  knowledgeRefs?: unknown[];
};

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const encryptedBytes = (value: string) =>
  new TextEncoder().encode(encryptToken(value));

function decryptPayload(value?: Uint8Array | null): CandidatePayload {
  if (!value?.length) return {};

  try {
    const clear = decryptToken(Buffer.from(value).toString('utf8'));
    const parsed = JSON.parse(clear);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeText(value: string) {
  return value
    .replace(/\b(?:\+?84|0)(?:\d[ .-]?){8,10}\b/g, '[PHONE_REDACTED]')
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      '[EMAIL_REDACTED]',
    )
    .replace(
      /\b(?:otp|mã xác thực|password|mật khẩu|token|api[_ -]?key)\s*[:=]?\s*\S+/gi,
      '[SECRET_REDACTED]',
    )
    .replace(/\b(?:\d[ -]?){12,19}\b/g, '[NUMBER_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts an approved learning candidate into a draft evaluation case.
 * It never edits live prompts, knowledge, skills, models or auto-reply policy.
 */
export async function materializeLearningCandidate(
  actor: LearningMaterializationActor,
  candidateId: string,
  note?: string,
) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.aiLearningCandidate.findFirst({
      where: { id: candidateId, orgId: actor.orgId },
    });

    if (!candidate) {
      throw new LearningMaterializationError(
        'Learning candidate not found',
        404,
        'CANDIDATE_NOT_FOUND',
      );
    }

    const evaluationKey = `learning-${candidate.id}`;
    if (candidate.status === 'published') {
      const existing = await tx.aiEvaluationCase.findUnique({
        where: {
          orgId_key: { orgId: actor.orgId, key: evaluationKey },
        },
        select: { id: true, key: true, status: true },
      });

      return {
        candidate,
        materialization: existing
          ? { type: 'evaluation_case' as const, ...existing }
          : null,
        productionChanged: false,
        idempotent: true,
      };
    }

    if (candidate.status !== 'approved') {
      throw new LearningMaterializationError(
        'Candidate must be approved before materialization',
        409,
        'APPROVAL_REQUIRED',
      );
    }

    const payload = decryptPayload(candidate.payloadEncrypted);
    const safeNote = safeText(note ?? '').slice(0, 500);
    const inputMaterial = JSON.stringify({
      source: 'ai_learning',
      candidateId: candidate.id,
      kind: candidate.kind,
      feedbackType: payload.type,
      reason: safeText(payload.reason ?? '') || undefined,
      context: payload.context ?? {},
      knowledgeRefs: Array.isArray(payload.knowledgeRefs)
        ? payload.knowledgeRefs.slice(0, 10)
        : [],
    });
    const expectedMaterial = safeText(
      payload.finalReply ?? payload.proposedReply ?? '',
    );

    const claimed = await tx.aiLearningCandidate.updateMany({
      where: {
        id: candidate.id,
        orgId: actor.orgId,
        status: 'approved',
      },
      data: { status: 'published', reviewedAt: new Date() },
    });

    if (claimed.count !== 1) {
      throw new LearningMaterializationError(
        'Candidate was changed by another reviewer',
        409,
        'CANDIDATE_CONFLICT',
      );
    }

    const evaluationCase = await tx.aiEvaluationCase.upsert({
      where: {
        orgId_key: { orgId: actor.orgId, key: evaluationKey },
      },
      update: {},
      create: {
        orgId: actor.orgId,
        key: evaluationKey,
        name: `Learning review · ${candidate.kind}`,
        taskType: 'reply_draft',
        status: 'draft',
        inputEncrypted: encryptedBytes(inputMaterial),
        inputHash: hash(inputMaterial),
        expectedEncrypted: expectedMaterial
          ? encryptedBytes(expectedMaterial)
          : undefined,
        expectedHash: expectedMaterial ? hash(expectedMaterial) : undefined,
        rubric: {
          source: 'ai_learning',
          candidateId: candidate.id,
          learningKind: candidate.kind,
          riskTier: candidate.riskTier,
          requiresHumanReview: true,
          note: safeNote || undefined,
        },
        tags: ['ai-learning', candidate.kind, candidate.riskTier],
        createdByUserId: actor.userId,
      },
      select: { id: true, key: true, status: true },
    });

    const evidence = [
      ...(Array.isArray(candidate.evidence) ? candidate.evidence : []),
      {
        transition: 'approved->published',
        materializedBy: actor.userId,
        materializedType: 'evaluation_case',
        materializedId: evaluationCase.id,
        productionChanged: false,
        note: safeNote || undefined,
        at: new Date().toISOString(),
      },
    ];

    const updated = await tx.aiLearningCandidate.update({
      where: { id: candidate.id },
      data: { evidence: evidence as Prisma.InputJsonValue },
    });

    await tx.aiAuditLog.create({
      data: {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        eventType: 'learning.candidate.materialize',
        outcome: 'draft_created',
        targetType: 'ai_evaluation_case',
        targetId: evaluationCase.id,
        inputHash: candidate.payloadHash,
        metadata: {
          candidateId: candidate.id,
          learningKind: candidate.kind,
          riskTier: candidate.riskTier,
          productionChanged: false,
        },
      },
    });

    return {
      candidate: updated,
      materialization: {
        type: 'evaluation_case' as const,
        ...evaluationCase,
      },
      productionChanged: false,
      idempotent: false,
    };
  });
}
