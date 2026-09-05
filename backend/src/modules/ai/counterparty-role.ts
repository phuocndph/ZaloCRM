export const COUNTERPARTY_CLASSIFIER_VERSION = 2;

export const COUNTERPARTY_ROLES = [
  'customer',
  'prospect',
  'vendor',
  'partner',
  'recruiter',
  'personal',
  'spam',
  'unknown',
] as const;

export type CounterpartyRole = typeof COUNTERPARTY_ROLES[number];

export type CounterpartyAssessment = {
  role: CounterpartyRole;
  confidence: number;
  reason: string;
};

type ConversationMessage = {
  senderType?: string | null;
  content?: string | null;
};

const CUSTOMER_ROLES = new Set<CounterpartyRole>(['customer', 'prospect']);
const NON_CUSTOMER_ROLES = new Set<CounterpartyRole>(['vendor', 'partner', 'recruiter', 'personal', 'spam']);

const SELLER_IDENTITY = /\b(?:ben em|cong ty (?:em|chung toi)|don vi (?:em|chung toi)|chung toi|shop em|doi ngu ben em)\b/i;
const SELLER_OFFER = /\b(?:chuyen cung cap|cung cap|phan phoi|san xuat|nhan (?:lam|thiet ke|thi cong)|dich vu|giai phap|san pham ben em|bao gia ben em|hop tac|dai ly|si toan quoc)\b/i;
const DIRECT_OUTREACH = /\b(?:xin phep (?:gioi thieu|ket noi)|gioi thieu den|moi (?:anh|chi|quy cong ty) tham khao|chao hang|tim doi tac|tuyen dai ly|mo dai ly|gui (?:anh|chi) tham khao)\b/i;
const RECRUITING = /\b(?:tuyen dung|tuyen nhan vien|ung tuyen|viec lam|muc luong|cv cua em)\b/i;
// Only count a purchase request when it is owned by the sender. Phrases such
// as "anh/chị muốn mua" are usually a vendor addressing our staff, not proof
// that the sender is buying from us.
const BUYER_SELF_NEED = /\b(?:toi|minh|ben minh|cong ty minh|chung toi|ben em|cong ty em)\b(?:(?!\b(?:anh|chi|quy cong ty)\b).){0,90}\b(?:can mua|muon mua|can dat|muon dat|dang can|co nhu cau|can bao gia|xin bao gia|cho xin bao gia|hoi gia|dat hang|mua|lay|chot)\b/i;
const BUYER_NEED = /\b(?:toi|minh|ben minh|cong ty minh|chung toi)\b.{0,70}\b(?:can mua|muon mua|can dat|muon dat|can bao gia|xin bao gia|hoi gia|lay|chot)\b/i;
const BUYER_QUESTION = /\b(?:shop|ben ban|ben minh|cong ty minh)\b.{0,55}\b(?:co|con|ban|nhan lam|giao|bao hanh)\b.{0,30}\b(?:khong|ko|k)\b/i;
const BUYER_ACTION = /\b(?:bao gia cho (?:toi|minh|anh|chi)|cho (?:toi|minh|anh|chi) xin gia|toi dat|minh dat|toi mua|minh mua|chot don|dat hang)\b/i;
const BULK_PROMOTION = /(?:https?:\/\/|www\.)\S+.*\b(?:khuyen mai|uu dai|giam gia|dang ky|tham gia)\b|\b(?:casino|vay nong|kiem tien online|loi nhuan)\b/i;

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizeCounterpartyText(value: string) {
  return value
    .normalize('NFD')
    .toLocaleLowerCase('vi-VN')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s:/._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCounterpartyRole(value: unknown): value is CounterpartyRole {
  return typeof value === 'string' && (COUNTERPARTY_ROLES as readonly string[]).includes(value);
}

export function normalizeCounterpartyAssessment(value: unknown): CounterpartyAssessment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<CounterpartyAssessment>;
  if (!isCounterpartyRole(candidate.role) || typeof candidate.confidence !== 'number') return null;
  return {
    role: candidate.role,
    confidence: clamp(candidate.confidence),
    reason: String(candidate.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
  };
}

export function assessCounterpartyHeuristically(messages: ConversationMessage[]): CounterpartyAssessment {
  const inbound = messages
    .filter((message) => message.senderType === 'contact' && message.content?.trim())
    .slice(-16)
    .map((message) => normalizeCounterpartyText(message.content ?? ''))
    .filter(Boolean);
  if (!inbound.length) return { role: 'unknown', confidence: 0.2, reason: 'Chưa có đủ tin nhắn từ đối phương để phân loại.' };

  let sellerScore = 0;
  let buyerScore = 0;
  let recruiterScore = 0;
  let spamScore = 0;
  let explicitBuyerRequest = false;
  for (const text of inbound) {
    const sellerIdentity = SELLER_IDENTITY.test(text);
    const sellerOffer = SELLER_OFFER.test(text);
    if (sellerIdentity && sellerOffer) sellerScore += 3;
    else if (sellerOffer) sellerScore += 1;
    if (DIRECT_OUTREACH.test(text)) sellerScore += 2;
    if (RECRUITING.test(text)) recruiterScore += 2;
    if (BUYER_SELF_NEED.test(text)) {
      buyerScore += 4;
      explicitBuyerRequest = true;
    } else if (BUYER_NEED.test(text)) buyerScore += 3;
    if (BUYER_QUESTION.test(text)) buyerScore += 2;
    if (BUYER_ACTION.test(text)) buyerScore += 3;
    if (BULK_PROMOTION.test(text)) spamScore += 2;
  }

  if (spamScore >= 2 && buyerScore === 0) {
    return { role: 'spam', confidence: 0.92, reason: 'Tin nhắn mang dạng quảng bá hàng loạt hoặc nội dung không liên quan.' };
  }
  if (recruiterScore >= 2 && buyerScore === 0) {
    return { role: 'recruiter', confidence: 0.86, reason: 'Đối phương đang trao đổi tuyển dụng hoặc tìm việc, không phải nhu cầu mua hàng.' };
  }
  // "Bên em chuyên cung cấp..., anh/chị muốn mua..." is an outbound pitch
  // disguised as a commercial question. An explicit first-person purchase
  // request is the exception: it represents a business buying from us.
  if (sellerScore >= 2 && !explicitBuyerRequest && sellerScore >= buyerScore) {
    return { role: 'vendor', confidence: sellerScore >= 4 ? 0.94 : 0.82, reason: 'Đối phương đang chủ động giới thiệu hoặc chào bán sản phẩm, dịch vụ cho doanh nghiệp.' };
  }
  if (buyerScore >= 2 && buyerScore >= sellerScore) {
    return { role: 'prospect', confidence: buyerScore >= 4 ? 0.9 : 0.76, reason: 'Đối phương đang hỏi mua, xin báo giá hoặc thể hiện nhu cầu sử dụng sản phẩm, dịch vụ.' };
  }
  return { role: 'unknown', confidence: 0.4, reason: 'Chưa có đủ bằng chứng để xác định đây là khách mua hàng hay đối tượng khác.' };
}

export function resolveCounterpartyAssessment(
  modelAssessment: unknown,
  messages: ConversationMessage[],
): CounterpartyAssessment {
  const model = normalizeCounterpartyAssessment(modelAssessment);
  const heuristic = assessCounterpartyHeuristically(messages);
  if (!model) return heuristic;
  if (NON_CUSTOMER_ROLES.has(heuristic.role) && heuristic.confidence >= 0.8
    && (model.role === 'unknown' || model.confidence < 0.75)) {
    return heuristic;
  }
  if (CUSTOMER_ROLES.has(heuristic.role) && heuristic.confidence >= 0.8
    && model.role === 'unknown') {
    return heuristic;
  }
  return model;
}

export function isConfirmedNonCustomer(assessment: CounterpartyAssessment | null | undefined) {
  return !!assessment && NON_CUSTOMER_ROLES.has(assessment.role) && assessment.confidence >= 0.62;
}

export function isConfirmedSalesTarget(assessment: CounterpartyAssessment | null | undefined) {
  return !!assessment && CUSTOMER_ROLES.has(assessment.role) && assessment.confidence >= 0.55;
}

export function shouldCreateSalesWorkItem(input: {
  assessment?: CounterpartyAssessment | null;
  messages?: ConversationMessage[];
  intent?: string | null;
  stage?: string | null;
}) {
  const heuristic = assessCounterpartyHeuristically(input.messages ?? []);
  if (input.assessment) {
    // The stored assessment has already combined the model and heuristics.
    // Reapplying a one-message heuristic here can invert a correct result.
    if (isConfirmedNonCustomer(input.assessment)) return false;
    if (isConfirmedSalesTarget(input.assessment)) return true;
    // Once the current classifier has explicitly returned unknown, do not revive
    // the task from a broad legacy intent such as product_inquiry or quote_request.
    return false;
  }
  if (isConfirmedNonCustomer(heuristic)) return false;
  if (isConfirmedSalesTarget(heuristic)) return true;
  const customerIntents = new Set([
    'product_inquiry', 'price_inquiry', 'quote_request', 'product_comparison',
    'shipping_inquiry', 'warranty_inquiry', 'discount_request', 'order_intent',
    'complaint', 'return_or_refund', 'payment_inquiry', 'follow_up_response', 'human_request',
  ]);
  const customerStages = new Set(['qualified', 'quoted', 'negotiating', 'payment_pending', 'won', 'post_sale']);
  return customerIntents.has(String(input.intent ?? '')) || customerStages.has(String(input.stage ?? ''));
}
