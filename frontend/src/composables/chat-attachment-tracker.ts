import { api } from '@/api/index';
import type { Message } from './use-chat';
import { messageDeliveryState } from './chat-delivery-state';
const tracking = new Map<string, Set<(messages: Message[]) => void>>();

/** Track server-owned transfers independently of the lifetime of a chat panel. */
export function trackAttachmentDelivery(conversationId: string, ids: string[], onMessages: (messages: Message[]) => void) {
  const key = `${conversationId}:${[...ids].sort().join(',')}`;
  const current = tracking.get(key);
  if (current) { current.add(onMessages); return; }
  const listeners = new Set([onMessages]);
  tracking.set(key, listeners);
  const finish = () => tracking.delete(key);
  const started = Date.now();
  let failures = 0;
  const poll = async () => {
    try {
      const { data } = await api.get(`/conversations/${conversationId}/attachments/status`, {
        params: { echoIds: JSON.stringify(ids) }, timeout: 15_000,
      });
      const messages: Message[] = data.messages || [];
      listeners.forEach((listener) => listener(messages));
      failures = 0;
      const unsettled = messages.length !== ids.length || messages.some((message) => {
        const state = messageDeliveryState(message);
        const mirror = (message.metadata?.outboundAttachment as { status?: string } | undefined)?.status;
        return ['queued', 'preparing', 'sending'].includes(state) || (state === 'accepted' && mirror === 'accepted_pending_mirror');
      });
      if (!unsettled || Date.now() - started > 15 * 60_000) { finish(); return; }
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if ([401, 403, 404].includes(status || 0) || ++failures >= 5) { finish(); return; }
    }
    setTimeout(() => { void poll(); }, Math.min(15_000, 3_000 * (failures + 1)));
  };
  setTimeout(() => { void poll(); }, 1_000);
}
