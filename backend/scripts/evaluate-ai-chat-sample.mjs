/**
 * Execute the server-owned safety evaluation for the sample AI chat setup.
 *
 * Examples (inside the app container):
 *   AI_EVALUATION_TARGET=prompt node /app/scripts/evaluate-ai-chat-sample.mjs
 *   AI_EVALUATION_TARGET=agent  node /app/scripts/evaluate-ai-chat-sample.mjs
 */

import { prisma } from '../dist/shared/database/prisma-client.js';
import { runServerEvaluation } from '../dist/modules/ai/evaluation-server-runner-service.js';

const targetType = process.env.AI_EVALUATION_TARGET === 'agent' ? 'agent' : 'prompt';
const promptKey = process.env.AI_SAMPLE_PROMPT_KEY || 'customer_support_sample';
const agentKey = process.env.AI_SAMPLE_AGENT_KEY || 'cskh-sample-agent';
const modelKey = process.env.AI_SAMPLE_MODEL_KEY || '9router-chat-cskh';

try {
  const selectedUser = process.env.AI_ACTOR_USER_ID
    ? await prisma.user.findUnique({ where: { id: process.env.AI_ACTOR_USER_ID } })
    : await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!selectedUser) throw new Error('Không tìm thấy người dùng để chạy đánh giá.');

  const actor = { orgId: selectedUser.orgId, userId: selectedUser.id };
  const [prompt, agent, model] = await Promise.all([
    prisma.aiPrompt.findFirst({
      where: { orgId: actor.orgId, key: promptKey, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    }),
    prisma.aiAgent.findFirst({ where: { orgId: actor.orgId, key: agentKey, deletedAt: null } }),
    prisma.aiModelConfig.findFirst({
      where: { orgId: actor.orgId, key: modelKey, deletedAt: null },
    }),
  ]);
  const promptVersion = prompt?.versions[0];
  if (!prompt || !promptVersion || !agent || !model) {
    throw new Error('Thiếu prompt, agent hoặc model mẫu để chạy đánh giá.');
  }

  const result = await runServerEvaluation(actor, {
    name: `9router sample ${targetType} safety evaluation`,
    targetType,
    targetId: targetType === 'agent' ? agent.id : promptVersion.id,
    ...(targetType === 'prompt'
      ? { promptVersionId: promptVersion.id, modelConfigId: model.id }
      : {}),
    threshold: 80,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
