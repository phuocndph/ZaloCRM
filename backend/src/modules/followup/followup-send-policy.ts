type Message = { id?: string; senderType: string; contentType: string; content: string | null; sentAt: Date };
type Input = { now: Date; accountStatus: string | null; conversation: { isPrivate: boolean; threadType: string; messages: Message[] } | null };
type Block = { reason: string; title: string };
function normalized(value: string | null): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
}
export function automaticQuoteFollowupBlock(input: Input): Block | null {
  if (input.accountStatus !== 'connected') {
    return { reason: 'sync_unverified', title: 'Kiểm tra kết nối và đồng bộ trước khi xác nhận nhu cầu; chưa liên hệ tự động' };
  }
  if (!input.conversation || input.conversation.isPrivate || input.conversation.threadType !== 'user') {
    return { reason: 'context_unverified', title: 'Nhân viên kiểm tra ngữ cảnh được cấp quyền trước khi follow-up' };
  }
  const messages = input.conversation.messages;
  const quotes = messages.filter((m) => m.senderType === 'self' && m.contentType === 'text'
    && /(?:gui|bao)\b.{0,40}\bbao gia\b/.test(normalized(m.content))
    && !/\b(?:mai|se|chua|khong|can|du dinh|sap)\b/.test(normalized(m.content)))
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const quote = quotes[0];
  if (!quote || !Number.isFinite(quote.sentAt.getTime()) || quote.sentAt > input.now) {
    return { reason: 'quote_unverified', title: 'Xác minh báo giá thực tế và nhu cầu hiện tại trước khi liên hệ' };
  }
  if (input.now.getTime() - quote.sentAt.getTime() > 14 * 86400000) {
    return { reason: 'stale_quote', title: 'Xác nhận nhu cầu hiện tại của cơ hội cũ trước khi nhắc báo giá' };
  }
  if (quote && messages.some((m) => m.senderType === 'contact' && m.sentAt > quote.sentAt)) {
    return { reason: 'customer_replied_after_quote', title: 'Xác nhận nhu cầu hiện tại và làm rõ vướng mắc sau báo giá; không tự giảm giá' };
  }
  return null;
}
