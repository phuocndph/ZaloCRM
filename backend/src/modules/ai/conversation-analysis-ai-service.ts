import sharp from 'sharp';
import { getObjectBuffer, keyFromPublicUrl } from '../../shared/storage/minio-client.js';
import {
  aiClient,
  type AIClientRequest,
  type AIClientResponse,
  type AIImageContentPart,
} from './core/index.js';
import {
  CUSTOMER_MEMORY_KEYS,
  type CustomerMemoryInput,
  type CustomerMemoryKey,
  type ShortTermConversationSummary,
} from './conversation-memory-service.js';
import {
  EMOTIONS,
  analyzeEmotionMessages,
  type Emotion,
  type EmotionOutput,
} from './emotion-engine-service.js';
import {
  INTENTS,
  analyzeIntentText,
  type Intent,
  type IntentOutput,
} from './intent-engine-service.js';
import type { ConversationContext } from './conversation-context-builder-service.js';
import {
  COUNTERPARTY_ROLES,
  resolveCounterpartyAssessment,
  type CounterpartyAssessment,
} from './counterparty-role.js';

type PreparedMessage = {
  messageId: string;
  sentAt: string;
  speaker: 'Người liên hệ' | 'Nhân viên' | 'Trợ lý' | 'Hệ thống';
  senderUid: string | null;
  senderName: string | null;
  content: string;
};

type ContextMessageItem = {
  id?: unknown;
  senderType?: unknown;
  contentType?: unknown;
  mediaUrl?: unknown;
  senderUid?: unknown;
  senderName?: unknown;
};

export type PreparedConversationAnalysisInput = {
  locale: 'vi-VN';
  conversationKind: 'direct' | 'group';
  groupProfile: unknown | null;
  customerProfile: unknown | null;
  salesState: unknown | null;
  currentProductOrNeed: unknown | null;
  tags: unknown | null;
  latestQuote: unknown | null;
  activeFollowups: unknown | null;
  previousSummary: unknown | null;
  conversationState: {
    latestContactMessage: PreparedMessage | null;
    latestStaffMessage: PreparedMessage | null;
    contactIsWaitingForReply: boolean | null;
  };
  transcript: PreparedMessage[];
};

type CombinedAnalysisOutput = {
  summary: {
    currentDiscussion: string;
    unansweredQuestions: string[];
    currentProduct: string | null;
    currentEmotion: string | null;
  };
  intent: {
    primary_intent: Intent;
    secondary_intents: Intent[];
    confidence: number;
    missing_information: string[];
    requires_human: boolean;
    reason: string;
  };
  emotion: {
    emotion: Emotion;
    confidence: number;
    intensity: number;
    suggested_tone: EmotionOutput['suggested_tone'];
    escalation_required: boolean;
    explanation: string;
  };
  counterparty: CounterpartyAssessment;
  memories: Array<{
    key: CustomerMemoryKey;
    value: string;
    confidence: number;
    evidenceMessageIds: string[];
  }>;
  groupAction: null | {
    actionable: boolean;
    senderUid: string | null;
    senderName: string | null;
    messageId: string | null;
    request: string | null;
    requiredAction: string | null;
    reason: string | null;
  };
};

