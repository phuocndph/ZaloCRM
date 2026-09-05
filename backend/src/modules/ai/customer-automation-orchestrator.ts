import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { enrollContact, stopEnrollment } from '../followup/followup-engine.js';
import { createWorkflow, setStatus, type WorkflowInput } from '../followup/followup-service.js';
import { addCrmTag, removeCrmTag } from '../tags/tag-service.js';
import { isConfirmedNonCustomer, normalizeCounterpartyAssessment } from './counterparty-role.js';

const ACTIVE_ENROLLMENT_STATES = ['running', 'waiting', 'waiting_sale'];
const AUTOMATION_MARKER = 'customer-automation:v1';
const AUTOMATION_ACTOR_NAME = 'AI chăm sóc khách hàng';
const COMPLETED_OUTCOMES = ['success', 'no_change', 'blocked'];

export type CustomerAutomationWorkflowType = 'after_quote' | 'post_sale' | 'reengage';

type AutomationAction = {
  type: 'tag_added' | 'tag_removed' | 'consent_revoked' | 'workflow_enrolled' | 'workflow_switched' | 'workflow_stopped' | 'workflow_kept' | 'workflow_provisioned';
  label?: string;
  workflowId?: string;
  enrollmentId?: string;
  reason?: string;
};

export type CustomerAutomationResult = {
  enabled: boolean;
  outcome: 'success' | 'no_change' | 'blocked' | 'failed' | 'already_processed';
  reason: string;
  desiredWorkflowType: CustomerAutomationWorkflowType | null;
  enrollmentId: string | null;
  actions: AutomationAction[];
};

type InsightSnapshot = {
  id: string;
  orgId: string;
  runId: string | null;
  conversationId: string;
  contactId: string | null;
  sourceThroughMessageId: string;
  stage: string;
  intentLabel: string;
  requiresHuman: boolean;
  recommendedWorkflowType: string | null;
  nextAction: string;
  analysisHash: string;
  signals: unknown;
  safeguards: unknown;
};

type Blueprint = {
  name: string;
  input: WorkflowInput;
};

type ManagedWorkflow = {
  id: string;
  name: string;
  type: string;
  status: string;
};

const TAGS: Record<string, { names: string[]; color: string }> = {
  qualified: { names: ['Khách tiềm năng'], color: '#F59E0B' },
  quoted: { names: ['Đã báo giá', 'Chờ phản hồi báo giá'], color: '#0EA5E9' },
  negotiating: { names: ['Đang thương lượng'], color: '#8B5CF6' },
  payment_pending: { names: ['Chờ thanh toán'], color: '#F97316' },
  won: { names: ['Đã chốt'], color: '#16A34A' },
  post_sale: { names: ['Chăm sóc sau bán'], color: '#059669' },
  cold: { names: ['Khách đang nguội'], color: '#64748B' },
  human_required: { names: ['Cần nhân viên xử lý'], color: '#DC2626' },
  do_not_contact: { names: ['Không liên hệ'], color: '#991B1B' },
  vendor: { names: ['Người chào hàng'], color: '#64748B' },
  partner: { names: ['Đối tác'], color: '#0F766E' },
  recruiter: { names: ['Tuyển dụng'], color: '#7C3AED' },
  personal: { names: ['Liên hệ cá nhân'], color: '#475569' },
  spam: { names: ['Tin quảng cáo'], color: '#B91C1C' },
};

const AUTOMATED_TAG_NAMES = [...new Set([
  ...Object.values(TAGS).flatMap((item) => item.names),
  'Khiếu nại',
])];

const STOP_TAGS = ['Không làm phiền', 'Không liên hệ'];

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeAutomationWorkflowType(value: string | null | undefined): CustomerAutomationWorkflowType | null {
  const normalized = String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
  if (normalized === 'after_quote') return 'after_quote';
  if (['post_sale', 'post_sale_care'].includes(normalized)) return 'post_sale';
  if (normalized === 'reengage') return 'reengage';
  return null;
}

