// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, type Ref } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import type { Conversation } from '@/composables/use-chat';

export interface AccountLabelView {
  id: number;
  text: string;
  color: string;
  emoji: string | null;
  offset: number;
  assignedCount: number;
  assignedTo?: boolean;
}

/** Keep the selected chat unchanged until Zalo confirms the assignment. */
export function useZaloLabelAssignment(options: {
  conversation: () => Conversation | null | undefined;
  labels: Ref<AccountLabelView[]>;
  currentLabelId: () => number | undefined;
  accountStatus?: () => string | null | undefined;
  refreshLabels: (accountId: string, threadId?: string | null) => Promise<void>;
}) {
  const saving = ref(false);
  const toast = useToast();
  async function assign(label: AccountLabelView) {
    if (saving.value) return;
    const conversation = options.conversation();
    const account = conversation?.zaloAccount;
    const threadId = conversation?.externalThreadId;
    if (!conversation || !account || !threadId) return;
    const status = options.accountStatus?.() ?? account.status;
    if (status && status !== 'connected') {
      toast.error('Nick Zalo đang mất kết nối. Kết nối lại để đổi thẻ phân loại.');
      return;
    }
    const labelId = options.currentLabelId() === label.id ? null : label.id;
    saving.value = true;
    try {
      await api.post(`/zalo-accounts/${account.id}/labels/assign-thread`, { threadId, labelId });
      const current = options.conversation();
      // Refreshes can replace the object; update the current object only for the same chat.
      const sameChat = current?.id === conversation.id && current.zaloAccount?.id === account.id
        && current.externalThreadId === threadId;
      const friendship = sameChat ? current?.friendship : conversation.friendship;
      if (friendship) {
        friendship.zaloLabels = labelId === null ? [] : [{ id: String(label.id), name: label.text, color: label.color }];
        const manual = (friendship.crmTagsPerNick ?? []).filter(tag => !tag.startsWith('🔵 '));
        friendship.crmTagsPerNick = labelId === null ? manual : [...manual, `🔵 ${label.text}`];
      }
      if (sameChat) {
        options.labels.value = options.labels.value.map(item => ({ ...item, assignedTo: item.id === labelId }));
        void options.refreshLabels(account.id, threadId);
      }
      toast.success(labelId === null ? 'Đã gỡ thẻ phân loại Zalo' : `Đã gắn “${label.text}” trên Zalo`);
      window.dispatchEvent(new CustomEvent('zalo-labels-synced', { detail: { accountId: account.id } }));
      if (conversation.contact?.id) window.dispatchEvent(new CustomEvent('timeline-updated', { detail: { contactId: conversation.contact.id } }));
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.response?.data?.error || 'Không gắn được thẻ Zalo. Thẻ cũ được giữ lại.');
    } finally { saving.value = false; }
  }
  return { saving, assign };
}
