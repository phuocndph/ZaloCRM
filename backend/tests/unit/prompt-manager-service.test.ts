import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  const db = {
    aiPrompt: model(),
    aiPromptVersion: model(),
    aiSkill: model(),
    aiAuditLog: model(),
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  return {
    db,
    prisma,
    aiComplete: vi.fn(),
  };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({
  encryptToken: (value: string) => `enc:${value}`,
  decryptToken: (value: string) => value.replace(/^enc:/, ''),
}));
vi.mock('../../src/modules/ai/evaluation-engine-service.js', () => ({ requirePassingEvaluation: vi.fn(async () => ({ runId: 'evaluation-pass' })) }));
vi.mock('../../src/modules/ai/core/index.js', () => ({
  aiClient: { complete: mocks.aiComplete },
}));

import {
  createPrompt,
  getProductionPrompt,
  previewPromptVersion,
  rollbackPrompt,
  transitionPromptVersion,
} from '../../src/modules/ai/prompt-manager-service.js';

const actor = { orgId: 'org-1', userId: 'admin-1' };

describe('PromptManagerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db));
  });

  it('creates immutable Draft v1 and an audit record', async () => {
    mocks.db.aiPrompt.create.mockResolvedValue({ id: 'prompt-1', key: 'system.reply' });
    await createPrompt(actor, {
      key: 'system.reply',
      name: 'System Reply',
      taskType: 'reply',
      scope: 'system',
      content: 'Hello {{customer.name}}',
    });
    expect(mocks.db.aiPrompt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        scope: 'system',
        versions: expect.objectContaining({
          create: expect.objectContaining({
            version: 1,
            status: 'draft',
            contentEncrypted: expect.any(Uint8Array),
            inputSchema: { type: 'object', required: ['customer.name'] },
          }),
        }),
      }),
    }));
    const createArg = mocks.db.aiPrompt.create.mock.calls[0][0];
    expect(Array.from(createArg.data.versions.create.contentEncrypted))
      .toEqual(Array.from(Buffer.from('enc:Hello {{customer.name}}')));
    expect(mocks.db.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'prompt.created', actorUserId: actor.userId }),
    }));
  });

  it('allows only Testing version to be approved as Production', async () => {
    mocks.db.aiPromptVersion.findFirst.mockResolvedValue({
      id: 'version-2', promptId: 'prompt-1', orgId: actor.orgId, version: 2, status: 'testing',
    });
    mocks.db.aiPromptVersion.update.mockResolvedValue({
      id: 'version-2', version: 2, status: 'production',
    });
    const result = await transitionPromptVersion(actor, 'prompt-1', 'version-2', 'production');
    expect(result.status).toBe('production');
    expect(mocks.db.aiPromptVersion.updateMany).toHaveBeenCalledWith({
      where: { promptId: 'prompt-1', status: 'production' },
      data: { status: 'archived' },
    });
    expect(mocks.db.aiPromptVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        approvedByUserId: actor.userId,
        approvedAt: expect.any(Date),
      }),
    }));
    expect(mocks.db.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'prompt.production_approved' }),
    }));
  });

  it('rejects preview when a required template variable is missing', async () => {
    mocks.prisma.aiPromptVersion.findFirst.mockResolvedValue({
      version: 1,
      status: 'draft',
      contentHash: 'hash',
      contentEncrypted: Buffer.from('enc:Hello {{customer.name}}'),
    });
    await expect(previewPromptVersion(actor, 'prompt-1', 'version-1', {}))
      .rejects.toThrow('Missing prompt variable: customer.name');
  });

  it('rolls back by creating a new approved Production version', async () => {
    mocks.db.aiPrompt.findFirst.mockResolvedValue({
      id: 'prompt-1',
      versions: [
        { id: 'latest', version: 3, status: 'production' },
        {
          id: 'source', version: 1, status: 'archived',
          contentEncrypted: Buffer.from('enc:old'),
          contentHash: 'old-hash',
          previewRedacted: 'old',
          inputSchema: {},
          outputSchema: null,
        },
      ],
    });
    mocks.db.aiPromptVersion.create.mockResolvedValue({
      id: 'version-4', version: 4, status: 'production',
    });
    const result = await rollbackPrompt(actor, 'prompt-1', 'source');
    expect(result).toEqual({ id: 'version-4', version: 4, status: 'production' });
    expect(mocks.db.aiPromptVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 4,
        status: 'production',
        contentHash: 'old-hash',
        changeNote: 'Rollback from version 1',
        approvedByUserId: actor.userId,
      }),
    });
    expect(mocks.db.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'prompt.rolled_back' }),
    }));
  });

  it('loads only an approved Production prompt for runtime', async () => {
    mocks.prisma.aiPrompt.findFirst.mockResolvedValue({
      id: 'prompt-1',
      versions: [{
        id: 'production-2',
        version: 2,
        contentEncrypted: Buffer.from('enc:Hello {{customer.name}}'),
        contentHash: 'hash-2',
      }],
    });
    const result = await getProductionPrompt(actor.orgId, 'system.reply', { customer: { name: 'Lan' } });
    expect(result.rendered).toBe('Hello Lan');
    expect(mocks.prisma.aiPrompt.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: actor.orgId, key: 'system.reply', deletedAt: null },
      select: expect.objectContaining({
        versions: expect.objectContaining({
          where: {
            status: 'production',
            approvedAt: { not: null },
            approvedByUserId: { not: null },
          },
        }),
      }),
    }));
  });
});
