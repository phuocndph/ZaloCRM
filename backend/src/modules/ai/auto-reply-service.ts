import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { buildConversationContext, ContextBuilderError, type ContextActor } from './conversation-context-builder-service.js';
import type { PolicyResult } from './policy-safety-checker-service.js';

export type AutoReplyMode = 'disabled' | 'shadow' | 'auto_send';
export type AutoReplyActor = ContextActor;
export type AutoReplyTransport = { send(input: { conversationId: string; text: string; idempotencyKey: string }): Promise<{ messageId?: string }> };
export class AutoReplyError extends Error { constructor(message: string, public readonly statusCode = 400, public readonly code = 'AUTO_REPLY_ERROR') { super(message); } }
type AutoReplyScope = 'workspace' | 'zalo_account' | 'employee' | 'skill' | 'intent' | 'segment';
type AutoReplyConfigRow = {
  id: string;
  scope: string;
  scopeRefId?: string | null;
  enabled: boolean;
  mode: string;
  emergencyStop?: boolean;
  config?: unknown;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type ProductionReleaseGate = { id: string; evaluationRunId: string };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const riskyIntents = new Set(['complaint', 'return_or_refund', 'human_request', 'discount_request']);
const scopePriority: Record<AutoReplyScope, number> = {
  workspace: 0,
  zalo_account: 1,
  employee: 2,
  skill: 3,
  intent: 4,
  segment: 5,
};

function config(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function localHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()));
}

function inHours(hours: unknown): boolean {
  const entries = Array.isArray(hours) ? hours : [];
  if (!entries.length) return true;
  const hour = localHour();
  return entries.some((row: any) => Number.isInteger(row?.start)
    && Number.isInteger(row?.end)
    && (row.start <= row.end
      ? hour >= row.start && hour < row.end
      : hour >= row.start || hour < row.end));
}

function timestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

function orderedConfigs(rows: AutoReplyConfigRow[]): AutoReplyConfigRow[] {
  return [...rows].sort((left, right) => {
    const priority = (scopePriority[left.scope as AutoReplyScope] ?? -1)
      - (scopePriority[right.scope as AutoReplyScope] ?? -1);
    if (priority !== 0) return priority;
    const updated = timestamp(left.updatedAt) - timestamp(right.updatedAt);
    if (updated !== 0) return updated;
    const created = timestamp(left.createdAt) - timestamp(right.createdAt);
    if (created !== 0) return created;
    const reference = (left.scopeRefId ?? '').localeCompare(right.scopeRefId ?? '');
    return reference !== 0 ? reference : left.id.localeCompare(right.id);
  });
}

function mergeConfigs(rows: AutoReplyConfigRow[]): Record<string, any> {
  return rows.reduce(
    (all, row) => ({ ...all, ...config(row.config) }),
    {} as Record<string, any>,
  );
}

function normalizeMode(value: unknown): AutoReplyMode {
  return value === 'shadow' || value === 'auto_send' ? value : 'disabled';
}

function normalizeCanaryPercent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : 0;
}

