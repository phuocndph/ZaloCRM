import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { decryptToken, encryptToken } from '../integrations/_shared/token-encryption.util.js';
import { aiClient } from './core/index.js';
import {
  buildConversationContext,
  ContextBuilderError,
  type ContextActor,
  type ConversationContext,
  type ContextSection,
} from './conversation-context-builder-service.js';

export type MemoryActor = ContextActor;

export type ShortTermConversationSummary = {
  currentDiscussion: string;
  unansweredQuestions: string[];
  currentProduct: unknown | null;
  currentEmotion: unknown | null;
  generatedFrom: { conversationId: string; sourceThroughMessageId: string | null; sourceIds: string[] };
};

export type CustomerMemoryKey =
  | 'customer_type'
  | 'long_term_need'
  | 'interested_product'
  | 'previous_order'
  | 'confirmed_budget'
  | 'communication_style'
  | 'rejection_reason'
  | 'important_complaint'
  | 'explicit_remember_request';

export type CustomerMemoryEvidence = {
  type: 'message' | 'context' | 'manual';
  sourceId?: string | null;
  messageId?: string | null;
  excerpt?: string | null;
  createdAt?: string | null;
};

export type CustomerMemoryInput = {
  key: CustomerMemoryKey;
  value: string;
  evidence: CustomerMemoryEvidence[];
  confidence?: number;
  status?: 'candidate' | 'approved' | 'blocked';
  expiresAt?: Date | string | null;
  source?: 'manual' | 'ai_candidate';
};

export class ConversationMemoryError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'CONVERSATION_MEMORY_ERROR') {
    super(message);
    this.name = 'ConversationMemoryError';
  }
}

const ALLOWED_MEMORY_KEYS = new Set<CustomerMemoryKey>([
  'customer_type',
  'long_term_need',
  'interested_product',
  'previous_order',
  'confirmed_budget',
  'communication_style',
  'rejection_reason',
  'important_complaint',
  'explicit_remember_request',
]);

const SENSITIVE_PATTERNS = [
  /\b(password|mat khau|mật khẩu|otp|2fa|token|secret|api[_ -]?key|private key)\b/i,
  /\b\d{6}\b/,
  /\b(?:\d[ -]?){12,19}\b/,
];

const DEFAULT_MIN_NEW_MESSAGES = 6;
const DEFAULT_IDLE_MS = 8 * 60 * 1000;
const MAX_MEMORY_VALUE_CHARS = 1200;

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function encryptText(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(encryptToken(value));
}

function decryptText(value: Uint8Array): string {
  return decryptToken(Buffer.from(value).toString('utf8'));
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function clampConfidence(value?: number) {
  if (!Number.isFinite(value ?? NaN)) return 0.7;
  return Math.max(0, Math.min(1, Number(value)));
}

function section(context: ConversationContext, id: string): ContextSection | undefined {
  return context.sections.find((item) => item.id === id);
}

function sectionItems<T = unknown>(context: ConversationContext, id: string): T | undefined {
  return section(context, id)?.items as T | undefined;
}

function recentMessages(context: ConversationContext) {
  return (sectionItems<Array<{ id: string; content?: string | null; senderType?: string; sentAt?: string | Date }>>(context, 'recent_messages') ?? [])
    .filter((message) => message.content);
}

function latestMessageId(context: ConversationContext) {
  const messages = recentMessages(context);
  return messages[messages.length - 1]?.id ?? null;
}

function newestMessageAt(context: ConversationContext) {
  const messages = recentMessages(context);
  const value = messages[messages.length - 1]?.sentAt;
  return value ? new Date(value).getTime() : 0;
}

function visibleSourceIds(context: ConversationContext) {
  return [...new Set(context.sections.flatMap((item) => item.sources))];
}

function compactJson(value: unknown, max = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sanitizeValue(value: string) {
  const clean = normalizeSpaces(value);
  if (!clean) throw new ConversationMemoryError('Memory value is required');
  if (clean.length > MAX_MEMORY_VALUE_CHARS) throw new ConversationMemoryError('Memory value is too long');
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(clean))) {
    throw new ConversationMemoryError('Sensitive memory values are not allowed by default', 400, 'SENSITIVE_MEMORY_REJECTED');
  }
  return clean;
}

function assertMemoryKey(key: string): asserts key is CustomerMemoryKey {
  if (!ALLOWED_MEMORY_KEYS.has(key as CustomerMemoryKey)) {
    throw new ConversationMemoryError('Unsupported customer memory key', 400, 'UNSUPPORTED_MEMORY_KEY');
  }
}

