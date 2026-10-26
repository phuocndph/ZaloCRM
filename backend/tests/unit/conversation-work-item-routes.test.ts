// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  users: vi.fn(), scope: vi.fn(), list: vi.fn(), activity: vi.fn(), update: vi.fn(), item: vi.fn(),
  user: { id: 'owner', role: 'owner', orgId: 'org' },
}));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {
  user: { findMany: mocks.users }, conversationWorkItem: { findFirst: mocks.item },
} }));
vi.mock('../../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: async (request: any) => { request.user = mocks.user; } }));
vi.mock('../../src/modules/rbac/owner-scope.js', () => ({ getOwnerScope: mocks.scope }));
vi.mock('../../src/modules/privacy/redact.js', () => ({
  buildPrivacyContext: async () => ({ viewerUserId: mocks.user.id, orgId: 'org', privacyUnlocked: false }),
  isConversationPrivateFor: () => false, canSeeConversationContent: () => true,
}));
vi.mock('../../src/modules/dashboard/conversation-work-item-service.js', () => ({
  listConversationLoadOverview: vi.fn(), reconcileConversationWorkItems: vi.fn(),
  listConversationWorkItems: mocks.list, listConversationAnalysisActivity: mocks.activity, updateConversationWorkItem: mocks.update,
}));
import { conversationWorkItemRoutes } from '../../src/modules/dashboard/conversation-work-item-routes.js';

async function get(url: string) {
  const app = Fastify();
  await app.register(conversationWorkItemRoutes);
  try { return await app.inject({ method: 'GET', url }); } finally { await app.close(); }
}
const people = [{ id: 'owner', fullName: 'Joliefam' }, { id: 'staff', fullName: 'Linh' }];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { id: 'owner', role: 'owner', orgId: 'org' };
  mocks.scope.mockResolvedValue({ canViewAll: true, visibleUserIds: [] });
  mocks.users.mockResolvedValue(people);
  mocks.list.mockResolvedValue({ items: [], counts: {} });
  mocks.activity.mockResolvedValue([]);
});
describe('combined work queue access', () => {
  it('lists all active organization assignees and deduplicates AI activity for the owner', async () => {
    mocks.activity.mockResolvedValue([{ conversationId: 'shared', name: 'Customer' }]);
    const response = await get('/api/v1/work-items?audience=all&scope=today&offset=40&q=Nick');
    expect(response.statusCode).toBe(200);
    expect(mocks.users).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org', isActive: true } }));
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org', assigneeUserIds: ['owner', 'staff'], scope: 'today', offset: 40, query: 'Nick',
      privacy: { viewerUserId: 'owner', orgId: 'org', privacyUnlocked: false },
    }));
    expect(response.json()).toMatchObject({ assignee: null, assignees: people, viewingAll: true, aiActivity: [{ conversationId: 'shared' }] });
    expect(response.json().aiActivity).toHaveLength(1);
  });
  it('keeps the default API call personal for existing dashboard and agent consumers', async () => {
    await get('/api/v1/work-items');
    const input = mocks.list.mock.calls[0][0];
    expect(input.assigneeUserId).toBe('owner');
    expect(input.assigneeUserIds).toBeUndefined();
    expect(mocks.activity).toHaveBeenCalledTimes(1);
  });
  it('filters to one selected employee while keeping the authorized filter options', async () => {
    const response = await get('/api/v1/work-items?audience=all&asUserId=staff');
    expect(response.statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserIds: ['staff'] }));
    expect(response.json()).toMatchObject({ assignee: people[1], assignees: people, viewingAll: false });
    expect(mocks.activity).toHaveBeenCalledWith({ orgId: 'org', assigneeUserId: 'staff' });
  });
  it('limits a member to their own permitted people even with audience=all', async () => {
    mocks.user = { id: 'staff', role: 'sale', orgId: 'org' };
    mocks.scope.mockResolvedValue({ canViewAll: false, visibleUserIds: ['staff'] });
    mocks.users.mockResolvedValue([people[1]]);
    await get('/api/v1/work-items?audience=all');
    expect(mocks.scope).toHaveBeenCalledWith(expect.objectContaining({ resource: 'conversation' }));
    expect(mocks.users).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org', isActive: true, id: { in: ['staff'] } } }));
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserIds: ['staff'] }));
  });
  it('allows team leaders to see their authorized team together', async () => {
    mocks.user = { id: 'leader', role: 'sale', orgId: 'org' };
    mocks.scope.mockResolvedValue({ canViewAll: false, visibleUserIds: ['leader', 'staff'] });
    mocks.users.mockResolvedValue([{ id: 'leader', fullName: 'Leader' }, people[1]]);
    await get('/api/v1/work-items?audience=all');
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserIds: ['leader', 'staff'] }));
  });
  it('rejects an employee outside the permitted scope', async () => {
    mocks.user = { id: 'staff', role: 'sale', orgId: 'org' };
    mocks.scope.mockResolvedValue({ canViewAll: false, visibleUserIds: ['staff'] });
    mocks.users.mockResolvedValue([people[1]]);
    expect((await get('/api/v1/work-items?audience=all&asUserId=owner')).statusCode).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('rejects a different organization or inactive employee even for an owner', async () => {
    expect((await get('/api/v1/work-items?audience=all&asUserId=outside-org')).statusCode).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('returns an empty combined queue when there are no authorized active people', async () => {
    mocks.users.mockResolvedValue([]);
    expect((await get('/api/v1/work-items?audience=all')).statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserIds: [] }));
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it('uses the same conversation scope when updating a team task', async () => {
    mocks.user = { id: 'leader', role: 'sale', orgId: 'org' };
    mocks.scope.mockResolvedValue({ canViewAll: false, visibleUserIds: ['leader', 'staff'] });
    mocks.item.mockResolvedValue({ id: 'task', assigneeUserId: 'staff', conversation: null });
    mocks.update.mockResolvedValue({ id: 'task', status: 'completed' });
    const app = Fastify(); await app.register(conversationWorkItemRoutes);
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/work-items/task', payload: { action: 'complete' } });
    expect(response.statusCode).toBe(200);
    expect(mocks.scope).toHaveBeenCalledWith(expect.objectContaining({ resource: 'conversation' }));
    expect(mocks.update).toHaveBeenCalled();
    await app.close();
  });
});
