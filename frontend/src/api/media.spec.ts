import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/api/index', () => ({ api }));

import { sendMediaToConversation } from './media';

describe('media send idempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reuses the same echo id after a failed request and rotates it after success', async () => {
    api.post
      .mockRejectedValueOnce(new Error('network interrupted'))
      .mockResolvedValueOnce({ data: { message: { id: 'message-1' } } })
      .mockResolvedValueOnce({ data: { message: { id: 'message-2' } } });

    await expect(sendMediaToConversation('asset-1', 'conversation-1')).rejects.toThrow('network interrupted');
    await expect(sendMediaToConversation('asset-1', 'conversation-1')).resolves.toMatchObject({
      message: { id: 'message-1' },
    });
    await sendMediaToConversation('asset-1', 'conversation-1');

    const firstEcho = api.post.mock.calls[0][1].echoId;
    const retryEcho = api.post.mock.calls[1][1].echoId;
    const nextActionEcho = api.post.mock.calls[2][1].echoId;
    expect(retryEcho).toBe(firstEcho);
    expect(nextActionEcho).not.toBe(firstEcho);
  });
});
