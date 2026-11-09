/**
 * storage-group-cleanup.test.ts (2026-11-09)
 *  - preview many groups at once (targetIds[]) with totals and GB
 *  - includeVisible lifts the protected_ref guard ONLY for the selected groups
 *  - after physical delete, messages are kept and flagged mediaPurged
 *  - nightly scheduler: only enabled schedules, preview -> execute, history row
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

const prismaMock: any = {
  conversation: { findMany: vi.fn() },
  zaloAccount: { findFirst: vi.fn() },
  storageCleanupRun: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() },
  storageCleanupItem: { updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  storageGroupCleanupSchedule: { findMany: vi.fn(), update: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};
const deleteObjectFromMock = vi.fn();

vi.mock('../../../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../../../src/shared/storage/minio-client.js', () => ({ deleteObjectFrom: deleteObjectFromMock }));
vi.mock('../../../src/shared/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn().mockReturnValue({ stop: vi.fn() }) } }));

const service = await import('../../../src/modules/media/storage-cleanup-service.js');
const cronModule = await import('../../../src/modules/media/storage-group-cleanup-cron.js');
const cron = (await import('node-cron')).default as any;

const sqlText = (query: Prisma.Sql) => query.sql.replace(/\s+/g, ' ');

const GROUPS = [
  { id: 'conv-a', externalThreadId: 'g-a', groupName: 'Nhóm A' },
  { id: 'conv-b', externalThreadId: 'g-b', groupName: 'Nhóm B' },
];

beforeEach(() => {
  vi.clearAllMocks();
  service.cleanupWorkers.clear();
  prismaMock.storageCleanupRun.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.storageCleanupRun.create.mockImplementation(async ({ data }: any) => ({ id: 'run-1', expiresAt: data.expiresAt, ...data }));
  prismaMock.storageCleanupRun.update.mockResolvedValue({});
  prismaMock.conversation.findMany.mockResolvedValue(GROUPS);
  prismaMock.$executeRaw.mockResolvedValue(3);
  prismaMock.$queryRaw.mockResolvedValue([{ files: 3n, bytes: BigInt(2 * 1024 ** 3), selectedBytes: BigInt(2 * 1024 ** 3), linksToRemove: 4n, objectsToDelete: 3n, image: 3n, video: 0n, file: 0n, audio: 0n, shared: 0n, linksKept: 0n, visibleMessages: 2n }]);
});

describe('parseCleanupBody with several groups', () => {
  it('accepts targetIds[] and merges a legacy targetId without duplicates', () => {
    const parsed = service.parseCleanupBody({ targetType: 'group', targetId: 'g-a', targetIds: ['g-a', 'g-b'], beforeDate: '2026-08-01', fileKinds: ['image'] });
    expect(parsed.targetIds).toEqual(['g-a', 'g-b']);
    expect(parsed.includeVisible).toBe(false);
  });

  it('only allows includeVisible for explicitly chosen groups', () => {
    expect(() => service.parseCleanupBody({ targetType: 'all', includeVisible: true, beforeDate: '2026-08-01', fileKinds: ['image'] })).toThrow('nhóm');
    expect(service.parseCleanupBody({ targetType: 'group', targetIds: ['g-a'], includeVisible: true, beforeDate: '2026-08-01', fileKinds: ['image'] }).includeVisible).toBe(true);
  });

  it('includeVisible must be the literal true, not a truthy string', () => {
    expect(service.parseCleanupBody({ targetType: 'group', targetIds: ['g-a'], includeVisible: 'true', beforeDate: '2026-08-01', fileKinds: ['image'] }).includeVisible).toBe(false);
  });
});

describe('createCleanupPreview', () => {
  it('previews several groups in one snapshot and returns files + GB totals', async () => {
    const parsed = service.parseCleanupBody({ targetType: 'group', targetIds: ['g-a', 'conv-b'], beforeDate: '2026-08-01', fileKinds: ['image'] });
    const result = await service.createCleanupPreview({ ...parsed, orgId: 'org-1', performedById: 'user-1' });

    const created = prismaMock.storageCleanupRun.create.mock.calls[0][0].data;
    expect(created.targetIds).toEqual(['g-a', 'g-b']);
    expect(created.targetName).toBe('2 nhóm: Nhóm A, Nhóm B');
    expect(created.includeVisible).toBe(false);
    expect(created.status).toBe('previewing');

    const insert = prismaMock.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(insert.values).toEqual(expect.arrayContaining(['g-a', 'g-b']));
    expect(sqlText(insert)).toContain('protected_message.hidden_at IS NULL');

    expect(result.files).toBe(3);
    expect(result.gb).toBe(2);
    expect(result.targetCount).toBe(2);
    expect(prismaMock.storageCleanupRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'previewed' }) }));
    // Preview never deletes bytes.
    expect(deleteObjectFromMock).not.toHaveBeenCalled();
  });

  it('keeps the protected_ref guard unchanged when includeVisible is off', () => {
    const sql = sqlText(service.protectedRefSql('org-1', false, ['g-a']));
    expect(sql).toContain('protected_message.is_deleted=false');
    expect(sql).not.toContain('gc.external_thread_id');
  });

  it('includeVisible lifts the guard only for references inside the selected groups', async () => {
    const parsed = service.parseCleanupBody({ targetType: 'group', targetIds: ['g-a'], includeVisible: true, beforeDate: '2026-08-01', fileKinds: ['image'] });
    prismaMock.conversation.findMany.mockResolvedValue([GROUPS[0]]);
    await service.createCleanupPreview({ ...parsed, orgId: 'org-1', performedById: 'user-1' });
    expect(prismaMock.storageCleanupRun.create.mock.calls[0][0].data.includeVisible).toBe(true);
    const insert = sqlText(prismaMock.$executeRaw.mock.calls[0][0]);
    // Guard is still there for refs outside the selection...
    expect(insert).toContain('protected_message.hidden_at IS NULL');
    // ...but refs inside the selected group are excluded from it.
    expect(insert).toMatch(/AND NOT EXISTS \( SELECT 1 FROM conversations gc WHERE gc.id=protected_ref.conversation_id/);
  });

  it('rejects a group that is not in the organization', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([GROUPS[0]]);
    const parsed = service.parseCleanupBody({ targetType: 'group', targetIds: ['g-a', 'g-x'], beforeDate: '2026-08-01', fileKinds: ['image'] });
    await expect(service.createCleanupPreview({ ...parsed, orgId: 'org-1', performedById: 'user-1' })).rejects.toThrow('không tồn tại');
    expect(prismaMock.storageCleanupRun.create).not.toHaveBeenCalled();
  });
});

describe('processCleanupBatch with includeVisible', () => {
  it('deletes media of a visible message in the selected group and flags the message instead of deleting it', async () => {
    prismaMock.storageCleanupRun.findFirst.mockResolvedValue({ id: 'run-1', orgId: 'org-1', targetType: 'group', targetId: 'g-a', targetIds: ['g-a'], includeVisible: true, startedAt: null });
    prismaMock.storageCleanupItem.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.storageCleanupItem.update.mockResolvedValue({});
    prismaMock.storageCleanupItem.groupBy.mockResolvedValue([{ status: 'deleted', _count: { _all: 1 } }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'item-1', objectId: 'obj-1', referenceIds: ['ref-1'], objectKey: 'media/x.jpg', storageDriver: 'r2', sizeBytes: 1000n, fileType: 'image' }]);
    deleteObjectFromMock.mockResolvedValue(true);

    const txCalls: Prisma.Sql[] = [];
    const executeCalls: Prisma.Sql[] = [];
    const tx = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => {
        txCalls.push(query);
        if (sqlText(query).includes('FOR UPDATE')) return [{ id: 'obj-1' }];
        return []; // active message query: lifted for the selected group -> nothing protects it
      }),
      $executeRaw: vi.fn(async (query: Prisma.Sql) => { executeCalls.push(query); return 1; }),
      storageObjectReference: {
        findMany: vi.fn().mockResolvedValue([{ messageId: 'msg-1' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      storageCleanupItem: { update: vi.fn() },
      storageObject: { delete: vi.fn() },
      message: { delete: vi.fn(), deleteMany: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const result = await service.processCleanupBatch('run-1', 'org-1');

    const activeQuery = txCalls.map(sqlText).find((sql) => sql.includes('m.hidden_at IS NULL'))!;
    expect(activeQuery).toContain('AND NOT EXISTS ( SELECT 1 FROM conversations gc WHERE gc.id=r.conversation_id');
    expect(deleteObjectFromMock).toHaveBeenCalledWith('r2', 'media/x.jpg');
    expect(tx.storageObject.delete).toHaveBeenCalledWith({ where: { id: 'obj-1' } });
    // Message row kept, only marked.
    expect(tx.message.delete).not.toHaveBeenCalled();
    expect(tx.message.deleteMany).not.toHaveBeenCalled();
    const mark = executeCalls.map(sqlText).find((sql) => sql.includes('UPDATE messages'))!;
    expect(mark).toContain("jsonb_build_object('mediaPurged'");
    expect(executeCalls[0].values).toContain('msg-1');
    expect(result.hasMore).toBe(false);
  });

  it('without includeVisible a visible message still protects the object', async () => {
    prismaMock.storageCleanupRun.findFirst.mockResolvedValue({ id: 'run-1', orgId: 'org-1', targetType: 'group', targetId: 'g-a', targetIds: ['g-a'], includeVisible: false, startedAt: null });
    prismaMock.storageCleanupItem.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.storageCleanupItem.groupBy.mockResolvedValue([{ status: 'protected', _count: { _all: 1 } }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'item-1', objectId: 'obj-1', referenceIds: ['ref-1'], objectKey: 'media/x.jpg', storageDriver: 'r2', sizeBytes: 1000n, fileType: 'image' }]);
    const tx = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => (sqlText(query).includes('FOR UPDATE') ? [{ id: 'obj-1' }] : [{ id: 'msg-1' }])),
      $executeRaw: vi.fn(),
      storageObjectReference: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
      storageCleanupItem: { update: vi.fn() }, storageObject: { delete: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx));
    await service.processCleanupBatch('run-1', 'org-1');
    const activeQuery = tx.$queryRaw.mock.calls.map((call: any[]) => sqlText(call[0])).find((sql: string) => sql.includes('m.hidden_at IS NULL'))!;
    expect(activeQuery).not.toContain('gc.external_thread_id');
    expect(deleteObjectFromMock).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(prismaMock.storageCleanupItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'protected' }) }));
  });
});

describe('nightly group cleanup scheduler', () => {
  it('is scheduled at 02:00 Asia/Ho_Chi_Minh', () => {
    cronModule.startStorageGroupCleanupCron();
    expect(cron.schedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), { timezone: 'Asia/Ho_Chi_Minh' });
  });

  it('new schedules default to disabled', () => {
    expect(cronModule.normalizeScheduleInput({ retentionDays: 90, fileKinds: ['image'] }).enabled).toBe(false);
    expect(cronModule.normalizeScheduleInput({ retentionDays: 90, fileKinds: ['image'], enabled: 'yes' }).enabled).toBe(false);
    expect(() => cronModule.normalizeScheduleInput({ retentionDays: 0, fileKinds: ['image'] })).toThrow();
    expect(() => cronModule.normalizeScheduleInput({ retentionDays: 30, fileKinds: [] })).toThrow();
  });

  it('computes the cutoff date in Vietnam time', () => {
    // 2026-11-09 19:30 UTC is already 2026-11-10 02:30 in Vietnam.
    expect(cronModule.cutoffDate(new Date('2026-11-09T19:30:00Z'), 30)).toBe('2026-10-11');
  });

  it('only reads enabled schedules and runs each through preview then execute', async () => {
    prismaMock.storageGroupCleanupSchedule.findMany.mockResolvedValue([
      { id: 'sch-1', orgId: 'org-1', groupId: 'g-a', groupName: 'Nhóm A', retentionDays: 30, fileKinds: ['image'], includeVisible: true, enabled: true },
    ]);
    prismaMock.conversation.findMany.mockResolvedValue([GROUPS[0]]);
    prismaMock.storageCleanupRun.findFirst.mockResolvedValue({ id: 'run-1', orgId: 'org-1', status: 'previewed', expiresAt: new Date(Date.now() + 60_000), startedAt: null, targetType: 'group', targetIds: ['g-a'], includeVisible: true });
    // Worker: no pending items left.
    prismaMock.storageCleanupItem.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.storageCleanupItem.groupBy.mockResolvedValue([]);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ files: 0n, bytes: 0n }]) // preview counts
      .mockResolvedValueOnce([]); // claimed items

    const results = await cronModule.runStorageGroupCleanupSchedules({ now: new Date('2026-11-09T19:00:00Z') });

    expect(prismaMock.storageGroupCleanupSchedule.findMany.mock.calls[0][0].where.enabled).toBe(true);
    const created = prismaMock.storageCleanupRun.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ trigger: 'schedule', scheduleId: 'sch-1', performedById: null, targetIds: ['g-a'], includeVisible: true, targetName: 'Lịch tự dọn: Nhóm A' });
    // now = 2026-11-10 02:00 VN, minus 30 days = 2026-10-11 00:00 VN = 2026-10-10T17:00Z
    expect(created.beforeDate.toISOString()).toBe('2026-10-10T17:00:00.000Z');
    // execute path flipped the run to running and the history row ends completed.
    const statuses = prismaMock.storageCleanupRun.update.mock.calls.map((call: any[]) => call[0].data.status);
    expect(statuses).toEqual(expect.arrayContaining(['previewed', 'running', 'completed']));
    expect(prismaMock.storageGroupCleanupSchedule.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sch-1' }, data: expect.objectContaining({ lastRunId: 'run-1', lastError: null }) }));
    expect(results).toEqual([expect.objectContaining({ scheduleId: 'sch-1', runId: 'run-1' })]);
  });

  it('does nothing when no schedule is enabled', async () => {
    prismaMock.storageGroupCleanupSchedule.findMany.mockResolvedValue([]);
    const results = await cronModule.runStorageGroupCleanupSchedules();
    expect(results).toEqual([]);
    expect(prismaMock.storageCleanupRun.create).not.toHaveBeenCalled();
  });

  it('records the error on the schedule and continues with the next one', async () => {
    prismaMock.storageGroupCleanupSchedule.findMany.mockResolvedValue([
      { id: 'sch-bad', orgId: 'org-1', groupId: 'g-x', groupName: null, retentionDays: 30, fileKinds: ['image'], includeVisible: false, enabled: true },
    ]);
    prismaMock.conversation.findMany.mockResolvedValue([]);
    const results = await cronModule.runStorageGroupCleanupSchedules();
    expect(results[0].error).toContain('không tồn tại');
    expect(prismaMock.storageGroupCleanupSchedule.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sch-bad' }, data: expect.objectContaining({ lastError: expect.stringContaining('không tồn tại') }) }));
  });
});
