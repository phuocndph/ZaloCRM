import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { analyzeConversationEmotion, type EmotionOutput } from './emotion-engine-service.js';
import { analyzeConversationIntent, type IntentOutput } from './intent-engine-service.js';
import { buildConversationContext } from './conversation-context-builder-service.js';
import { analyzePreparedConversation } from './conversation-analysis-ai-service.js';
import { reconcileCustomerAutomation } from './customer-automation-orchestrator.js';
import {
  ContextBuilderError,
  proposeCustomerMemoriesFromConversation,
  refreshConversationSummary,
  type MemoryActor,
} from './conversation-memory-service.js';

export const AI_CONVERSATION_STAGES = [
  'needs_reply',
  'discovery',
  'qualified',
  'quoted',
  'negotiating',
  'payment_pending',
  'won',
  'post_sale',
  'cold',
  'do_not_contact',
  'human_required',
] as const;

export type AiConversationStage = typeof AI_CONVERSATION_STAGES[number];

export type ConversationAnalysisJobData = {
  orgId: string;
  conversationId: string;
  messageId: string;
  force?: boolean;
};

type RecommendationInput = {
  intent: IntentOutput;
  emotion: EmotionOutput;
  latestInboundText: string;
  recentConversationText?: string;
  currentTags?: string[];
  hasOutboundQuote: boolean;
  crmStatus: string | null;
  needsReply: boolean;
  verifiedPaymentObligation: boolean;
};

export type ShadowRecommendation = {
  stage: AiConversationStage;
  stageConfidence: number;
  stageReason: string;
  requiresHuman: boolean;
  nextAction: string;
  nextActionReason: string;
  recommendedWorkflowType: string | null;
  signals: Record<string, unknown>;
  safeguards: Record<string, unknown>;
};

