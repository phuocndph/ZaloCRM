import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {},
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

import { checkFollowupStop, type ContactState } from '../../src/modules/followup/followup-engine.js';

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
});