export function desiredAutomatedTags(stage: string, intentLabel: string): string[] {
  const tags = [...(TAGS[stage]?.names ?? [])];
  if (['complaint', 'return_or_refund'].includes(intentLabel)) tags.push('Khiếu nại');
  return [...new Set(tags)];
}

function blueprint(type: CustomerAutomationWorkflowType): Blueprint {
  if (type === 'after_quote') {
    return {
      name: '[Tự động] Theo dõi sau báo giá',
      input: {
        name: '[Tự động] Theo dõi sau báo giá',
        description: `${AUTOMATION_MARKER}; Tự chờ trước khi nhắn, dừng ngay khi khách phản hồi.`,
        type,
        goalType: 'replied',
        stopOnPurchase: true,
        stopOnTags: STOP_TAGS,
        sendWindowStart: 480,
        sendWindowEnd: 1080,
        minGapMinutes: 2880,
        maxMessages: 2,
        steps: [
          { key: 'start', type: 'start', nextKey: 'wait_1' },
          { key: 'wait_1', type: 'wait', config: { amount: 2, unit: 'day' }, nextKey: 'check_1' },
          { key: 'check_1', type: 'condition', config: { check: 'not_replied', trueKey: 'send_1', falseKey: 'end' } },
          { key: 'send_1', type: 'send', config: { content: 'Dạ {{name}} đã xem qua báo giá bên em chưa ạ? Nếu cần điều chỉnh theo số lượng hoặc nhu cầu sử dụng, anh/chị cứ nhắn em nhé.' }, nextKey: 'wait_2' },
          { key: 'wait_2', type: 'wait', config: { amount: 3, unit: 'day' }, nextKey: 'check_2' },
          { key: 'check_2', type: 'condition', config: { check: 'not_replied', trueKey: 'sale_task', falseKey: 'end' } },
          { key: 'sale_task', type: 'sale_task', config: { title: 'Gọi hoặc nhắn trực tiếp để làm rõ vướng mắc sau báo giá', note: 'Khách chưa phản hồi sau nhịp tự động an toàn.' }, nextKey: 'end' },
          { key: 'end', type: 'end' },
        ],
      },
    };
  }
  if (type === 'post_sale') {
    return {
      name: '[Tự động] Chăm sóc sau bán',
      input: {
        name: '[Tự động] Chăm sóc sau bán',
        description: `${AUTOMATION_MARKER}; Chăm sóc sau bán có bước chờ và bàn giao nhân viên khi khách phản hồi.`,
        type,
        goalType: 'replied',
        stopOnPurchase: false,
        stopOnTags: STOP_TAGS,
        sendWindowStart: 480,
        sendWindowEnd: 1080,
        minGapMinutes: 10080,
        maxMessages: 1,
        steps: [
          { key: 'start', type: 'start', nextKey: 'wait_1' },
          { key: 'wait_1', type: 'wait', config: { amount: 7, unit: 'day' }, nextKey: 'check_1' },
          { key: 'check_1', type: 'condition', config: { check: 'not_replied', trueKey: 'send_1', falseKey: 'end' } },
          { key: 'send_1', type: 'send', config: { content: 'Dạ {{name}} sử dụng sản phẩm bên em thấy ổn không ạ? Nếu có điểm nào chưa phù hợp, anh/chị nhắn em để bên em hỗ trợ ngay nhé.' }, nextKey: 'end' },
          { key: 'end', type: 'end' },
        ],
      },
    };
  }
  return {
    name: '[Tự động] Kết nối lại khách đang nguội',
    input: {
      name: '[Tự động] Kết nối lại khách đang nguội',
      description: `${AUTOMATION_MARKER}; Chỉ hỏi thăm sau thời gian chờ, không đeo bám khách đã từ chối.`,
      type,
      goalType: 'replied',
      stopOnPurchase: true,
      stopOnTags: STOP_TAGS,
      sendWindowStart: 480,
      sendWindowEnd: 1080,
      minGapMinutes: 10080,
      maxMessages: 1,
      steps: [
        { key: 'start', type: 'start', nextKey: 'wait_1' },
        { key: 'wait_1', type: 'wait', config: { amount: 7, unit: 'day' }, nextKey: 'friend_check' },
        { key: 'friend_check', type: 'condition', config: { check: 'is_friend', trueKey: 'send_1', falseKey: 'sale_task' } },
        { key: 'send_1', type: 'send', config: { content: 'Chào {{name}}, lâu rồi em chưa hỏi thăm ạ. Hiện anh/chị có cần bên em hỗ trợ thêm thông tin hoặc tư vấn gì không ạ?' }, nextKey: 'end' },
        { key: 'sale_task', type: 'sale_task', config: { title: 'Kiểm tra lại quan hệ bạn bè trước khi liên hệ', note: 'Hệ thống không tự gửi cho khách chưa là bạn Zalo.' }, nextKey: 'end' },
        { key: 'end', type: 'end' },
      ],
    },
  };
}

