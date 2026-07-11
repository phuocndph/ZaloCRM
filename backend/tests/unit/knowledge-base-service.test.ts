import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiKnowledgeSource: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    aiKnowledgeDocument: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    aiKnowledgeChunk: { updateMany: vi.fn(), createMany: vi.fn() },
    aiAuditLog: { create: vi.fn() },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  return { prisma };
});
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ encryptToken: (v: string) => `enc:${v}`, decryptToken: (v: string) => v.replace(/^enc:/, '') }));

import { createKnowledgeSource, reindexKnowledgeDocument, searchKnowledge } from '../../src/modules/ai/knowledge-base-service.js';
const actor = { orgId: 'org-1', userId: 'admin-1', role: 'admin' };

function source(overrides: any = {}) { return { id: 'source-1', orgId: 'org-1', name: 'Bang gia', type: 'price_list', status: 'published', priority: 8, scope: { visibility: 'org' }, deletedAt: null, ...overrides }; }
function document(overrides: any = {}) { return { id: 'doc-1', sourceId: 'source-1', orgId: 'org-1', title: 'Bang gia Q3', status: 'published', version: 2, priority: 5, scope: {}, metadata: { contentEncrypted: 'enc:Gia can ho 2PN la 3.8 ty. Bao gom VAT.' }, effectiveFrom: null, effectiveTo: null, approvedAt: new Date(), deletedAt: null, source: source(), chunks: [], ...overrides }; }

describe('KnowledgeBaseService', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.prisma.aiAuditLog.create.mockResolvedValue({}); });
  it('creates a tenant-scoped draft source with normalized tags', async () => {
    mocks.prisma.aiKnowledgeSource.create.mockImplementation(async ({ data }: any) => ({ id: 'source-1', ...data }));
    const result = await createKnowledgeSource(actor, { name: 'Bang gia', type: 'price_list', tags: ['Gia', 'gia', ' Q3 '] });
    expect(mocks.prisma.aiKnowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', tags: ['gia', 'q3'] }) }));
  });
  it('chunks and embeds encrypted document content during re-index', async () => {
    mocks.prisma.aiKnowledgeDocument.findFirst.mockResolvedValue(document({ status: 'draft' })); mocks.prisma.aiKnowledgeChunk.updateMany.mockResolvedValue({ count: 0 }); mocks.prisma.aiKnowledgeChunk.createMany.mockResolvedValue({ count: 1 }); mocks.prisma.aiKnowledgeDocument.update.mockResolvedValue({}); mocks.prisma.aiKnowledgeSource.update.mockResolvedValue({});
    const result = await reindexKnowledgeDocument(actor, 'doc-1');
    expect(result.chunkCount).toBeGreaterThan(0); expect(mocks.prisma.aiKnowledgeChunk.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ embeddingModel: 'local-hash', embeddingVersion: 'v1', contentEncrypted: expect.any(Uint8Array) })]) }));
  });
  it('returns only effective published tenant knowledge with internal citation', async () => {
    mocks.prisma.aiKnowledgeDocument.findMany.mockResolvedValue([document({ chunks: [{ id: 'chunk-1', chunkIndex: 0, contentRedacted: 'Gia can ho 2PN 3.8 ty', keywords: ['gia', 'can', 'ho', '2pn'], embedding: new Array(96).fill(0), deletedAt: null }] }), document({ id: 'expired', effectiveTo: new Date('2020-01-01'), chunks: [{ id: 'old', chunkIndex: 0, contentRedacted: 'old', keywords: ['gia'], embedding: new Array(96).fill(0), deletedAt: null }] })]);
    const result = await searchKnowledge(actor, 'gia can ho 2pn');
    expect(result.results).toHaveLength(1); expect(result.results[0]).toMatchObject({ citation: { sourceId: 'source-1', documentId: 'doc-1', chunkId: 'chunk-1', documentVersion: 2 } });
  });
});