const OPT_OUT_PATTERN = /\b(dung nhan|khong lien he|xoa so|bo theo doi)\b/i;
const QUOTE_PATTERN = /\b(bao gia|quotation|quote|gia la)\b|\b\d+[,.]?\d*\s*(tr|trieu|ty|vnd|vnd|d)\b/i;
const WON_STATUS_PATTERN = /\b(chot|won|thanh cong|da mua)\b/i;
const EXPLICIT_ORDER_PATTERN = /\b(?:cho|lay|dat|mua|chot)\b.{0,40}\b\d+(?:[.,]\d+)?\s*(?:cai|bo|chiec|san pham|sp|tam|met|m|kg|hop|goi|thung|chai|loc|cuon)\b|\b(?:chot|dat|mua|lay)\s+(?:don|hang)\b/i;

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .toLocaleLowerCase('vi-VN')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s.,/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function redactedReason(value: string) {
  return value.replace(/\b\d{9,12}\b/g, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function buildShadowRecommendation(input: RecommendationInput): ShadowRecommendation {
  const explicitOptOut = OPT_OUT_PATTERN.test(normalizeSearch(input.latestInboundText));
  const currentTags = (input.currentTags ?? []).map(normalizeSearch);
  const wonByCrm = (!!input.crmStatus && WON_STATUS_PATTERN.test(normalizeSearch(input.crmStatus)))
    || currentTags.some((tag) => WON_STATUS_PATTERN.test(tag));
  const orderEvidence = normalizeSearch([
    input.latestInboundText,
    input.recentConversationText ?? '',
  ].filter(Boolean).join('\n'));
  const explicitOrderConfirmed = EXPLICIT_ORDER_PATTERN.test(orderEvidence)
    && ['order_intent', 'follow_up_response'].includes(input.intent.primary_intent);
  const riskyIntent = ['complaint', 'return_or_refund', 'human_request'].includes(input.intent.primary_intent);
  const paymentNeedsVerification = input.intent.primary_intent === 'payment_inquiry' && !input.verifiedPaymentObligation;
  const confirmedBusinessProgress = wonByCrm || explicitOrderConfirmed;
  // Models often set requires_human for ordinary operational work such as
  // checking an image or completing an order. That should create a staff task,
  // not downgrade a confirmed sale into an escalation state.
  const modelHumanEscalation = input.intent.requires_human
    && !confirmedBusinessProgress
    && !paymentNeedsVerification;
  const hardEscalation = riskyIntent || input.emotion.escalation_required || modelHumanEscalation;
  const requiresHuman = hardEscalation || paymentNeedsVerification;

  let stage: AiConversationStage = 'needs_reply';
  let stageConfidence = Math.max(0.55, input.intent.confidence);
  let stageReason = 'Tin nhắn mới nhất của khách cần được xem xét trước khi chuyển sang giai đoạn tiếp theo.';

  if (explicitOptOut) {
    stage = 'do_not_contact';
    stageConfidence = 0.99;
    stageReason = 'Khách đã yêu cầu không tiếp tục liên hệ.';
  } else if (hardEscalation) {
    stage = 'human_required';
    stageConfidence = Math.max(input.intent.confidence, input.emotion.confidence, 0.8);
    stageReason = 'Hội thoại có khiếu nại, dấu hiệu cần xử lý khẩn hoặc yêu cầu gặp nhân viên.';
  } else if (wonByCrm) {
    stage = input.emotion.emotion === 'satisfied' ? 'post_sale' : 'won';
    stageConfidence = 0.9;
    stageReason = 'Trạng thái CRM đã xác nhận khách hàng đã chuyển đổi.';
  } else if (explicitOrderConfirmed) {
    stage = 'won';
    stageConfidence = Math.max(input.intent.confidence, 0.9);
    stageReason = 'Khách đã chốt sản phẩm và số lượng cụ thể; cần xác nhận thông tin đơn hàng.';
  } else if (input.intent.primary_intent === 'order_intent') {
    stage = 'qualified';
    stageReason = 'Khách đã thể hiện ý định mua hoặc đặt hàng cụ thể.';
  } else if (['quote_request', 'price_inquiry'].includes(input.intent.primary_intent)) {
    stage = input.hasOutboundQuote ? 'quoted' : 'discovery';
    stageReason = input.hasOutboundQuote
      ? 'Giá hoặc báo giá đã được trao đổi trong phần hội thoại có thể đọc.'
      : 'Khách đang hỏi giá nhưng chưa tìm thấy báo giá đã gửi để xác minh.';
  } else if (['discount_request', 'follow_up_response', 'payment_inquiry'].includes(input.intent.primary_intent)) {
    stage = 'negotiating';
    stageReason = paymentNeedsVerification
      ? 'Khách có nhắc đến thanh toán nhưng chưa có hóa đơn hoặc nghĩa vụ thanh toán được xác minh.'
      : 'Khách đang cân nhắc điều kiện hoặc tiếp tục trao đổi bán hàng.';
  } else if (['product_inquiry', 'product_comparison', 'shipping_inquiry', 'warranty_inquiry'].includes(input.intent.primary_intent)) {
    stage = 'discovery';
    stageReason = 'Khách vẫn đang tìm hiểu thông tin sản phẩm hoặc dịch vụ.';
  } else if (input.intent.primary_intent === 'not_interested') {
    stage = 'cold';
    stageReason = 'Khách hiện không quan tâm; mọi follow-up tự động phải tiếp tục bị chặn.';
  }

  let nextAction = input.needsReply ? 'reply_customer' : 'review_conversation';
  let nextActionReason = input.needsReply
    ? 'Nhân viên cần xem và trả lời tin nhắn mới nhất của khách.'
    : 'Cần rà lại phân tích trước khi thực hiện bất kỳ follow-up nào.';
  let recommendedWorkflowType: string | null = null;

  if (stage === 'do_not_contact') {
    nextAction = 'suppress_automation';
    nextActionReason = 'Không đưa khách vào workflow và không gửi follow-up tự động.';
  } else if (stage === 'human_required') {
    nextAction = 'assign_to_human';
    nextActionReason = 'Nhân viên phải xử lý hội thoại này trước khi cân nhắc bất kỳ tự động hóa nào.';
  } else if (paymentNeedsVerification) {
    nextAction = 'verify_payment_obligation';
    nextActionReason = 'Xác minh hóa đơn hoặc đơn hàng trước khi cân nhắc nhắc thanh toán.';
  } else if (explicitOrderConfirmed) {
    nextAction = 'confirm_order_details';
    nextActionReason = 'Kiểm tra quy cách, số lượng, thông tin giao nhận và tạo hoặc hoàn tất đơn hàng.';
  } else if (stage === 'qualified') {
    nextAction = 'prepare_quote';
    nextActionReason = 'Xác nhận thông tin còn thiếu và chuẩn bị báo giá để nhân viên duyệt.';
  } else if (stage === 'quoted') {
    nextAction = 'review_quote_follow_up';
    nextActionReason = 'Rà lại ngữ cảnh báo giá và quyết định thời điểm follow-up phù hợp.';
    recommendedWorkflowType = 'after_quote';
  } else if (stage === 'won' || stage === 'post_sale') {
    nextAction = 'review_post_sale_care';
    nextActionReason = 'Xác nhận việc giao hàng hoặc hoàn thành dịch vụ trước khi lên lịch chăm sóc sau bán.';
    recommendedWorkflowType = 'post_sale';
  }

  return {
    stage,
    stageConfidence: clamp(stageConfidence),
    stageReason,
    requiresHuman,
    nextAction,
    nextActionReason,
    recommendedWorkflowType,
    signals: {
      needsReply: input.needsReply,
      explicitOptOut,
      hasOutboundQuote: input.hasOutboundQuote,
      crmWonSignal: wonByCrm,
      explicitOrderConfirmed,
      customerNotInterested: input.intent.primary_intent === 'not_interested',
      verifiedPaymentObligation: input.verifiedPaymentObligation,
      paymentVerificationRequired: paymentNeedsVerification,
    },
    safeguards: {
      mode: 'automatic_followup',
      autoSendAllowed: !!recommendedWorkflowType && !requiresHuman && !explicitOptOut && !input.needsReply && !explicitOrderConfirmed,
      workflowEnrollmentAllowed: !!recommendedWorkflowType && !requiresHuman && !explicitOptOut && !input.needsReply && !explicitOrderConfirmed,
      autoTagMutationAllowed: true,
      crmStatusMutationAllowed: false,
      paymentReminderRequiresVerifiedObligation: true,
    },
  };
}

function parseSummary(summaryRedacted: string | null | undefined) {
  if (!summaryRedacted) return null;
  try {
    const value = JSON.parse(summaryRedacted) as Record<string, unknown>;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return { currentDiscussion: summaryRedacted };
  }
}

async function resolveActor(input: {
  orgId: string;
  owner: { id: string; role: string; isActive: boolean } | null;
}): Promise<MemoryActor | null> {
  const user = input.owner?.isActive
    ? input.owner
    : await prisma.user.findFirst({
        where: { orgId: input.orgId, isActive: true, role: { in: ['owner', 'admin'] } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, role: true, isActive: true },
      });
  return user ? { orgId: input.orgId, userId: user.id, role: user.role, privacyUnlocked: false } : null;
}

async function configuredRuntime(orgId: string) {
  const [config, agent] = await Promise.all([
    prisma.aiConfig.findUnique({
      where: { orgId },
      select: {
        enabled: true,
        defaultModelConfig: { select: { id: true, status: true, deletedAt: true } },
      },
    }),
    prisma.aiAgent.findFirst({
      where: {
        orgId,
        status: 'active',
        deletedAt: null,
        modelConfig: { status: { in: ['active', 'approved'] }, deletedAt: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, modelConfigId: true, promptVersionId: true },
    }),
  ]);
  if (!config?.enabled) return { enabled: false, agent: null, modelConfigId: null };
  const defaultModel = config.defaultModelConfig;
  const defaultReady = defaultModel && !defaultModel.deletedAt && ['active', 'approved'].includes(defaultModel.status);
  return {
    enabled: true,
    agent,
    modelConfigId: agent?.modelConfigId ?? (defaultReady ? defaultModel.id : null),
  };
}

async function latestSummary(conversationId: string) {
  return prisma.aiConversationSummary.findFirst({
    where: { conversationId, status: 'active' },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, summaryRedacted: true, sourceThroughMessageId: true },
  });
}

export async function processConversationAnalysis(data: ConversationAnalysisJobData) {
  const trigger = await prisma.message.findFirst({
    where: {
      id: data.messageId,
      conversationId: data.conversationId,
      senderType: { in: ['contact', 'self'] },
      isDeleted: false,
      conversation: { orgId: data.orgId, deletedAt: null },
    },
    select: {
      id: true,
      senderType: true,
      content: true,
      sentAt: true,
      conversation: {
        select: {
          id: true,
          orgId: true,
          contactId: true,
          threadType: true,
          isReplied: true,
          isPrivate: true,
          privateOwnerUserId: true,
          contact: { select: { status: true, statusRef: { select: { name: true } } } },
          zaloAccount: {
            select: {
              privacyMode: true,
              owner: { select: { id: true, role: true, isActive: true } },
            },
          },
        },
      },
    },
  });
  if (!trigger) return { skipped: true, reason: 'trigger_not_found' };
  const conversation = trigger.conversation;
  if (conversation.threadType !== 'user' || !conversation.contactId) {
    return { skipped: true, reason: 'unsupported_conversation' };
  }
  if (conversation.isPrivate || conversation.zaloAccount.privacyMode === 'main') {
    return { skipped: true, reason: 'private_conversation' };
  }

  const existing = await prisma.aiConversationInsight.findUnique({
    where: {
      conversationId_sourceThroughMessageId: {
        conversationId: conversation.id,
        sourceThroughMessageId: trigger.id,
      },
    },
    select: { id: true },
  });
  if (existing && !data.force) return { skipped: true, reason: 'already_analyzed', insightId: existing.id };

  const latestActivity = await prisma.message.findFirst({
    where: { conversationId: conversation.id, isDeleted: false, senderType: { in: ['contact', 'self'] } },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  if (latestActivity?.id !== trigger.id) return { skipped: true, reason: 'stale_trigger' };

  const actor = await resolveActor({ orgId: data.orgId, owner: conversation.zaloAccount.owner });
  if (!actor) return { skipped: true, reason: 'analysis_actor_unavailable' };
  const runtime = await configuredRuntime(data.orgId);
  if (!runtime.enabled) return { skipped: true, reason: 'ai_disabled' };
  if (!runtime.agent || !runtime.modelConfigId) return { skipped: true, reason: 'ai_runtime_not_ready' };

  const recentMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id, isDeleted: false },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    take: 30,
    select: { id: true, senderType: true, content: true, sentAt: true },
  });
  const hasOutboundQuote = recentMessages.some(
    (message) => message.senderType === 'self' && QUOTE_PATTERN.test(normalizeSearch(message.content ?? '')),
  );
  const inputHash = createHash('sha256')
    .update(JSON.stringify({ conversationId: conversation.id, triggerMessageId: trigger.id, latestSentAt: trigger.sentAt }))
    .digest('hex');

  const run = await prisma.aiRun.create({
        data: {
          orgId: data.orgId,
          agentId: runtime.agent.id,
          requestedByUserId: actor.userId,
          taskType: 'conversation_analysis',
          status: 'running',
          riskTier: 'low',
          conversationId: conversation.id,
          contactId: conversation.contactId,
          triggerMessageId: trigger.id,
          promptVersionId: runtime.agent.promptVersionId,
          modelConfigId: runtime.modelConfigId,
          inputHash,
          contextManifest: {
            mode: 'automatic_followup',
            sourceThroughMessageId: trigger.id,
            rawContentStored: false,
            autoSendAllowed: false,
          },
        },
        select: { id: true },
      });

  try {
    let modelFallback = false;
    const context = await buildConversationContext(actor, conversation.id, { maxTokens: 2600 });
    const combined = await analyzePreparedConversation({
      orgId: data.orgId,
      modelConfigId: runtime.modelConfigId,
      runId: run.id,
      context,
    }).catch((error) => {
      modelFallback = true;
      logger.warn(`[conversation-analysis] combined model fallback conversation=${conversation.id}: ${(error as Error).message}`);
      return null;
    });

    const summaryResult = await refreshConversationSummary(actor, conversation.id, {
      force: true,
      runId: run.id,
      maxTokens: 2600,
      context,
      preparedSummary: combined?.summary,
    });
    const [intentResult, emotionResult] = combined
      ? [{ output: combined.intent }, { output: combined.emotion }]
      : await Promise.all([
          analyzeConversationIntent(actor, conversation.id, { maxTokens: 1400, context }),
          analyzeConversationEmotion(actor, conversation.id, { maxTokens: 1600, context }),
        ]);
    const memories = await proposeCustomerMemoriesFromConversation(actor, conversation.id, {
      runId: run.id,
      maxTokens: 2600,
      context,
      preparedCandidates: combined?.memories,
    });

    const summary = 'summary' in summaryResult ? summaryResult.summary : await latestSummary(conversation.id);
    const summaryPayload = parseSummary(summary?.summaryRedacted);
    const latestInbound = recentMessages.find((message) => message.senderType === 'contact');
    const contextTags = (() => {
      const items = context?.sections?.find((section) => section.id === 'tags')?.items;
      if (!items || typeof items !== 'object' || Array.isArray(items)) return [];
      const values = (items as { tags?: unknown }).tags;
      return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
    })();
    const currentDiscussion = typeof summaryPayload?.currentDiscussion === 'string'
      ? summaryPayload.currentDiscussion
      : '';
    const recentConversationText = [
      currentDiscussion,
      ...recentMessages
        .filter((message) => message.senderType === 'contact' && message.content)
        .slice(0, 12)
        .map((message) => message.content ?? ''),
    ].filter(Boolean).join('\n');
    const recommendation = buildShadowRecommendation({
      intent: intentResult.output,
      emotion: emotionResult.output,
      latestInboundText: latestInbound?.content ?? '',
      recentConversationText,
      currentTags: contextTags,
      hasOutboundQuote,
      crmStatus: conversation.contact?.statusRef?.name ?? conversation.contact?.status ?? null,
      // `isReplied` is maintained by the chat writer. Re-checking the latest
      // activity makes an outbound staff reply immediately move the insight to
      // "waiting for customer", even when an echo arrives out of order.
      needsReply: trigger.senderType !== 'self' && !conversation.isReplied,
      verifiedPaymentObligation: false,
    });
    const outputHash = createHash('sha256')
      .update(JSON.stringify({ recommendation, intent: intentResult.output, emotion: emotionResult.output, summaryId: summary?.id ?? null }))
      .digest('hex');

    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.aiConversationInsight.findUnique({
        where: {
          conversationId_sourceThroughMessageId: {
            conversationId: conversation.id,
            sourceThroughMessageId: trigger.id,
          },
        },
        select: { id: true, version: true },
      });
      if (duplicate && !data.force) return { id: duplicate.id, duplicate: true };

      const latest = await tx.aiConversationInsight.findFirst({
        where: { conversationId: conversation.id },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        select: { version: true },
      });

      await Promise.all([
          tx.aiIntentAnalysis.create({
            data: {
              orgId: data.orgId,
              runId: run.id,
              conversationId: conversation.id,
              messageId: trigger.id,
              contactId: conversation.contactId,
              label: intentResult.output.primary_intent,
              confidence: clamp(intentResult.output.confidence),
              secondary: intentResult.output.secondary_intents as Prisma.InputJsonValue,
              reasonRedacted: redactedReason(intentResult.output.reason),
            },
          }),
          tx.aiEmotionAnalysis.create({
            data: {
              orgId: data.orgId,
              runId: run.id,
              conversationId: conversation.id,
              messageId: trigger.id,
              contactId: conversation.contactId,
              label: emotionResult.output.emotion,
              confidence: clamp(emotionResult.output.confidence),
              intensity: clamp(emotionResult.output.intensity),
              secondary: [],
              reasonRedacted: redactedReason(emotionResult.output.explanation),
            },
          }),
        ]);

      await tx.aiConversationInsight.updateMany({
        where: { conversationId: conversation.id, status: 'active' },
        data: { status: 'archived' },
      });
      const insightData = {
          orgId: data.orgId,
          runId: run.id,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          summaryId: summary?.id ?? null,
          sourceThroughMessageId: trigger.id,
          version: duplicate?.version ?? ((latest?.version ?? 0) + 1),
          status: 'active',
          mode: 'automatic_followup',
          stage: recommendation.stage,
          stageConfidence: recommendation.stageConfidence,
          stageReasonRedacted: recommendation.stageReason,
          intentLabel: intentResult.output.primary_intent,
          intentConfidence: clamp(intentResult.output.confidence),
          emotionLabel: emotionResult.output.emotion,
          emotionConfidence: clamp(emotionResult.output.confidence),
          emotionIntensity: clamp(emotionResult.output.intensity),
          requiresHuman: recommendation.requiresHuman,
          nextAction: recommendation.nextAction,
          nextActionReasonRedacted: recommendation.nextActionReason,
          recommendedWorkflowType: recommendation.recommendedWorkflowType,
          memoryCandidateIds: memories.candidates.map((item: { id: string }) => item.id),
          signals: {
            ...recommendation.signals,
            unansweredQuestionCount: Array.isArray(summaryPayload?.unansweredQuestions)
              ? summaryPayload.unansweredQuestions.length
              : 0,
            analysisModelFallback: modelFallback,
          } as Prisma.InputJsonValue,
          safeguards: recommendation.safeguards as Prisma.InputJsonValue,
          analysisHash: outputHash,
          generatedWithModel: !!runtime.modelConfigId && !modelFallback,
        };
      const insight = duplicate
        ? await tx.aiConversationInsight.update({
            where: { id: duplicate.id },
            data: { ...insightData, status: 'active' },
            select: { id: true, version: true, stage: true, nextAction: true, mode: true },
          })
        : await tx.aiConversationInsight.create({
            data: insightData,
            select: { id: true, version: true, stage: true, nextAction: true, mode: true },
          });

      await tx.aiRun.update({
        where: { id: run.id },
        data: { status: 'completed', outputHash, completedAt: new Date() },
      });
      await tx.aiAuditLog.create({
        data: {
          orgId: data.orgId,
          runId: run.id,
          actorUserId: actor.userId,
          conversationId: conversation.id,
          eventType: 'conversation_insight.generated',
          outcome: 'success',
          targetType: 'ai_conversation_insight',
          targetId: insight.id,
          inputHash,
          outputHash,
          metadata: {
            mode: 'automatic_followup',
            stage: insight.stage,
            nextAction: insight.nextAction,
            autoSendAllowed: recommendation.safeguards.autoSendAllowed,
            workflowEnrollmentAllowed: recommendation.safeguards.workflowEnrollmentAllowed,
          },
        },
      });
      return { ...insight, duplicate: !!duplicate, refreshed: !!duplicate && !!data.force };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const automation = await reconcileCustomerAutomation(created.id).catch((error) => {
      logger.error(`[customer-automation] reconcile failed insight=${created.id}: ${(error as Error).message}`);
      return { enabled: true, outcome: 'failed', reason: (error as Error).message };
    });
    return { skipped: false, insight: created, automation };
  } catch (error) {
    await prisma.aiRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorCode: 'CONVERSATION_ANALYSIS_FAILED', completedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}

export async function getLatestConversationInsight(actor: MemoryActor, conversationId: string) {
  const { buildConversationContext } = await import('./conversation-context-builder-service.js');
  await buildConversationContext(actor, conversationId, { maxTokens: 500, recentMessageLimit: 10 });
  const insight = await prisma.aiConversationInsight.findFirst({
    where: { orgId: actor.orgId, conversationId, status: 'active' },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      version: true,
      mode: true,
      stage: true,
      stageConfidence: true,
      stageReasonRedacted: true,
      intentLabel: true,
      intentConfidence: true,
      emotionLabel: true,
      emotionConfidence: true,
      emotionIntensity: true,
      requiresHuman: true,
      nextAction: true,
      nextActionReasonRedacted: true,
      recommendedWorkflowType: true,
      memoryCandidateIds: true,
      signals: true,
      safeguards: true,
      createdAt: true,
      updatedAt: true,
      summary: { select: { id: true, version: true, summaryRedacted: true, sourceThroughMessageId: true, createdAt: true } },
    },
  });
  if (!insight) return null;
  const [memories, automationAudit] = await Promise.all([
    insight.memoryCandidateIds.length
      ? prisma.aiCustomerMemory.findMany({
        where: { orgId: actor.orgId, id: { in: insight.memoryCandidateIds }, deletedAt: null },
        select: { id: true, key: true, valueRedacted: true, status: true, confidence: true, updatedAt: true },
      })
      : Promise.resolve([]),
    prisma.aiAuditLog.findFirst({
      where: {
        orgId: actor.orgId,
        eventType: 'customer_automation.reconciled',
        targetType: 'ai_conversation_insight',
        targetId: insight.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { outcome: true, metadata: true, createdAt: true },
    }),
  ]);
  return {
    id: insight.id,
    version: insight.version,
    mode: insight.mode,
    stage: insight.stage,
    stageConfidence: insight.stageConfidence,
    stageReason: insight.stageReasonRedacted,
    intent: { label: insight.intentLabel, confidence: insight.intentConfidence },
    emotion: {
      label: insight.emotionLabel,
      confidence: insight.emotionConfidence,
      intensity: insight.emotionIntensity,
    },
    requiresHuman: insight.requiresHuman,
    nextAction: {
      key: insight.nextAction,
      reason: insight.nextActionReasonRedacted,
      workflowType: insight.recommendedWorkflowType,
    },
    signals: insight.signals,
    safeguards: insight.safeguards,
    automation: automationAudit ? {
      outcome: automationAudit.outcome,
      ...(automationAudit.metadata && typeof automationAudit.metadata === 'object' && !Array.isArray(automationAudit.metadata)
        ? automationAudit.metadata as Record<string, unknown>
        : {}),
      updatedAt: automationAudit.createdAt,
    } : null,
    summary: insight.summary ? { ...insight.summary, content: parseSummary(insight.summary.summaryRedacted), summaryRedacted: undefined } : null,
    memoryCandidates: memories,
    createdAt: insight.createdAt,
    updatedAt: insight.updatedAt,
  };
}

export { ContextBuilderError };