export const CONVERSATION_ANALYSIS_SYSTEM_PROMPT = [
  'Bạn là bộ phân tích hội thoại người liên hệ cho CRM Zalo; không được mặc định mọi người liên hệ đều là khách hàng.',
  'Backend đã thu thập và sắp xếp dữ liệu sẵn; không cần kể lại toàn bộ transcript.',
  'BẮT BUỘC: mọi chuỗi văn bản dành cho nhân viên phải là tiếng Việt tự nhiên, chuẩn UTF-8 và có dấu đầy đủ.',
  'Nếu khách viết tiếng Việt không dấu, hãy tự khôi phục dấu theo ngữ cảnh.',
  'Không trả nội dung mô tả bằng tiếng Anh, trừ tên riêng, mã sản phẩm hoặc thuật ngữ bắt buộc.',
  'Các enum/key kỹ thuật phải giữ nguyên đúng danh sách schema.',
  'Tập trung vào trạng thái HIỆN TẠI: khách đang phản hồi gì, đang chờ gì và nhân viên cần làm gì tiếp theo.',
  'Trước khi coi đây là khách hàng, phải xác định vai trò của đối phương so với doanh nghiệp.',
  'customer/prospect chỉ dùng khi đối phương đang mua, đã mua hoặc thực sự tìm hiểu sản phẩm/dịch vụ của doanh nghiệp.',
  'vendor dùng khi đối phương chủ động chào bán, quảng bá hoặc giới thiệu sản phẩm/dịch vụ của họ cho doanh nghiệp; có kết bạn Zalo không đồng nghĩa là khách hàng.',
  'partner, recruiter, personal, spam và unknown không được diễn giải thành nhu cầu mua hàng nếu không có bằng chứng rõ.',
  'Nếu chủ đề đã đổi, không trộn chủ đề cũ vào tóm tắt hiện tại; chỉ giữ cam kết, báo giá hoặc đơn hàng cũ còn liên quan.',
  'Không suy đoán dữ kiện. Không tự xác nhận thanh toán, đơn hàng, giá hay ưu đãi nếu dữ liệu không nói rõ.',
  'Ghi nhớ dài hạn chỉ lấy sự thật ổn định và có messageId làm bằng chứng; không lưu câu xã giao hoặc trạng thái tạm thời.',
  'Không đưa mật khẩu, OTP, token, số thẻ, số điện thoại hoặc email nguyên vẹn vào kết quả.',
  'Với hội thoại nhóm, phải tách từng người theo senderUid/senderName và chỉ tạo groupAction cho một thành viên đang thực sự mua hàng hoặc cần doanh nghiệp hỗ trợ.',
  'Không coi tin chào hàng, trao đổi nội bộ, tin của nhà cung cấp hoặc câu chuyện chung trong nhóm là việc chăm sóc khách hàng.',
].join(' ');

const VIETNAMESE_DIACRITICS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
const UNACCENTED_VIETNAMESE = /\b(khach|nhan vien|hoi|gia|kiem tra|khong|con thieu|san pham|tra loi|dang|se|mua|bao lai|quan tam|thanh toan)\b/i;
const ENGLISH_DISPLAY_WORDS = /\b(customer|purchase|history|direct|brief|messages|prefers|pricing|availability|previous|communication|product|interested|order)\b/gi;
const MAX_ANALYSIS_IMAGES = 2;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;

const SPEAKER_BY_SENDER: Record<string, PreparedMessage['speaker']> = {
  contact: 'Người liên hệ',
  self: 'Nhân viên',
  agent: 'Trợ lý',
  system: 'Hệ thống',
};

function sectionItems(context: ConversationContext, id: string) {
  return context.sections.find((section) => section.id === id)?.items ?? null;
}

function parsePreviousSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  const summary = (value as { summary?: unknown }).summary;
  if (typeof summary !== 'string') return value;
  try {
    return JSON.parse(summary);
  } catch {
    return summary;
  }
}

function cleanText(value: unknown, max = 900) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function transcriptFromContext(context: ConversationContext): PreparedMessage[] {
  const raw = sectionItems(context, 'recent_messages');
  if (!Array.isArray(raw)) return [];
  return raw
    .map((message: any) => ({
      messageId: String(message?.id ?? ''),
      sentAt: message?.sentAt ? new Date(message.sentAt).toISOString() : '',
      speaker: SPEAKER_BY_SENDER[String(message?.senderType ?? '')] ?? 'Hệ thống',
      senderUid: typeof message?.senderUid === 'string' && message.senderUid ? message.senderUid : null,
      senderName: typeof message?.senderName === 'string' && message.senderName ? cleanText(message.senderName, 160) : null,
      content: cleanText(message?.content),
    }))
    .filter((message) => message.messageId && message.content)
    .slice(-40);
}

