import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';
import { encryptToken, decryptToken } from '../integrations/_shared/token-encryption.util.js';
import { EvaluationEngineError, requirePassingEvaluation } from './evaluation-engine-service.js';

export type KnowledgeActor = { orgId: string; userId: string; role: string };
export type KnowledgeStatus = 'draft' | 'published' | 'archived' | 'failed';
export type KnowledgeSourceType = 'product' | 'price_list' | 'policy' | 'faq' | 'website' | 'article' | 'pdf' | 'word' | 'excel' | 'text' | 'manual' | 'consultation_script' | 'complaint_process';

type Scope = { visibility?: 'org' | 'restricted'; userIds?: string[]; departmentIds?: string[]; permissionGroupIds?: string[] };
const SOURCE_TYPES = new Set<KnowledgeSourceType>(['product', 'price_list', 'policy', 'faq', 'website', 'article', 'pdf', 'word', 'excel', 'text', 'manual', 'consultation_script', 'complaint_process']);
const MAX_INGEST_BYTES = 10 * 1024 * 1024;
const CHUNK_CHARS = 1100;
const CHUNK_OVERLAP = 160;
const EMBEDDING_DIMENSIONS = 96;
const STOP_WORDS = new Set(['và', 'là', 'của', 'có', 'cho', 'với', 'một', 'những', 'được', 'trong', 'the', 'a', 'an', 'to', 'of', 'is', 'in', 'on', 'at', 'về', 'từ', 'khi', 'để']);

export class KnowledgeBaseError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'KNOWLEDGE_BASE_ERROR') {
    super(message); this.name = 'KnowledgeBaseError';
  }
}

function sha256(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
function bytes(value: string) { return Buffer.from(value, 'utf8'); }
function text(value?: Uint8Array | null) { return value ? new TextDecoder().decode(value) : ''; }
function clampPriority(value?: number) { return Math.max(-100, Math.min(100, Math.floor(Number(value ?? 0) || 0))); }
function cleanTags(value?: unknown) { return Array.from(new Set((Array.isArray(value) ? value : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean))).slice(0, 30); }
function asScope(value?: unknown): Scope {
  const scope = value && typeof value === 'object' && !Array.isArray(value) ? value as Scope : {};
  return { visibility: scope.visibility === 'restricted' ? 'restricted' : 'org', userIds: cleanTags(scope.userIds), departmentIds: cleanTags(scope.departmentIds), permissionGroupIds: cleanTags(scope.permissionGroupIds) };
}
function dateOrNull(value?: string | Date | null) { if (!value) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) throw new KnowledgeBaseError('Invalid effective date', 400, 'INVALID_EFFECTIVE_DATE'); return date; }
function isEffective(from?: Date | null, to?: Date | null, now = new Date()) { return (!from || from <= now) && (!to || to >= now); }
function tokenize(value: string) { return Array.from(new Set((value.toLocaleLowerCase('vi-VN').match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).filter((word) => word.length > 1 && !STOP_WORDS.has(word)))); }
function embedding(value: string) {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of tokenize(value)) { const hash = createHash('sha256').update(word).digest(); const index = hash.readUInt16BE(0) % EMBEDDING_DIMENSIONS; vector[index] += hash[2] % 2 ? -1 : 1; }
  const magnitude = Math.sqrt(vector.reduce((total, item) => total + item * item, 0));
  return magnitude ? vector.map((item) => item / magnitude) : vector;
}
function cosine(a: number[], b: number[]) { if (!a.length || !b.length || a.length !== b.length) return 0; return Math.max(0, a.reduce((total, item, index) => total + item * b[index], 0)); }
function redactedPreview(value: string, length = 420) { return value.replace(/\s+/g, ' ').trim().slice(0, length); }
function readableChunk(chunk: { contentEncrypted?: Uint8Array | null; contentRedacted?: string | null }) {
  if (!chunk.contentEncrypted) return chunk.contentRedacted ?? '';
  try {
    return decryptToken(text(chunk.contentEncrypted)).replace(/\s+/g, ' ').trim().slice(0, CHUNK_CHARS + 200);
  } catch {
    return chunk.contentRedacted ?? '';
  }
}
function chunks(value: string) {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const parts: string[] = []; let start = 0;
  while (start < normalized.length) { let end = Math.min(normalized.length, start + CHUNK_CHARS); if (end < normalized.length) { const boundary = Math.max(normalized.lastIndexOf('\n', end), normalized.lastIndexOf('. ', end)); if (boundary > start + 350) end = boundary + 1; } const part = normalized.slice(start, end).trim(); if (part) parts.push(part); if (end >= normalized.length) break; start = Math.max(end - CHUNK_OVERLAP, start + 1); }
  return parts;
}
function canReadScope(actor: KnowledgeActor, raw: unknown) { const scope = asScope(raw); if (scope.visibility !== 'restricted' || ['owner', 'admin'].includes(actor.role)) return true; return scope.userIds?.includes(actor.userId) ?? false; }
async function audit(actor: KnowledgeActor, eventType: string, outcome: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await prisma.aiAuditLog.create({ data: { orgId: actor.orgId, actorUserId: actor.userId, eventType, outcome, targetType, targetId, metadata } });
}

