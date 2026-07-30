import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { updateAutoReplyConfig } from './auto-reply-service.js';

export class AiAdminCenterError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'AI_ADMIN_CENTER_ERROR') {
    super(message);
  }
}

function range(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new AiAdminCenterError('Invalid date range', 400, 'INVALID_DATE_RANGE');
  }
  return { gte: start, lte: end };
}

export async function adminCenterSummary(orgId: string, options: { from?: string; to?: string } = {}) {
  const createdAt = range(options.from, options.to);
  const where = { orgId, createdAt };
  const [runs, suggestions, used, edited, autoSent, handoffs, failed, hallucinations, feedback, usage, intents, missingKnowledge, emergency] = await Promise.all([
    prisma.aiRun.count({ where }),
    prisma.aiAssistantSuggestion.count({ where: { ...where, deletedAt: null } }),
    prisma.aiFeedback.count({ where: { ...where, selectionStatus: 'selected' } }),
    prisma.aiFeedback.count({ where: { ...where, selectionStatus: 'edited' } }),
    prisma.aiAutoReplyLog.count({ where: { ...where, status: 'sent' } }),
    prisma.aiHandoff.count({ where }),
    prisma.aiRun.count({ where: { ...where, status: { in: ['failed', 'error', 'degraded'] } } }),
    prisma.aiFeedback.count({ where: { ...where, type: { in: ['incorrect_information', 'policy_violation'] } } }),
    prisma.aiFeedback.count({ where }),
    prisma.aiUsageRecord.aggregate({ where, _sum: { costMicros: true, inputTokens: true, outputTokens: true } }),
    prisma.aiIntentAnalysis.groupBy({ by: ['label'], where, _count: { _all: true }, orderBy: { _count: { label: 'desc' } }, take: 8 }),
    prisma.aiLearningCandidate.count({ where: { orgId, kind: 'knowledge_gap', status: { in: ['pending_review', 'pending', 'approved'] }, createdAt } }),
    prisma.aiAutoReplyConfig.findFirst({ where: { orgId, scope: 'workspace', emergencyStop: true, deletedAt: null }, select: { id: true } }),
  ]);
  const errorRate = runs ? Number((failed / runs * 100).toFixed(2)) : null;
  const hallucinationRate = feedback ? Number((hallucinations / feedback * 100).toFixed(2)) : null;
  return {
    range: { from: createdAt.gte.toISOString(), to: createdAt.lte.toISOString() },
    hasRuntimeData: runs > 0,
    metrics: {
      aiProcessed: runs,
      suggestions,
      employeeUsed: used,
      editRate: suggestions ? Number((edited / suggestions * 100).toFixed(2)) : null,
      autoSent,
      handoffs,
      errorRate,
      hallucinationRate,
      costMicros: (usage._sum.costMicros ?? 0n).toString(),
      inputTokens: usage._sum.inputTokens ?? 0,
      outputTokens: usage._sum.outputTokens ?? 0,
      conversion: null,
      knowledgeGaps: missingKnowledge,
    },
    topIntents: intents.map((item) => ({ label: item.label, count: item._count._all })),
    alerts: [
      ...(!runs ? [{ level: 'info', code: 'NO_RUNTIME_DATA', message: 'Chưa có lượt chạy AI trong khoảng thời gian này; các tỷ lệ chất lượng chưa đủ dữ liệu.' }] : []),
      ...(emergency ? [{ level: 'critical', code: 'EMERGENCY_STOP_ACTIVE', message: 'Emergency stop is active for Auto Reply.' }] : []),
      ...(errorRate != null && errorRate >= 10 ? [{ level: 'warning', code: 'ERROR_RATE_HIGH', message: `AI error rate is ${errorRate}% in selected range.` }] : []),
      ...(hallucinationRate != null && hallucinationRate >= 5 ? [{ level: 'warning', code: 'HALLUCINATION_RATE_HIGH', message: `Potential hallucination rate is ${hallucinationRate}%.` }] : []),
    ],
  };
}

