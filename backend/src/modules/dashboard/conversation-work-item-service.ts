import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { getIo } from '../../shared/event-buffer.js';
import {
  canSeeConversationContent,
  isConversationPrivateFor,
  type PrivacyContext,
} from '../privacy/redact.js';
import {
  assessCounterpartyHeuristically,
  normalizeCounterpartyAssessment,
  shouldCreateSalesWorkItem,
  type CounterpartyAssessment,
} from '../ai/counterparty-role.js';
import { isZaloFriendAcceptedNotification } from '../zalo/zalo-friend-accepted-notification.js';

export type WorkItemScope = 'now' | 'today' | 'waiting' | 'upcoming' | 'verify' | 'done' | 'all';

export type WorkItemSummary = {
  totalActive: number;
  critical: number;
  overdue: number;
  waitingReply: number;
  verification: number;
};

type Signal = {
  key: string;
  kind: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  priorityScore: number;
  title: string;
  customerSituation: string | null;
  nextAction: string;
  reason: string | null;
  dueAt: Date | null;
  eventAt: Date | null;
  conversationId: string | null;
  zaloAccountId: string | null;
  contextVersion: number | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
};

type ContactBucket = {
  contactId: string;
  assignedUserId: string | null;
  contactName: string;
  contactAvatar: string | null;
  signals: Signal[];
  nickNames: Set<string>;
  conversationIds: Set<string>;
  unreadCount: number;
};

export function emitConversationWorkItemsUpdated(args: {
  orgId: string;
  conversationId?: string | null;
  itemId?: string | null;
}) {
  getIo()?.to(`org:${args.orgId}`).emit('work-items:updated', {
    conversationId: args.conversationId ?? undefined,
    itemId: args.itemId ?? undefined,
    at: new Date().toISOString(),
  });
}

const ACTIVE_STAGES = new Set(['qualified', 'quoted', 'negotiating', 'payment_pending']);
const PRIORITY_ORDER = { critical: 4, high: 3, normal: 2, low: 1 } as const;
const ACTION_LABELS: Record<string, string> = {
  reply_customer: 'Trả lời khách hàng',
  review_conversation: 'Rà lại cuộc hội thoại',
  suppress_automation: 'Dừng follow-up tự động và kiểm tra yêu cầu của khách',
  assign_to_human: 'Ưu tiên nhân viên xử lý trực tiếp',
  verify_payment_obligation: 'Xác minh đơn hàng hoặc công nợ',
  confirm_order_details: 'Xác nhận thông tin và lên đơn',
  prepare_quote: 'Hoàn thiện thông tin và chuẩn bị báo giá',
  review_quote_follow_up: 'Follow-up báo giá',
  review_post_sale_care: 'Chăm sóc sau bán',
  clarify_latest_message: 'Xác nhận nội dung tin nhắn mới',
};
const RECONCILIATION_TTL_MS = 3_000;
const reconciliationCache = new Map<string, number>();
const reconciliationInFlight = new Map<string, Promise<unknown>>();

function reconciliationCacheKey(input: { orgId: string; assigneeUserId: string; privacy: PrivacyContext }) {
  return [input.orgId, input.assigneeUserId, input.privacy.viewerUserId ?? 'anonymous', input.privacy.privacyUnlocked ? 'unlocked' : 'locked'].join(':');
}

function invalidateReconciliationCache(orgId: string, assigneeUserId: string) {
  const prefix = `${orgId}:${assigneeUserId}:`;
  for (const key of reconciliationCache.keys()) if (key.startsWith(prefix)) reconciliationCache.delete(key);
}

function normalizeText(value: unknown, max = 1200) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : '';
}

function jsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function parseSummary(summaryRedacted: string | null | undefined) {
  if (!summaryRedacted) return {} as Record<string, any>;
  try {
    return jsonObject(JSON.parse(summaryRedacted));
  } catch {
    return { currentDiscussion: normalizeText(summaryRedacted) };
  }
}

function fingerprint(parts: string[]) {
  return createHash('sha256').update(parts.sort().join('|')).digest('hex');
}

function bucketFor(map: Map<string, ContactBucket>, contact: any) {
  let bucket = map.get(contact.id);
  if (!bucket) {
    bucket = {
      contactId: contact.id,
      assignedUserId: contact.assignedUserId ?? null,
      contactName: normalizeText(contact.crmName || contact.fullName || 'Khách hàng', 180),
      contactAvatar: contact.avatarUrl ?? null,
      signals: [],
      nickNames: new Set<string>(),
      conversationIds: new Set<string>(),
      unreadCount: 0,
    };
    map.set(contact.id, bucket);
  }
  return bucket;
}

function addSignal(bucket: ContactBucket, signal: Signal, nickName?: string | null) {
  bucket.signals.push(signal);
  if (nickName?.trim()) bucket.nickNames.add(nickName.trim());
  if (signal.conversationId) bucket.conversationIds.add(signal.conversationId);
}

function latestMessage(conversation: any) {
  return Array.isArray(conversation.messages)
    ? conversation.messages.find((message: any) => message?.isDeleted !== true) ?? null
    : null;
}

function activeInsight(conversation: any) {
  return Array.isArray(conversation.aiInsights) ? conversation.aiInsights[0] ?? null : null;
}

function insightCounterparty(insight: any | null): CounterpartyAssessment | null {
  const signals = jsonObject(insight?.signals);
  return normalizeCounterpartyAssessment({
    role: signals.counterpartyRole,
    confidence: signals.counterpartyConfidence,
    reason: signals.counterpartyReason,
  });
}

export function isVerificationCandidate(conversation: any, canReadContent: boolean) {
  if (!canReadContent) return false;
  const latest = latestMessage(conversation);
  if (!latest || latest.senderType !== 'contact') return false;
  // Zalo emits the accepted-friend e-card as a media/system message. It is an
  // account event, not a customer request and must never create a work item.
  if (isZaloFriendAcceptedNotification(latest.content)) return false;
  const insight = activeInsight(conversation);
  const insightMatchesLatest = !insight?.sourceThroughMessageId || !latest.id || insight.sourceThroughMessageId === latest.id;
  const assessment = insightMatchesLatest ? insightCounterparty(insight) : null;
  if (assessment) return assessment.role === 'unknown' && assessment.confidence >= 0.6;
  const text = normalizeText(latest.content, 160);
  if (latest.contentType && latest.contentType !== 'text') return true;
  return text.length >= 20 && !/^(?:xin chao|chao|hello|alo|ok|da|vang|cam on)[.!\s]*$/iu.test(text);
}

