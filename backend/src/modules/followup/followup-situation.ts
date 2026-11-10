export const LEGACY_FOLLOWUP_SALE_TASK_TITLE = 'Gọi hoặc nhắn trực tiếp để làm rõ vướng mắc sau báo giá';

type FollowupMessage = {
  senderType: string;
  contentType?: string | null;
  content?: string | null;
  isDeleted?: boolean;
  redacted?: boolean;
};
export type FollowupSituationInput = {
  saleTaskTitle?: string | null;
  conversation: { messages?: FollowupMessage[]; lastMessageAt?: Date | null; redacted?: boolean } | null;
  now: Date;
};

/** Presentation only: no side effects, message drafts, or automation decisions. */
export function presentFollowupSituation(input: FollowupSituationInput) {
  if (input.conversation?.redacted) return {
    situation: 'hidden', title: 'Công việc follow-up trong hội thoại riêng tư',
    nextAction: 'Nhân viên có quyền xem cần xác minh bối cảnh trước khi liên hệ.',
    customerSituation: 'Nội dung hội thoại đang được bảo vệ.',
    reason: 'Không phân tích nội dung hội thoại khi chưa được phép xem.',
  };
  if (input.saleTaskTitle?.trim() && input.saleTaskTitle !== LEGACY_FOLLOWUP_SALE_TASK_TITLE) return {
    situation: 'manual', title: input.saleTaskTitle, nextAction: input.saleTaskTitle,
    customerSituation: 'Workflow đang chờ nhân viên thực hiện công việc đã chỉ định.',
    reason: 'Giữ nguyên nội dung công việc do nhân viên chỉ định.',
  };
  const messages = input.conversation?.messages?.slice(0, 12) ?? [];
  const priceObjection = messages.some((message) => message.senderType === 'contact'
    && !message.redacted && !message.isDeleted && (!message.contentType || message.contentType === 'text')
    && /giá\s+cao|đắt\s+hơn|giảm\s+giá|giá\s+mềm|(?:giá|báo\s+giá)[^.!?\n]{0,60}cao\s+hơn/iu.test(message.content ?? ''));
  if (priceObjection) return {
    situation: 'price_objection',
    title: 'Xác nhận nhu cầu hiện tại và làm rõ chênh lệch giá',
    nextAction: 'Xác nhận nhu cầu hiện tại; làm rõ quy cách, chất liệu, số lượng và điều kiện giao hàng để so sánh tương đương.',
    customerSituation: 'Trao đổi gần đây có băn khoăn về giá; cần xác nhận lại nhu cầu và cơ sở so sánh.',
    reason: 'Nhân viên cần làm rõ thông tin trước khi tư vấn phương án phù hợp.',
  };
  if (input.conversation?.lastMessageAt
    && input.now.getTime() - input.conversation.lastMessageAt.getTime() > 14 * 86400000) return {
    situation: 'stale', title: 'Xác nhận lại nhu cầu hiện tại',
    nextAction: 'Xác nhận lại nhu cầu hiện tại, thời điểm dự kiến và quy cách cần mua trước khi tư vấn tiếp.',
    customerSituation: 'Hội thoại đã hơn 14 ngày chưa có tương tác; nhu cầu trước đây có thể đã thay đổi.',
    reason: 'Không mặc định nhu cầu hoặc báo giá cũ còn phù hợp.',
  };
  const quoteEvidence = messages.some((message) => message.senderType === 'self'
    && !message.redacted && !message.isDeleted && (!message.contentType || message.contentType === 'text')
    && /(?:đã\s+gửi\s+(?:bảng\s+)?báo\s+giá|(?:em|mình|tôi|bên\s+em)\s+gửi\s+(?:anh|chị|bạn)\s+(?:bảng\s+)?báo\s+giá)/iu.test(message.content ?? '')
    && !/(?:chưa|không|sẽ)\s+(?:gửi|đã\s+gửi)/iu.test(message.content ?? ''));
  if (!quoteEvidence) return {
    situation: 'unknown', title: 'Xác minh bối cảnh trước khi liên hệ',
    nextAction: 'Nhân viên rà lại bối cảnh và xác nhận nhu cầu trước khi liên hệ; không tự động gửi follow-up.',
    customerSituation: 'Chưa đủ bằng chứng trong trao đổi được phép xem để xác nhận bối cảnh báo giá.',
    reason: 'Cần nhân viên xác minh; không suy diễn đã gửi báo giá từ tên workflow hoặc tệp đính kèm.',
  };
  return {
    situation: 'ordinary', title: 'Liên hệ theo dõi nhu cầu khách hàng',
    nextAction: 'Rà lại trao đổi gần nhất, liên hệ theo nhu cầu khách hàng và ghi nhận kết quả xử lý.',
    customerSituation: 'Workflow đang chờ nhân viên xử lý.',
    reason: 'Workflow đang tạm dừng tại bước cần nhân viên thực hiện.',
  };
}
