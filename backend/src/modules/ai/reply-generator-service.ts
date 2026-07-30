import { createHash } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { decryptToken, encryptToken } from '../integrations/_shared/token-encryption.util.js';
import { aiClient } from './core/index.js';
import { PromptRenderer } from './core/prompt-renderer.js';
import {
  buildConversationContext,
  ContextBuilderError,
  type ContextActor,
  type ConversationContext,
} from './conversation-context-builder-service.js';
import { listCustomerMemories } from './conversation-memory-service.js';
import { searchKnowledge } from './knowledge-base-service.js';
import { getSkill, SkillFrameworkError } from './skill-framework-service.js';
import type { SkillDefinition } from './skills/skill-definition.js';
import { checkReplyPolicy, type PolicyResult } from './policy-safety-checker-service.js';
import { calculateConfidence, historicalEvaluationSignal, type ConfidenceOutput } from './confidence-engine-service.js';
import { analyzeIntentText } from './intent-engine-service.js';
import { analyzeEmotionMessages } from './emotion-engine-service.js';

export type ReplyActor = ContextActor;
export type ReplyStyle = 'shorter' | 'friendlier' | 'professional' | 'softer' | 'more_sales_focused' | 'more_explanatory';
export type ReplyInput = {
  context: ConversationContext;
  customerMemory: Array<Record<string, unknown>>;
  intent: { primary_intent: string; confidence: number; missing_information?: string[]; requires_human?: boolean };
  emotion: { emotion: string; confidence: number; intensity: number; suggested_tone?: string; escalation_required?: boolean };
  knowledgeResults: Array<Record<string, any>>;
  skill: { id: string; key: string; name: string; config: SkillDefinition };
  persona?: string | null;
  employeeTone?: ReplyStyle;
  businessRules?: string[];
  prompt?: { id: string; version: number; content: string } | null;
};
export type ReplyRuntime = {
  mode: 'model' | 'deterministic' | 'degraded';
  provider?: string;
  model?: string;
  usedFallback?: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: string;
  errorCode?: string;
};
export type ReplyOutput = {
  policy?: PolicyResult;
  confidence_assessment?: ConfidenceOutput;
  runtime?: ReplyRuntime;
  runId?: string;
  suggestionId?: string;
  agent?: { id: string; name: string };
  reply_text: string;
  alternative_replies: string[];
  intent: string;
  tone: string;
  sources: Array<Record<string, unknown>>;
  confidence: number;
  assumptions: string[];
  missing_information: string[];
  suggested_actions: string[];
  requires_human: boolean;
  do_not_send_reason: string | null;
};

export class ReplyGeneratorError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'REPLY_GENERATOR_ERROR') {
    super(message);
    this.name = 'ReplyGeneratorError';
  }
}

const renderer = new PromptRenderer();
const RISKY_INTENTS = new Set(['price_inquiry', 'quote_request', 'discount_request', 'complaint', 'return_or_refund', 'payment_inquiry']);

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function compact(text: string, max = 280) { return text.replace(/\s+/g, ' ').trim().slice(0, max); }
function sources(results: Array<Record<string, any>>) { return results.map((result) => result.citation).filter(Boolean).slice(0, 5); }

function contextCustomerMessages(context: ConversationContext) {
  const messages = context.sections.find((section) => section.id === 'recent_messages')?.items as Array<{ content?: string; senderType?: string }> | undefined;
  return (messages ?? [])
    .filter((message) => message.senderType === 'contact' && message.content)
    .map((message) => message.content!.trim())
    .slice(-5);
}

function latestCustomerText(context: ConversationContext) {
  return contextCustomerMessages(context).at(-1) ?? '';
}

function safety(input: ReplyInput) {
  const missing = [...new Set(input.intent.missing_information ?? [])];
  const hasSources = input.knowledgeResults.length > 0;
  const risky = RISKY_INTENTS.has(input.intent.primary_intent);
  const human = !!input.intent.requires_human
    || !!input.emotion.escalation_required
    || ['complaint_handling', 'human_handoff'].includes(input.skill.key);
  const assumptions: string[] = [];
  if (!hasSources && risky) assumptions.push('Không có nguồn kiến thức đã duyệt, còn hiệu lực để xác nhận nội dung nhạy cảm.');
  if (input.intent.confidence < input.skill.config.confidenceThreshold) assumptions.push('Độ tin cậy intent chưa đạt ngưỡng Skill.');
  if (input.emotion.confidence < .55) assumptions.push('Tín hiệu cảm xúc chỉ mang tính tạm thời.');
  const requiresHuman = human || assumptions.length > 0;
  const reason = human
    ? 'Tình huống cần nhân viên xử lý theo rule handoff.'
    : assumptions.length ? assumptions.join(' ') : null;
  return { missing, assumptions, requiresHuman, reason, hasSources };
}