function verificationSignal(conversation: any, redacted: boolean): Signal {
  const latest = latestMessage(conversation);
  const preview = redacted
    ? 'Nội dung thuộc phạm vi riêng tư.'
    : latest?.contentType && latest.contentType !== 'text'
      ? `Khách vừa gửi ${latest.contentType}.`
    : normalizeText(latest?.content, 260) || 'Người liên hệ chưa nêu rõ nhu cầu.';
  return {
    key: `verify:${latest?.id ?? conversation.id}`,
    kind: 'verification',
    priority: 'normal',
    priorityScore: 60,
    title: 'Xác minh người liên hệ',
    customerSituation: preview,
    nextAction: 'Mở hội thoại và xác minh đây có phải khách hàng cần hỗ trợ không.',
    reason: 'Chưa đủ dữ kiện để phân loại là khách mua hàng, nhà cung cấp hay đối tượng khác.',
    dueAt: conversation.lastMessageAt ?? new Date(),
    eventAt: conversation.lastMessageAt,
    conversationId: conversation.id,
    zaloAccountId: conversation.zaloAccountId,
    contextVersion: activeInsight(conversation)?.version ?? null,
    confidence: insightCounterparty(activeInsight(conversation))?.confidence ?? null,
    metadata: {
      verification: true,
      counterpartyRole: 'unknown',
      actionKey: 'verify_customer_identity',
      unreadCount: conversation.unreadCount,
    },
  };
}

export function isConversationEligibleForSalesWork(conversation: any, canReadContent = true) {
  const insight = activeInsight(conversation);
  const rawMessages = Array.isArray(conversation.messages)
    ? conversation.messages.filter((message: any) => message?.isDeleted !== true)
    : [];
  const latest = rawMessages[0] ?? null;
  // A work item represents an action triggered by a new inbound message. A
  // staff/system message must close or wait for the next inbound event rather
  // than revive an older AI recommendation.
  if (!latest || latest.senderType !== 'contact') return false;
  const insightMatchesLatest = !insight?.sourceThroughMessageId || !latest?.id || insight.sourceThroughMessageId === latest.id;
  const messages = canReadContent
    ? rawMessages.map((message: any) => ({ senderType: message.senderType, content: message.content }))
    : [];
  let assessment = insightMatchesLatest ? insightCounterparty(insight) : null;
  let evidenceMessages = messages;
  if (!insightMatchesLatest) {
    if (latest?.senderType === 'self') return false;
    // Do not reuse a customer/order assessment for a newer image, file, or
    // empty payload. The model has not interpreted this message yet; route it
    // to verification so staff can inspect the actual attachment.
    if (latest?.senderType === 'contact'
      && (latest.contentType && latest.contentType !== 'text' || !String(latest.content ?? '').trim())) {
      return false;
    }
    const insightMessageIndex = rawMessages.findIndex((message: any) => message.id === insight?.sourceThroughMessageId);
    const newerMessages = insightMessageIndex >= 0 ? rawMessages.slice(0, insightMessageIndex) : rawMessages;
    const newerInbound = canReadContent
      ? newerMessages
          .filter((message: any) => message.senderType === 'contact')
          .map((message: any) => ({ senderType: message.senderType, content: message.content }))
      : [];
    const newerAssessment = assessCounterpartyHeuristically(newerInbound);
    // A stale insight is never evidence for the newest message. If the new
    // text cannot be classified yet, leave it out until the analysis worker
    // catches up (verification handles explicit media/unclear messages).
    assessment = newerAssessment.role === 'unknown' ? null : newerAssessment;
    evidenceMessages = newerInbound;
  }
  return shouldCreateSalesWorkItem({
    assessment,
    messages: evidenceMessages,
    intent: insightMatchesLatest ? insight?.intentLabel : null,
    stage: insightMatchesLatest ? insight?.stage : null,
  });
}

export function deriveConversationSignal(input: {
  unreadCount: number;
  lastMessageAt: Date | null;
  messagePreview: string;
  redacted: boolean;
  insight: any | null;
  conversationId: string;
  zaloAccountId: string;
  latestMessageId: string | null;
}): Signal {
  const insight = input.insight;
  const summary = parseSummary(insight?.summary?.summaryRedacted);
  const counterparty = insightCounterparty(insight);
  const intent = String(insight?.intentLabel ?? '');
  const stage = String(insight?.stage ?? 'needs_reply');
  const requiresHuman = !!insight?.requiresHuman;
  const urgentIntent = ['complaint', 'return_or_refund', 'human_request'].includes(intent);
  const commercialIntent = ['order_intent', 'payment_inquiry'].includes(intent) || ['qualified', 'negotiating', 'payment_pending'].includes(stage);
  const ageMs = input.lastMessageAt ? Date.now() - input.lastMessageAt.getTime() : 0;
  const priority = requiresHuman || urgentIntent ? 'critical' : commercialIntent || ageMs >= 60 * 60 * 1000 ? 'high' : 'normal';
  const priorityScore = priority === 'critical'
    ? 100
    : priority === 'high'
      ? Math.min(95, 82 + Math.floor(ageMs / (4 * 60 * 60 * 1000)))
      : Math.min(79, 65 + Math.floor(ageMs / (8 * 60 * 60 * 1000)));
  const actionKey = String(insight?.nextAction ?? 'reply_customer');
  const discussion = input.redacted
    ? 'Nội dung thuộc phạm vi riêng tư.'
    : normalizeText(summary.currentDiscussion || input.messagePreview || 'Khách vừa gửi tin nhắn mới.', 320);

  return {
    key: `reply:${input.latestMessageId ?? input.lastMessageAt?.toISOString() ?? input.conversationId}`,
    kind: requiresHuman ? 'human_required' : 'reply',
    priority,
    priorityScore,
    title: ACTION_LABELS[actionKey] ?? 'Trả lời khách hàng',
    customerSituation: discussion || null,
    nextAction: ACTION_LABELS[actionKey] ?? 'Đọc tin nhắn mới và trả lời khách hàng.',
    reason: normalizeText(insight?.nextActionReasonRedacted || insight?.stageReasonRedacted || 'Khách đang chờ nhân viên phản hồi.') || null,
    dueAt: input.lastMessageAt ?? new Date(),
    eventAt: input.lastMessageAt,
    conversationId: input.conversationId,
    zaloAccountId: input.zaloAccountId,
    contextVersion: insight?.version ?? null,
    confidence: insight?.stageConfidence ?? null,
    metadata: {
      unreadCount: input.unreadCount,
      stage,
      intent: insight?.intentLabel ?? null,
      emotion: insight?.emotionLabel ?? null,
      requiresHuman,
      redacted: input.redacted,
      unansweredQuestions: Array.isArray(summary.unansweredQuestions) ? summary.unansweredQuestions.slice(0, 4) : [],
      counterpartyRole: counterparty?.role ?? null,
      counterpartyConfidence: counterparty?.confidence ?? null,
      actionKey,
    },
  };
}

