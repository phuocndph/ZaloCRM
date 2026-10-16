import type { Message } from './use-chat';

export type DeliveryViewState = 'queued' | 'preparing' | 'sending' | 'uncertain' | 'failed' | 'accepted' | 'delivered' | 'seen';

export function messageDeliveryState(message: Partial<Message>): DeliveryViewState {
  if (message.seenAt) return 'seen';
  if (message.deliveredAt) return 'delivered';
  const metadata = message.metadata as { sendStatus?: string; outboundAttachment?: { status?: string }; outboundText?: { status?: string } } | null;
  const status = metadata?.outboundAttachment?.status || metadata?.outboundText?.status || metadata?.sendStatus;
  if (message.zaloMsgId || ['accepted', 'completed'].includes(message.deliveryState || '')) return 'accepted';
  if (message.deliveryState === 'failed' || status === 'failed') return 'failed';
  if (message.deliveryState === 'uncertain' || status === 'uncertain' || message.pendingConfirmation) return 'uncertain';
  if (status === 'preparing') return 'preparing';
  if (message.deliveryState === 'prepared' || status === 'queued') return 'queued';
  if (message.deliveryState === 'submitting' || message.isPending || ['sending', 'submitting', 'uploading'].includes(status || '')) return 'sending';
  // Historical/native messages without receipt metadata are sent, never inferred as sending by age.
  return 'accepted';
}

export const deliveryLabels: Record<DeliveryViewState, string> = {
  queued: 'Chờ gửi', preparing: 'Đang chuẩn bị', sending: 'Đang gửi', uncertain: 'Chưa xác định kết quả',
  failed: 'Gửi thất bại', accepted: 'Zalo đã tiếp nhận', delivered: 'Đã nhận', seen: 'Đã xem',
};

export function attachmentOutcomes(ids: string[], data: { messages?: Message[]; failedIndices?: number[]; pendingConfirmationIndices?: number[] }) {
  const indexed = new Map((data.messages || []).map((message) => [message.clientEchoId || message.echoId, message]));
  const failed = new Set(data.failedIndices || []);
  const pending = new Set(data.pendingConfirmationIndices || []);
  const accepted = new Set<number>();
  const missing = new Set<number>();
  ids.forEach((id, index) => {
    const message = indexed.get(id);
    if (!message) { if (!failed.has(index)) missing.add(index); return; }
    const state = messageDeliveryState(message);
    if (state === 'failed') { failed.add(index); pending.delete(index); }
    else if (['accepted', 'delivered', 'seen'].includes(state)) { accepted.add(index); failed.delete(index); pending.delete(index); }
    else { pending.add(index); failed.delete(index); }
  });
  return { accepted, failed, pending, missing };
}
