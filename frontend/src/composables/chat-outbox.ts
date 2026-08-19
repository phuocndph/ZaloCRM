export interface EchoMessageLike {
  id: string;
  clientEchoId?: string | null;
  echoId?: string | null;
  zaloMsgId?: string | null;
  zaloMsgIdNum?: string | null;
  sentAt: string;
}

export function resolveClientEchoId(retryEchoId?: string, create?: () => string): string {
  if (retryEchoId) return retryEchoId;
  if (create) return create();
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function messageEchoIdOf(message: EchoMessageLike): string | null {
  return message.clientEchoId || message.echoId || null;
}

export function isSameMessageIdentity(a: EchoMessageLike, b: EchoMessageLike): boolean {
  if (a.id === b.id) return true;
  const aEchoId = messageEchoIdOf(a);
  const bEchoId = messageEchoIdOf(b);
  if (aEchoId && bEchoId && aEchoId === bEchoId) return true;
  if (a.zaloMsgId && b.zaloMsgId && a.zaloMsgId === b.zaloMsgId) return true;
  return !!a.zaloMsgIdNum && !!b.zaloMsgIdNum && a.zaloMsgIdNum === b.zaloMsgIdNum;
}

export function compareEchoMessages(a: EchoMessageLike, b: EchoMessageLike): number {
  const sentDiff = new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
  if (sentDiff !== 0) return sentDiff;
  if (a.zaloMsgIdNum && b.zaloMsgIdNum) {
    const diff = BigInt(a.zaloMsgIdNum) - BigInt(b.zaloMsgIdNum);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
  }
  if (a.zaloMsgIdNum && !b.zaloMsgIdNum) return -1;
  if (!a.zaloMsgIdNum && b.zaloMsgIdNum) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function replaceMessageByEchoId<T extends EchoMessageLike>(
  list: T[],
  echoId: string,
  incoming: T,
): T[] | null {
  const hasEcho = list.some((message) =>
    message.id === `pending:${echoId}` || messageEchoIdOf(message) === echoId,
  );
  if (!hasEcho) return null;
  // Socket self-listen can arrive before the HTTP response. Remove both the
  // optimistic row and any already-rendered remote row before inserting the
  // final message, regardless of which confirmation wins the race.
  const next = list.filter((message) =>
    message.id !== `pending:${echoId}`
    && messageEchoIdOf(message) !== echoId
    && !isSameMessageIdentity(message, incoming),
  );
  next.push(incoming);
  next.sort(compareEchoMessages);
  return next;
}

export function upsertMessageByIdentity<T extends EchoMessageLike>(list: T[], incoming: T): T[] {
  const next = list.filter((message) => !isSameMessageIdentity(message, incoming));
  next.push(incoming);
  next.sort(compareEchoMessages);
  return next;
}