function timezoneOffsetMinutes(timezone: string) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (!match) return 420;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

export function appointmentDueAt(appointmentDate: Date, appointmentTime?: string | null, timezone = '+07:00') {
  const match = String(appointmentTime ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return new Date(appointmentDate);
  const offsetMinutes = timezoneOffsetMinutes(timezone);
  const localDate = new Date(appointmentDate.getTime() + offsetMinutes * 60_000);
  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    hours,
    minutes,
  ) - offsetMinutes * 60_000);
}

function appointmentSignal(appointment: any, conversation: any | null, now: Date, timezone: string): Signal {
  const dueAt = appointmentDueAt(appointment.appointmentDate as Date, appointment.appointmentTime, timezone);
  const overdue = appointment.status === 'overdue' || dueAt.getTime() < now.getTime();
  return {
    key: `appointment:${appointment.id}:${appointment.status}:${dueAt.toISOString()}:${appointment.appointmentTime ?? ''}`,
    kind: 'appointment',
    priority: overdue ? 'high' : 'normal',
    priorityScore: overdue ? 90 : 68,
    title: overdue ? 'Xử lý lịch hẹn quá hạn' : 'Thực hiện lịch hẹn',
    customerSituation: normalizeText(appointment.notes || appointment.title || 'Đã có lịch hẹn với khách hàng.') || null,
    nextAction: appointment.type === 'call' ? 'Gọi cho khách theo lịch hẹn.' : 'Liên hệ khách theo nội dung lịch hẹn.',
    reason: overdue ? 'Lịch hẹn đã đến hạn nhưng chưa có kết quả cuối.' : 'Lịch hẹn cần được thực hiện đúng thời gian đã đặt.',
    dueAt,
    eventAt: dueAt,
    conversationId: conversation?.id ?? null,
    zaloAccountId: conversation?.zaloAccountId ?? null,
    contextVersion: null,
    confidence: null,
    metadata: {
      appointmentId: appointment.id,
      appointmentTime: appointment.appointmentTime,
      appointmentType: appointment.type,
      appointmentTitle: appointment.title,
      overdue,
    },
  };
}

function followupSignal(enrollment: any, conversation: any | null): Signal {
  return {
    key: `followup:${enrollment.id}:${enrollment.currentStepKey ?? ''}:${enrollment.messagesSent}:${enrollment.saleTaskTitle ?? ''}`,
    kind: 'followup_sale',
    priority: 'high',
    priorityScore: 84,
    title: enrollment.saleTaskTitle || 'Xử lý công việc follow-up',
    customerSituation: `Workflow “${enrollment.workflow?.name || 'Follow-up'}” đang chờ nhân viên xử lý.`,
    nextAction: enrollment.saleTaskTitle || 'Mở hội thoại, xử lý khách và hoàn thành bước dành cho Sale.',
    reason: 'Workflow đang tạm dừng tại bước cần nhân viên thực hiện.',
    dueAt: new Date(),
    eventAt: enrollment.updatedAt,
    conversationId: conversation?.id ?? null,
    zaloAccountId: enrollment.zaloAccountId,
    contextVersion: null,
    confidence: null,
    metadata: {
      enrollmentId: enrollment.id,
      workflowId: enrollment.workflowId,
      workflowName: enrollment.workflow?.name ?? null,
      currentStepKey: enrollment.currentStepKey,
    },
  };
}

function aiNextSignal(conversation: any, insight: any, redacted: boolean): Signal | null {
  const actionKey = String(insight?.nextAction ?? 'review_conversation');
  if (['reply_customer', 'review_conversation', 'suppress_automation'].includes(actionKey)) return null;
  const latest = latestMessage(conversation);
  // Once staff has replied, do not keep an old AI order/post-sale suggestion
  // in the urgent queue. A future inbound message will create a fresh insight.
  if (latest?.senderType === 'self' && ['confirm_order_details', 'review_post_sale_care', 'review_quote_follow_up'].includes(actionKey)) return null;
  const summary = parseSummary(insight?.summary?.summaryRedacted);
  const critical = !!insight?.requiresHuman || actionKey === 'assign_to_human';
  const payment = actionKey === 'verify_payment_obligation';
  const priorityScore = critical ? 98 : payment ? 92 : actionKey === 'confirm_order_details' ? 90 : ['prepare_quote', 'review_quote_follow_up'].includes(actionKey) ? 82 : 70;
  return {
    key: `ai:${insight.version}:${actionKey}:${insight.stage}`,
    kind: critical ? 'human_required' : 'ai_next_action',
    priority: critical ? 'critical' : priorityScore >= 80 ? 'high' : 'normal',
    priorityScore,
    title: ACTION_LABELS[actionKey] ?? 'Xử lý đề xuất từ phân tích hội thoại',
    customerSituation: redacted
      ? 'Nội dung thuộc phạm vi riêng tư.'
      : normalizeText(summary.currentDiscussion || insight.stageReasonRedacted || 'AI đã phát hiện một bước cần nhân viên xử lý.', 320) || null,
    nextAction: ACTION_LABELS[actionKey] ?? 'Mở hội thoại và rà lại đề xuất của AI.',
    reason: normalizeText(insight.nextActionReasonRedacted || insight.stageReasonRedacted) || null,
    dueAt: conversation.lastMessageAt ?? new Date(),
    eventAt: conversation.lastMessageAt,
    conversationId: conversation.id,
    zaloAccountId: conversation.zaloAccountId,
    contextVersion: insight.version ?? null,
    confidence: insight.stageConfidence ?? null,
    metadata: {
      stage: insight.stage,
      intent: insight.intentLabel,
      emotion: insight.emotionLabel,
      requiresHuman: !!insight.requiresHuman,
      redacted,
      actionKey,
    },
  };
}

