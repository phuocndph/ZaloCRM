import { prisma } from '../../shared/database/prisma-client.js';
import { checkZaloAccess } from '../zalo/zalo-access-middleware.js';
import { canSeeConversationContent, type PrivacyContext, type PrivacyConversation } from '../privacy/redact.js';

export type ContextActor = {
  orgId: string;
  userId: string;
  role: string;
  privacyUnlocked?: boolean;
};

export type ContextSource = {
  id: string;
  table: string;
  recordId?: string | null;
  field?: string;
  reason: string;
  createdAt?: string | null;
};

export type ContextSection = {
  id: string;
  title: string;
  priority: number;
  tokenEstimate: number;
  items: unknown;
  sources: string[];
};

export type ConversationContext = {
  conversationId: string;
  orgId: string;
  generatedAt: string;
  tokenBudget: number;
  tokenEstimate: number;
  truncated: boolean;
  truncation: {
    droppedSections: string[];
    droppedMessages: number;
    originalTokenEstimate: number;
  };
  access: {
    allowed: boolean;
    contentVisible: boolean;
    reason: string;
    scope: 'conversation';
    userId: string;
    role: string;
    privacy: { conversationPrivate: boolean; privacyUnlocked: boolean };
  };
  sections: ContextSection[];
  sources: ContextSource[];
};

export class ContextBuilderError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'CONTEXT_BUILDER_ERROR') {
    super(message);
    this.name = 'ContextBuilderError';
  }
}

type JsonRecord = Record<string, unknown>;
type SectionDraft = Omit<ContextSection, 'tokenEstimate'> & { textForBudget?: unknown };

const DEFAULT_MAX_TOKENS = 2400;
const MIN_MAX_TOKENS = 500;
const HARD_MAX_TOKENS = 8000;
const MAX_RECENT_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 700;

function clampBudget(value?: number) {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_MAX_TOKENS;
  return Math.max(MIN_MAX_TOKENS, Math.min(HARD_MAX_TOKENS, Math.floor(value!)));
}

function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
}

