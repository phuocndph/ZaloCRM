import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiAutoReplyConfig: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiAutoReplyLog: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiRelease: { findFirst: vi.fn() },
    aiAuditLog: { create: vi.fn() },
    conversation: { findFirst: vi.fn() },
  };
  return { prisma, context: vi.fn() };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/ai/conversation-context-builder-service.js', () => ({
  buildConversationContext: mocks.context,
  ContextBuilderError: class extends Error {
    statusCode = 403;
    code = 'CONVERSATION_ACCESS_DENIED';
  },
}));

import {
  autoReplyInternals,
  evaluateAutoReply,
  processAutoReply,
} from '../../src/modules/ai/auto-reply-service.js';

const actor = {
  orgId: 'org-1',
  userId: 'u-1',
  role: 'member',
  privacyUnlocked: true,
};
const policy = {
  allowed: true,
  requires_human: false,
  risk_level: 'low',
  violations: [],
  corrected_reply: null,
  confidence: 1,
};
const validRelease = {
  id: 'release-1',
  evaluationRunId: 'eval-1',
  deployedAt: new Date('2026-07-16T00:00:00.000Z'),
  snapshotHash: 'a'.repeat(64),
  evaluationRun: {
    id: 'eval-1',
    status: 'completed',
    completedAt: new Date('2026-07-15T00:00:00.000Z'),
    metrics: { passed: true },
  },
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-workspace',
    scope: 'workspace',
    scopeRefId: null,
    enabled: true,
    mode: 'shadow',
    emergencyStop: false,
    config: {
      allowedIntents: ['greeting'],
      confidenceThreshold: 90,
      maxMessagesPerConversation: 3,
    },
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: 'c-1',
    employeeId: 'employee-1',
    skillKey: 'general_assistant',
    intent: 'greeting',
    emotion: 'neutral',
    confidence: 95,
    replyText: 'Dạ em hỗ trợ anh/chị ạ.',
    sources: [{ citation: { sourceType: 'faq' } }],
    policy,
    ...overrides,
  } as any;
}