function dormantSignal(conversation: any, insight: any | null, redacted: boolean): Signal {
  const stage = String(insight?.stage ?? '');
  const summary = parseSummary(insight?.summary?.summaryRedacted);
  const actionKey = String(insight?.nextAction ?? (stage === 'quoted' ? 'review_quote_follow_up' : 'review_conversation'));
  const days = stage === 'payment_pending' ? 1 : ['qualified', 'quoted', 'negotiating'].includes(stage) ? 2 : 7;
  const dueAt = new Date((conversation.lastMessageAt as Date).getTime() + days * 86400000);
  return {
    key: `dormant:${conversation.lastMessageAt.toISOString()}`,
    kind: 'follow_up',
    priority: ACTIVE_STAGES.has(stage) ? 'high' : 'low',
    priorityScore: ACTIVE_STAGES.has(stage) ? 78 : 42,
    title: ACTION_LABELS[actionKey] ?? 'Chăm sóc lại khách hàng',
    customerSituation: redacted
      ? 'Nội dung thuộc phạm vi riêng tư.'
      : normalizeText(summary.currentDiscussion || 'Khách tiềm năng đã lâu chưa có tương tác.', 320) || null,
    nextAction: ACTION_LABELS[actionKey] ?? 'Xem lại trao đổi gần nhất và quyết định nội dung follow-up.',
    reason: normalizeText(insight?.nextActionReasonRedacted || 'Khách có mức ưu tiên cao nhưng đã lâu chưa tương tác.') || null,
    dueAt,
    eventAt: conversation.lastMessageAt,
    conversationId: conversation.id,
    zaloAccountId: conversation.zaloAccountId,
    contextVersion: insight?.version ?? null,
    confidence: insight?.stageConfidence ?? null,
    metadata: { stage: stage || null, redacted, dormantDays: Math.max(1, Math.floor((Date.now() - conversation.lastMessageAt.getTime()) / 86400000)) },
  };
}

function choosePrimary(signals: Signal[]) {
  return [...signals].sort((a, b) => {
    const score = b.priorityScore - a.priorityScore;
    if (score) return score;
    const dueA = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const dueB = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return dueA - dueB;
  })[0];
}

function buildCandidate(bucket: ContactBucket, orgId: string, assigneeUserId: string) {
  const primary = choosePrimary(bucket.signals);
  const dueTimes = bucket.signals.map((signal) => signal.dueAt?.getTime()).filter((value): value is number => Number.isFinite(value));
  const eventTimes = bucket.signals.map((signal) => signal.eventAt?.getTime()).filter((value): value is number => Number.isFinite(value));
  const signalMetadata = bucket.signals
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .map((signal) => ({
      key: signal.key,
      kind: signal.kind,
      title: signal.title,
      priority: signal.priority,
      dueAt: signal.dueAt?.toISOString() ?? null,
      metadata: signal.metadata,
    }));
  return {
    orgId,
    contactId: bucket.contactId,
    conversationId: primary.conversationId,
    zaloAccountId: primary.zaloAccountId,
    assigneeUserId,
    sourceType: 'contact',
    sourceId: bucket.contactId,
    kind: primary.kind,
    priority: primary.priority,
    priorityScore: primary.priorityScore,
    title: primary.title,
    customerSituation: primary.customerSituation,
    nextAction: primary.nextAction,
    reason: primary.reason,
    dueAt: dueTimes.length ? new Date(Math.min(...dueTimes)) : null,
    sourceEventAt: eventTimes.length ? new Date(Math.max(...eventTimes)) : null,
    fingerprint: fingerprint(bucket.signals.map((signal) => signal.key)),
    contextVersion: primary.contextVersion,
    confidence: primary.confidence,
    metadata: {
      contactName: bucket.contactName,
      contactAvatar: bucket.contactAvatar,
      nickNames: [...bucket.nickNames],
      conversationIds: [...bucket.conversationIds],
      unreadCount: bucket.unreadCount,
      signalCount: bucket.signals.length,
      actionKey: (primary.metadata as { actionKey?: string }).actionKey ?? null,
      signals: signalMetadata,
    } as Prisma.InputJsonValue,
  };
}

