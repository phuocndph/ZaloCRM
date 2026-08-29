import { describe, expect, it } from 'vitest';
import { mobileChatRedirect } from './mobile-chat-redirect';

describe('mobileChatRedirect', () => {
  it('preserves AI deep-link state when redirecting a conversation to mobile', () => {
    expect(mobileChatRedirect({ convId: 'conversation-1', query: { ai: '1' }, hash: '#latest' })).toEqual({
      name: 'M.Chat',
      params: { convId: 'conversation-1' },
      query: { ai: '1' },
      hash: '#latest',
    });
  });

  it('preserves query state when opening the mobile conversation list', () => {
    expect(mobileChatRedirect({ query: { filter: 'unread' }, hash: '' })).toEqual({
      name: 'M.Conversations',
      query: { filter: 'unread' },
      hash: '',
    });
  });
});