function trimText(value: unknown, max = MAX_MESSAGE_CHARS) {
  if (typeof value !== 'string') return value;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function jsonObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function maskPhone(value?: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function maskEmail(value?: string | null) {
  if (!value || !value.includes('@')) return null;
  const [name, domain] = value.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

function sourceId(table: string, recordId: string | null | undefined, field?: string) {
  return [table, recordId ?? 'none', field ?? 'row'].join(':');
}

function addSource(sources: Map<string, ContextSource>, source: Omit<ContextSource, 'id'>) {
  const id = sourceId(source.table, source.recordId, source.field);
  if (!sources.has(id)) sources.set(id, { id, ...source });
  return id;
}

function dedupeStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const clean = value.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')) as Partial<T>;
}

function messageText(message: { content: string | null; contentType: string; attachments?: unknown; metadata?: unknown }) {
  if (message.content?.trim()) return trimText(message.content);
  if (message.contentType !== 'text') return `[${message.contentType}]`;
  return null;
}

function extractLatestQuote(messages: Array<{ id: string; content: string | null; sentAt: Date; senderType: string }>) {
  const patterns = [/báo giá/i, /bao gia/i, /quote/i, /quotation/i, /giá/i, /gia/i, /\b\d+[,.]?\d*\s*(tr|triệu|ty|tỷ|vnd|vnđ|đ)\b/i];
  return messages.find((message) => message.content && patterns.some((pattern) => pattern.test(message.content!))) ?? null;
}

function propertyNeedFrom(metadata: unknown) {
  const meta = jsonObject(metadata);
  const propertyNeed = jsonObject(meta.propertyNeed);
  return Object.keys(propertyNeed).length ? propertyNeed : null;
}

function missingInfo(contact: any, propertyNeed: JsonRecord | null) {
  const missing: string[] = [];
  if (!contact?.fullName && !contact?.crmName) missing.push('customer.name');
  if (!contact?.phone && !contact?.email) missing.push('customer.contact_method');
  if (!propertyNeed?.type) missing.push('product.type');
  if (!propertyNeed?.budgetMin && !propertyNeed?.budgetMax) missing.push('budget');
  if (!propertyNeed?.area) missing.push('preferred_area');
  if (!propertyNeed?.purpose) missing.push('purchase_purpose');
  if (!propertyNeed?.decisionTimeline) missing.push('decision_timeline');
  return missing;
}

function fitSections(drafts: SectionDraft[], budget: number) {
  const always = new Set(['access']);
  const sections: ContextSection[] = [];
  const droppedSections: string[] = [];
  let total = 0;

  const sorted = [...drafts].sort((a, b) => b.priority - a.priority);
  for (const draft of sorted) {
    const tokenEstimate = estimateTokens(draft.textForBudget ?? draft.items);
    const section = { ...draft, tokenEstimate };
    delete (section as any).textForBudget;
    if (always.has(section.id) || total + tokenEstimate <= budget) {
      sections.push(section);
      total += tokenEstimate;
    } else {
      droppedSections.push(section.id);
    }
  }
  return { sections: sections.sort((a, b) => b.priority - a.priority), tokenEstimate: total, droppedSections };
}

export async function buildConversationContext(
  actor: ContextActor,
  conversationId: string,
  options: { maxTokens?: number; recentMessageLimit?: number } = {},
): Promise<ConversationContext> {
  const tokenBudget = clampBudget(options.maxTokens);
  const sources = new Map<string, ContextSource>();
  const now = new Date().toISOString();

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: actor.orgId, deletedAt: null },
    select: {
      id: true,
      orgId: true,
      zaloAccountId: true,
      contactId: true,
      threadType: true,
      groupName: true,
      lastMessageAt: true,
      unreadCount: true,
      isReplied: true,
      tab: true,
      isPrivate: true,
      privateOwnerUserId: true,
      zaloAccount: { select: { id: true, displayName: true, privacyMode: true, ownerUserId: true } },
      contact: {
        select: {
          id: true, fullName: true, crmName: true, phone: true, email: true, source: true,
          province: true, district: true, ward: true, gender: true, birthYear: true,
          occupation: true, incomeRange: true, preferredLang: true, status: true, statusId: true, leadScore: true,
          tags: true, metadata: true, nextAppointment: true, lastActivity: true,
          assignedUser: { select: { id: true, fullName: true, role: true } },
          statusRef: { select: { id: true, name: true, color: true, order: true } },
        },
      },
    },
  });

  if (!conversation) throw new ContextBuilderError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');

  const access = await checkZaloAccess({
    userId: actor.userId,
    orgId: actor.orgId,
    role: actor.role,
    zaloAccountId: conversation.zaloAccountId,
    minPermission: 'read',
  });
  if (access !== 'ok') throw new ContextBuilderError('No permission to read this conversation', 403, 'CONVERSATION_ACCESS_DENIED');

  const privacyCtx: PrivacyContext = {
    viewerUserId: actor.userId,
    orgId: actor.orgId,
    privacyUnlocked: !!actor.privacyUnlocked,
  };
  const privacyConversation: PrivacyConversation = {
    isPrivate: conversation.isPrivate,
    privateOwnerUserId: conversation.privateOwnerUserId,
    zaloAccount: conversation.zaloAccount,
  };
  const contentVisible = canSeeConversationContent(privacyConversation, privacyCtx);
  if (!contentVisible) {
    throw new ContextBuilderError('Conversation content is private for this user', 403, 'CONVERSATION_CONTENT_PRIVATE');
  }

  const convSource = addSource(sources, { table: 'conversations', recordId: conversation.id, reason: 'conversation access and metadata', createdAt: conversation.lastMessageAt?.toISOString() ?? null });
  const accessSection: SectionDraft = {
    id: 'access',
    title: 'Data access',
    priority: 100,
    items: {
      allowed: true,
      contentVisible,
      scope: 'conversation',
      conversationPrivate: conversation.isPrivate,
      privacyUnlocked: !!actor.privacyUnlocked,
      rule: 'zalo_account_read + conversation_privacy',
    },
    sources: [convSource],
  };

  const [messagesDesc, summary, intent, emotion, friend, followups] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, isDeleted: false },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(MAX_RECENT_MESSAGES, Math.max(10, options.recentMessageLimit ?? MAX_RECENT_MESSAGES)),
      select: { id: true, senderType: true, senderName: true, content: true, contentType: true, sentAt: true, metadata: true },
    }),
    prisma.aiConversationSummary.findFirst({
      where: { orgId: actor.orgId, conversationId: conversation.id, status: 'active' },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, version: true, summaryRedacted: true, summaryHash: true, createdAt: true, sourceThroughMessageId: true },
    }),
    prisma.aiIntentAnalysis.findFirst({
      where: { orgId: actor.orgId, conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, confidence: true, secondary: true, reasonRedacted: true, createdAt: true, messageId: true },
    }),
    prisma.aiEmotionAnalysis.findFirst({
      where: { orgId: actor.orgId, conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, confidence: true, intensity: true, secondary: true, reasonRedacted: true, createdAt: true, messageId: true },
    }),
    conversation.contactId ? prisma.friend.findFirst({
      where: { orgId: actor.orgId, contactId: conversation.contactId, zaloAccountId: conversation.zaloAccountId },
      select: {
        id: true, friendshipStatus: true, relationshipKind: true, crmTagsPerNick: true, zaloLabels: true,
        statusRef: { select: { id: true, name: true, color: true, order: true } }, leadScore: true,
        lastInboundAt: true, lastOutboundAt: true, lastInteractionAt: true,
      },
    }) : Promise.resolve(null),
    conversation.contactId ? prisma.followupEnrollment.findMany({
      where: { orgId: actor.orgId, contactId: conversation.contactId, status: { in: ['running', 'waiting', 'waiting_sale'] } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 3,
      select: {
        id: true, status: true, currentStepKey: true, messagesSent: true, nextRunAt: true, saleTaskTitle: true,
        workflowVersion: true, updatedAt: true,
        workflow: { select: { id: true, name: true, type: true, goalType: true, status: true } },
      },
    }) : Promise.resolve([]),
  ]);

  const contact = conversation.contact;
  const propertyNeed = propertyNeedFrom(contact?.metadata);
  const messages = [...messagesDesc].reverse();
  const latestQuote = extractLatestQuote(messagesDesc);
  const messageSources = messages.map((message) => addSource(sources, {
    table: 'messages', recordId: message.id, field: 'content', reason: 'recent visible conversation message', createdAt: message.sentAt.toISOString(),
  }));

  const sections: SectionDraft[] = [accessSection];

  if (summary?.summaryRedacted) {
    sections.push({
      id: 'conversation_summary', title: 'Conversation summary', priority: 95,
      items: { version: summary.version, summary: trimText(summary.summaryRedacted, 1400), summaryHash: summary.summaryHash },
      sources: [addSource(sources, { table: 'ai_conversation_summaries', recordId: summary.id, field: 'summary_redacted', reason: 'latest active summary', createdAt: summary.createdAt.toISOString() })],
    });
  }

  if (contact) {
    sections.push({
      id: 'customer_profile', title: 'Customer profile', priority: 90,
      items: compactObject({
        contactId: contact.id,
        displayName: contact.crmName || contact.fullName,
        phoneMasked: maskPhone(contact.phone),
        emailMasked: maskEmail(contact.email),
        source: contact.source,
        location: compactObject({ province: contact.province, district: contact.district, ward: contact.ward }),
        demographics: compactObject({ gender: contact.gender, birthYear: contact.birthYear, occupation: contact.occupation, incomeRange: contact.incomeRange, preferredLang: contact.preferredLang }),
        lastActivity: contact.lastActivity,
      }),
      sources: [addSource(sources, { table: 'contacts', recordId: contact.id, reason: 'customer profile fields', createdAt: contact.lastActivity?.toISOString() ?? null })],
    });

    sections.push({
      id: 'sales_state', title: 'Sales state', priority: 86,
      items: compactObject({
        contactStatus: contact.statusRef?.name || contact.status,
        contactStatusId: contact.statusRef?.id || contact.statusId,
        contactLeadScore: contact.leadScore,
        friendStatus: friend?.statusRef?.name,
        friendLeadScore: friend?.leadScore,
        relationshipKind: friend?.relationshipKind,
        friendshipStatus: friend?.friendshipStatus,
        nextAppointment: contact.nextAppointment,
        isReplied: conversation.isReplied,
        tab: conversation.tab,
      }),
      sources: [addSource(sources, { table: 'contacts', recordId: contact.id, reason: 'sales status and score' }), ...(friend ? [addSource(sources, { table: 'friends', recordId: friend.id, reason: 'per-nick sales state' })] : [])],
    });

    sections.push({
      id: 'owner', title: 'Owner and responsible account', priority: 78,
      items: compactObject({
        assignedUser: contact.assignedUser ? { id: contact.assignedUser.id, fullName: contact.assignedUser.fullName, role: contact.assignedUser.role } : null,
        zaloAccount: { id: conversation.zaloAccount.id, displayName: conversation.zaloAccount.displayName },
      }),
      sources: [convSource, addSource(sources, { table: 'contacts', recordId: contact.id, field: 'assigned_user_id', reason: 'responsible user' })],
    });

    const tags = dedupeStrings([
      ...jsonArray(contact.tags),
      ...jsonArray(friend?.crmTagsPerNick),
      ...jsonArray(friend?.zaloLabels).map((label: any) => label?.name || label?.text),
    ]);
    if (tags.length) {
      sections.push({
        id: 'tags', title: 'Relevant tags', priority: 74,
        items: { tags: tags.slice(0, 30) },
        sources: [addSource(sources, { table: 'contacts', recordId: contact.id, field: 'tags', reason: 'contact tags' }), ...(friend ? [addSource(sources, { table: 'friends', recordId: friend.id, field: 'crm_tags_per_nick', reason: 'per-nick tags and labels' })] : [])],
      });
    }

    sections.push({
      id: 'missing_information', title: 'Missing information', priority: 72,
      items: { missing: missingInfo(contact, propertyNeed) },
      sources: [addSource(sources, { table: 'contacts', recordId: contact.id, field: 'metadata', reason: 'derived missing fields' })],
    });
  }

  if (propertyNeed) {
    sections.push({
      id: 'current_product', title: 'Current product or need', priority: 88,
      items: propertyNeed,
      sources: [addSource(sources, { table: 'contacts', recordId: contact!.id, field: 'metadata.propertyNeed', reason: 'structured product need' })],
    });
  }

  if (latestQuote) {
    sections.push({
      id: 'latest_quote', title: 'Latest quote or pricing mention', priority: 84,
      items: { messageId: latestQuote.id, sentAt: latestQuote.sentAt, senderType: latestQuote.senderType, excerpt: trimText(latestQuote.content, 600) },
      sources: [addSource(sources, { table: 'messages', recordId: latestQuote.id, field: 'content', reason: 'latest quote-like message', createdAt: latestQuote.sentAt.toISOString() })],
    });
  }

  if (followups.length) {
    sections.push({
      id: 'active_followups', title: 'Active follow-up', priority: 82,
      items: followups.map((item) => ({
        enrollmentId: item.id,
        status: item.status,
        workflow: item.workflow,
        workflowVersion: item.workflowVersion,
        currentStepKey: item.currentStepKey,
        messagesSent: item.messagesSent,
        nextRunAt: item.nextRunAt,
        saleTaskTitle: item.saleTaskTitle,
      })),
      sources: followups.map((item) => addSource(sources, { table: 'followup_enrollments', recordId: item.id, reason: 'active follow-up enrollment', createdAt: item.updatedAt.toISOString() })),
    });
  }

  if (intent) {
    sections.push({
      id: 'latest_intent', title: 'Latest intent', priority: 80,
      items: { label: intent.label, confidence: intent.confidence, secondary: intent.secondary, reason: intent.reasonRedacted, messageId: intent.messageId, createdAt: intent.createdAt },
      sources: [addSource(sources, { table: 'ai_intent_analyses', recordId: intent.id, reason: 'latest intent analysis', createdAt: intent.createdAt.toISOString() })],
    });
  }

  if (emotion) {
    sections.push({
      id: 'latest_emotion', title: 'Latest emotion', priority: 79,
      items: { label: emotion.label, confidence: emotion.confidence, intensity: emotion.intensity, secondary: emotion.secondary, reason: emotion.reasonRedacted, messageId: emotion.messageId, createdAt: emotion.createdAt },
      sources: [addSource(sources, { table: 'ai_emotion_analyses', recordId: emotion.id, reason: 'latest emotion analysis', createdAt: emotion.createdAt.toISOString() })],
    });
  }

  const messageItems = messages
    .map((message, index) => ({
      id: message.id,
      sentAt: message.sentAt,
      senderType: message.senderType,
      senderName: message.senderName,
      contentType: message.contentType,
      content: messageText(message),
      sourceId: messageSources[index],
    }))
    .filter((message) => message.content);
  const messageBudget = Math.max(120, Math.floor(tokenBudget * 0.38));
  const selectedMessages = [] as typeof messageItems;
  let messageTokens = 0;
  for (const message of [...messageItems].reverse()) {
    const cost = estimateTokens(message);
    if (selectedMessages.length > 0 && messageTokens + cost > messageBudget) break;
    selectedMessages.push(message);
    messageTokens += cost;
  }
  selectedMessages.reverse();
  const droppedMessages = messageItems.length - selectedMessages.length;
  if (selectedMessages.length) {
    sections.push({
      id: 'recent_messages', title: 'Recent messages', priority: 92,
      items: selectedMessages.map(({ sourceId: _sourceId, ...message }) => message),
      sources: selectedMessages.map((message) => message.sourceId),
      textForBudget: selectedMessages,
    });
  }

  const originalTokenEstimate = estimateTokens(sections.map((section) => section.textForBudget ?? section.items));
  const fitted = fitSections(sections, tokenBudget);

  return {
    conversationId: conversation.id,
    orgId: actor.orgId,
    generatedAt: now,
    tokenBudget,
    tokenEstimate: fitted.tokenEstimate,
    truncated: fitted.droppedSections.length > 0 || droppedMessages > 0 || originalTokenEstimate > tokenBudget,
    truncation: { droppedSections: fitted.droppedSections, droppedMessages, originalTokenEstimate },
    access: accessSection.items as ConversationContext['access'],
    sections: fitted.sections,
    sources: [...sources.values()],
  };
}

