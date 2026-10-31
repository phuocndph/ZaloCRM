// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), add: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { customerResearchTask: { findMany: mocks.find } } }));
vi.mock('ioredis', () => ({ Redis: class { on() {} duplicate() { return this; } async quit() {} } }));
vi.mock('bullmq', () => ({ Queue: class { on() {} add = mocks.add; async close() {} }, Worker: class { on() {} async close() {} } }));
import { getTenantContext } from '../../src/shared/tenant/tenant-context.js';
import { enqueueResearchTask, recoverResearchTasks, stopResearchWorker } from '../../src/modules/ai/research/research-queue.js';
beforeEach(() => { vi.resetAllMocks(); mocks.add.mockResolvedValue({}); mocks.find.mockResolvedValue([]); });
afterEach(async () => { await stopResearchWorker(); });
describe('direct research durable scheduling', () => {
  it('recovers queued and expired local work using identifiers without reading research content', async () => {
    mocks.find.mockImplementation(async () => { expect(getTenantContext()?.bypassTenantGuard).toBe(true); return [{ id: 'task', orgId: 'org', projectId: 'project' }]; });
    await recoverResearchTasks();
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ cancelRequested: false, project: { executor: 'internal' }, OR: expect.any(Array) }), select: { id: true, orgId: true, projectId: true } }));
    expect(mocks.add).toHaveBeenCalledWith('research', { orgId: 'org', projectId: 'project', taskId: 'task' }, expect.objectContaining({ jobId: 'research-task', removeOnComplete: true, removeOnFail: true }));
  });
  it('deduplicates deliveries across normal scheduling and recovery', async () => {
    await enqueueResearchTask('org', 'project', 'task');
    mocks.find.mockResolvedValue([{ id: 'task', orgId: 'org', projectId: 'project' }]);
    await recoverResearchTasks();
    expect(mocks.add.mock.calls.map((args) => args[2].jobId)).toEqual(['research-task', 'research-task']);
  });
  it('retries a recovery sweep after database connectivity returns', async () => {
    mocks.find.mockRejectedValueOnce(new Error('offline'));
    await recoverResearchTasks();
    mocks.find.mockResolvedValue([{ id: 'task', orgId: 'org', projectId: 'project' }]);
    await recoverResearchTasks(); expect(mocks.add).toHaveBeenCalledTimes(1);
  });
});