export async function createKnowledgeSource(actor: KnowledgeActor, input: { name: string; type: KnowledgeSourceType; config?: Record<string, unknown>; priority?: number; tags?: string[]; scope?: Scope; effectiveFrom?: string; effectiveTo?: string }) {
  if (!input.name?.trim()) throw new KnowledgeBaseError('Source name is required', 400, 'SOURCE_NAME_REQUIRED');
  if (!SOURCE_TYPES.has(input.type)) throw new KnowledgeBaseError('Unsupported source type', 400, 'SOURCE_TYPE_INVALID');
  const source = await prisma.aiKnowledgeSource.create({ data: { orgId: actor.orgId, name: input.name.trim(), type: input.type, config: input.config ?? {}, priority: clampPriority(input.priority), tags: cleanTags(input.tags), scope: asScope(input.scope), effectiveFrom: dateOrNull(input.effectiveFrom), effectiveTo: dateOrNull(input.effectiveTo), createdByUserId: actor.userId } });
  await audit(actor, 'knowledge.source_created', 'success', 'knowledge_source', source.id, { type: source.type });
  return source;
}

export async function listKnowledgeSources(actor: KnowledgeActor, includeArchived = false) {
  const sources = await prisma.aiKnowledgeSource.findMany({ where: { orgId: actor.orgId, deletedAt: null, ...(includeArchived ? {} : { status: { not: 'archived' } }) }, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], include: { _count: { select: { documents: { where: { deletedAt: null } } } }, createdBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } } } });
  return sources.filter((source) => canReadScope(actor, source.scope));
}

