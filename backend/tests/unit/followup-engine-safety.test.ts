import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enrollment: vi.fn(), claim: vi.fn(), step: vi.fn() }));

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: { followupEnrollment: { findUnique: mocks.enrollment, updateMany: mocks.claim }, followupStep: { findUnique: mocks.step } },
  tenantTransaction: vi.fn(),
}));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/modules/outreach/outreach-service.js', () => ({
  sendCampaignMessage: vi.fn(), renderTemplate: vi.fn(), STUB_MODE: vi.fn(),
}));
vi.mock('../../src/modules/followup/followup-queue.js', () => ({
  scheduleAdvance: vi.fn(), cancelScheduledJob: vi.fn(),
}));
vi.mock('../../src/modules/followup/followup-lint.js', () => ({ lintWorkflow: vi.fn(() => []) }));

import { checkFollowupStop, completeSaleTask, type ContactState } from '../../src/modules/followup/followup-engine.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enrollment.mockResolvedValue({ id: 'enrollment', orgId: 'org', contactId: 'contact', zaloAccountId: 'other', status: 'waiting_sale', currentStepKey: 'sale', updatedAt: new Date() });
  mocks.step.mockResolvedValue({ nextKey: 'send' }); mocks.claim.mockResolvedValue({ count: 0 });
});

function state(overrides: Partial<ContactState> = {}): ContactState {
  return {
    contactId: 'contact-1',
    zaloUid: 'uid-1',
    fullName: 'Lan',
    phone: null,
    tags: [],
    isFriend: true,
    strangerBlocked: false,
    consentStatus: 'implicit',
    ...overrides,
  };
}

describe('FollowupEngine safety stop', () => {
  const workflow = { stopOnPurchase: true, stopOnTags: ['Không liên hệ', 'Không làm phiền'] };

  it('stops for taxonomy slugs and purchased Zalo labels normalized to slugs', () => {
    expect(checkFollowupStop(workflow, state({ tags: ['khong-lien-he'] })))
      .toMatchObject({ reason: 'do_not_disturb' });
    expect(checkFollowupStop(workflow, state({ tags: ['da-mua'] })))
      .toMatchObject({ reason: 'purchased' });
  });

  it('stops when consent, friendship or block state changes during a wait', () => {
    expect(checkFollowupStop(workflow, state({ consentStatus: 'revoked' })))
      .toMatchObject({ reason: 'do_not_disturb' });
    expect(checkFollowupStop(workflow, state({ strangerBlocked: true })))
      .toMatchObject({ reason: 'customer_blocked' });
    expect(checkFollowupStop(workflow, state({ isFriend: false })))
      .toMatchObject({ reason: 'not_friend' });
  });
  it.each([{ allowedAccountIds: ['nick'] }, { allowedAccountIds: [] }])('does not claim or send a sale task moved outside the Agent sender scope: %j', async ({ allowedAccountIds }) => {
    expect(await completeSaleTask('enrollment', { actorId: 'user' }, { orgId: 'org', contactId: 'contact', currentStepKey: 'sale', allowedAccountIds })).toBe(false);
    expect(mocks.step).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('keeps the account constraint in the atomic claim if the sender changes after the read', async () => {
    mocks.enrollment.mockResolvedValue({ id: 'enrollment', orgId: 'org', contactId: 'contact', zaloAccountId: 'nick', workflowId: 'workflow', status: 'waiting_sale', currentStepKey: 'sale', updatedAt: new Date() });
    expect(await completeSaleTask('enrollment', { actorId: 'user' }, { orgId: 'org', contactId: 'contact', currentStepKey: 'sale', allowedAccountIds: ['nick'] })).toBe(false);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ zaloAccountId: { in: ['nick'] } }) }));
  });
});
