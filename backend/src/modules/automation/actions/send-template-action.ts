import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { renderMessageTemplate } from '../template-renderer.js';
import { zaloPool } from '../../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../../zalo/zalo-rate-limiter.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../../contacts/contact-aggregate.js';

export async function sendTemplateAction(input: {
  templateId: string;
  orgId: string;
  conversationId: string;
  zaloAccountId: string;
  threadId: string | null;
  threadType: string;
  context: {
    org?: { id: string; name: string | null } | null;
    contact?: { id: string; fullName: string | null; crmName?: string | null; phone: string | null; status: string | null } | null;
    conversation?: { id: string } | null;
  };
}) {
  if (!input.threadId) return null;

  const template = await prisma.messageTemplate.findFirst({
    where: { id: input.templateId, orgId: input.orgId },
    select: { id: true, content: true },
  });
  if (!template) return null;

  const content = renderMessageTemplate(template.content, input.context).trim();
  if (!content) return null;

  const instance = zaloPool.getInstance(input.zaloAccountId);
  if (!instance?.api) return null;

  const limits = await zaloRateLimiter.checkLimits(input.zaloAccountId);
  if (!limits.allowed) return null;

  zaloRateLimiter.recordSend(input.zaloAccountId);
  const threadType = input.threadType === 'group' ? 1 : 0;
  const sendResult = await instance.api.sendMessage({ msg: content }, input.threadId, threadType);
  const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');

  const created = await prisma.message.create({
    data: {
      id: randomUUID(),
      conversationId: input.conversationId,
      zaloMsgId: zaloMsgId || null,
      senderType: 'self',
      senderUid: null,
      senderName: 'Automation',
      content,
      contentType: 'text',
      sentAt: new Date(),
    },
  });

  const aggInput = {
    conversationId: input.conversationId,
    message: {
      id: created.id,
      content: created.content,
      contentType: created.contentType,
      sentAt: created.sentAt,
      senderType: 'self' as const,
    },
  };
  void applyContactAggregateFromMessage(aggInput);
  void applyFriendAggregate(aggInput);

  return created;
}