function buildGroupCandidate(conversation: any, orgId: string, assigneeUserId: string) {
  const insight = activeInsight(conversation);
  const signals = jsonObject(insight?.signals);
  if (signals.groupActionable !== true) return null;
  const senderName = normalizeText(signals.actionableSenderName || 'Thành viên trong nhóm', 180);
  const request = normalizeText(signals.actionableRequest || insight?.summary?.summaryRedacted || '', 320);
  const requiredAction = normalizeText(signals.requiredEmployeeAction || insight?.nextActionReasonRedacted || '', 260);
  const urgent = !!insight?.requiresHuman || ['complaint', 'return_or_refund', 'human_request'].includes(String(insight?.intentLabel ?? ''));
  const commercial = ['order_intent', 'payment_inquiry'].includes(String(insight?.intentLabel ?? ''))
    || ['qualified', 'negotiating', 'payment_pending', 'won'].includes(String(insight?.stage ?? ''));
  const priority = urgent ? 'critical' : commercial ? 'high' : 'normal';
  const priorityScore = urgent ? 98 : commercial ? 86 : 68;
  const groupName = normalizeText(conversation.groupName || conversation.contact?.fullName || 'Nhóm Zalo', 180);
  const evidenceMessageId = normalizeText(signals.actionableMessageId, 120) || null;
  return {
    orgId,
    contactId: conversation.contactId,
    conversationId: conversation.id,
    zaloAccountId: conversation.zaloAccountId,
    assigneeUserId,
    sourceType: 'group_conversation',
    sourceId: conversation.id,
    kind: urgent ? 'group_human_required' : 'group_reply',
    priority,
    priorityScore,
    title: `Xử lý yêu cầu của ${senderName}`,
    customerSituation: request || `${senderName} đang có yêu cầu cần xử lý trong nhóm ${groupName}.`,
    nextAction: requiredAction || `Mở nhóm ${groupName}, đọc tin của ${senderName} và phản hồi đúng nội dung đang chờ.`,
    reason: normalizeText(insight?.nextActionReasonRedacted || insight?.stageReasonRedacted || 'AI đã xác định một thành viên có yêu cầu kinh doanh rõ ràng.', 900) || null,
    dueAt: conversation.lastMessageAt ?? new Date(),
    sourceEventAt: conversation.lastMessageAt,
    fingerprint: fingerprint([
      `group:${conversation.id}`,
      `version:${insight?.version ?? 0}`,
      `evidence:${evidenceMessageId ?? ''}`,
      `action:${requiredAction}`,
    ]),
    contextVersion: insight?.version ?? null,
    confidence: insight?.stageConfidence ?? null,
    metadata: {
      isGroup: true,
      contactName: groupName,
      contactAvatar: conversation.groupAvatarUrl ?? null,
      groupName,
      groupCategory: conversation.groupCategory,
      actionableSenderUid: signals.actionableSenderUid ?? null,
      actionableSenderName: senderName,
      actionableMessageId: evidenceMessageId,
      actionableRequest: request || null,
      requiredEmployeeAction: requiredAction || null,
      nickNames: [conversation.zaloAccount?.displayName].filter(Boolean),
      conversationIds: [conversation.id],
      unreadCount: conversation.unreadCount,
      signalCount: 1,
      safeguards: insight?.safeguards ?? {},
    } as Prisma.InputJsonValue,
  };
}

function appointmentWindowEnd(now: Date, timezone: string) {
  const offsetMinutes = timezoneOffsetMinutes(timezone);
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  return new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 2,
  ) - offsetMinutes * 60_000);
}

function todayEndVN(now = new Date()) {
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const nextDayVN = Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + 1);
  return new Date(nextDayVN - vnOffset);
}

export async function collectAllPages<T extends { id: string }>(
  pageSize: number,
  fetchPage: (cursorId?: string) => Promise<T[]>,
) {
  const rows: T[] = [];
  let cursorId: string | undefined;
  while (true) {
    const page = await fetchPage(cursorId);
    rows.push(...page);
    if (page.length < pageSize) break;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursorId) break;
    cursorId = nextCursor;
  }
  return rows;
}