function applyStyle(reply: string, style?: ReplyStyle, sourceExcerpt?: string) {
  if (!style) return reply;
  if (style === 'shorter') return compact(reply.split(/[.!?]/)[0] || reply, 260) + '.';
  if (style === 'friendlier') return reply.replace(/\.$/, ' nhé ạ.');
  if (style === 'professional') return `Xin chào anh/chị. ${reply.replace(/^Dạ,?\s*/i, '')}`;
  if (style === 'softer') return `Em rất mong được hỗ trợ anh/chị. ${reply}`;
  if (style === 'more_sales_focused') return `${reply} Nếu phù hợp, em có thể hỗ trợ anh/chị xem lựa chọn phù hợp hơn.`;
  if (style === 'more_explanatory' && sourceExcerpt) return `${reply} Thông tin tham khảo: ${compact(sourceExcerpt, 180)}`;
  return reply;
}

function deterministic(input: ReplyInput): ReplyOutput {
  const guard = safety(input);
  const question = latestCustomerText(input.context);
  const missingText = guard.missing.length
    ? 'Để hỗ trợ chính xác hơn, anh/chị cho em xin thêm thông tin về ' + guard.missing.join(', ') + ' nhé.'
    : '';
  let reply = '';
  if (guard.requiresHuman) {
    reply = input.intent.primary_intent === 'human_request'
      ? 'Dạ em đã ghi nhận yêu cầu. Em sẽ chuyển thông tin để nhân viên phụ trách hỗ trợ anh/chị sớm nhất có thể.'
      : `Dạ em đã ghi nhận nội dung của anh/chị.${missingText ? ` ${missingText}` : ''} Em xin phép chuyển nhân viên phụ trách kiểm tra và hỗ trợ chính xác hơn.`;
  } else if (missingText) reply = missingText;
  else if (input.knowledgeResults[0]?.excerpt) reply = `Dạ, theo thông tin hiện có: ${compact(String(input.knowledgeResults[0].excerpt), 230)} Anh/chị cần em làm rõ thêm phần nào ạ?`;
  else if (question) reply = 'Dạ em đã hiểu nhu cầu của anh/chị. Anh/chị cho em thêm một chút thông tin cụ thể để em hỗ trợ đúng hơn nhé.';
  else reply = 'Dạ em sẵn sàng hỗ trợ anh/chị. Anh/chị cho em biết thêm nhu cầu của mình nhé.';
  reply = applyStyle(reply, input.employeeTone, input.knowledgeResults[0]?.excerpt);
  const tone = guard.requiresHuman
    ? 'calm_deescalating'
    : input.employeeTone ?? input.emotion.suggested_tone ?? input.skill.config.defaultTone;
  const alternatives = [reply.replace(/^Dạ,?\s*/i, 'Em xin phép '), reply.replace(/ nhé\.$/, ' ạ.')]
    .filter((item, index, array) => item !== reply && array.indexOf(item) === index)
    .slice(0, 2);
  return {
    reply_text: reply,
    alternative_replies: alternatives,
    intent: input.intent.primary_intent,
    tone,
    sources: sources(input.knowledgeResults),
    confidence: clamp(Math.min(
      input.intent.confidence,
      input.emotion.confidence || 1,
      guard.hasSources || !RISKY_INTENTS.has(input.intent.primary_intent) ? 1 : .45,
    )),
    assumptions: guard.assumptions,
    missing_information: guard.missing,
    suggested_actions: guard.requiresHuman ? ['create_handoff', 'review_before_send'] : ['review_before_send'],
    requires_human: guard.requiresHuman,
    do_not_send_reason: guard.reason,
  };
}

