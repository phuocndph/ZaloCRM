import { describe, expect, it } from 'vitest';
import { normalizeChatMessage } from './normalize-chat-message';
import type { Message } from './use-chat';
describe('shared chat message normalization', () => {
  it('aggregates raw reactions and retains users for the detail popup', () => {
    const raw = { id: 'm', reactions: [{ emoji: 'heart', reactorId: 'me', reactorName: 'Staff' }, { emoji: 'heart', reactorId: 'other' }] } as any;
    const result = normalizeChatMessage(raw, 'me');
    expect(result.reactions).toEqual([{ emoji: 'heart', count: 2, reacted: true }]);
    expect(result.reactionDetails?.[0].reactorName).toBe('Staff');
    expect(normalizeChatMessage(result, 'me')).toEqual(result);
  });
  it('normalizes native image quotes and preserves pre-normalized replies', () => {
    const raw = { id: 'm', reactions: [], quote: { msgId: 'q', msg: '', fromD: 'Khách', cliMsgType: 32, uidFrom: 'u' } } as any;
    const result = normalizeChatMessage(raw);
    expect(result.reply).toMatchObject({ msgId: 'q', senderName: 'Khách', msgType: 'image', uidFrom: 'u' });
    expect(normalizeChatMessage(result as Message).reply).toEqual(result.reply);
  });
});