function defaultExpiresAt(key: CustomerMemoryKey, now = new Date()) {
  const daysByKey: Record<CustomerMemoryKey, number | null> = {
    customer_type: 365,
    long_term_need: 365,
    interested_product: 180,
    previous_order: null,
    confirmed_budget: 180,
    communication_style: 365,
    rejection_reason: 365,
    important_complaint: 720,
    explicit_remember_request: 365,
  };
  const days = daysByKey[key];
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function auditData(metadata: Record<string, unknown>): Prisma.InputJsonValue {
  return metadata as Prisma.InputJsonValue;
}

async function audit(
  tx: any,
  actor: MemoryActor,
  eventType: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await tx.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType,
      outcome: 'success',
      targetType,
      targetId,
      metadata: auditData(metadata),
    },
  });
}

function buildDeterministicSummary(context: ConversationContext): ShortTermConversationSummary {
  const messages = recentMessages(context);
  const lastMessages = messages.slice(-8).map((message) => `${message.senderType ?? 'unknown'}: ${message.content}`).join('\n');
  const unansweredQuestions = messages
    .filter((message) => message.senderType !== 'agent' && message.content && /[?？]|\b(bao nhiêu|bao nhieu|khi nào|lúc nào|ở đâu|o dau|có không|co khong)\b/i.test(message.content))
    .slice(-5)
    .map((message) => normalizeSpaces(String(message.content)));
  return {
    currentDiscussion: lastMessages || compactJson(sectionItems(context, 'conversation_summary') ?? 'No recent visible messages'),
    unansweredQuestions,
    currentProduct: sectionItems(context, 'current_product') ?? null,
    currentEmotion: sectionItems(context, 'latest_emotion') ?? null,
    generatedFrom: { conversationId: context.conversationId, sourceThroughMessageId: latestMessageId(context), sourceIds: visibleSourceIds(context) },
  };
}

function summarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['currentDiscussion', 'unansweredQuestions', 'currentProduct', 'currentEmotion'],
    properties: {
      currentDiscussion: { type: 'string' },
      unansweredQuestions: { type: 'array', items: { type: 'string' } },
      currentProduct: {},
      currentEmotion: {},
    },
  };
}

async function generateSummary(
  actor: MemoryActor,
  context: ConversationContext,
  modelConfigId?: string,
): Promise<ShortTermConversationSummary> {
  const fallback = buildDeterministicSummary(context);
  if (!modelConfigId) return fallback;
  const response = await aiClient.complete<Partial<ShortTermConversationSummary>>({
    orgId: actor.orgId,
    modelConfigId,
    taskType: 'conversation_summary',
    maxTokens: 800,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: [
          'You summarize CRM conversations into short-term operational memory.',
          'Only use provided context. Do not infer facts. If uncertain, omit.',
          'Do not include secrets, raw phone numbers, raw emails, passwords, OTPs, tokens, or payment card data.',
        ].join(' '),
      },
      { role: 'user', content: JSON.stringify({ context }) },
    ],
    structuredOutput: { name: 'conversation_short_term_summary', schema: summarySchema() },
  });
  const structured = response.structured ?? {};
  return {
    currentDiscussion: sanitizeSummaryText(structured.currentDiscussion) || fallback.currentDiscussion,
    unansweredQuestions: Array.isArray(structured.unansweredQuestions)
      ? structured.unansweredQuestions.map(String).map(sanitizeSummaryText).filter(Boolean).slice(0, 8)
      : fallback.unansweredQuestions,
    currentProduct: structured.currentProduct ?? fallback.currentProduct,
    currentEmotion: structured.currentEmotion ?? fallback.currentEmotion,
    generatedFrom: fallback.generatedFrom,
  };
}

function sanitizeSummaryText(value: unknown) {
  const clean = normalizeSpaces(String(value ?? ''));
  if (!clean) return '';
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(clean))) return '';
  return clean.slice(0, 2000);
}

async function newMessageCount(conversationId: string, sourceThroughMessageId?: string | null) {
  if (!sourceThroughMessageId) {
    return prisma.message.count({ where: { conversationId, isDeleted: false } });
  }
  const source = await prisma.message.findFirst({
    where: { id: sourceThroughMessageId, conversationId, isDeleted: false },
    select: { sentAt: true, createdAt: true },
  });
  if (!source) return prisma.message.count({ where: { conversationId, isDeleted: false } });
  return prisma.message.count({
    where: {
      conversationId,
      isDeleted: false,
      OR: [{ sentAt: { gt: source.sentAt } }, { sentAt: source.sentAt, createdAt: { gt: source.createdAt } }],
    },
  });
}