function valid(value: unknown): value is ReplyOutput {
  if (!value || typeof value !== 'object') return false;
  const output = value as Partial<ReplyOutput>;
  return typeof output.reply_text === 'string'
    && Array.isArray(output.alternative_replies)
    && typeof output.intent === 'string'
    && typeof output.tone === 'string'
    && Array.isArray(output.sources)
    && typeof output.confidence === 'number'
    && Array.isArray(output.assumptions)
    && Array.isArray(output.missing_information)
    && Array.isArray(output.suggested_actions)
    && typeof output.requires_human === 'boolean'
    && (typeof output.do_not_send_reason === 'string' || output.do_not_send_reason === null);
}

function enforce(output: ReplyOutput, input: ReplyInput): ReplyOutput {
  const fallback = deterministic(input);
  const guard = safety(input);
  const reply = compact(output.reply_text, 1200);
  if (!reply) return fallback;
  const requiresHuman = output.requires_human || guard.requiresHuman;
  return {
    ...output,
    reply_text: reply,
    alternative_replies: output.alternative_replies.map((item) => compact(String(item), 1200)).filter(Boolean).slice(0, 3),
    intent: input.intent.primary_intent,
    tone: requiresHuman ? 'calm_deescalating' : output.tone,
    sources: sources(input.knowledgeResults),
    confidence: clamp(Math.min(output.confidence, fallback.confidence || 1)),
    assumptions: [...new Set([...guard.assumptions, ...output.assumptions.map(String)])].slice(0, 8),
    missing_information: [...new Set([...guard.missing, ...output.missing_information.map(String)])].slice(0, 8),
    suggested_actions: [...new Set([...output.suggested_actions.map(String), 'review_before_send'])].slice(0, 8),
    requires_human: requiresHuman,
    do_not_send_reason: requiresHuman
      ? (guard.reason ?? output.do_not_send_reason ?? 'Cần nhân viên review trước khi gửi.')
      : output.do_not_send_reason,
  };
}

function applyPolicy(input: ReplyInput, draft: ReplyOutput): ReplyOutput {
  const policy = checkReplyPolicy({
    replyText: draft.reply_text,
    context: input.context,
    sources: draft.sources,
    intent: input.intent.primary_intent,
    skillKey: input.skill.key,
    requestedActions: draft.suggested_actions,
  });
  const blocked = !policy.allowed;
  return {
    ...draft,
    policy,
    reply_text: blocked && policy.corrected_reply ? policy.corrected_reply : draft.reply_text,
    requires_human: draft.requires_human || policy.requires_human,
    suggested_actions: [...new Set([
      ...draft.suggested_actions,
      'review_before_send',
      ...(policy.requires_human ? ['create_handoff'] : []),
    ])],
    do_not_send_reason: blocked
      ? policy.violations.map((item) => item.code).join(', ')
      : draft.do_not_send_reason,
  };
}

export async function generateReplyDraft(
  input: ReplyInput,
  options: { orgId?: string; modelConfigId?: string; runId?: string } = {},
): Promise<ReplyOutput> {
  const fallback = deterministic(input);
  if (!options.orgId || !options.modelConfigId || !input.prompt?.content) {
    return { ...applyPolicy(input, fallback), runtime: { mode: 'deterministic', errorCode: 'MODEL_RUNTIME_NOT_CONFIGURED' } };
  }
  try {
    const rendered = renderer.render(input.prompt.content, {
      context: input.context,
      memory: input.customerMemory,
      intent: input.intent,
      emotion: input.emotion,
      knowledge: input.knowledgeResults,
      skill: input.skill,
      persona: input.persona ?? '',
      employeeTone: input.employeeTone ?? '',
      businessRules: input.businessRules ?? [],
    });
    const response = await aiClient.complete<ReplyOutput>({
      orgId: options.orgId,
      modelConfigId: options.modelConfigId,
      runId: options.runId,
      taskType: 'reply_draft',
      maxTokens: 700,
      temperature: .45,
      messages: [
        { role: 'system', content: `${rendered}\n\nSafety: draft only; no unconfirmed promise, discount, policy, payment or factual invention; do not repeat customer statements; ask clarification when missing; return Vietnamese JSON only.` },
        { role: 'user', content: JSON.stringify({ latestCustomerMessage: latestCustomerText(input.context), intent: input.intent, emotion: input.emotion, sources: sources(input.knowledgeResults), employeeTone: input.employeeTone, businessRules: input.businessRules }) },
      ],
      structuredOutput: {
        name: 'reply_draft',
        schema: { type: 'object', required: ['reply_text', 'alternative_replies', 'intent', 'tone', 'sources', 'confidence', 'assumptions', 'missing_information', 'suggested_actions', 'requires_human', 'do_not_send_reason'] },
        validate: valid,
      },
    });
    return {
      ...applyPolicy(input, enforce(response.structured ?? fallback, input)),
      runtime: {
        mode: 'model',
        provider: response.provider,
        model: response.model,
        usedFallback: response.usedFallback,
        latencyMs: response.usage.latencyMs,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costMicros: response.usage.costMicros.toString(),
      },
    };
  } catch (error) {
    return {
      ...applyPolicy(input, fallback),
      runtime: {
        mode: 'degraded',
        errorCode: error instanceof Error ? error.name.slice(0, 80) : 'MODEL_CALL_FAILED',
      },
    };
  }
}

