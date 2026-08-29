import { prisma } from '../dist/shared/database/prisma-client.js';
import { generateConversationReply } from '../dist/modules/ai/reply-generator-service.js';

try {
  const user = await prisma.user.findFirst({
    where: { role: { in: ['owner', 'admin'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, orgId: true },
  });
  const conversation = await prisma.conversation.findFirst({
    where: { orgId: user?.orgId },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  });
  if (!user || !conversation) throw new Error('No active user or conversation is available.');
  const output = await generateConversationReply(
    { orgId: user.orgId, userId: user.id, role: 'owner', privacyUnlocked: true },
    conversation.id,
    {},
  );
  process.stdout.write(JSON.stringify({
    conversationId: conversation.id,
    runtime: output.runtime,
    agent: output.agent,
    replyLength: output.reply_text.length,
    requiresHuman: output.requires_human,
  }) + '\n');
} finally {
  await prisma.$disconnect();
}
