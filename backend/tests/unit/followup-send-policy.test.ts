import { describe, expect, it } from 'vitest';
import { automaticQuoteFollowupBlock } from '../../src/modules/followup/followup-send-policy.js';

const now = new Date('2026-10-13T09:00:00Z');
const quote = { id: 'quote', senderType: 'self', contentType: 'text', content: 'Em gửi anh báo giá chi tiết', sentAt: new Date('2026-10-11T08:00:00Z') };
const input = { now, accountStatus: 'connected', conversation: { isPrivate: false, threadType: 'user', messages: [quote] } };

describe('automatic managed quote follow-up policy', () => {
  it('hands a price objection after the quote to staff, never asks whether quote was viewed', () => {
    const decision = automaticQuoteFollowupBlock({ ...input, conversation: { ...input.conversation, messages: [
      { id: 'objection', senderType: 'contact', contentType: 'text', content: 'Giá em cao hơn các đơn vị khác rồi', sentAt: new Date('2026-10-11T09:00:00Z') }, quote,
    ] } });
    expect(decision).toMatchObject({ reason: 'customer_replied_after_quote' });
    expect(decision?.title).toContain('nhu cầu');
  });
  it('blocks automatic outreach when the nick is disconnected', () => {
    expect(automaticQuoteFollowupBlock({ ...input, accountStatus: 'disconnected' }))
      .toMatchObject({ reason: 'sync_unverified' });
  });
  it('hands an old quotation to staff to reconfirm current demand', () => {
    expect(automaticQuoteFollowupBlock({ ...input, conversation: { ...input.conversation, messages: [{ ...quote, sentAt: new Date('2026-08-01T00:00:00Z') }] } }))
      .toMatchObject({ reason: 'stale_quote' });
  });
  it('requires actual quote evidence, not a price inquiry or an arbitrary file', () => {
    expect(automaticQuoteFollowupBlock({ ...input, conversation: { ...input.conversation, messages: [{ ...quote, content: 'Anh cần em báo giá không?' }] } }))
      .toMatchObject({ reason: 'quote_unverified' });
  });
  it('never analyzes a private or missing conversation', () => {
    expect(automaticQuoteFollowupBlock({ ...input, conversation: null }))?.toMatchObject({ reason: 'context_unverified' });
    expect(automaticQuoteFollowupBlock({ ...input, conversation: { ...input.conversation, isPrivate: true } }))
      .toMatchObject({ reason: 'context_unverified' });
  });
  it('does not treat a future promise to send a quote as a sent quote', () => {
    expect(automaticQuoteFollowupBlock({ ...input, conversation: { ...input.conversation, messages: [{ ...quote, content: 'Mai em gửi anh báo giá nhé' }] } }))
      .toMatchObject({ reason: 'quote_unverified' });
  });
  it('allows a recent evidenced quote with no subsequent reply', () => {
    expect(automaticQuoteFollowupBlock(input)).toBeNull();
  });
});
