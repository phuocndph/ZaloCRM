import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), send: vi.fn(), createLog: vi.fn(), conversation: vi.fn(), account: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({
 prisma: {
  followupEnrollment: { findUnique: m.find, update: m.update, groupBy: vi.fn(async () => []) },
  followupWorkflow: { findUnique: vi.fn(async () => ({ id: 'wf', name: '[Tự động] Theo dõi sau báo giá', type: 'after_quote', description: 'customer-automation:v1', status: 'active', goalType: 'none', stopOnPurchase: true, stopOnTags: [], maxMessages: 2, sendWindowStart: 480, sendWindowEnd: 1080, timezone: 'Asia/Ho_Chi_Minh' })), update: vi.fn(async () => ({})) },
  followupStep: { findMany: vi.fn(async () => [ { key: 'send_1', type: 'send', config: { content: 'Đã xem báo giá chưa?' }, nextKey: 'end' }, { key: 'sale_task', type: 'sale_task', config: {}, nextKey: 'end' }, { key: 'end', type: 'end', config: {}, nextKey: null } ]) },
  contact: { findUnique: vi.fn(async () => ({ id:'customer', zaloUid:'uid', fullName:'Khách', tags:[], consentStatus:'implicit', tagAssignments:[] })) },
  friend: { findFirst: vi.fn(async () => ({ friendshipStatus:'accepted', strangerBlocked:false, tagAssignments:[] })) },
  followupLog: { create: m.createLog }, conversation: { findFirst: m.conversation }, zaloAccount: { findFirst: m.account },
 }, tenantTransaction: vi.fn(),
}));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/modules/outreach/outreach-service.js', () => ({ sendCampaignMessage: m.send, renderTemplate: (s: string) => s, STUB_MODE: vi.fn() }));
vi.mock('../../src/modules/followup/followup-queue.js', () => ({ scheduleAdvance: vi.fn(), cancelScheduledJob: vi.fn() }));
vi.mock('../../src/modules/followup/followup-lint.js', () => ({ lintWorkflow: vi.fn(() => []) }));
import { advanceEnrollment } from '../../src/modules/followup/followup-engine.js';
beforeEach(() => {
 vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
 const e={id:'e',orgId:'org',workflowId:'wf',contactId:'customer',zaloAccountId:'nick',status:'running',currentStepKey:'send_1',messagesSent:0,startedAt:new Date('2026-10-11T00:00:00Z')};
 m.find.mockResolvedValue(e);m.update.mockImplementation(async ({data})=>({...e,...data}));m.send.mockResolvedValue({ok:true,msgId:'test-only'});m.createLog.mockResolvedValue({});
 m.account.mockResolvedValue({status:'disconnected'});m.conversation.mockResolvedValue({isPrivate:false,threadType:'user',messages:[]});
});
describe('managed quote follow-up send boundary', () => {
 it('turns an unsynchronized quote follow-up into an internal task without sending', async () => {
  await advanceEnrollment('e');
  expect(m.send).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'waiting_sale',currentStepKey:'sale_task'})}));
  expect(m.createLog).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({eventType:'sale_task_created'})}));
 });
});