describe('AutoReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      access: { allowed: true, contentVisible: true },
    });
    mocks.prisma.conversation.findFirst.mockResolvedValue({
      id: 'c-1',
      zaloAccountId: 'z-1',
      contact: { id: 'contact-1', tags: ['vip'] },
    });
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([]);
    mocks.prisma.aiAutoReplyConfig.findFirst.mockImplementation(
      async ({ where }: any) => where?.id ? { id: where.id } : null,
    );
    mocks.prisma.aiAutoReplyLog.count.mockResolvedValue(0);
    mocks.prisma.aiAutoReplyLog.create.mockImplementation(
      async ({ data }: any) => ({
        id: 'log-1',
        confidence: data.confidence,
        replyHash: data.replyHash,
        ...data,
      }),
    );
    mocks.prisma.aiAutoReplyLog.update.mockResolvedValue({});
    mocks.prisma.aiRelease.findFirst.mockResolvedValue(validRelease);
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
  });

  it('defaults to blocked while Auto Reply is disabled', async () => {
    const result = await evaluateAutoReply(actor, request());

    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('AUTO_REPLY_DISABLED');
    expect(mocks.prisma.aiRelease.findFirst).not.toHaveBeenCalled();
  });

  it('uses the documented deterministic scope precedence', () => {
    const shuffled = [
      row({ id: 'intent', scope: 'intent', scopeRefId: 'greeting' }),
      row({ id: 'workspace', scope: 'workspace' }),
      row({ id: 'segment', scope: 'segment', scopeRefId: 'vip' }),
      row({ id: 'skill', scope: 'skill', scopeRefId: 'general_assistant' }),
      row({ id: 'account', scope: 'zalo_account', scopeRefId: 'z-1' }),
      row({ id: 'employee', scope: 'employee', scopeRefId: 'employee-1' }),
    ];

    expect(autoReplyInternals.orderedConfigs(shuffled).map((item) => item.scope))
      .toEqual(['workspace', 'zalo_account', 'employee', 'skill', 'intent', 'segment']);
  });

  it('lets a higher disabled scope override and block lower enabled scopes', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        id: 'cfg-segment',
        scope: 'segment',
        scopeRefId: 'vip',
        enabled: false,
        mode: 'disabled',
      }),
      row({
        id: 'cfg-intent',
        scope: 'intent',
        scopeRefId: 'greeting',
        enabled: true,
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
      row(),
    ]);

    const result = await evaluateAutoReply(actor, request());

    expect(result).toMatchObject({
      status: 'blocked',
      mode: 'disabled',
      configId: 'cfg-segment',
      selectedScope: 'segment',
    });
    expect(result.reasons).toContain('AUTO_REPLY_DISABLED');
    expect(mocks.prisma.aiRelease.findFirst).not.toHaveBeenCalled();
  });

  it('matches segment configs from normalized contact tags', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({
      id: 'c-1',
      zaloAccountId: 'z-1',
      contact: { id: 'contact-1', tags: [' vip ', 'vip', 'priority'] },
    });
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row(),
      row({
        id: 'cfg-vip',
        scope: 'segment',
        scopeRefId: 'vip',
        mode: 'shadow',
        config: { allowedIntents: ['greeting'], confidenceThreshold: 92 },
      }),
    ]);

    const result = await evaluateAutoReply(actor, request());

    expect(result).toMatchObject({
      allowed: true,
      status: 'shadow',
      configId: 'cfg-vip',
      selectedScope: 'segment',
      confidenceThreshold: 92,
    });
    const query = mocks.prisma.aiAutoReplyConfig.findMany.mock.calls[0][0];
    expect(query.where.OR).toContainEqual({
      scope: 'segment',
      scopeRefId: { in: ['priority', 'vip'] },
    });
  });

  it('never sends while running in shadow mode', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([row()]);
    const send = vi.fn();

    const result = await processAutoReply(actor, request(), { send });

    expect(result).toMatchObject({ allowed: true, mode: 'shadow', status: 'shadow' });
    expect(send).not.toHaveBeenCalled();
    expect(mocks.prisma.aiRelease.findFirst).not.toHaveBeenCalled();
  });

  it('blocks auto_send without an active production release', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
    ]);
    mocks.prisma.aiRelease.findFirst.mockResolvedValue(null);

    const result = await evaluateAutoReply(actor, request());

    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('ACTIVE_PRODUCTION_RELEASE_REQUIRED');
  });

  it('blocks a production release whose evaluation is not passing', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
    ]);
    mocks.prisma.aiRelease.findFirst.mockResolvedValue({
      ...validRelease,
      evaluationRun: {
        ...validRelease.evaluationRun,
        metrics: { passed: false },
      },
    });

    const result = await evaluateAutoReply(actor, request());

    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('ACTIVE_PRODUCTION_RELEASE_REQUIRED');
  });

  it('defaults canary rollout to fail-closed zero percent', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'] },
      }),
    ]);

    const result = await evaluateAutoReply(actor, request());

    expect(result).toMatchObject({
      status: 'blocked',
      canaryPercent: 0,
      releaseId: 'release-1',
    });
    expect(result.reasons).toContain('CANARY_NOT_SELECTED');
    expect(autoReplyInternals.normalizeCanaryPercent(undefined)).toBe(0);
    expect(autoReplyInternals.normalizeCanaryPercent(101)).toBe(0);
  });

  it('uses a stable rollout bucket and allows a 100 percent canary', async () => {
    const first = autoReplyInternals.rolloutBucket('org-1', 'contact-1');
    const second = autoReplyInternals.rolloutBucket('org-1', 'contact-1');
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);

    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
    ]);

    const result = await evaluateAutoReply(actor, request());

    expect(result).toMatchObject({
      allowed: true,
      status: 'auto_send_ready',
      releaseId: 'release-1',
      evaluationRunId: 'eval-1',
      canaryPercent: 100,
    });
  });

  it('blocks emergency stop even if every other auto_send gate passes', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        emergencyStop: true,
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
    ]);

    const result = await evaluateAutoReply(
      actor,
      request({ emotion: 'angry' }),
    );

    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(expect.arrayContaining([
      'EMERGENCY_STOP',
      'HUMAN_HANDOFF_REQUIRED',
    ]));
  });

  it('rechecks the exact production release immediately before transport', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
    ]);
    mocks.prisma.aiRelease.findFirst
      .mockResolvedValueOnce(validRelease)
      .mockResolvedValueOnce(null);
    const send = vi.fn();

    const result = await processAutoReply(actor, request(), { send });

    expect(result).toMatchObject({ allowed: false, status: 'blocked', sent: false });
    expect(result.reasons).toContain('ACTIVE_PRODUCTION_RELEASE_CHANGED');
    expect(send).not.toHaveBeenCalled();
    expect(mocks.prisma.aiAutoReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'blocked' }),
      }),
    );
    expect(mocks.prisma.aiRelease.findFirst.mock.calls[1][0].where.id).toBe('release-1');
  });

  it('blocks when a higher disabled scope appears before transport', async () => {
    const initial = row({
      mode: 'auto_send',
      config: { allowedIntents: ['greeting'], canaryPercent: 100 },
    });
    const segmentStop = row({
      id: 'cfg-segment-stop',
      scope: 'segment',
      scopeRefId: 'vip',
      enabled: false,
      mode: 'disabled',
      config: { allowedIntents: ['greeting'], canaryPercent: 100 },
    });
    mocks.prisma.aiAutoReplyConfig.findMany
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([initial, segmentStop]);
    const send = vi.fn();

    const result = await processAutoReply(actor, request(), { send });

    expect(result).toMatchObject({ allowed: false, status: 'blocked', sent: false });
    expect(result.reasons).toContain('AUTO_REPLY_CONFIG_CHANGED');
    expect(send).not.toHaveBeenCalled();
    expect(mocks.prisma.aiAutoReplyConfig.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.aiAutoReplyConfig.findMany.mock.calls[1][0].where.OR)
      .toEqual(expect.arrayContaining([
        { scope: 'employee', scopeRefId: 'employee-1' },
        { scope: 'skill', scopeRefId: 'general_assistant' },
        { scope: 'intent', scopeRefId: 'greeting' },
        { scope: 'segment', scopeRefId: { in: ['vip'] } },
      ]));
    expect(mocks.prisma.conversation.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.aiAutoReplyLog.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.aiAuditLog.create.mock.calls
      .filter(([call]: any[]) => call.data.eventType === 'auto_reply.evaluated'))
      .toHaveLength(1);
    expect(mocks.prisma.aiAutoReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'blocked',
          decisionReasons: expect.arrayContaining(['AUTO_REPLY_CONFIG_CHANGED']),
        }),
      }),
    );
  });

  it('rechecks emergency stop immediately before transport', async () => {
    const initial = row({
      mode: 'auto_send',
      config: { allowedIntents: ['greeting'], canaryPercent: 100 },
    });
    mocks.prisma.aiAutoReplyConfig.findMany
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([{ ...initial, emergencyStop: true }]);
    const send = vi.fn();

    const result = await processAutoReply(actor, request(), { send });

    expect(result).toMatchObject({ allowed: false, status: 'blocked', sent: false });
    expect(result.reasons).toContain('EMERGENCY_STOP');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends only after all controls pass twice', async () => {
    mocks.prisma.aiAutoReplyConfig.findMany.mockResolvedValue([
      row({
        mode: 'auto_send',
        config: { allowedIntents: ['greeting'], canaryPercent: 100 },
      }),
    ]);
    const send = vi.fn().mockResolvedValue({ messageId: 'message-1' });

    const result = await processAutoReply(actor, request(), { send });

    expect(send).toHaveBeenCalledWith({
      conversationId: 'c-1',
      text: 'Dạ em hỗ trợ anh/chị ạ.',
      idempotencyKey: 'log-1',
    });
    expect(result).toMatchObject({
      allowed: true,
      status: 'sent',
      sent: true,
      messageId: 'message-1',
    });
    expect(mocks.prisma.aiRelease.findFirst).toHaveBeenCalledTimes(2);
  });
});