function rolloutBucket(orgId: string, stableSubjectId: string): number {
  const digest = createHash('sha256').update(`${orgId}:${stableSubjectId}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 * 100;
}

function uniqueTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean))]
    .sort();
}

function hasPassingEvaluation(release: any): boolean {
  if (!release
    || typeof release.id !== 'string'
    || typeof release.evaluationRunId !== 'string'
    || !release.deployedAt
    || typeof release.snapshotHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(release.snapshotHash)) {
    return false;
  }
  const evaluation = release.evaluationRun;
  return evaluation?.id === release.evaluationRunId
    && evaluation.status === 'completed'
    && Boolean(evaluation.completedAt)
    && config(evaluation.metrics).passed === true;
}

async function activeProductionRelease(
  orgId: string,
  expectedReleaseId?: string | null,
): Promise<ProductionReleaseGate | null> {
  if (expectedReleaseId === null) return null;
  const release = await prisma.aiRelease.findFirst({
    where: {
      orgId,
      status: 'production',
      evaluationRunId: { not: null },
      ...(expectedReleaseId ? { id: expectedReleaseId } : {}),
    },
    select: {
      id: true,
      evaluationRunId: true,
      deployedAt: true,
      snapshotHash: true,
      evaluationRun: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          metrics: true,
        },
      },
    },
  });
  if (!release || !hasPassingEvaluation(release)) return null;
  return { id: release.id, evaluationRunId: release.evaluationRunId! };
}

async function effectiveAutoReplyConfig(
  orgId: string,
  input: { conversationId: string; employeeId?: string; skillKey: string; intent: string },
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, orgId },
    select: {
      id: true,
      zaloAccountId: true,
      contact: { select: { id: true, tags: true } },
    },
  });
  if (!conversation) {
    throw new AutoReplyError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
  }

  const contactTags = uniqueTags(conversation.contact?.tags);
  const rows = await prisma.aiAutoReplyConfig.findMany({
    where: {
      orgId,
      deletedAt: null,
      OR: [
        { scope: 'workspace', scopeRefId: null },
        { scope: 'zalo_account', scopeRefId: conversation.zaloAccountId },
        ...(input.employeeId ? [{ scope: 'employee', scopeRefId: input.employeeId }] : []),
        { scope: 'skill', scopeRefId: input.skillKey },
        { scope: 'intent', scopeRefId: input.intent },
        ...(contactTags.length
          ? [{ scope: 'segment', scopeRefId: { in: contactTags } }]
          : []),
      ],
    },
  });
  const ordered = orderedConfigs(rows as AutoReplyConfigRow[]);
  const selected = ordered.length ? ordered[ordered.length - 1] : null;
  return {
    conversation,
    contactTags,
    ordered,
    settings: mergeConfigs(ordered),
    selected,
    mode: normalizeMode(selected?.mode),
    workspaceEmergencyStop: ordered.some(
      (row) => row.scope === 'workspace' && row.emergencyStop,
    ),
  };
}

export async function updateAutoReplyConfig(actor: { orgId: string; userId: string }, input: { scope: 'workspace'|'zalo_account'|'employee'|'skill'|'intent'|'segment'; scopeRefId?: string | null; enabled?: boolean; mode?: AutoReplyMode; emergencyStop?: boolean; config?: Record<string, unknown> }) { if (!['workspace', 'zalo_account', 'employee', 'skill', 'intent', 'segment'].includes(input.scope)) throw new AutoReplyError('Invalid auto-reply scope', 400, 'INVALID_SCOPE'); if (input.scope !== 'workspace' && !input.scopeRefId) throw new AutoReplyError('scopeRefId is required for this scope', 400, 'SCOPE_REFERENCE_REQUIRED'); if (input.mode && !['disabled', 'shadow', 'auto_send'].includes(input.mode)) throw new AutoReplyError('Invalid auto-reply mode', 400, 'INVALID_MODE'); const current = await prisma.aiAutoReplyConfig.findFirst({ where: { orgId: actor.orgId, scope: input.scope, scopeRefId: input.scopeRefId ?? null, deletedAt: null }, orderBy: { updatedAt: 'desc' } }); const data = { enabled: input.enabled ?? current?.enabled ?? false, mode: input.mode ?? current?.mode ?? 'disabled', emergencyStop: input.emergencyStop ?? current?.emergencyStop ?? false, config: (input.config ?? current?.config ?? {}) as Prisma.InputJsonValue, createdByUserId: current?.createdByUserId ?? actor.userId }; const saved = current ? await prisma.aiAutoReplyConfig.update({ where: { id: current.id }, data }) : await prisma.aiAutoReplyConfig.create({ data: { orgId: actor.orgId, scope: input.scope, scopeRefId: input.scopeRefId ?? null, ...data } }); await prisma.aiAuditLog.create({ data: { orgId: actor.orgId, actorUserId: actor.userId, eventType: 'auto_reply.config_updated', outcome: 'success', targetType: 'ai_auto_reply_config', targetId: saved.id, metadata: { scope: saved.scope, enabled: saved.enabled, mode: saved.mode, emergencyStop: saved.emergencyStop } } }); return saved; }
export async function evaluateAutoReply(
  actor: AutoReplyActor,
  input: {
    conversationId: string;
    employeeId?: string;
    skillKey: string;
    intent: string;
    emotion: string;
    confidence: number;
    replyText: string;
    sources: Array<Record<string, any>>;
    policy: PolicyResult;
    requiresHuman?: boolean;
  },
) {
  const context = await buildConversationContext(actor, input.conversationId, { maxTokens: 1200 });
  const {
    conversation,
    contactTags,
    settings,
    selected,
    mode,
    workspaceEmergencyStop,
  } = await effectiveAutoReplyConfig(actor.orgId, input);
  const reasons: string[] = [];

  if (workspaceEmergencyStop) reasons.push('EMERGENCY_STOP');
  if (!selected?.enabled || mode === 'disabled') reasons.push('AUTO_REPLY_DISABLED');
  if (!context.access.allowed || !context.access.contentVisible) {
    reasons.push('CONVERSATION_ACCESS_DENIED');
  }

  const allowedIntents = Array.isArray(settings.allowedIntents) ? settings.allowedIntents : [];
  if (!allowedIntents.includes(input.intent)) reasons.push('INTENT_NOT_ALLOWED');
  if (!input.sources?.length
    || input.sources.some((source) => !source?.citation && !source?.sourceType)) {
    reasons.push('KNOWLEDGE_NOT_GROUNDED');
  }
  if (!input.policy.allowed || input.policy.requires_human) reasons.push('POLICY_BLOCKED');

  const threshold = Number.isFinite(settings.confidenceThreshold)
    ? Number(settings.confidenceThreshold)
    : 85;
  if (input.confidence < threshold) reasons.push('CONFIDENCE_LOW');
  if (riskyIntents.has(input.intent) || /discount|giảm giá/i.test(input.replyText)) {
    reasons.push('RESTRICTED_INTENT_OR_DISCOUNT');
  }
  if (input.requiresHuman || input.emotion === 'angry' || input.emotion === 'disappointed') {
    reasons.push('HUMAN_HANDOFF_REQUIRED');
  }
  if (settings.knowledgeConflict) reasons.push('KNOWLEDGE_CONFLICT');
  if (!inHours(settings.businessHours)) reasons.push('OUTSIDE_BUSINESS_HOURS');

  const configuredSegments = Array.isArray(settings.customerSegments)
    ? settings.customerSegments.filter((tag: unknown): tag is string => typeof tag === 'string')
    : [];
  if (configuredSegments.length
    && !configuredSegments.some((tag: string) => contactTags.includes(tag))) {
    reasons.push('CUSTOMER_SEGMENT_NOT_ALLOWED');
  }

  const sent = await prisma.aiAutoReplyLog.count({
    where: {
      orgId: actor.orgId,
      conversationId: input.conversationId,
      status: { in: ['sent', 'auto_send_ready'] },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  const maxMessages = Number.isFinite(settings.maxMessagesPerConversation)
    ? Number(settings.maxMessagesPerConversation)
    : 3;
  if (sent >= maxMessages) reasons.push('MESSAGE_LIMIT_REACHED');

  const orgRecent = await prisma.aiAutoReplyLog.count({
    where: {
      orgId: actor.orgId,
      status: { in: ['sent', 'auto_send_ready'] },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  const maxHourly = Number.isFinite(settings.maxMessagesPerHour)
    ? Number(settings.maxMessagesPerHour)
    : 30;
  if (orgRecent >= maxHourly) reasons.push('SPAM_RATE_LIMIT');

  const canaryPercent = normalizeCanaryPercent(settings.canaryPercent);
  const cohortBucket = rolloutBucket(
    actor.orgId,
    conversation.contact?.id ?? conversation.id,
  );
  let release: ProductionReleaseGate | null = null;
  if (selected?.enabled && mode === 'auto_send') {
    release = await activeProductionRelease(actor.orgId);
    if (!release) reasons.push('ACTIVE_PRODUCTION_RELEASE_REQUIRED');
    if (cohortBucket >= canaryPercent) reasons.push('CANARY_NOT_SELECTED');
  }

  const allowed = reasons.length === 0;
  const status = !allowed
    ? 'blocked'
    : mode === 'shadow'
      ? 'shadow'
      : mode === 'auto_send'
        ? 'auto_send_ready'
        : 'blocked';
  const roundedBucket = Number(cohortBucket.toFixed(6));
  const log = await prisma.aiAutoReplyLog.create({
    data: {
      orgId: actor.orgId,
      conversationId: input.conversationId,
      configId: selected?.id ?? null,
      status,
      decisionReasons: reasons as Prisma.InputJsonValue,
      replyHash: hash(input.replyText),
      confidence: Math.max(0, Math.min(100, Math.round(input.confidence))),
      mode,
      metadata: {
        skillKey: input.skillKey,
        intent: input.intent,
        emotion: input.emotion,
        sourceCount: input.sources.length,
        threshold,
        selectedScope: selected?.scope ?? null,
        selectedScopeRefId: selected?.scopeRefId ?? null,
        shadow: mode === 'shadow',
        autoSendExecuted: false,
        activeReleaseId: release?.id ?? null,
        evaluationRunId: release?.evaluationRunId ?? null,
        canaryPercent,
        rolloutBucket: roundedBucket,
      },
    },
  });
  await prisma.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      conversationId: input.conversationId,
      eventType: 'auto_reply.evaluated',
      outcome: status,
      targetType: 'ai_auto_reply_log',
      targetId: log.id,
      inputHash: hash(JSON.stringify({ skillKey: input.skillKey, intent: input.intent })),
      outputHash: log.replyHash,
      metadata: {
        reasons,
        mode,
        confidence: log.confidence,
        selectedScope: selected?.scope ?? null,
        activeReleaseId: release?.id ?? null,
        canaryPercent,
        rolloutBucket: roundedBucket,
        autoSendExecuted: false,
      },
    },
  });
  return {
    allowed,
    mode,
    status,
    reasons,
    logId: log.id,
    configId: selected?.id ?? null,
    selectedScope: selected?.scope ?? null,
    releaseId: release?.id ?? null,
    evaluationRunId: release?.evaluationRunId ?? null,
    confidenceThreshold: threshold,
    canaryPercent,
    rolloutBucket: roundedBucket,
  };
}

async function blockAfterSendRecheck(
  actor: AutoReplyActor,
  decision: Awaited<ReturnType<typeof evaluateAutoReply>>,
  recheckReasons: string[],
) {
  const reasons = [...decision.reasons, ...recheckReasons];
  await prisma.aiAutoReplyLog.update({
    where: { id: decision.logId },
    data: {
      status: 'blocked',
      decisionReasons: reasons as Prisma.InputJsonValue,
      metadata: {
        autoSendExecuted: false,
        sendRecheckBlocked: true,
        activeReleaseId: decision.releaseId,
        evaluationRunId: decision.evaluationRunId,
      },
    },
  });
  await prisma.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: 'auto_reply.send_rechecked',
      outcome: 'blocked',
      targetType: 'ai_auto_reply_log',
      targetId: decision.logId,
      metadata: {
        reasons,
        activeReleaseId: decision.releaseId,
        autoSendExecuted: false,
      },
    },
  });
  return {
    ...decision,
    allowed: false,
    status: 'blocked',
    reasons,
    sent: false,
    reason: 'Auto reply controls changed before send; message was not sent.',
  };
}

export async function processAutoReply(
  actor: AutoReplyActor,
  input: Parameters<typeof evaluateAutoReply>[1],
  transport?: AutoReplyTransport,
) {
  const decision = await evaluateAutoReply(actor, input);
  if (decision.status !== 'auto_send_ready' || decision.mode !== 'auto_send') {
    return decision;
  }
  if (!transport) {
    return {
      ...decision,
      status: 'auto_send_ready',
      sent: false,
      reason: 'No approved transport attached; message was not sent.',
    };
  }

  const [release, effective] = await Promise.all([
    activeProductionRelease(actor.orgId, decision.releaseId),
    effectiveAutoReplyConfig(actor.orgId, input),
  ]);
  const selectedConfigUnchanged = effective.selected?.id === decision.configId
    && effective.selected.enabled
    && effective.mode === 'auto_send';

  if (!release || effective.workspaceEmergencyStop || !selectedConfigUnchanged) {
    const recheckReasons: string[] = [];
    if (!release) recheckReasons.push('ACTIVE_PRODUCTION_RELEASE_CHANGED');
    if (effective.workspaceEmergencyStop) recheckReasons.push('EMERGENCY_STOP');
    if (!selectedConfigUnchanged) recheckReasons.push('AUTO_REPLY_CONFIG_CHANGED');
    return blockAfterSendRecheck(actor, decision, recheckReasons);
  }

  try {
    const sent = await transport.send({
      conversationId: input.conversationId,
      text: input.replyText,
      idempotencyKey: decision.logId,
    });
    await prisma.aiAutoReplyLog.update({
      where: { id: decision.logId },
      data: {
        status: 'sent',
        metadata: {
          sentMessageId: sent.messageId ?? null,
          activeReleaseId: release.id,
          evaluationRunId: release.evaluationRunId,
          autoSendExecuted: true,
        },
      },
    });
    return {
      ...decision,
      status: 'sent',
      sent: true,
      messageId: sent.messageId ?? null,
    };
  } catch (error) {
    await prisma.aiAutoReplyLog.update({
      where: { id: decision.logId },
      data: {
        status: 'send_failed',
        metadata: {
          activeReleaseId: release.id,
          evaluationRunId: release.evaluationRunId,
          autoSendExecuted: true,
          error: error instanceof Error ? error.name : 'SEND_ERROR',
        },
      },
    });
    throw new AutoReplyError('Auto reply transport failed', 502, 'AUTO_REPLY_SEND_FAILED');
  }
}

export const autoReplyInternals = {
  normalizeCanaryPercent,
  orderedConfigs,
  rolloutBucket,
};

export { ContextBuilderError };
