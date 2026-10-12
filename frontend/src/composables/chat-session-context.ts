import type { InjectionKey, Ref } from 'vue';
import type { Message } from './use-chat';
import type { JSONContent } from '@tiptap/core';

export type RichChatDraft = {
  text: string;
  styles?: Array<{ st: string; start: number; len: number }>;
  mentions?: Array<{ uid: string; pos: number; len: number }>;
  document?: JSONContent;
};
export type ChatAttachmentState = {
  files: File[];
  uploading: boolean;
  progress: number;
  status: string;
  echoes: WeakMap<File, string>;
  captions: WeakMap<File, string>;
};
export interface ChatSessionContext {
  canSend: Ref<boolean>;
  draft: Ref<RichChatDraft>;
  attachments: ChatAttachmentState;
  submit: (draft: RichChatDraft, replyId?: string | null) => Promise<boolean>;
  addOptimisticMessages: (id: string, messages: Message[]) => void;
  reconcileOptimisticMessages: (id: string, temporaryIds: string[], messages: Message[]) => void;
  removeOptimisticMessages: (id: string, temporaryIds: string[]) => void;
}
export const chatSessionKey: InjectionKey<ChatSessionContext> = Symbol('conversation-chat-session');