export async function listKnowledgeDocuments(actor: KnowledgeActor, sourceId?: string) {
  const sources = await listKnowledgeSources(actor, true);
  const allowedSourceIds = sources.map((source) => source.id);
  if (sourceId && !allowedSourceIds.includes(sourceId)) {
    throw new KnowledgeBaseError('Knowledge source not found', 404, 'SOURCE_NOT_FOUND');
  }
  if (!allowedSourceIds.length) return [];
  const documents = await prisma.aiKnowledgeDocument.findMany({
    where: {
      orgId: actor.orgId,
      sourceId: sourceId ?? { in: allowedSourceIds },
      deletedAt: null,
    },
    select: {
      id: true,
      sourceId: true,
      title: true,
      status: true,
      version: true,
      scope: true,
      effectiveFrom: true,
      effectiveTo: true,
      approvedAt: true,
      lastIndexedAt: true,
      updatedAt: true,
      _count: { select: { chunks: { where: { deletedAt: null } } } },
      source: { select: { id: true, name: true, type: true, status: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const visible = documents.filter((document) => canReadScope(actor, document.scope));
  const runs = await prisma.aiEvaluationRun.findMany({
    where: { orgId: actor.orgId, status: { in: ['completed', 'failed'] } },
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: { id: true, status: true, config: true, metrics: true, completedAt: true },
  });
  return visible.map(({ scope: _scope, ...document }) => {
    const matchingRuns = runs.filter((run) => {
      const config = run.config && typeof run.config === 'object' && !Array.isArray(run.config)
        ? run.config as Record<string, unknown>
        : {};
      return config.targetType === 'knowledge' && config.targetId === document.id;
    });
    const passingRun = matchingRuns.find((run) => {
      const metrics = run.metrics && typeof run.metrics === 'object' && !Array.isArray(run.metrics)
        ? run.metrics as Record<string, unknown>
        : {};
      return run.status === 'completed' && metrics.passed === true;
    });
    const latestRun = matchingRuns[0];
    // Publishing only changes workflow metadata. Evaluation freshness follows the
    // indexed payload, falling back to creation time before the first index.
    const changedAt = document.lastIndexedAt ?? document.updatedAt;
    const passingFresh = Boolean(passingRun?.completedAt && passingRun.completedAt >= changedAt);
    const displayRun = passingFresh ? passingRun : latestRun ?? passingRun;
    const displayMetrics = displayRun?.metrics && typeof displayRun.metrics === 'object' && !Array.isArray(displayRun.metrics)
      ? displayRun.metrics as Record<string, unknown>
      : {};
    const evaluationStatus = passingFresh
      ? 'passed'
      : passingRun
        ? 'stale'
        : latestRun
          ? 'failed'
          : 'not_run';
    return {
      ...document,
      evaluation: {
        status: evaluationStatus,
        runId: displayRun?.id ?? null,
        score: typeof displayMetrics.averageScore === 'number' ? displayMetrics.averageScore : null,
        completedAt: displayRun?.completedAt ?? null,
      },
    };
  });
}

export async function getKnowledgeDocument(actor: KnowledgeActor, documentId: string) {
  const document = await prisma.aiKnowledgeDocument.findFirst({
    where: { id: documentId, orgId: actor.orgId, deletedAt: null },
    select: {
      id: true,
      sourceId: true,
      externalId: true,
      title: true,
      status: true,
      contentRef: true,
      version: true,
      mimeType: true,
      language: true,
      effectiveFrom: true,
      effectiveTo: true,
      priority: true,
      tags: true,
      scope: true,
      metadata: true,
      lastIndexedAt: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true,
      source: {
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          scope: true,
          deletedAt: true,
        },
      },
      createdBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      _count: { select: { chunks: { where: { deletedAt: null } } } },
    },
  });
  if (!document || document.source.deletedAt) {
    throw new KnowledgeBaseError('Knowledge document not found', 404, 'DOCUMENT_NOT_FOUND');
  }
  if (!canReadScope(actor, document.source.scope) || !canReadScope(actor, document.scope)) {
    throw new KnowledgeBaseError('No access to knowledge document', 403, 'DOCUMENT_ACCESS_DENIED');
  }
  const content = documentContent(document);
  const { metadata: _metadata, scope: _scope, source, ...safeDocument } = document;
  const { scope: _sourceScope, deletedAt: _sourceDeletedAt, ...safeSource } = source;
  await audit(actor, 'knowledge.document_viewed', 'success', 'knowledge_document', documentId, {
    sourceId: document.sourceId,
    version: document.version,
  });
  return { ...safeDocument, source: safeSource, content };
}

export async function updateKnowledgeSource(actor: KnowledgeActor, sourceId: string, input: { name?: string; config?: Record<string, unknown>; priority?: number; tags?: string[]; scope?: Scope; effectiveFrom?: string | null; effectiveTo?: string | null }) {
  const current = await prisma.aiKnowledgeSource.findFirst({ where: { id: sourceId, orgId: actor.orgId, deletedAt: null } });
  if (!current) throw new KnowledgeBaseError('Knowledge source not found', 404, 'SOURCE_NOT_FOUND');
  const source = await prisma.aiKnowledgeSource.update({ where: { id: sourceId }, data: { name: input.name?.trim() || undefined, config: input.config, priority: input.priority === undefined ? undefined : clampPriority(input.priority), tags: input.tags === undefined ? undefined : cleanTags(input.tags), scope: input.scope === undefined ? undefined : asScope(input.scope), effectiveFrom: input.effectiveFrom === undefined ? undefined : dateOrNull(input.effectiveFrom), effectiveTo: input.effectiveTo === undefined ? undefined : dateOrNull(input.effectiveTo), version: { increment: 1 }, status: current.status === 'published' ? 'draft' : undefined, approvedByUserId: null, approvedAt: null } });
  await audit(actor, 'knowledge.source_updated', 'success', 'knowledge_source', sourceId, { version: source.version, requiresPublish: current.status === 'published' });
  return source;
}

async function extractContent(input: { content?: string; contentBase64?: string; mimeType?: string; fileName?: string }) {
  if (input.content?.trim()) return input.content.trim();
  if (!input.contentBase64) throw new KnowledgeBaseError('Content or file payload is required', 400, 'CONTENT_REQUIRED');
  const buffer = Buffer.from(input.contentBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_INGEST_BYTES) throw new KnowledgeBaseError('File is empty or exceeds 10 MB', 400, 'FILE_TOO_LARGE');
  const mime = (input.mimeType ?? '').toLowerCase(); const file = (input.fileName ?? '').toLowerCase();
  if (mime.includes('sheet') || file.endsWith('.xlsx')) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any); return workbook.worksheets.map((sheet) => { const lines: string[] = []; sheet.eachRow((row) => { const values = Array.isArray(row.values) ? row.values.slice(1) : []; lines.push(values.map((cell: any) => String(cell ?? '').trim()).filter(Boolean).join(' | ')); }); return `# ${sheet.name}\n${lines.filter(Boolean).join('\n')}`; }).join('\n\n'); }
  if (mime.includes('pdf') || file.endsWith('.pdf')) return (buffer.toString('latin1').match(/[\x20-\x7E\xA0-\xFF]{4,}/g) ?? []).join(' ').replace(/\s+/g, ' ').trim();
  if (mime.includes('word') || file.endsWith('.docx')) return buffer.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return buffer.toString('utf8').trim();
}

export async function createKnowledgeDocument(actor: KnowledgeActor, sourceId: string, input: { title: string; externalId?: string; content?: string; contentBase64?: string; fileName?: string; mimeType?: string; language?: string; priority?: number; tags?: string[]; scope?: Scope; effectiveFrom?: string; effectiveTo?: string; metadata?: Record<string, unknown> }) {
  const source = await prisma.aiKnowledgeSource.findFirst({ where: { id: sourceId, orgId: actor.orgId, deletedAt: null } });
  if (!source) throw new KnowledgeBaseError('Knowledge source not found', 404, 'SOURCE_NOT_FOUND');
  if (!canReadScope(actor, source.scope)) throw new KnowledgeBaseError('No access to knowledge source', 403, 'SOURCE_ACCESS_DENIED');
  if (!input.title?.trim()) throw new KnowledgeBaseError('Document title is required', 400, 'DOCUMENT_TITLE_REQUIRED');
  const content = await extractContent(input); if (content.length < 2) throw new KnowledgeBaseError('No readable text found in document', 400, 'CONTENT_UNREADABLE');
  const hash = sha256(content); const previous = input.externalId ? await prisma.aiKnowledgeDocument.findFirst({ where: { sourceId, externalId: input.externalId, deletedAt: null }, orderBy: { version: 'desc' } }) : null;
  const document = await prisma.aiKnowledgeDocument.create({ data: { orgId: actor.orgId, sourceId, externalId: input.externalId, title: input.title.trim(), status: 'draft', contentRef: input.fileName ?? null, contentHash: hash, version: (previous?.version ?? 0) + 1, mimeType: input.mimeType ?? 'text/plain', language: input.language?.slice(0, 12) ?? 'vi', effectiveFrom: dateOrNull(input.effectiveFrom), effectiveTo: dateOrNull(input.effectiveTo), priority: clampPriority(input.priority), tags: cleanTags(input.tags), scope: asScope(input.scope), metadata: { ...(input.metadata ?? {}), contentEncrypted: encryptToken(content) }, createdByUserId: actor.userId } });
  await audit(actor, 'knowledge.document_created', 'success', 'knowledge_document', document.id, { sourceId, contentHash: hash, version: document.version });
  return document;
}

function documentContent(document: { metadata: unknown }) { const metadata = document.metadata && typeof document.metadata === 'object' ? document.metadata as Record<string, unknown> : {}; const encrypted = typeof metadata.contentEncrypted === 'string' ? metadata.contentEncrypted : ''; if (!encrypted) throw new KnowledgeBaseError('Document payload is unavailable; import it again', 409, 'DOCUMENT_CONTENT_UNAVAILABLE'); return decryptToken(encrypted); }

export async function reindexKnowledgeDocument(actor: KnowledgeActor, documentId: string) {
  const document = await prisma.aiKnowledgeDocument.findFirst({ where: { id: documentId, orgId: actor.orgId, deletedAt: null }, include: { source: true } });
  if (!document || document.source.deletedAt) throw new KnowledgeBaseError('Knowledge document not found', 404, 'DOCUMENT_NOT_FOUND');
  if (!canReadScope(actor, document.source.scope) || !canReadScope(actor, document.scope)) throw new KnowledgeBaseError('No access to knowledge document', 403, 'DOCUMENT_ACCESS_DENIED');
  const content = documentContent(document); const parts = chunks(content); if (!parts.length) throw new KnowledgeBaseError('Document has no indexable text', 400, 'CONTENT_UNREADABLE');
  await prisma.$transaction(async (tx) => { await tx.aiKnowledgeChunk.updateMany({ where: { documentId, deletedAt: null }, data: { deletedAt: new Date() } }); await tx.aiKnowledgeChunk.createMany({ data: parts.map((part, index) => ({ orgId: actor.orgId, documentId, chunkIndex: index, contentEncrypted: bytes(encryptToken(part)), contentRedacted: redactedPreview(part), contentHash: sha256(part), tokenCount: Math.ceil(part.length / 4), embedding: embedding(part), embeddingModel: 'local-hash', embeddingVersion: 'v1', keywords: tokenize(part).slice(0, 48), metadata: { charStart: Math.max(0, index * (CHUNK_CHARS - CHUNK_OVERLAP)), untrustedContent: true } })) }); await tx.aiKnowledgeDocument.update({ where: { id: documentId }, data: { status: 'draft', lastIndexedAt: new Date() } }); await tx.aiKnowledgeSource.update({ where: { id: document.sourceId }, data: { lastIndexedAt: new Date() } }); });
  await audit(actor, 'knowledge.document_reindexed', 'success', 'knowledge_document', documentId, { chunks: parts.length, embeddingModel: 'local-hash/v1' });
  return { documentId, chunkCount: parts.length, lastIndexedAt: new Date().toISOString() };
}

export async function publishKnowledgeDocument(actor: KnowledgeActor, documentId: string) {
  const document = await prisma.aiKnowledgeDocument.findFirst({ where: { id: documentId, orgId: actor.orgId, deletedAt: null }, include: { source: true, _count: { select: { chunks: { where: { deletedAt: null } } } } } });
  if (!document) throw new KnowledgeBaseError('Knowledge document not found', 404, 'DOCUMENT_NOT_FOUND');
  if (!isEffective(document.effectiveFrom ?? document.source.effectiveFrom, document.effectiveTo ?? document.source.effectiveTo)) throw new KnowledgeBaseError('Expired or not-yet-effective knowledge cannot be published', 409, 'DOCUMENT_NOT_EFFECTIVE');
  if (!document._count.chunks) throw new KnowledgeBaseError('Re-index the document before publishing', 409, 'DOCUMENT_NOT_INDEXED');
  let gate: Awaited<ReturnType<typeof requirePassingEvaluation>>;
  try {
    gate = await requirePassingEvaluation(actor.orgId, 'knowledge', documentId);
  } catch (error) {
    if (error instanceof EvaluationEngineError && error.code === 'EVALUATION_GATE_BLOCKED') {
      throw new KnowledgeBaseError(
        'Run and pass evaluation for this document before publishing',
        409,
        'KNOWLEDGE_EVALUATION_REQUIRED',
      );
    }
    throw error;
  }
  const changedAt = document.lastIndexedAt ?? document.updatedAt;
  if (!gate.completedAt || gate.completedAt < changedAt) {
    throw new KnowledgeBaseError(
      'Document changed after its last passing evaluation; run evaluation again',
      409,
      'KNOWLEDGE_EVALUATION_STALE',
    );
  }
  await prisma.$transaction(async (tx) => { await tx.aiKnowledgeDocument.update({ where: { id: documentId }, data: { status: 'published', approvedByUserId: actor.userId, approvedAt: new Date() } }); if (document.source.status !== 'published') await tx.aiKnowledgeSource.update({ where: { id: document.sourceId }, data: { status: 'published', approvedByUserId: actor.userId, approvedAt: new Date() } }); });
  await audit(actor, 'knowledge.document_published', 'success', 'knowledge_document', documentId, { sourceId: document.sourceId });
  return { id: documentId, status: 'published' };
}

export async function searchKnowledge(actor: KnowledgeActor, query: string, options: {
  limit?: number;
  includeDraft?: boolean;
  sourceTypes?: string[];
  tags?: string[];
} = {}) {
  const normalized = query.trim(); if (normalized.length < 2) throw new KnowledgeBaseError('Search query must have at least 2 characters', 400, 'QUERY_TOO_SHORT');
  const sourceTypes = new Set((options.sourceTypes ?? []).map((value) => value.trim()).filter(Boolean));
  const requiredTags = new Set(cleanTags(options.tags));
  const now = new Date(); const queryVector = embedding(normalized); const queryTerms = tokenize(normalized); const documents = await prisma.aiKnowledgeDocument.findMany({ where: { orgId: actor.orgId, deletedAt: null, status: options.includeDraft ? { in: ['draft', 'published'] } : 'published', OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] }, include: { source: true, chunks: { where: { deletedAt: null } } } });
  const results: Array<Record<string, unknown>> = [];
  for (const document of documents) {
    if (!document.source || document.source.deletedAt || (!options.includeDraft && document.source.status !== 'published') || !isEffective(document.effectiveFrom ?? document.source.effectiveFrom, document.effectiveTo ?? document.source.effectiveTo, now) || !canReadScope(actor, document.source.scope) || !canReadScope(actor, document.scope)) continue;
    if (sourceTypes.size && !sourceTypes.has(document.source.type)) continue;
    const documentTags = new Set([...(document.source.tags ?? []), ...(document.tags ?? [])].map((value) => value.toLowerCase()));
    if (requiredTags.size && ![...requiredTags].some((tag) => documentTags.has(tag))) continue;
    for (const chunk of document.chunks) {
      const semantic = cosine(queryVector, chunk.embedding);
      const keyword = queryTerms.length ? queryTerms.filter((term) => chunk.keywords.includes(term)).length / queryTerms.length : 0;
      const priority = Math.max(-0.08, Math.min(0.08, (document.priority + document.source.priority) / 1000));
      const score = semantic * 0.68 + keyword * 0.28 + priority + (document.approvedAt ? 0.04 : 0);
      if (score < 0.05) continue;
      results.push({
        score: Number(score.toFixed(4)),
        citation: {
          sourceId: document.sourceId,
          sourceName: document.source.name,
          sourceType: document.source.type,
          documentId: document.id,
          documentTitle: document.title,
          documentVersion: document.version,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          effectiveFrom: document.effectiveFrom ?? document.source.effectiveFrom,
          effectiveTo: document.effectiveTo ?? document.source.effectiveTo,
        },
        excerpt: readableChunk(chunk),
        retrieval: {
          semantic: Number(semantic.toFixed(4)),
          keyword: Number(keyword.toFixed(4)),
          priority: document.priority + document.source.priority,
        },
      });
    }
  }
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 6)));
  const ranked = results.sort((a: any, b: any) => b.score - a.score).slice(0, limit);
  await audit(actor, 'knowledge.search', 'success', 'knowledge_search', sha256(normalized), {
    queryHash: sha256(normalized),
    results: ranked.length,
    includeDraft: !!options.includeDraft,
    sourceTypes: [...sourceTypes],
    tags: [...requiredTags],
  });
  return {
    query: normalized,
    results: ranked,
    diagnostics: {
      mode: 'hybrid_local_hash_v1',
      candidateDocuments: documents.length,
      excludedExpired: true,
      citationsRequired: true,
      sourceTypes: [...sourceTypes],
      tags: [...requiredTags],
    },
  };
}

export async function archiveKnowledgeSource(actor: KnowledgeActor, sourceId: string) { const source = await prisma.aiKnowledgeSource.findFirst({ where: { id: sourceId, orgId: actor.orgId, deletedAt: null } }); if (!source) throw new KnowledgeBaseError('Knowledge source not found', 404, 'SOURCE_NOT_FOUND'); await prisma.aiKnowledgeSource.update({ where: { id: sourceId }, data: { status: 'archived', deletedAt: new Date() } }); await audit(actor, 'knowledge.source_archived', 'success', 'knowledge_source', sourceId); return { id: sourceId, status: 'archived' }; }