export async function adminCenterAudit(orgId: string, options: { limit?: number; from?: string; to?: string }) {
  const createdAt = range(options.from, options.to);
  return prisma.aiAuditLog.findMany({
    where: { orgId, createdAt },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(options.limit ?? 100, 200)),
    select: {
      id: true,
      eventType: true,
      outcome: true,
      targetType: true,
      targetId: true,
      runId: true,
      actorUserId: true,
      createdAt: true,
      metadata: true,
      actor: { select: { fullName: true } },
    },
  });
}

export async function listAiRuns(orgId: string, options: { from?: string; to?: string; status?: string; taskType?: string; search?: string; limit?: number }) {
  const createdAt = range(options.from, options.to);
  const search = options.search?.trim().slice(0, 120);
  const rows = await prisma.aiRun.findMany({
    where: {
      orgId,
      createdAt,
      ...(options.status ? { status: options.status } : {}),
      ...(options.taskType ? { taskType: options.taskType } : {}),
      ...(search ? {
        OR: [
          { id: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { agent: { name: { contains: search, mode: Prisma.QueryMode.insensitive } } },
          { modelConfig: { name: { contains: search, mode: Prisma.QueryMode.insensitive } } },
        ],
      } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(options.limit ?? 100, 200)),
    select: {
      id: true,
      taskType: true,
      status: true,
      riskTier: true,
      conversationId: true,
      errorCode: true,
      knowledgeRefs: true,
      createdAt: true,
      completedAt: true,
      agent: { select: { id: true, name: true } },
      modelConfig: { select: { id: true, name: true, provider: true, model: true } },
      promptVersion: { select: { id: true, version: true, prompt: { select: { name: true } } } },
      usageRecords: { orderBy: { createdAt: 'asc' }, select: { inputTokens: true, outputTokens: true, cachedInputTokens: true, costMicros: true, latencyMs: true, status: true } },
      suggestions: { where: { deletedAt: null }, select: { id: true, status: true, confidence: true } },
    },
  });
  return rows.map((row) => ({
    ...row,
    usageRecords: row.usageRecords.map((usage) => ({ ...usage, costMicros: usage.costMicros.toString() })),
  }));
}

export async function getAiRunDetail(orgId: string, runId: string) {
  const run = await prisma.aiRun.findFirst({
    where: { id: runId, orgId },
    select: {
      id: true,
      taskType: true,
      status: true,
      riskTier: true,
      conversationId: true,
      contactId: true,
      errorCode: true,
      contextManifest: true,
      knowledgeRefs: true,
      createdAt: true,
      completedAt: true,
      agent: { select: { id: true, name: true } },
      modelConfig: { select: { id: true, name: true, provider: true, model: true } },
      promptVersion: { select: { id: true, version: true, prompt: { select: { name: true } } } },
      usageRecords: { orderBy: { createdAt: 'asc' }, select: { id: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, costMicros: true, latencyMs: true, status: true, createdAt: true } },
      suggestions: { where: { deletedAt: null }, select: { id: true, kind: true, status: true, confidence: true, contentRedacted: true, createdAt: true } },
      actions: { select: { id: true, type: true, status: true, riskTier: true, requiresApproval: true, previewRedacted: true, createdAt: true } },
      auditLogs: { orderBy: { createdAt: 'asc' }, select: { id: true, eventType: true, outcome: true, createdAt: true, metadata: true } },
    },
  });
  if (!run) throw new AiAdminCenterError('AI run not found', 404, 'AI_RUN_NOT_FOUND');
  return {
    ...run,
    usageRecords: run.usageRecords.map((usage) => ({ ...usage, costMicros: usage.costMicros.toString() })),
  };
}

function percentile(values: number[], value: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? null;
}

export async function aiUsageBreakdown(orgId: string, options: { from?: string; to?: string } = {}) {
  const createdAt = range(options.from, options.to);
  const records = await prisma.aiUsageRecord.findMany({
    where: { orgId, createdAt },
    orderBy: { createdAt: 'asc' },
    take: 10_000,
    select: { provider: true, model: true, taskType: true, inputTokens: true, outputTokens: true, cachedInputTokens: true, costMicros: true, latencyMs: true, status: true, createdAt: true },
  });
  const sum = (items: typeof records) => items.reduce((result, item) => ({
    requests: result.requests + 1,
    inputTokens: result.inputTokens + item.inputTokens,
    outputTokens: result.outputTokens + item.outputTokens,
    cachedInputTokens: result.cachedInputTokens + item.cachedInputTokens,
    costMicros: result.costMicros + item.costMicros,
    errors: result.errors + (item.status === 'ok' ? 0 : 1),
  }), { requests: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costMicros: 0n, errors: 0 });
  const group = (key: (item: typeof records[number]) => string) => {
    const map = new Map<string, typeof records>();
    for (const item of records) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
    return [...map.entries()].map(([name, items]) => {
      const total = sum(items);
      return { name, ...total, costMicros: total.costMicros.toString(), p95LatencyMs: percentile(items.map((item) => item.latencyMs).filter((value): value is number => value != null), .95) };
    });
  };
  const total = sum(records);
  const latencies = records.map((item) => item.latencyMs).filter((value): value is number => value != null);
  return {
    range: { from: createdAt.gte.toISOString(), to: createdAt.lte.toISOString() },
    hasData: records.length > 0,
    totals: { ...total, costMicros: total.costMicros.toString(), p50LatencyMs: percentile(latencies, .5), p95LatencyMs: percentile(latencies, .95) },
    byModel: group((item) => `${item.provider} · ${item.model}`),
    byTask: group((item) => item.taskType),
    byDay: group((item) => item.createdAt.toISOString().slice(0, 10)),
  };
}

export async function aiSecurityCenter(orgId: string) {
  const [models, emergency, releases, publishedKnowledge, auditEvents] = await Promise.all([
    prisma.aiModelConfig.findMany({ where: { orgId, status: { in: ['active', 'approved'] }, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, provider: true, model: true, status: true, capabilities: true, dataPolicy: true, fallbackModelConfigId: true } }),
    prisma.aiAutoReplyConfig.findFirst({ where: { orgId, scope: 'workspace', scopeRefId: null, deletedAt: null }, orderBy: { updatedAt: 'desc' }, select: { enabled: true, mode: true, emergencyStop: true, updatedAt: true } }),
    prisma.aiRelease.count({ where: { orgId, status: 'production' } }),
    prisma.aiKnowledgeDocument.count({ where: { orgId, status: 'published', deletedAt: null } }),
    prisma.aiAuditLog.count({ where: { orgId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  return {
    safeguards: [
      { key: 'tenant_isolation', label: 'Cô lập dữ liệu theo tổ chức', status: 'enforced' },
      { key: 'conversation_privacy', label: 'Kiểm tra quyền và khóa hội thoại riêng tư trước khi gọi AI', status: 'enforced' },
      { key: 'secret_redaction', label: 'Không ghi API key hoặc nội dung thô vào audit log', status: 'enforced' },
      { key: 'tool_approval', label: 'Công cụ thay đổi dữ liệu chỉ tạo bản nháp và cần phê duyệt', status: 'enforced' },
      { key: 'auto_send_gate', label: 'Tự gửi cần Release Production và Evaluation đạt yêu cầu', status: releases > 0 ? 'ready' : 'blocked' },
    ],
    permissions: [
      { resource: 'ai_model', actions: ['access', 'create', 'edit', 'delete', 'manage_secret', 'approve'] },
      { resource: 'ai_agent', actions: ['access', 'create', 'edit', 'delete', 'approve'] },
      { resource: 'ai_knowledge', actions: ['access', 'create', 'edit', 'delete', 'approve'] },
      { resource: 'ai_auto_reply', actions: ['access', 'edit', 'approve', 'emergency_stop'] },
      { resource: 'ai_audit', actions: ['access', 'view_all', 'export'] },
    ],
    models,
    runtime: {
      autoReply: emergency ?? { enabled: false, mode: 'disabled', emergencyStop: true, updatedAt: null },
      productionReleases: releases,
      publishedKnowledge,
      auditEventsLast30Days: auditEvents,
    },
  };
}

export async function setAdminEmergencyStop(actor: { orgId: string; userId: string }, enabled: boolean) {
  return updateAutoReplyConfig(actor, { scope: 'workspace', emergencyStop: enabled });
}