async function imagePartsFromContext(context: ConversationContext): Promise<AIImageContentPart[]> {
  const raw = sectionItems(context, 'recent_messages');
  if (!Array.isArray(raw)) return [];
  const candidates = (raw as ContextMessageItem[])
    .filter((message) => message.senderType === 'contact'
      && message.contentType === 'image'
      && typeof message.mediaUrl === 'string'
      && message.mediaUrl.trim())
    .slice(-MAX_ANALYSIS_IMAGES);
  const parts: AIImageContentPart[] = [];
  for (const candidate of candidates) {
    try {
      const key = keyFromPublicUrl(String(candidate.mediaUrl));
      if (!key) continue;
      const source = await getObjectBuffer(key);
      if (!source?.length || source.length > MAX_SOURCE_IMAGE_BYTES) continue;
      const optimized = await sharp(source)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      parts.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${optimized.toString('base64')}`, detail: 'low' },
      });
    } catch {
      // A missing or damaged attachment must not block text analysis.
    }
  }
  return parts;
}

function salesReplyState(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const isReplied = (value as { isReplied?: unknown }).isReplied;
  return typeof isReplied === 'boolean' ? !isReplied : null;
}

export function prepareConversationAnalysisInput(context: ConversationContext): PreparedConversationAnalysisInput {
  const transcript = transcriptFromContext(context);
  const salesState = sectionItems(context, 'sales_state');
  const groupProfile = sectionItems(context, 'group_profile');
  return {
    locale: 'vi-VN',
    conversationKind: groupProfile ? 'group' : 'direct',
    groupProfile,
    customerProfile: sectionItems(context, 'customer_profile'),
    salesState,
    currentProductOrNeed: sectionItems(context, 'current_product'),
    tags: sectionItems(context, 'tags'),
    latestQuote: sectionItems(context, 'latest_quote'),
    activeFollowups: sectionItems(context, 'active_followups'),
    previousSummary: parsePreviousSummary(sectionItems(context, 'conversation_summary')),
    conversationState: {
      latestContactMessage: [...transcript].reverse().find((message) => message.speaker === 'Người liên hệ') ?? null,
      latestStaffMessage: [...transcript].reverse().find((message) => message.speaker === 'Nhân viên') ?? null,
      contactIsWaitingForReply: salesReplyState(salesState),
    },
    transcript,
  };
}

function combinedSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'intent', 'emotion', 'counterparty', 'memories', 'groupAction'],
    properties: {
      summary: {
        type: 'object',
        additionalProperties: false,
        required: ['currentDiscussion', 'unansweredQuestions', 'currentProduct', 'currentEmotion'],
        properties: {
          currentDiscussion: { type: 'string' },
          unansweredQuestions: { type: 'array', items: { type: 'string' } },
          currentProduct: { type: ['string', 'null'] },
          currentEmotion: { type: ['string', 'null'] },
        },
      },
      intent: {
        type: 'object',
        additionalProperties: false,
        required: ['primary_intent', 'secondary_intents', 'confidence', 'missing_information', 'requires_human', 'reason'],
        properties: {
          primary_intent: { type: 'string', enum: [...INTENTS] },
          secondary_intents: { type: 'array', items: { type: 'string', enum: [...INTENTS] } },
          confidence: { type: 'number' },
          missing_information: { type: 'array', items: { type: 'string' } },
          requires_human: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      emotion: {
        type: 'object',
        additionalProperties: false,
        required: ['emotion', 'confidence', 'intensity', 'suggested_tone', 'escalation_required', 'explanation'],
        properties: {
          emotion: { type: 'string', enum: [...EMOTIONS] },
          confidence: { type: 'number' },
          intensity: { type: 'number' },
          suggested_tone: { type: 'string', enum: ['warm', 'clear', 'reassuring', 'concise', 'calm_deescalating', 'handoff'] },
          escalation_required: { type: 'boolean' },
          explanation: { type: 'string' },
        },
      },
      counterparty: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'confidence', 'reason'],
        properties: {
          role: { type: 'string', enum: [...COUNTERPARTY_ROLES] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
      memories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value', 'confidence', 'evidenceMessageIds'],
          properties: {
            key: { type: 'string', enum: [...CUSTOMER_MEMORY_KEYS] },
            value: { type: 'string' },
            confidence: { type: 'number' },
            evidenceMessageIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      groupAction: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['actionable', 'senderUid', 'senderName', 'messageId', 'request', 'requiredAction', 'reason'],
            properties: {
              actionable: { type: 'boolean' },
              senderUid: { type: ['string', 'null'] },
              senderName: { type: ['string', 'null'] },
              messageId: { type: ['string', 'null'] },
              request: { type: ['string', 'null'] },
              requiredAction: { type: ['string', 'null'] },
              reason: { type: ['string', 'null'] },
            },
          },
        ],
      },
    },
  };
}

function isCombinedOutput(value: unknown): value is CombinedAnalysisOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const output = value as Partial<CombinedAnalysisOutput>;
  return !!output.summary
    && typeof output.summary.currentDiscussion === 'string'
    && Array.isArray(output.summary.unansweredQuestions)
    && !!output.intent
    && (INTENTS as readonly string[]).includes(output.intent.primary_intent)
    && Array.isArray(output.intent.secondary_intents)
    && typeof output.intent.confidence === 'number'
    && typeof output.intent.requires_human === 'boolean'
    && typeof output.intent.reason === 'string'
    && !!output.emotion
    && (EMOTIONS as readonly string[]).includes(output.emotion.emotion)
    && typeof output.emotion.confidence === 'number'
    && typeof output.emotion.intensity === 'number'
    && typeof output.emotion.explanation === 'string'
    && !!output.counterparty
    && (COUNTERPARTY_ROLES as readonly string[]).includes(output.counterparty.role)
    && typeof output.counterparty.confidence === 'number'
    && typeof output.counterparty.reason === 'string'
    && Array.isArray(output.memories)
    && (output.groupAction === null
      || (typeof output.groupAction === 'object' && typeof output.groupAction.actionable === 'boolean'));
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function displayTextNeedsRepair(value: unknown) {
  const text = cleanText(value, 2500);
  if (text.length < 24) return false;
  const englishMatches = text.match(ENGLISH_DISPLAY_WORDS)?.length ?? 0;
  const vietnameseWithoutDiacritics = !VIETNAMESE_DIACRITICS.test(text) && UNACCENTED_VIETNAMESE.test(text);
  return englishMatches >= 2 || vietnameseWithoutDiacritics;
}

function outputNeedsLanguageRepair(output: CombinedAnalysisOutput) {
  const displayTexts = [
    output.summary.currentDiscussion,
    ...output.summary.unansweredQuestions,
    output.summary.currentEmotion,
    output.intent.reason,
    output.emotion.explanation,
    output.counterparty.reason,
    ...output.memories.map((memory) => memory.value),
    output.groupAction?.request,
    output.groupAction?.requiredAction,
    output.groupAction?.reason,
  ];
  return displayTexts.some(displayTextNeedsRepair);
}

function memoryCandidates(output: CombinedAnalysisOutput, input: PreparedConversationAnalysisInput): CustomerMemoryInput[] {
  if (input.conversationKind === 'group') return [];
  const messages = new Map(input.transcript.map((message) => [message.messageId, message]));
  return output.memories.slice(0, 10).flatMap((memory) => {
    if (!CUSTOMER_MEMORY_KEYS.includes(memory.key)) return [];
    const value = cleanText(memory.value, 1200);
    if (!value) return [];
    const evidence = memory.evidenceMessageIds
      .map((id) => messages.get(id))
      .filter((message): message is PreparedMessage => !!message)
      .slice(0, 5)
      .map((message) => ({
        type: 'message' as const,
        messageId: message.messageId,
        excerpt: message.content.slice(0, 280),
        createdAt: message.sentAt || null,
      }));
    if (!evidence.length) return [];
    return [{
      key: memory.key,
      value,
      confidence: clamp(memory.confidence),
      evidence,
      status: 'candidate' as const,
      source: 'ai_candidate' as const,
    }];
  });
}

export async function analyzePreparedConversation(input: {
  orgId: string;
  modelConfigId: string;
  runId?: string;
  context: ConversationContext;
}) {
  const preparedInput = prepareConversationAnalysisInput(input.context);
  const imageParts = await imagePartsFromContext(input.context);
  const userPrompt = [
    'Hãy trả về đúng JSON theo schema với các yêu cầu sau:',
    '- summary.currentDiscussion: 2-4 câu ngắn, rõ người liên hệ đang nói gì và tình trạng hiện tại. Nếu họ đang chào hàng, phải nói rõ đây là lời chào bán cho doanh nghiệp.',
    '- summary.unansweredQuestions: tối đa 4 việc người liên hệ thực sự đang chờ làm rõ; không lặp câu đã được trả lời.',
    '- intent/emotion: đánh giá dựa trên các tin gần nhất, nhưng dùng lịch sử liên quan để tránh hiểu sai.',
    '- counterparty: phân loại vai trò đối phương so với doanh nghiệp. Phân biệt rõ người muốn MUA của doanh nghiệp với người đang BÁN/CHÀO HÀNG cho doanh nghiệp.',
    '- Nếu đối phương nói “bên em/chúng tôi chuyên cung cấp...” và chủ động giới thiệu dịch vụ thì thường là vendor, không phải prospect.',
    '- Chỉ chọn customer hoặc prospect khi có bằng chứng họ đang hỏi mua, xin báo giá, đặt hàng, cần hỗ trợ đơn hàng hoặc đã từng mua.',
    preparedInput.conversationKind === 'group'
      ? '- Đây là HỘI THOẠI NHÓM. groupAction chỉ actionable=true khi một thành viên cụ thể đang cần mua hàng/hỗ trợ từ doanh nghiệp và nhân viên còn việc phải làm. senderUid, senderName, messageId phải lấy nguyên từ transcript. Nếu không đủ bằng chứng hoặc chỉ là chào hàng/trao đổi nội bộ, trả actionable=false hoặc null.'
      : '- Đây là hội thoại 1-1. Luôn trả groupAction=null.',
    imageParts.length
      ? `- Có ${imageParts.length} ảnh gần nhất do người liên hệ gửi được đính kèm sau phần dữ liệu. Hãy đọc nội dung nhìn thấy trong ảnh để làm rõ ngữ cảnh, nhưng không suy đoán phần bị mờ hoặc không đọc được.`
      : '- Nếu transcript chỉ ghi [Hình ảnh] mà không có ảnh đính kèm, phải nói rõ chưa đọc được nội dung ảnh và không suy đoán nhu cầu.',
    '- memories: tối đa 5 ghi nhớ dài hạn; value phải là tiếng Việt có dấu và evidenceMessageIds phải tồn tại trong transcript.',
    '- Ví dụ chuẩn hóa: "khach noi se kiem tra con thieu khung noi khong" → "Khách cho biết sẽ kiểm tra lại xem còn thiếu khung nối hay không."',
    JSON.stringify({
      allowedMemoryKeys: CUSTOMER_MEMORY_KEYS,
      preparedConversation: preparedInput,
    }),
  ].join('\n');
  const request: AIClientRequest<CombinedAnalysisOutput> = {
    orgId: input.orgId,
    modelConfigId: input.modelConfigId,
    runId: input.runId,
    taskType: 'conversation_analysis_combined',
    maxTokens: 1500,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: CONVERSATION_ANALYSIS_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: imageParts.length
          ? [{ type: 'text', text: userPrompt }, ...imageParts]
          : userPrompt,
      },
    ],
    structuredOutput: {
      name: 'conversation_analysis_combined',
      schema: combinedSchema(),
      validate: isCombinedOutput,
    },
  };
  let response: AIClientResponse<CombinedAnalysisOutput>;
  try {
    response = await aiClient.complete<CombinedAnalysisOutput>(request);
  } catch (error) {
    if (!imageParts.length) throw error;
    response = await aiClient.complete<CombinedAnalysisOutput>({
      ...request,
      taskType: 'conversation_analysis_combined_text_fallback',
      messages: [request.messages[0], {
        role: 'user',
        content: `${userPrompt}\nNhà cung cấp AI không đọc được ảnh đính kèm trong lần này; chỉ phân tích phần văn bản và tuyệt đối không suy đoán nội dung ảnh.`,
      }],
    });
  }
  let output = response.structured!;
  if (outputNeedsLanguageRepair(output)) {
    response = await aiClient.complete<CombinedAnalysisOutput>({
      ...request,
      taskType: 'conversation_analysis_language_repair',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Bạn là bộ kiểm tra tiếng Việt cho dữ liệu CRM.',
            'Giữ nguyên toàn bộ sự kiện, enum, key, số liệu và evidenceMessageIds.',
            'Chỉ sửa các chuỗi mô tả thành tiếng Việt tự nhiên, chuẩn UTF-8, có dấu đầy đủ.',
            'Dịch các câu tiếng Anh sang tiếng Việt; không thêm hoặc suy đoán dữ kiện mới.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify({ outputToRepair: output }) },
      ],
    });
    output = response.structured!;
  }
  const latestContactText = preparedInput.conversationState.latestContactMessage?.content ?? '';
  const fallbackIntent = await analyzeIntentText(latestContactText);
  const fallbackEmotion = await analyzeEmotionMessages(
    preparedInput.transcript.filter((message) => message.speaker === 'Người liên hệ').map((message) => message.content),
  );
  const intent: IntentOutput = {
    ...fallbackIntent,
    primary_intent: output.intent.primary_intent,
    secondary_intents: output.intent.secondary_intents.filter((item) => item !== output.intent.primary_intent).slice(0, 3),
    confidence: clamp(output.intent.confidence),
    missing_information: output.intent.missing_information.map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 8),
    requires_human: output.intent.requires_human,
    reason: cleanText(output.intent.reason, 500),
  };
  const emotion: EmotionOutput = {
    ...fallbackEmotion,
    emotion: output.emotion.emotion,
    confidence: clamp(output.emotion.confidence),
    intensity: clamp(output.emotion.intensity),
    suggested_tone: output.emotion.suggested_tone,
    escalation_required: output.emotion.escalation_required,
    explanation: cleanText(output.emotion.explanation, 500),
  };
  const summary: Partial<ShortTermConversationSummary> = {
    currentDiscussion: cleanText(output.summary.currentDiscussion, 2000),
    unansweredQuestions: output.summary.unansweredQuestions.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 4),
    currentProduct: output.summary.currentProduct ? cleanText(output.summary.currentProduct, 800) : null,
    currentEmotion: output.summary.currentEmotion ? cleanText(output.summary.currentEmotion, 400) : null,
  };
  const counterparty = resolveCounterpartyAssessment(output.counterparty, preparedInput.transcript.map((message) => ({
    senderType: message.speaker === 'Người liên hệ' ? 'contact' : message.speaker === 'Nhân viên' ? 'self' : 'system',
    content: message.content,
  })));
  const groupAction = (() => {
    if (preparedInput.conversationKind !== 'group' || !output.groupAction?.actionable) return null;
    const evidence = preparedInput.transcript.find((message) => message.messageId === output.groupAction?.messageId);
    if (!evidence || evidence.speaker !== 'Người liên hệ') return null;
    if (output.groupAction.senderUid && evidence.senderUid && output.groupAction.senderUid !== evidence.senderUid) return null;
    return {
      actionable: true,
      senderUid: evidence.senderUid,
      senderName: evidence.senderName || cleanText(output.groupAction.senderName, 160) || null,
      messageId: evidence.messageId,
      request: cleanText(output.groupAction.request, 900) || summary.currentDiscussion || null,
      requiredAction: cleanText(output.groupAction.requiredAction, 700) || null,
      reason: cleanText(output.groupAction.reason, 500) || null,
    };
  })();
  return {
    preparedInput,
    summary,
    intent,
    emotion,
    counterparty,
    memories: memoryCandidates(output, preparedInput),
    groupAction,
    model: response.model,
    provider: response.provider,
    usage: response.usage,
  };
}