async function provisionWorkflow(orgId: string, type: CustomerAutomationWorkflowType, actions: AutomationAction[]) {
  const existing = await prisma.followupWorkflow.findFirst({
    where: {
      orgId,
      type,
      isLatest: true,
      description: { contains: AUTOMATION_MARKER },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, type: true, status: true, createdByName: true },
  });
  if (existing) {
    if (existing.status === 'draft' && existing.createdByName === 'AI chăm sóc khách hàng') {
      await setStatus(existing.id, orgId, 'active');
      return { id: existing.id, name: existing.name, type: existing.type, status: 'active' };
    }
    return { id: existing.id, name: existing.name, type: existing.type, status: existing.status };
  }

  const definition = blueprint(type);
  const created = await createWorkflow(orgId, { fullName: 'AI chăm sóc khách hàng' }, definition.input);
  const workflowId = (created as { id?: string } | null)?.id;
  if (!workflowId) throw new Error(`AUTOMATION_WORKFLOW_CREATE_FAILED:${type}`);
  await setStatus(workflowId, orgId, 'active');
  actions.push({ type: 'workflow_provisioned', workflowId, label: definition.name });
  return { id: workflowId, name: definition.name, type, status: 'active' };
}

const workflowProvisioning = new Map<string, Promise<ManagedWorkflow>>();

async function ensureWorkflow(orgId: string, type: CustomerAutomationWorkflowType, actions: AutomationAction[]) {
  const key = `${orgId}:${type}`;
  const pending = workflowProvisioning.get(key);
  if (pending) return pending;
  const task = provisionWorkflow(orgId, type, actions).finally(() => workflowProvisioning.delete(key));
  workflowProvisioning.set(key, task);
  return task;
}

async function syncTags(
  insight: InsightSnapshot,
  actions: AutomationAction[],
  options: { preserveDoNotContact?: boolean; desiredNames?: string[] } = {},
) {
  if (!insight.contactId) return;
  const desired = new Set(options.desiredNames ?? desiredAutomatedTags(insight.stage, insight.intentLabel));
  if (options.preserveDoNotContact) desired.add(TAGS.do_not_contact.names[0]);
  const assignments = await prisma.contactTag.findMany({
    where: {
      contactId: insight.contactId,
      removedAt: null,
      addedVia: 'ai_suggest',
      tag: { orgId: insight.orgId, scope: 'crm', name: { in: AUTOMATED_TAG_NAMES } },
    },
    select: { tagId: true, tag: { select: { name: true } } },
  });
  const activeByName = new Map(assignments.map((item) => [item.tag.name, item.tagId]));

  for (const [name, tagId] of activeByName) {
    if (desired.has(name)) continue;
    await removeCrmTag({ contactId: insight.contactId, tagId, removedBy: null });
    actions.push({ type: 'tag_removed', label: name });
  }

  for (const name of desired) {
    if (activeByName.has(name)) continue;
    const color = Object.values(TAGS).find((entry) => entry.names.includes(name))?.color ?? '#DC2626';
    await addCrmTag({
      contactId: insight.contactId,
      tagName: name,
      source: 'ai_suggest',
      addedBy: null,
      autoCreate: true,
      color,
    });
    actions.push({ type: 'tag_added', label: name });
  }
}

