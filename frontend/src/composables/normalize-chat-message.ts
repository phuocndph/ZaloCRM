import type { Message, ReplyMessageRef } from './use-chat';

type WireReaction = { emoji: string; reactorId?: string; reactorName?: string | null; reactorSource?: string | null; reactorAvatar?: string | null; count?: number; reacted?: boolean };
type WireMessage = Omit<Message, 'reactions' | 'reply' | 'reactionDetails'> & {
  quote?: ReplyMessageRef | Record<string, any> | null;
  reply?: ReplyMessageRef | null;
  reactions?: WireReaction[];
  reactionDetails?: Message['reactionDetails'];
};

export function normalizeChatMessage(message: WireMessage, viewerId = ''): Message {
  const counts = new Map<string, number>();
  const myEmojis = new Set<string>();
  const details: NonNullable<Message['reactionDetails']> = [];
  for (const reaction of message.reactions ?? []) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + (reaction.reactorId ? 1 : reaction.count ?? 1));
    if (reaction.reacted || (viewerId && reaction.reactorId === viewerId)) myEmojis.add(reaction.emoji);
    if (reaction.reactorId) details.push({ reactorId: reaction.reactorId, reactorName: reaction.reactorName ?? null,
      reactorSource: reaction.reactorSource ?? null, reactorAvatar: reaction.reactorAvatar ?? null, emoji: reaction.emoji });
  }
  const { reactions, quote, ...base } = message;
  let reply = message.reply ?? null;
  if (quote) {
    const q = quote as Record<string, any>;
    const cliType = Number(q.cliMsgType ?? 0);
    let msgType = String(q.msgType ?? '');
    if (!msgType && cliType) msgType = ({ 1: 'text', 19: 'link', 22: 'video', 23: 'sticker', 24: 'voice',
      30: 'file', 32: 'image', 38: 'card', 46: 'location' } as Record<number, string>)[cliType] || '';
    if (!msgType && typeof q.attach === 'string' && q.attach.length > 2) {
      try { const attachment = JSON.parse(q.attach); if (attachment.thumbUrl || attachment.oriUrl) msgType = 'image'; else if (attachment.href) msgType = 'link'; }
      catch { /* Malformed quotes do not prevent rendering the message. */ }
    }
    reply = { msgId: String(q.msgId || q.msg_id || q.globalMsgId || ''), cliMsgId: q.cliMsgId,
      content: String(q.msg ?? q.content ?? ''), senderName: String(q.fromD ?? q.senderName ?? q.fromName ?? ''),
      msgType, uidFrom: String(q.uidFrom ?? q.uid_from ?? ''), ts: String(q.ts ?? ''), propertyExt: q.propertyExt, ttl: q.ttl };
  }
  return { ...base, reply, reactions: [...counts].map(([emoji, count]) => ({ emoji, count, reacted: myEmojis.has(emoji) })),
    reactionDetails: details.length ? details : message.reactionDetails ?? [] };
}