export async function reconcileConversationWorkItems(input: {
  orgId: string;
  assigneeUserId: string;
  privacy: PrivacyContext;
}) {
  const now = new Date();
  const [accountRows, organization] = await Promise.all([
    prisma.zaloAccount.findMany({
      where: {
        orgId: input.orgId,
        archivedAt: null,
        OR: [
          { ownerUserId: input.assigneeUserId },
          { access: { some: { userId: input.assigneeUserId, permission: { in: ['read', 'chat', 'admin'] } } } },
        ],
      },
      select: { id: true, ownerUserId: true },
    }),
    prisma.organization.findUnique({ where: { id: input.orgId }, select: { timezone: true } }),
  ]);
  const accountIds = accountRows.map((row) => row.id);
  const ownerAccountIds = new Set(accountRows.filter((row) => row.ownerUserId === input.assigneeUserId).map((row) => row.id));
  const timezone = organization?.timezone || '+07:00';
  const buckets = new Map<string, ContactBucket>();
  const conversationSelect = {
    id: true,
    contactId: true,
    zaloAccountId: true,
    lastMessageAt: true,
    unreadCount: true,
    isReplied: true,
    isPrivate: true,
    privateOwnerUserId: true,
    contact: {
      select: {
        id: true, fullName: true, crmName: true, avatarUrl: true, priorityScore: true, status: true, assignedUserId: true,
        statusRef: { select: { isTerminal: true } },
      },
    },
    zaloAccount: { select: { id: true, displayName: true, privacyMode: true, ownerUserId: true } },
    messages: {
      where: { isDeleted: false },
      take: 12,
      orderBy: [{ zaloMsgIdNum: { sort: 'desc' as const, nulls: 'last' as const } }, { sentAt: 'desc' as const }],
      select: { id: true, content: true, contentType: true, isDeleted: true, sentAt: true, senderType: true, senderUid: true, senderName: true },
    },
    aiInsights: {
      where: { status: 'active' },
      take: 1,
      orderBy: [{ version: 'desc' as const }, { createdAt: 'desc' as const }],
      select: {
        version: true, sourceThroughMessageId: true, stage: true, stageConfidence: true, stageReasonRedacted: true,
        intentLabel: true, emotionLabel: true, requiresHuman: true, nextAction: true,
        nextActionReasonRedacted: true, signals: true, safeguards: true,
        summary: { select: { summaryRedacted: true } },
      },
    },
  };

  const [unreplied, aiConversations, dormant, appointments, followups, monitoredGroups] = await Promise.all([
    accountIds.length ? collectAllPages(300, (cursorId) => prisma.conversation.findMany({
      where: { orgId: input.orgId, zaloAccountId: { in: accountIds }, threadType: 'user', deletedAt: null, contactId: { not: null }, isReplied: false },
      select: conversationSelect,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: 300,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) : Promise.resolve([]),
    accountIds.length ? collectAllPages(300, (cursorId) => prisma.conversation.findMany({
      where: {
        orgId: input.orgId,
        zaloAccountId: { in: accountIds },
        threadType: 'user',
        deletedAt: null,
        contactId: { not: null },
        aiInsights: {
          some: {
            status: 'active',
            OR: [
              { requiresHuman: true },
              { nextAction: { in: ['assign_to_human', 'verify_payment_obligation', 'confirm_order_details', 'prepare_quote', 'review_quote_follow_up', 'review_post_sale_care', 'clarify_latest_message'] } },
            ],
          },
        },
      },
      select: conversationSelect,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: 300,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) : Promise.resolve([]),
    accountIds.length ? collectAllPages(300, (cursorId) => prisma.conversation.findMany({
      where: {
        orgId: input.orgId,
        zaloAccountId: { in: accountIds },
        threadType: 'user',
        deletedAt: null,
        contactId: { not: null },
        isReplied: true,
        lastMessageAt: { not: null },
        OR: [
          { contact: { priorityScore: { gte: 70 } } },
          { aiInsights: { some: { status: 'active', stage: { in: [...ACTIVE_STAGES] } } } },
        ],
      },
      select: conversationSelect,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: 300,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) : Promise.resolve([]),
    collectAllPages(200, (cursorId) => prisma.appointment.findMany({
      where: { orgId: input.orgId, assignedUserId: input.assigneeUserId, status: 'scheduled', appointmentDate: { lt: appointmentWindowEnd(now, timezone) } },
      select: {
        id: true, contactId: true, appointmentDate: true, appointmentTime: true, title: true, notes: true, type: true, status: true,
        contact: { select: { id: true, fullName: true, crmName: true, avatarUrl: true } },
      },
      orderBy: [{ appointmentDate: 'asc' }, { id: 'asc' }],
      take: 200,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })),
    accountIds.length ? collectAllPages(200, (cursorId) => prisma.followupEnrollment.findMany({
      where: { orgId: input.orgId, zaloAccountId: { in: accountIds }, status: 'waiting_sale' },
      select: {
        id: true, workflowId: true, contactId: true, zaloAccountId: true, currentStepKey: true,
        messagesSent: true, saleTaskTitle: true, updatedAt: true,
        workflow: { select: { name: true } },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) : Promise.resolve([]),
    ownerAccountIds.size ? collectAllPages(200, (cursorId) => prisma.conversation.findMany({
      where: {
        orgId: input.orgId,
        zaloAccountId: { in: [...ownerAccountIds] },
        threadType: 'group',
        deletedAt: null,
        isPrivate: false,
        contactId: { not: null },
        groupSdkType: { not: 2 },
        groupMonitoringEnabled: true,
        groupCategory: { in: ['sales', 'customer_care'] },
        aiInsights: { some: { status: 'active' } },
      },
      select: {
        ...conversationSelect,
        groupName: true,
        groupAvatarUrl: true,
        groupCategory: true,
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: 200,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })) : Promise.resolve([]),
  ]);

  const usableUnreplied = unreplied.filter((conversation) => !isConversationPrivateFor(conversation, input.privacy.viewerUserId));
  const unrepliedContactIds = new Set<string>();
  for (const conversation of usableUnreplied) {
    if (!conversation.contact || !conversation.contactId) continue;
    const message = latestMessage(conversation);
    const canSee = canSeeConversationContent(conversation, input.privacy);
    if (!isConversationEligibleForSalesWork(conversation, canSee)) {
      if (isVerificationCandidate(conversation, canSee)) {
        unrepliedContactIds.add(conversation.contactId);
        const bucket = bucketFor(buckets, conversation.contact);
        addSignal(bucket, verificationSignal(conversation, !canSee), conversation.zaloAccount.displayName);
        bucket.unreadCount += conversation.unreadCount;
      }
      continue;
    }
    unrepliedContactIds.add(conversation.contactId);
    const bucket = bucketFor(buckets, conversation.contact);
    const preview = !canSee
      ? ''
      : message?.isDeleted
        ? 'Tin nhắn đã thu hồi'
        : message?.contentType && message.contentType !== 'text'
          ? `[${message.contentType}]`
          : normalizeText(message?.content, 400);
    addSignal(bucket, deriveConversationSignal({
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt,
      messagePreview: preview,
      redacted: !canSee,
      insight: canSee ? activeInsight(conversation) : null,
      conversationId: conversation.id,
      zaloAccountId: conversation.zaloAccountId,
      latestMessageId: message?.id ?? null,
    }), conversation.zaloAccount.displayName);
    bucket.unreadCount += conversation.unreadCount;
  }

  const latestConversationByContact = new Map<string, any>();
  for (const conversation of [...usableUnreplied, ...aiConversations, ...dormant]) {
    if (!conversation.contactId || isConversationPrivateFor(conversation, input.privacy.viewerUserId)) continue;
    const current = latestConversationByContact.get(conversation.contactId);
    if (!current || (conversation.lastMessageAt?.getTime() ?? 0) > (current.lastMessageAt?.getTime() ?? 0)) {
      latestConversationByContact.set(conversation.contactId, conversation);
    }
  }

  const aiTaskContactIds = new Set<string>();
  for (const conversation of aiConversations) {
    if (!conversation.contact || !conversation.contactId || unrepliedContactIds.has(conversation.contactId)) continue;
    if (isConversationPrivateFor(conversation, input.privacy.viewerUserId)) continue;
    const canSee = canSeeConversationContent(conversation, input.privacy);
    if (!isConversationEligibleForSalesWork(conversation, canSee)) continue;
    const signal = aiNextSignal(conversation, canSee ? activeInsight(conversation) : null, !canSee);
    if (!signal) continue;
    aiTaskContactIds.add(conversation.contactId);
    const bucket = bucketFor(buckets, conversation.contact);
    addSignal(bucket, signal, conversation.zaloAccount.displayName);
  }

  for (const conversation of dormant) {
    if (!conversation.contact || !conversation.contactId || unrepliedContactIds.has(conversation.contactId) || aiTaskContactIds.has(conversation.contactId)) continue;
    if (conversation.contact.statusRef?.isTerminal) continue;
    if (isConversationPrivateFor(conversation, input.privacy.viewerUserId)) continue;
    const canSee = canSeeConversationContent(conversation, input.privacy);
    if (!isConversationEligibleForSalesWork(conversation, canSee)) continue;
    const bucket = bucketFor(buckets, conversation.contact);
    addSignal(bucket, dormantSignal(conversation, canSee ? activeInsight(conversation) : null, !canSee), conversation.zaloAccount.displayName);
  }

  for (const appointment of appointments) {
    const conversation = latestConversationByContact.get(appointment.contactId) ?? null;
    const bucket = bucketFor(buckets, appointment.contact);
    addSignal(bucket, appointmentSignal(appointment, conversation, now, timezone), conversation?.zaloAccount?.displayName);
  }

  const followupContactIds = [...new Set(followups.map((row) => row.contactId))];
  const followupContacts = followupContactIds.length
    ? await prisma.contact.findMany({
        where: { orgId: input.orgId, id: { in: followupContactIds } },
        select: { id: true, fullName: true, crmName: true, avatarUrl: true, assignedUserId: true },
      })
    : [];
  const followupContactMap = new Map(followupContacts.map((contact) => [contact.id, contact]));
  for (const enrollment of followups) {
    const contact = followupContactMap.get(enrollment.contactId);
    if (!contact) continue;
    const conversation = latestConversationByContact.get(enrollment.contactId) ?? null;
    const bucket = bucketFor(buckets, contact);
    addSignal(bucket, followupSignal(enrollment, conversation), conversation?.zaloAccount?.displayName);
  }

  const candidates = [...buckets.values()]
    .filter((bucket) => bucket.signals.length)
    // Explicit CRM ownership wins over nick access. Only unassigned contacts
    // are routed to the account owner/access holder that is reconciling them.
    .filter((bucket) => bucket.signals.some((signal) => signal.kind === 'appointment')
      || bucket.assignedUserId === input.assigneeUserId
      || (bucket.assignedUserId == null && bucket.signals.some((signal) => !!signal.zaloAccountId && ownerAccountIds.has(signal.zaloAccountId))))
    .map((bucket) => buildCandidate(bucket, input.orgId, input.assigneeUserId));
  const groupCandidates = monitoredGroups
    .map((conversation) => buildGroupCandidate(conversation, input.orgId, input.assigneeUserId))
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);
  const activeContactIds = candidates.map((candidate) => candidate.contactId);
  const [existing, existingGroups] = await Promise.all([
    prisma.conversationWorkItem.findMany({
      where: { orgId: input.orgId, assigneeUserId: input.assigneeUserId, sourceType: 'contact' },
      select: { id: true, contactId: true, fingerprint: true, status: true, snoozedUntil: true },
    }),
    prisma.conversationWorkItem.findMany({
      where: { orgId: input.orgId, assigneeUserId: input.assigneeUserId, sourceType: 'group_conversation' },
      select: { id: true, sourceId: true, fingerprint: true, status: true, snoozedUntil: true },
    }),
  ]);
  const existingByContact = new Map(existing.map((row) => [row.contactId, row]));
  const existingByGroup = new Map(existingGroups.map((row) => [row.sourceId, row]));

  await prisma.$transaction([
    ...candidates.map((candidate) => {
      const current = existingByContact.get(candidate.contactId);
      const changed = current?.fingerprint !== candidate.fingerprint;
      const snoozeExpired = current?.status === 'snoozed' && !!current.snoozedUntil && current.snoozedUntil <= now;
      const nextStatus = changed || snoozeExpired || current?.status === 'dismissed'
        ? 'open'
        : current?.status ?? 'open';
      return prisma.conversationWorkItem.upsert({
        where: {
          orgId_assigneeUserId_sourceType_sourceId: {
            orgId: input.orgId,
            assigneeUserId: input.assigneeUserId,
            sourceType: 'contact',
            sourceId: candidate.contactId,
          },
        },
        create: { ...candidate, status: 'open' },
        update: {
          ...candidate,
          status: nextStatus,
          completedAt: nextStatus === 'completed' ? undefined : null,
          snoozedUntil: nextStatus === 'snoozed' ? undefined : null,
        },
      });
    }),
    prisma.conversationWorkItem.updateMany({
      where: {
        orgId: input.orgId,
        assigneeUserId: input.assigneeUserId,
        sourceType: 'contact',
        status: { in: ['open', 'snoozed'] },
        ...(activeContactIds.length ? { contactId: { notIn: activeContactIds } } : {}),
      },
      data: { status: 'dismissed', completedAt: null, snoozedUntil: null },
    }),
    ...groupCandidates.map((candidate) => {
      const current = existingByGroup.get(candidate.sourceId);
      const changed = current?.fingerprint !== candidate.fingerprint;
      const snoozeExpired = current?.status === 'snoozed' && !!current.snoozedUntil && current.snoozedUntil <= now;
      const nextStatus = changed || snoozeExpired || current?.status === 'dismissed'
        ? 'open'
        : current?.status ?? 'open';
      return prisma.conversationWorkItem.upsert({
        where: {
          orgId_assigneeUserId_sourceType_sourceId: {
            orgId: input.orgId,
            assigneeUserId: input.assigneeUserId,
            sourceType: 'group_conversation',
            sourceId: candidate.sourceId,
          },
        },
        create: { ...candidate, status: 'open' },
        update: {
          ...candidate,
          status: nextStatus,
          completedAt: nextStatus === 'completed' ? undefined : null,
          snoozedUntil: nextStatus === 'snoozed' ? undefined : null,
        },
      });
    }),
    prisma.conversationWorkItem.updateMany({
      where: {
        orgId: input.orgId,
        assigneeUserId: input.assigneeUserId,
        sourceType: 'group_conversation',
        status: { in: ['open', 'snoozed'] },
        ...(groupCandidates.length ? { sourceId: { notIn: groupCandidates.map((candidate) => candidate.sourceId) } } : {}),
      },
      data: { status: 'dismissed', completedAt: null, snoozedUntil: null },
    }),
  ]);
  return [...candidates, ...groupCandidates];
}

export function matchesWorkItemScope(item: any, scope: WorkItemScope, now = new Date()): boolean {
  const todayEnd = todayEndVN(now);
  if (scope === 'done') return item.status === 'completed';
  if (scope === 'waiting') return item.status === 'snoozed' && (!item.snoozedUntil || item.snoozedUntil > now);
  if (scope === 'all') return ['open', 'snoozed'].includes(item.status);
  if (item.status !== 'open') return false;
  const actionKey = jsonObject(item.metadata).actionKey;
  const isVerification = item.kind === 'verification' || actionKey === 'clarify_latest_message' || actionKey === 'verify_customer_identity';
  if (scope === 'verify') return isVerification;
  if (isVerification) return false;
  if (scope === 'now') {
    const dueNow = !item.dueAt || item.dueAt <= now;
    return item.priority === 'critical'
      || item.kind === 'reply'
      || item.kind === 'human_required'
      || (dueNow && item.priority === 'high')
      || (!!item.dueAt && item.dueAt <= now);
  }
  if (scope === 'today') {
    if (!item.dueAt || item.dueAt >= todayEnd) return false;
    return !matchesWorkItemScope(item, 'now', now);
  }
  if (scope === 'upcoming') return !!item.dueAt && item.dueAt >= todayEnd;
  return false;
}

export async function listConversationWorkItems(input: {
  orgId: string;
  assigneeUserId: string;
  privacy: PrivacyContext;
  scope?: WorkItemScope;
  limit?: number;
  offset?: number;
  query?: string;
}) {
  const cacheKey = reconciliationCacheKey(input);
  const cachedAt = reconciliationCache.get(cacheKey) ?? 0;
  if (Date.now() - cachedAt >= RECONCILIATION_TTL_MS) {
    const running = reconciliationInFlight.get(cacheKey);
    if (running) {
      await running;
    } else {
      const reconciliation = reconcileConversationWorkItems(input);
      reconciliationInFlight.set(cacheKey, reconciliation);
      try {
        await reconciliation;
        reconciliationCache.set(cacheKey, Date.now());
      } finally {
        reconciliationInFlight.delete(cacheKey);
      }
    }
  }
  const now = new Date();
  const rows = await prisma.conversationWorkItem.findMany({
    where: {
      orgId: input.orgId,
      assigneeUserId: input.assigneeUserId,
      status: { in: ['open', 'snoozed', 'completed'] },
    },
    include: {
      contact: { select: { id: true, fullName: true, crmName: true, avatarUrl: true, priorityScore: true } },
      conversation: { select: { id: true, zaloAccount: { select: { displayName: true, status: true } } } },
    },
    orderBy: [{ priorityScore: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { sourceEventAt: 'desc' }],
  });
  const scopes: WorkItemScope[] = ['now', 'today', 'waiting', 'upcoming', 'verify', 'done', 'all'];
  const counts = Object.fromEntries(scopes.map((scope) => [scope, rows.filter((row) => matchesWorkItemScope(row, scope, now)).length]));
  const activeRows = rows.filter((row) => ['open', 'snoozed'].includes(row.status));
  const summary: WorkItemSummary = {
    totalActive: activeRows.length,
    critical: activeRows.filter((row) => row.status === 'open' && row.priority === 'critical').length,
    overdue: activeRows.filter((row) => row.status === 'open' && !!row.dueAt && row.dueAt <= now).length,
    waitingReply: activeRows.filter((row) => row.status === 'open' && ['reply', 'human_required'].includes(row.kind)).length,
    verification: activeRows.filter((row) => row.status === 'open' && (row.kind === 'verification' || ['clarify_latest_message', 'verify_customer_identity'].includes(jsonObject(row.metadata).actionKey))).length,
  };
  const scope = input.scope ?? 'now';
  const query = normalizeText(input.query, 120).toLocaleLowerCase('vi-VN');
  const scopedRows = rows
    .filter((row) => matchesWorkItemScope(row, scope, now))
    .filter((row) => {
      if (!query) return true;
      const metadata = jsonObject(row.metadata);
      return [
        row.title,
        row.customerSituation,
        row.nextAction,
        row.reason,
        metadata.contactName,
        metadata.groupName,
        ...(Array.isArray(metadata.nickNames) ? metadata.nickNames : []),
      ].some((value) => normalizeText(value, 300).toLocaleLowerCase('vi-VN').includes(query));
    });
  const limit = Math.max(1, Math.min(100, input.limit ?? 30));
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const items = scopedRows.slice(offset, offset + limit);
  return { items, counts, summary, hasMore: offset + items.length < scopedRows.length, nextOffset: offset + items.length < scopedRows.length ? offset + items.length : null, generatedAt: now };
}

export async function updateConversationWorkItem(input: {
  orgId: string;
  itemId: string;
  action: 'complete' | 'snooze' | 'reopen';
  snoozedUntil?: Date | null;
}) {
  const item = await prisma.conversationWorkItem.findFirst({ where: { id: input.itemId, orgId: input.orgId } });
  if (!item) return null;
  invalidateReconciliationCache(input.orgId, item.assigneeUserId);
  if (input.action === 'complete') {
    const updated = await prisma.conversationWorkItem.update({ where: { id: item.id }, data: { status: 'completed', completedAt: new Date(), snoozedUntil: null } });
    emitConversationWorkItemsUpdated({ orgId: input.orgId, conversationId: item.conversationId, itemId: item.id });
    return updated;
  }
  if (input.action === 'snooze') {
    if (!input.snoozedUntil || input.snoozedUntil <= new Date()) throw new Error('SNOOZE_TIME_INVALID');
    const updated = await prisma.conversationWorkItem.update({ where: { id: item.id }, data: { status: 'snoozed', snoozedUntil: input.snoozedUntil, completedAt: null } });
    emitConversationWorkItemsUpdated({ orgId: input.orgId, conversationId: item.conversationId, itemId: item.id });
    return updated;
  }
  const updated = await prisma.conversationWorkItem.update({ where: { id: item.id }, data: { status: 'open', snoozedUntil: null, completedAt: null } });
  emitConversationWorkItemsUpdated({ orgId: input.orgId, conversationId: item.conversationId, itemId: item.id });
  return updated;
}
