// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-conversation-content.ts — client cho Conversation Content Library (2026-07-11).
 *
 * Ghim tin nhắn, tin đã ghim, tìm trong hội thoại, tab Ảnh/Video · File · Link, và context
 * "nhảy tới tin gốc". Chỉ gọi API — mọi quyết định quyền/riêng tư nằm ở backend.
 *
 * Có AbortController per-request-kind: gõ tìm kiếm nhanh → hủy request cũ (yêu cầu 12).
 */
import { api } from '@/api/index';
import type { Message } from '@/composables/use-chat';

export interface PinnedItem {
  pinId: string;
  pinnedByUserId: string;
  pinnedByName: string;
  pinnedAt: string;
  message: Message | null;
  missing: boolean;
}

export interface ContentPage {
  items: Message[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type ContentSearchType = 'all' | 'text' | 'media' | 'file' | 'link' | 'pinned';
export type SenderFilter = 'all' | 'self' | 'contact';

export interface SearchQuery {
  q?: string;
  type?: ContentSearchType;
  senderType?: SenderFilter;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

// 1 controller / loại request để hủy cái cũ khi có request mới cùng loại (search debounce).
const controllers: Record<string, AbortController | undefined> = {};
function freshSignal(kind: string): AbortSignal {
  controllers[kind]?.abort();
  const c = new AbortController();
  controllers[kind] = c;
  return c.signal;
}

export function isCanceled(err: unknown): boolean {
  return (
    (err as { code?: string })?.code === 'ERR_CANCELED' ||
    (err as { name?: string })?.name === 'CanceledError'
  );
}

export function useConversationContent() {
  async function pin(conversationId: string, messageId: string): Promise<void> {
    await api.post(`/conversations/${conversationId}/messages/${messageId}/pin`);
  }
  async function unpin(conversationId: string, messageId: string): Promise<void> {
    await api.delete(`/conversations/${conversationId}/messages/${messageId}/pin`);
  }

  async function listPinned(conversationId: string): Promise<PinnedItem[]> {
    const res = await api.get(`/conversations/${conversationId}/pinned-messages`, {
      signal: freshSignal('pinned'),
    });
    return res.data.items as PinnedItem[];
  }

  async function search(conversationId: string, query: SearchQuery): Promise<ContentPage> {
    const res = await api.get(`/conversations/${conversationId}/search`, {
      params: query,
      signal: freshSignal('search'),
    });
    return res.data as ContentPage;
  }

  async function listMedia(conversationId: string, page = 1, limit = 40): Promise<ContentPage> {
    const res = await api.get(`/conversations/${conversationId}/media`, {
      params: { page, limit },
      signal: freshSignal('media'),
    });
    return res.data as ContentPage;
  }

  async function listFiles(
    conversationId: string,
    opts: { page?: number; limit?: number; q?: string; sort?: 'newest' | 'oldest' } = {},
  ): Promise<ContentPage> {
    const res = await api.get(`/conversations/${conversationId}/files`, {
      params: { page: 1, limit: 40, ...opts },
      signal: freshSignal('files'),
    });
    return res.data as ContentPage;
  }

  async function listLinks(conversationId: string, page = 1, limit = 40): Promise<ContentPage> {
    const res = await api.get(`/conversations/${conversationId}/links`, {
      params: { page, limit },
      signal: freshSignal('links'),
    });
    return res.data as ContentPage;
  }

  /** Cửa sổ tin quanh 1 messageId — để merge vào thread rồi cuộn tới (nhảy tin chưa tải). */
  async function loadContext(
    conversationId: string,
    messageId: string,
    before = 20,
    after = 20,
  ): Promise<Message[]> {
    const res = await api.get(
      `/conversations/${conversationId}/messages/${messageId}/context`,
      { params: { before, after } },
    );
    return res.data.items as Message[];
  }

  return { pin, unpin, listPinned, search, listMedia, listFiles, listLinks, loadContext };
}