function redactPreview(value: string) {
  return value
    .replace(/\b\d{9,12}\b/g, '[đã ẩn]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[đã ẩn]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

async function runtimeAgent(orgId: string, requestedAgentId?: string, requestedSkillId?: string) {
  const agent = await prisma.aiAgent.findFirst({
    where: {
      orgId,
      status: 'active',
      deletedAt: null,
      ...(requestedAgentId ? { id: requestedAgentId } : {}),
      ...(requestedSkillId ? { skills: { some: { skillId: requestedSkillId, isEnabled: true } } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      modelConfigId: true,
      promptVersionId: true,
      personaId: true,
      modelConfig: { select: { id: true, status: true } },
      promptVersion: { select: { id: true, version: true, status: true, contentEncrypted: true } },
      persona: { select: { previewRedacted: true } },
      skills: {
        where: { isEnabled: true },
        orderBy: { createdAt: 'asc' },
        select: { skill: { select: { id: true, key: true, name: true, riskTier: true, deletedAt: true } } },
      },
    },
  });
  if (!agent) throw new ReplyGeneratorError('Chưa có tác nhân AI đang hoạt động phù hợp.', 409, 'ACTIVE_AGENT_REQUIRED');
  const modelConfigId = agent.modelConfigId;
  if (!modelConfigId || !agent.modelConfig || !['active', 'approved'].includes(agent.modelConfig.status)) {
    throw new ReplyGeneratorError('Model của tác nhân AI chưa sẵn sàng.', 409, 'AGENT_MODEL_NOT_READY');
  }
  const promptVersion = agent.promptVersion;
  if (!promptVersion || promptVersion.status !== 'production') {
    throw new ReplyGeneratorError('Prompt Production của tác nhân AI chưa sẵn sàng.', 409, 'AGENT_PROMPT_NOT_READY');
  }
  const skill = agent.skills
    .map((link) => link.skill)
    .find((item) => item && !item.deletedAt && (!requestedSkillId || item.id === requestedSkillId));
  if (!skill) throw new ReplyGeneratorError('Tác nhân AI chưa có kỹ năng phù hợp.', 409, 'AGENT_SKILL_NOT_READY');
  return { ...agent, modelConfigId, promptVersion, skill };
}

export async function generateConversationReply(
  actor: ReplyActor,
  conversationId: string,
  request: {
    intent?: ReplyInput['intent'];
    emotion?: ReplyInput['emotion'];
    skillId?: string;
    agentId?: string;
    knowledgeQuery?: string;
    employeeTone?: ReplyStyle;
    businessRules?: string[];
  },
) {
  const [context, agent] = await Promise.all([
    buildConversationContext(actor, conversationId, { maxTokens: 3000 }),
    runtimeAgent(actor.orgId, request.agentId, request.skillId),
  ]);
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: actor.orgId },
    select: { contactId: true },
  });
  if (!conversation) throw new ReplyGeneratorError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');

  const skill = await getSkill(actor.orgId, agent.skill.id);
  const config = skill.config as SkillDefinition;
  const customerMessages = contextCustomerMessages(context);
  const latestText = customerMessages.at(-1) ?? '';
  const [memories, knowledge, inferredIntent, inferredEmotion] = await Promise.all([
    conversation.contactId ? listCustomerMemories(actor, conversation.contactId) : [],
    latestText
      ? searchKnowledge(actor, request.knowledgeQuery?.trim() || latestText, { limit: 5 }).then((result) => result.results)
      : [],
    !request.intent || request.intent.primary_intent === 'unknown' ? analyzeIntentText(latestText) : request.intent,
    !request.emotion || request.emotion.emotion === 'neutral' ? analyzeEmotionMessages(customerMessages) : request.emotion,
  ]);
  const prompt = {
    id: agent.promptVersion.id,
    version: agent.promptVersion.version,
    content: decryptToken(Buffer.from(agent.promptVersion.contentEncrypted).toString('utf8')),
  };
  const inputHash = createHash('sha256')
    .update(JSON.stringify({ conversationId, skillId: skill.id, intent: inferredIntent, emotion: inferredEmotion }))
    .digest('hex');
  const run = await prisma.aiRun.create({
    data: {
      orgId: actor.orgId,
      agentId: agent.id,
      requestedByUserId: actor.userId,
      taskType: 'reply_draft',
      status: 'running',
      riskTier: agent.skill.riskTier,
      conversationId,
      contactId: conversation.contactId,
      promptVersionId: prompt.id,
      modelConfigId: agent.modelConfigId,
      inputHash,
      contextManifest: {
        sourceIds: context.sources.map((source) => source.id),
        customerMessageCount: customerMessages.length,
        rawContentStored: false,
      },
      knowledgeRefs: knowledge.map((item: any) => item.citation).filter(Boolean).slice(0, 5),
    },
  });

  try {
    const input: ReplyInput = {
      context,
      customerMemory: memories as any[],
      intent: inferredIntent,
      emotion: inferredEmotion,
      knowledgeResults: knowledge,
      skill: { id: skill.id, key: skill.key, name: skill.name, config },
      persona: agent.persona?.previewRedacted ?? null,
      employeeTone: request.employeeTone,
      businessRules: request.businessRules?.slice(0, 20),
      prompt,
    };
    const output = await generateReplyDraft(input, {
      orgId: actor.orgId,
      modelConfigId: agent.modelConfigId,
      runId: run.id,
    });
    output.confidence_assessment = calculateConfidence({
      intentConfidence: input.intent.confidence,
      emotionConfidence: input.emotion.confidence,
      knowledgeResults: input.knowledgeResults,
      missingInformation: output.missing_information,
      skill: config,
      policy: output.policy ?? checkReplyPolicy({ replyText: output.reply_text, context, sources: output.sources, intent: input.intent.primary_intent, skillKey: skill.key }),
      actionSensitivity: config.approvalActions.length ? 'high' : config.riskTier,
      historicalEvaluation: await historicalEvaluationSignal(actor.orgId, skill.key),
    });
    const outputHash = createHash('sha256').update(output.reply_text).digest('hex');
    const status = output.runtime?.mode === 'model' ? 'completed' : 'degraded';
    const suggestion = await prisma.$transaction(async (tx) => {
      const saved = await tx.aiAssistantSuggestion.create({
        data: {
          orgId: actor.orgId,
          runId: run.id,
          conversationId,
          kind: 'reply_draft',
          status: 'pending',
          contentEncrypted: Buffer.from(encryptToken(output.reply_text), 'utf8'),
          contentRedacted: redactPreview(output.reply_text),
          contentHash: outputHash,
          payloadEncrypted: Buffer.from(encryptToken(JSON.stringify({ alternatives: output.alternative_replies, sources: output.sources })), 'utf8'),
          confidence: output.confidence_assessment?.overall_confidence ?? output.confidence,
        },
      });
      await tx.aiRun.update({
        where: { id: run.id },
        data: { status, outputHash, errorCode: output.runtime?.errorCode ?? null, completedAt: new Date() },
      });
      await tx.aiAuditLog.create({
        data: {
          orgId: actor.orgId,
          actorUserId: actor.userId,
          runId: run.id,
          conversationId,
          eventType: 'reply_draft.generated',
          outcome: status,
          targetType: 'ai_run',
          targetId: run.id,
          inputHash,
          outputHash,
          metadata: {
            agentId: agent.id,
            skillId: skill.id,
            promptVersionId: prompt.id,
            modelConfigId: agent.modelConfigId,
            sourceCount: output.sources.length,
            requiresHuman: output.requires_human,
            runtimeMode: output.runtime?.mode ?? 'unknown',
            rawContentStored: false,
          },
        },
      });
      return saved;
    });
    return {
      ...output,
      runId: run.id,
      suggestionId: suggestion.id,
      agent: { id: agent.id, name: agent.name },
    };
  } catch (error) {
    await prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorCode: error instanceof Error ? error.name.slice(0, 80) : 'REPLY_PIPELINE_FAILED',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export { ContextBuilderError, SkillFrameworkError };