function stopReason(input: {
  insight: InsightSnapshot;
  senderType: string;
  consentStatus: string;
  friendshipStatus: string | null;
  strangerBlocked: boolean | null;
}) {
  const signals = jsonObject(input.insight.signals);
  if (input.consentStatus === 'revoked' || input.insight.stage === 'do_not_contact') return 'do_not_contact';
  if (input.insight.requiresHuman || input.insight.stage === 'human_required') return 'human_required';
  if (['complaint', 'return_or_refund', 'human_request'].includes(input.insight.intentLabel)) return 'human_required';
  if (signals.paymentVerificationRequired === true || input.insight.nextAction === 'verify_payment_obligation') return 'payment_requires_verification';
  if (input.insight.stage === 'won' || input.insight.nextAction === 'confirm_order_details') return 'order_requires_staff_processing';
  if (signals.customerNotInterested === true || input.insight.intentLabel === 'not_interested') return 'customer_not_interested';
  if (input.senderType === 'contact') return 'customer_replied';
  if (input.friendshipStatus !== 'accepted' || input.strangerBlocked === true) return 'not_a_messageable_friend';
  return null;
}

function desiredWorkflow(insight: InsightSnapshot): CustomerAutomationWorkflowType | null {
  const recommended = normalizeAutomationWorkflowType(insight.recommendedWorkflowType);
  if (recommended) return recommended;
  if (insight.stage === 'quoted') return 'after_quote';
  if (insight.stage === 'post_sale') return 'post_sale';
  if (insight.stage === 'cold') return 'reengage';
  return null;
}

async function writeAudit(insight: InsightSnapshot, result: CustomerAutomationResult) {
  await prisma.aiAuditLog.create({
    data: {
      orgId: insight.orgId,
      runId: insight.runId,
      conversationId: insight.conversationId,
      eventType: 'customer_automation.reconciled',
      outcome: result.outcome,
      targetType: 'ai_conversation_insight',
      targetId: insight.id,
      outputHash: insight.analysisHash,
      metadata: {
        enabled: result.enabled,
        reason: result.reason,
        desiredWorkflowType: result.desiredWorkflowType,
        enrollmentId: result.enrollmentId,
        actions: result.actions,
      } as Prisma.InputJsonValue,
    },
  });
}

