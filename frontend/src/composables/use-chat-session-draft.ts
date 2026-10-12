import { reactive, shallowRef } from 'vue';
import type { ChatAttachmentState, RichChatDraft } from './chat-session-context';
import type { Message } from './use-chat';

const sessions = new Map<string, ReturnType<typeof freshDraft>>();
function freshDraft() {
  return {
    rich: shallowRef<RichChatDraft>({ text: '' }),
    submission: shallowRef<RichChatDraft | null>(null),
    reply: shallowRef<Message | null>(null),
    editing: shallowRef<Message | null>(null),
    attachments: reactive<ChatAttachmentState>({ files: [], uploading: false, progress: 0, status: '', echoes: new WeakMap(), captions: new WeakMap() }),
  };
}
export function useChatSessionDraft(userId: string, conversationId: string) {
  const key = JSON.stringify([userId, conversationId]);
  let session = sessions.get(key);
  if (!session) { session = freshDraft(); sessions.set(key, session); }
  return session;
}