export async function refreshConversationSummary(
  actor: MemoryActor,
  conversationId: string,
  options: { modelConfigId?: string; force?: boolean; maxTokens?: number; minNewMessages?: number; idleMs?: number } = {},
) {
  const context = await buildConversationContext(actor, conversationId, { maxTokens: options.maxTokens ?? 2600 });
  const existing = await prisma.aiConversationSummary.findFirst({
    where: { orgId: actor.orgId, conversationId, status: 'active' },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, version: true, sourceThroughMessageId: true },
  });
  const count = await newMessageCount(conversationId, existing?.sourceThroughMessageId);
  const idleMs = Date.now() - newestMessageAt(context);
  const latestId = latestMessageId(context);
  const minNewMessages = options.minNewMessages ?? DEFAULT_MIN_NEW_MESSAGES;
  const requiredIdleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  if (!options.force && existing?.sourceThroughMessageId === latestId) {
    return { skipped: true, reason: 'up_to_date', summaryId: existing.id };
  }
  if (!options.force && count < minNewMessages && idleMs < requiredIdleMs) {
    return { skipped: true, reason: 'threshold_not_met', newMessages: count, idleMs };
  }
  const summary = await generateSummary(actor, context, options.modelConfigId);
  const payload = JSON.stringify(summary);
  return prisma.$transaction(async (tx) => {
    await tx.aiConversationSummary.updateMany({
      where: { orgId: actor.orgId, conversationId, status: 'active' },
      data: { status: 'archived' },
    });
    const created = await tx.aiConversationSummary.create({
      data: {
        orgId: actor.orgId,
        conversationId,
        sourceThroughMessageId: summary.generatedFrom.sourceThroughMessageId,
        version: (existing?.version ?? 0) + 1,
        status: 'active',
        summaryEncrypted: encryptText(payload),
        summaryRedacted: JSON.stringify({
          currentDiscussion: summary.currentDiscussion,
          unansweredQuestions: summary.unansweredQuestions,
          currentProduct: summary.currentProduct,
          currentEmotion: summary.currentEmotion,
        }),
        summaryHash: hash(payload),
      },
      select: { id: true, version: true, summaryRedacted: true, sourceThroughMessageId: true, createdAt: true },
    });
    await audit(tx, actor, 'memory.summary_refreshed', 'ai_conversation_summary', created.id, {
      conversationId,
      version: created.version,
      sourceThroughMessageId: created.sourceThroughMessageId,
      sourceCount: summary.generatedFrom.sourceIds.length,
      modelConfigId: options.modelConfigId ?? null,
    });
    return { skipped: false, summary: created };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function memoryDto(memory: any) {
  return {
    ...memory,
    value: memory.valueEncrypted ? decryptText(memory.valueEncrypted) : memory.valueRedacted,
    valueEncrypted: undefined,
  };
}

export async function listCustomerMemories(actor: MemoryActor, contactId: string) {
  const now = new Date();
  const rows = await prisma.aiCustomerMemory.findMany({
    where: {
      orgId: actor.orgId,
      contactId,
      deletedAt: null,
      status: { in: ['candidate', 'approved'] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });
  return rows.map(memoryDto);
}

export async function upsertCustomerMemory(actor: MemoryActor, contactId: string, input: CustomerMemoryInput) {
  assertMemoryKey(input.key);
  const value = sanitizeValue(input.value);
  if (!input.evidence?.length) throw new ConversationMemoryError('Memory evidence is required', 400, 'MEMORY_EVIDENCE_REQUIRED');
  const valueHash = hash(`${input.key}:${value.toLowerCase()}`);
  const status = input.status ?? (input.source === 'manual' ? 'approved' : 'candidate');
  const confidence = clampConfidence(input.confidence);
  const expiresAt = input.expiresAt === null ? null : input.expiresAt ? new Date(input.expiresAt) : defaultExpiresAt(input.key);
  const evidence = input.evidence.slice(0, 12) as Prisma.InputJsonValue;

  const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId: actor.orgId }, select: { id: true } });
  if (!contact) throw new ConversationMemoryError('Contact not found', 404, 'CONTACT_NOT_FOUND');

  const existingSame = await prisma.aiCustomerMemory.findFirst({
    where: { orgId: actor.orgId, contactId, key: input.key, valueHash, deletedAt: null, status: { in: ['candidate', 'approved'] } },
    orderBy: { updatedAt: 'desc' },
  });

  return prisma.$transaction(async (tx) => {
    if (existingSame) {
      const mergedEvidence = [...(Array.isArray(existingSame.evidence) ? existingSame.evidence as unknown[] : []), ...(evidence as unknown[])]
        .slice(-20) as Prisma.InputJsonValue;
      const updated = await tx.aiCustomerMemory.update({
        where: { id: existingSame.id },
        data: {
          evidence: mergedEvidence,
          confidence: Math.max(existingSame.confidence ?? 0, confidence),
          lastReinforcedAt: new Date(),
          expiresAt,
          status: existingSame.status === 'approved' ? 'approved' : status,
          approvedByUserId: status === 'approved' ? actor.userId : existingSame.approvedByUserId,
          approvedAt: status === 'approved' ? new Date() : existingSame.approvedAt,
        },
      });
      await audit(tx, actor, 'memory.reinforced', 'ai_customer_memory', updated.id, { contactId, key: input.key, status: updated.status });
      return memoryDto(updated);
    }

    const conflicting = await tx.aiCustomerMemory.findFirst({
      where: { orgId: actor.orgId, contactId, key: input.key, deletedAt: null, status: { in: ['candidate', 'approved'] } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, valueHash: true, confidence: true, status: true },
    });
    const finalStatus = conflicting && status !== 'approved' ? 'candidate' : status;
    const created = await tx.aiCustomerMemory.create({
      data: {
        orgId: actor.orgId,
        contactId,
        key: input.key,
        valueEncrypted: encryptText(value),
        valueRedacted: value,
        valueHash,
        evidence: conflicting ? ([...(evidence as unknown[]), { type: 'context', sourceId: conflicting.id, excerpt: 'potential_conflict' }] as Prisma.InputJsonValue) : evidence,
        status: finalStatus,
        confidence,
        expiresAt,
        lastReinforcedAt: new Date(),
        approvedByUserId: finalStatus === 'approved' ? actor.userId : null,
        approvedAt: finalStatus === 'approved' ? new Date() : null,
        supersededById: conflicting && finalStatus === 'approved' ? conflicting.id : null,
      },
    });
    await audit(tx, actor, 'memory.created', 'ai_customer_memory', created.id, {
      contactId,
      key: input.key,
      status: created.status,
      confidence,
      conflictWith: conflicting?.id ?? null,
      source: input.source ?? 'ai_candidate',
    });
    return memoryDto(created);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateCustomerMemory(
  actor: MemoryActor,
  memoryId: string,
  input: Partial<Pick<CustomerMemoryInput, 'value' | 'confidence' | 'status' | 'expiresAt' | 'evidence'>>,
) {
  const current = await prisma.aiCustomerMemory.findFirst({ where: { id: memoryId, orgId: actor.orgId, deletedAt: null } });
  if (!current) throw new ConversationMemoryError('Memory not found', 404, 'MEMORY_NOT_FOUND');
  const value = input.value !== undefined ? sanitizeValue(input.value) : current.valueEncrypted ? decryptText(current.valueEncrypted) : current.valueRedacted ?? '';
  const valueHash = hash(`${current.key}:${value.toLowerCase()}`);
  const status = input.status ?? current.status;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.aiCustomerMemory.update({
      where: { id: memoryId },
      data: {
        valueEncrypted: encryptText(value),
        valueRedacted: value,
        valueHash,
        confidence: input.confidence === undefined ? current.confidence : clampConfidence(input.confidence),
        status,
        evidence: input.evidence ? input.evidence as Prisma.InputJsonValue : current.evidence as Prisma.InputJsonValue,
        expiresAt: input.expiresAt === undefined ? current.expiresAt : input.expiresAt === null ? null : new Date(input.expiresAt),
        approvedByUserId: status === 'approved' ? actor.userId : current.approvedByUserId,
        approvedAt: status === 'approved' ? (current.approvedAt ?? new Date()) : current.approvedAt,
      },
    });
    await audit(tx, actor, 'memory.updated', 'ai_customer_memory', row.id, { key: row.key, status: row.status });
    return row;
  });
  return memoryDto(updated);
}

export async function deleteCustomerMemory(actor: MemoryActor, memoryId: string, reason?: string) {
  const current = await prisma.aiCustomerMemory.findFirst({ where: { id: memoryId, orgId: actor.orgId, deletedAt: null } });
  if (!current) throw new ConversationMemoryError('Memory not found', 404, 'MEMORY_NOT_FOUND');
  return prisma.$transaction(async (tx) => {
    const row = await tx.aiCustomerMemory.update({ where: { id: memoryId }, data: { deletedAt: new Date(), status: 'deleted' } });
    await audit(tx, actor, 'memory.deleted', 'ai_customer_memory', row.id, { key: row.key, reason: reason?.slice(0, 300) ?? null });
    return { ok: true, id: row.id };
  });
}

function evidenceFromContext(context: ConversationContext, sectionId: string, excerpt?: string): CustomerMemoryEvidence[] {
  const found = section(context, sectionId);
  if (!found) return [];
  return found.sources.slice(0, 5).map((sourceId) => ({ type: 'context', sourceId, excerpt: excerpt?.slice(0, 280) ?? found.title }));
}

function deterministicMemoryCandidates(context: ConversationContext): CustomerMemoryInput[] {
  const candidates: CustomerMemoryInput[] = [];
  const currentProduct = sectionItems(context, 'current_product');
  if (currentProduct) {
    candidates.push({
      key: 'interested_product',
      value: compactJson(currentProduct, 700),
      confidence: 0.78,
      status: 'candidate',
      source: 'ai_candidate',
      evidence: evidenceFromContext(context, 'current_product', 'Structured current product/need from customer profile metadata'),
    });
  }
  const profile = sectionItems<Record<string, unknown>>(context, 'customer_profile');
  const demographics = profile?.demographics as Record<string, unknown> | undefined;
  if (demographics?.incomeRange) {
    candidates.push({
      key: 'confirmed_budget',
      value: `Income/budget range recorded in profile: ${String(demographics.incomeRange)}`,
      confidence: 0.65,
      status: 'candidate',
      source: 'ai_candidate',
      evidence: evidenceFromContext(context, 'customer_profile', 'Profile field, not inferred from chat'),
    });
  }
  for (const message of recentMessages(context).slice(-20)) {
    const text = normalizeSpaces(String(message.content ?? ''));
    if (!/\b(ghi nhớ|nho giup|nhớ giúp|lưu ý|luu y|remember)\b/i.test(text)) continue;
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) continue;
    candidates.push({
      key: 'explicit_remember_request',
      value: text.slice(0, 500),
      confidence: 0.88,
      status: 'candidate',
      source: 'ai_candidate',
      evidence: [{ type: 'message', messageId: message.id, excerpt: text.slice(0, 280), createdAt: message.sentAt ? new Date(message.sentAt).toISOString() : null }],
    });
  }
  return candidates;
}

function contactIdFromContext(context: ConversationContext) {
  return sectionItems<{ contactId?: string }>(context, 'customer_profile')?.contactId;
}

export async function proposeCustomerMemoriesFromConversation(
  actor: MemoryActor,
  conversationId: string,
  options: { modelConfigId?: string; maxTokens?: number } = {},
) {
  const context = await buildConversationContext(actor, conversationId, { maxTokens: options.maxTokens ?? 2600 });
  const contactId = contactIdFromContext(context);
  if (!contactId) throw new ConversationMemoryError('Conversation has no linked contact', 400, 'CONTACT_REQUIRED');
  let candidates = deterministicMemoryCandidates(context);
  if (options.modelConfigId) {
    const response = await aiClient.complete<{ memories?: CustomerMemoryInput[] }>({
      orgId: actor.orgId,
      modelConfigId: options.modelConfigId,
      taskType: 'customer_memory_proposal',
      maxTokens: 900,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'Extract long-term customer memory candidates only from explicit facts in the provided CRM context.',
            'Never store guesses as facts. Every memory needs evidence, confidence, and one allowed key.',
            'Return candidates only; they are not approved automatically.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify({ allowedKeys: [...ALLOWED_MEMORY_KEYS], context }) },
      ],
      structuredOutput: {
        name: 'customer_memory_candidates',
        schema: {
          type: 'object',
          required: ['memories'],
          properties: { memories: { type: 'array', items: { type: 'object' } } },
        },
      },
    });
    const modelCandidates = Array.isArray(response.structured?.memories) ? response.structured.memories : [];
    candidates = [...candidates, ...modelCandidates].slice(0, 20);
  }
  const saved = [];
  for (const candidate of candidates) {
    try {
      assertMemoryKey(candidate.key);
      saved.push(await upsertCustomerMemory(actor, contactId, { ...candidate, status: 'candidate', source: 'ai_candidate' }));
    } catch (error) {
      if (error instanceof ConversationMemoryError) continue;
      throw error;
    }
  }
  return { contactId, candidates: saved };
}

export async function maybeRefreshConversationSummaryAfterMessage(
  actor: MemoryActor,
  conversationId: string,
  options: { modelConfigId?: string; maxTokens?: number; minNewMessages?: number; idleMs?: number } = {},
) {
  return refreshConversationSummary(actor, conversationId, { ...options, force: false });
}

export { ContextBuilderError };