async function reconcile(insight: InsightSnapshot): Promise<CustomerAutomationResult> {
  const actions: AutomationAction[] = [];
  const enabled = (process.env.AI_CUSTOMER_AUTOMATION_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!enabled) {
    const result: CustomerAutomationResult = {
      enabled: false, outcome: 'blocked', reason: 'automation_disabled', desiredWorkflowType: null, enrollmentId: null, actions,
    };
    await writeAudit(insight, result);
    return result;
  }
  if (!insight.contactId) {
    const result: CustomerAutomationResult = {
      enabled: true, outcome: 'blocked', reason: 'contact_required', desiredWorkflowType: null, enrollmentId: null, actions,
    };
    await writeAudit(insight, result);
    return result;
  }

  const [conversation, sourceMessage, contact, active] = await Promise.all([
    prisma.conversation.findFirst({
      where: { id: insight.conversationId, orgId: insight.orgId, contactId: insight.contactId, deletedAt: null },
      select: { id: true, zaloAccountId: true, isPrivate: true, threadType: true },
    }),
    prisma.message.findUnique({ where: { id: insight.sourceThroughMessageId }, select: { senderType: true } }),
    prisma.contact.findFirst({ where: { id: insight.contactId, orgId: insight.orgId }, select: { consentStatus: true } }),
    prisma.followupEnrollment.findFirst({
      where: { orgId: insight.orgId, contactId: insight.contactId, status: { in: ACTIVE_ENROLLMENT_STATES } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        workflowId: true,
        enrolledByName: true,
        workflow: { select: { id: true, name: true, type: true } },
      },
    }),
  ]);

  if (!conversation || !sourceMessage || !contact || conversation.isPrivate || conversation.threadType !== 'user') {
    const result: CustomerAutomationResult = {
      enabled: true, outcome: 'blocked', reason: 'conversation_not_eligible', desiredWorkflowType: null, enrollmentId: active?.id ?? null, actions,
    };
    await writeAudit(insight, result);
    return result;
  }

  const signals = jsonObject(insight.signals);
  const counterparty = normalizeCounterpartyAssessment({
    role: signals.counterpartyRole,
    confidence: signals.counterpartyConfidence,
    reason: signals.counterpartyReason,
  });
  const classifierApplied = Number(signals.counterpartyClassifierVersion ?? 0) > 0;
  const salesTargetConfirmed = signals.workItemEligible === true;
  const analysisModelFallback = signals.analysisModelFallback === true;
  const identityUnconfirmed = classifierApplied && !salesTargetConfirmed && !isConfirmedNonCustomer(counterparty);
  if (isConfirmedNonCustomer(counterparty)) {
    const blockReason = 'not_a_customer';
    await syncTags(insight, actions, {
      desiredNames: TAGS[counterparty!.role]?.names ?? [],
    });
    if (active?.enrolledByName === 'AI chăm sóc khách hàng') {
      await stopEnrollment(active.id, blockReason, { actorType: 'system', actorName: 'AI chăm sóc khách hàng' });
      actions.push({ type: 'workflow_stopped', workflowId: active.workflowId, enrollmentId: active.id, reason: blockReason });
    }
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: 'blocked',
      reason: blockReason,
      desiredWorkflowType: null,
      enrollmentId: active?.enrolledByName === 'AI chăm sóc khách hàng' ? null : active?.id ?? null,
      actions,
    };
    await writeAudit(insight, result);
    return result;
  }
  const explicitOptOut = insight.stage === 'do_not_contact' || signals.explicitOptOut === true;
  if (explicitOptOut && contact.consentStatus !== 'revoked') {
    await prisma.contact.updateMany({
      where: { id: insight.contactId, orgId: insight.orgId },
      data: { consentStatus: 'revoked', consentRevokedAt: new Date(), consentSource: 'ai_explicit_opt_out' },
    });
    contact.consentStatus = 'revoked';
    actions.push({ type: 'consent_revoked', reason: 'explicit_opt_out' });
  }
  const messageableFriend = await prisma.friend.findFirst({
    where: { orgId: insight.orgId, contactId: insight.contactId, zaloAccountId: conversation.zaloAccountId },
    select: { friendshipStatus: true, strangerBlocked: true, zaloAccountId: true },
  });
  const blockedReason = stopReason({
    insight,
    senderType: sourceMessage.senderType,
    consentStatus: contact.consentStatus,
    friendshipStatus: messageableFriend?.friendshipStatus ?? null,
    strangerBlocked: messageableFriend?.strangerBlocked ?? null,
  });
  if (identityUnconfirmed) {
    // A current, non-fallback classifier result may retract stale AI-owned
    // sales state. Manual tags and workflows remain untouched.
    if (!analysisModelFallback) {
      await syncTags(insight, actions, { desiredNames: [] });
    }
    const stopUnconfirmedAutomation = active?.enrolledByName === AUTOMATION_ACTOR_NAME
      && (!!blockedReason || !analysisModelFallback);
    if (stopUnconfirmedAutomation && active) {
      const reason = blockedReason ?? 'customer_identity_unconfirmed';
      await stopEnrollment(active.id, reason, { actorType: 'system', actorName: AUTOMATION_ACTOR_NAME });
      actions.push({ type: 'workflow_stopped', workflowId: active.workflowId, enrollmentId: active.id, reason });
    }
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: blockedReason ? 'blocked' : actions.length ? 'success' : 'no_change',
      reason: blockedReason ?? (analysisModelFallback ? 'analysis_pending' : 'customer_identity_unconfirmed'),
      desiredWorkflowType: null,
      enrollmentId: stopUnconfirmedAutomation ? null : active?.id ?? null,
      actions,
    };
    await writeAudit(insight, result);
    return result;
  }
  await syncTags(insight, actions, { preserveDoNotContact: contact.consentStatus === 'revoked' });
  if (blockedReason) {
    if (active) {
      await stopEnrollment(active.id, blockedReason, { actorType: 'system', actorName: 'AI chăm sóc khách hàng' });
      actions.push({ type: 'workflow_stopped', workflowId: active.workflowId, enrollmentId: active.id, reason: blockedReason });
    }
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: 'blocked',
      reason: blockedReason,
      desiredWorkflowType: null,
      enrollmentId: null,
      actions,
    };
    await writeAudit(insight, result);
    return result;
  }

  const wanted = desiredWorkflow(insight);
  if (!wanted) {
    if (active?.enrolledByName === 'AI chăm sóc khách hàng') {
      await stopEnrollment(active.id, 'no_longer_applicable', { actorType: 'system', actorName: 'AI chăm sóc khách hàng' });
      actions.push({
        type: 'workflow_stopped',
        workflowId: active.workflowId,
        enrollmentId: active.id,
        reason: 'no_longer_applicable',
      });
    }
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: actions.length ? 'success' : 'no_change',
      reason: actions.some((action) => action.type === 'workflow_stopped')
        ? 'workflow_no_longer_applicable'
        : 'no_safe_workflow_required',
      desiredWorkflowType: null,
      enrollmentId: active?.enrolledByName === 'AI chăm sóc khách hàng' ? null : active?.id ?? null,
      actions,
    };
    await writeAudit(insight, result);
    return result;
  }

  if (active?.workflow.type === wanted) {
    actions.push({ type: 'workflow_kept', workflowId: active.workflowId, enrollmentId: active.id, reason: 'same_workflow_type' });
    const result: CustomerAutomationResult = {
      enabled: true, outcome: 'no_change', reason: 'same_workflow_kept', desiredWorkflowType: wanted, enrollmentId: active.id, actions,
    };
    await writeAudit(insight, result);
    return result;
  }

  if (active && active.enrolledByName !== 'AI chăm sóc khách hàng') {
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: 'blocked',
      reason: 'manual_workflow_preserved',
      desiredWorkflowType: wanted,
      enrollmentId: active.id,
      actions,
    };
    await writeAudit(insight, result);
    return result;
  }

  const workflow = await ensureWorkflow(insight.orgId, wanted, actions);
  if (workflow.status !== 'active') {
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: 'blocked',
      reason: 'workflow_not_active',
      desiredWorkflowType: wanted,
      enrollmentId: active?.id ?? null,
      actions,
    };
    await writeAudit(insight, result);
    return result;
  }
  const enrollment = await enrollContact({
    workflowId: workflow.id,
    contactId: insight.contactId,
    zaloAccountId: conversation.zaloAccountId,
    actorType: 'system',
    actorName: 'AI chăm sóc khách hàng',
    onConflict: active ? 'switch' : undefined,
    reason: active ? 'switched' : undefined,
  });
  if (!enrollment.ok || !enrollment.enrollmentId) {
    throw new Error(`AUTOMATION_ENROLL_FAILED:${enrollment.error ?? 'unknown'}`);
  }

  actions.push({
    type: active ? 'workflow_switched' : 'workflow_enrolled',
    workflowId: workflow.id,
    enrollmentId: enrollment.enrollmentId,
    reason: `stage:${insight.stage}`,
  });
  await prisma.followupLog.create({
    data: {
      orgId: insight.orgId,
      enrollmentId: enrollment.enrollmentId,
      workflowId: workflow.id,
      contactId: insight.contactId,
      eventType: 'note',
      message: `AI tự chọn nhịp chăm sóc theo tình huống “${insight.stage}”. Hệ thống sẽ dừng ngay khi khách phản hồi.`,
      actorType: 'system',
      actorName: 'AI chăm sóc khách hàng',
      detail: { insightId: insight.id, analysisHash: insight.analysisHash, stage: insight.stage } as Prisma.InputJsonValue,
    },
  });
  const result: CustomerAutomationResult = {
    enabled: true,
    outcome: 'success',
    reason: active ? 'workflow_switched' : 'workflow_enrolled',
    desiredWorkflowType: wanted,
    enrollmentId: enrollment.enrollmentId,
    actions,
  };
  await writeAudit(insight, result);
  return result;
}

const running = new Map<string, Promise<CustomerAutomationResult>>();
const contactLocks = new Map<string, Promise<void>>();

async function withContactLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = contactLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => gate);
  contactLocks.set(key, chain);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (contactLocks.get(key) === chain) contactLocks.delete(key);
  }
}

export async function reconcileCustomerAutomation(insightId: string): Promise<CustomerAutomationResult> {
  const insight = await prisma.aiConversationInsight.findUnique({
    where: { id: insightId },
    select: {
      id: true, orgId: true, runId: true, conversationId: true, contactId: true,
      sourceThroughMessageId: true, stage: true, intentLabel: true, requiresHuman: true,
      recommendedWorkflowType: true, nextAction: true, analysisHash: true, signals: true, safeguards: true,
    },
  });
  if (!insight) throw new Error('AUTOMATION_INSIGHT_NOT_FOUND');
  const existing = await prisma.aiAuditLog.findFirst({
    where: {
      eventType: 'customer_automation.reconciled',
      targetType: 'ai_conversation_insight',
      targetId: insight.id,
      outputHash: insight.analysisHash,
      outcome: { in: COMPLETED_OUTCOMES },
    },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  });
  if (existing) {
    const metadata = jsonObject(existing.metadata);
    const enabledNow = (process.env.AI_CUSTOMER_AUTOMATION_ENABLED ?? 'false').toLowerCase() === 'true';
    if (!(enabledNow && metadata.enabled !== true)) {
      return {
        enabled: metadata.enabled === true,
        outcome: 'already_processed',
        reason: String(metadata.reason ?? 'already_processed'),
        desiredWorkflowType: normalizeAutomationWorkflowType(String(metadata.desiredWorkflowType ?? '')),
        enrollmentId: typeof metadata.enrollmentId === 'string' ? metadata.enrollmentId : null,
        actions: Array.isArray(metadata.actions) ? metadata.actions as AutomationAction[] : [],
      };
    }
  }

  const key = `${insight.id}:${insight.analysisHash}`;
  const pending = running.get(key);
  if (pending) return pending;
  const task = withContactLock(
    `${insight.orgId}:${insight.contactId ?? insight.conversationId}`,
    () => reconcile(insight),
  ).catch(async (error) => {
    const result: CustomerAutomationResult = {
      enabled: true,
      outcome: 'failed',
      reason: (error as Error).message,
      desiredWorkflowType: desiredWorkflow(insight),
      enrollmentId: null,
      actions: [],
    };
    await writeAudit(insight, result).catch(() => undefined);
    throw error;
  }).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

export async function backfillCustomerAutomations(options: { orgId?: string; batchSize?: number } = {}) {
  const batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 25)));
  const insights = await prisma.aiConversationInsight.findMany({
    where: { ...(options.orgId ? { orgId: options.orgId } : {}), status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: batchSize * 3,
    select: { id: true, analysisHash: true },
  });
  if (!insights.length) return { scanned: 0, reconciled: 0 };
  const audited = await prisma.aiAuditLog.findMany({
    where: {
      eventType: 'customer_automation.reconciled',
      targetType: 'ai_conversation_insight',
      targetId: { in: insights.map((item) => item.id) },
      outcome: { in: COMPLETED_OUTCOMES },
    },
    select: { targetId: true, outputHash: true, metadata: true },
  });
  const done = new Set(audited
    .filter((item) => jsonObject(item.metadata).enabled === true)
    .map((item) => `${item.targetId}:${item.outputHash}`));
  let reconciled = 0;
  for (const insight of insights) {
    if (done.has(`${insight.id}:${insight.analysisHash}`)) continue;
    try {
      await reconcileCustomerAutomation(insight.id);
      reconciled += 1;
    } catch (error) {
      logger.warn(`[customer-automation] backfill failed insight=${insight.id}: ${(error as Error).message}`);
    }
    if (reconciled >= batchSize) break;
  }
  return { scanned: insights.length, reconciled };
}
