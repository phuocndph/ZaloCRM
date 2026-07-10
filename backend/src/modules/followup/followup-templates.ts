// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════════
// Kho chiến dịch mẫu (Campaign Template Library) — Follow-up.
//
// THIẾT KẾ: template là DỮ LIỆU TĨNH TRONG CODE, không phải bảng DB. Vì:
//   1. "Không được sửa trực tiếp chiến dịch mẫu gốc" → bất biến theo thiết kế.
//   2. "Cập nhật nội dung mẫu KHÔNG ảnh hưởng chiến dịch đã tạo" → chiến dịch tạo ra
//      là BẢN SAO độc lập (copy steps vào followup_workflows), sửa mẫu về sau không đụng.
//   3. Không cần migration; thêm mẫu mới = thêm 1 object vào mảng dưới.
//
// Mở rộng: mỗi mẫu có `key` (ổn định), `category`, `tags`, `version` → tìm kiếm / lọc /
// phân nhóm chạy hoàn toàn ở client. "Yêu thích" lưu localStorage theo `key`.
//
// Ngành hàng: đồ vải khách sạn (chăn ga gối nệm, đệm, khăn) — Joliefam.
// ════════════════════════════════════════════════════════════════════════════

import type { StepInput, WorkflowInput } from './followup-service.js';
import { lintWorkflow } from './followup-lint.js';

export type WaitUnit = 'hour' | 'day' | 'week';

export interface TemplateStep extends StepInput {
  /** Bước này LÀM GÌ — hiển thị trong phần giải thích luồng. */
  explain: string;
  /** Khi nào / theo điều kiện gì thì sang bước kế. */
  transition?: string;
}

export interface FollowupTemplate {
  key: string;              // định danh ổn định, dùng cho URL + localStorage favorite
  name: string;
  category: string;         // nhóm hiển thị
  tags: string[];
  version: number;          // tăng khi sửa nội dung mẫu (không ảnh hưởng chiến dịch đã tạo)

  type: string;             // map sang FollowupWorkflow.type
  goal: string;             // Mục tiêu (chữ, cho người đọc)
  audience: string;         // Đối tượng phù hợp
  shortDescription: string; // Mô tả ngắn (thẻ)

  intro: string;            // Giới thiệu chiến dịch
  whenToUse: string[];      // Khi nào nên sử dụng
  endConditions: string[];  // Điều kiện kết thúc chiến dịch
  expectedOutcome: string;  // Kết quả mong muốn

  config: {
    goalType: string;
    goalTag?: string | null;
    goalTagOnReach?: string | null;
    stopOnPurchase: boolean;
    stopOnTags: string[];
    maxMessages: number;
    sendWindowStart?: number;
    sendWindowEnd?: number;
    minGapMinutes?: number;
  };

  steps: TemplateStep[];
}

// ── Helper dựng step cho gọn ────────────────────────────────────────────────
const S = (i: number, k: string, content: string, next: string | null, explain: string, transition?: string): TemplateStep =>
  ({ key: k, type: 'send', orderIndex: i, config: { content }, nextKey: next, explain, transition });
const W = (i: number, k: string, amount: number, unit: WaitUnit, next: string | null, explain: string): TemplateStep =>
  ({ key: k, type: 'wait', orderIndex: i, config: { amount, unit }, nextKey: next, explain, transition: `Sau ${amount} ${unitLabel(unit)}` });
const C = (i: number, k: string, check: string, trueKey: string, falseKey: string, explain: string, tag?: string): TemplateStep =>
  ({ key: k, type: 'condition', orderIndex: i, config: { check, tag, trueKey, falseKey }, nextKey: null, explain, transition: 'ĐÚNG → nhánh A · SAI → nhánh B' });
const T = (i: number, k: string, title: string, next: string | null, explain: string, note?: string): TemplateStep =>
  ({ key: k, type: 'sale_task', orderIndex: i, config: { title, note }, nextKey: next, explain, transition: 'Tạm dừng tới khi Sale bấm "Hoàn thành"' });
const TAG = (i: number, k: string, tag: string, next: string | null, explain: string): TemplateStep =>
  ({ key: k, type: 'tag_add', orderIndex: i, config: { tag }, nextKey: next, explain, transition: 'Chuyển ngay' });
const START = (next: string): TemplateStep => ({ key: 'start', type: 'start', orderIndex: 0, nextKey: next, explain: 'Khách được thêm vào chiến dịch', transition: 'Chuyển ngay' });
const END = (i: number): TemplateStep => ({ key: 'end', type: 'end', orderIndex: i, explain: 'Kết thúc chiến dịch' });

function unitLabel(u: WaitUnit) { return u === 'hour' ? 'giờ' : u === 'week' ? 'tuần' : 'ngày'; }

const WINDOW = { sendWindowStart: 480, sendWindowEnd: 1080, minGapMinutes: 1440 };
const DND = ['Không làm phiền'];

// ════════════════════════════════════════════════════════════════════════════
// 10 mẫu. Thêm mẫu mới = thêm 1 object vào mảng này.
// ════════════════════════════════════════════════════════════════════════════
export const FOLLOWUP_TEMPLATES: FollowupTemplate[] = [
  {
    key: 'new-customer-care',
    name: 'Chăm sóc khách mới',
    category: 'Khách mới',
    tags: ['khách mới', 'giới thiệu', 'phản hồi'],
    version: 1,
    type: 'intro',
    goal: 'Khách phản hồi lại tin nhắn',
    audience: 'Chủ khách sạn / homestay / resort vừa để lại thông tin, chưa từng trao đổi',
    shortDescription: 'Chạm đầu tiên: giới thiệu doanh nghiệp, gửi catalogue, nhắc lại nếu khách im lặng.',
    intro:
      'Chiến dịch mở đầu quan hệ với khách hoàn toàn mới. Mục tiêu duy nhất là khiến khách phản hồi — ' +
      'chưa bán hàng, chưa báo giá. Nếu sau 2 lần nhắn khách vẫn im, hệ thống giao việc cho Sale gọi điện.',
    whenToUse: [
      'Khách vừa được thêm từ quét nhóm hoặc tệp khách hàng, chưa từng chat',
      'Bạn muốn đo xem khách có quan tâm không trước khi đầu tư thời gian',
    ],
    endConditions: [
      'Khách phản hồi (đạt mục tiêu) → dừng ngay, gắn tag "Đã phản hồi"',
      'Khách có tag "Không làm phiền" hoặc "Đã mua"',
      'Đã gửi hết 2 tin và Sale đã gọi điện',
    ],
    expectedOutcome: 'Phân loại được khách quan tâm / không quan tâm chỉ sau ~5 ngày, không tốn công Sale.',
    config: { goalType: 'replied', goalTagOnReach: 'Đã phản hồi', stopOnPurchase: true, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Chào {{name}}! Em là Phước bên Joliefam, chuyên chăn ga gối nệm, đệm và khăn cho khách sạn, homestay, resort. Vải cotton kháng khuẩn, bền màu sau nhiều lần giặt công nghiệp. Bên mình đang setup phòng mới hay cần thay đồ vải ạ?', 'w1',
        'Gửi tin giới thiệu đầu tiên, hỏi mở để khách dễ trả lời'),
      W(2, 'w1', 2, 'day', 'c1', 'Chờ khách đọc và cân nhắc'),
      C(3, 'c1', 'not_replied', 's2', 'end', 'Kiểm tra khách đã phản hồi chưa. Nếu đã phản hồi → kết thúc (mục tiêu đạt được)'),
      S(4, 's2', 'Dạ em gửi anh/chị catalogue và bảng giá đồ vải khách sạn Joliefam. Bên em may theo đúng size phòng và gửi hàng mẫu trước khi chốt. Anh/chị cần báo giá cho bao nhiêu phòng ạ?', 'w2',
        'Nhắc lần 2 kèm giá trị cụ thể (catalogue, hàng mẫu)'),
      W(5, 'w2', 3, 'day', 'c2', 'Chờ thêm 3 ngày'),
      C(6, 'c2', 'not_replied', 't1', 'end', 'Vẫn im lặng sau 2 tin → chuyển cho người thật'),
      T(7, 't1', 'Gọi điện giới thiệu sản phẩm', 'end', 'Giao việc cho Sale gọi điện — tin nhắn đã hết tác dụng', 'Khách chưa phản hồi sau 2 tin nhắn.'),
      END(8),
    ],
  },

  {
    key: 'after-quote',
    name: 'Follow-up sau báo giá',
    category: 'Chốt đơn',
    tags: ['báo giá', 'chốt đơn', 'ưu đãi'],
    version: 2,
    type: 'after_quote',
    goal: 'Khách chốt đơn (có tag "Đã mua")',
    audience: 'Khách đã nhận báo giá nhưng chưa phản hồi quyết định',
    shortDescription: 'Bám đuổi sau báo giá: nhắc xem giá, tung ưu đãi, cuối cùng giao Sale gọi chốt.',
    intro:
      'Giai đoạn dễ mất khách nhất là sau khi gửi báo giá. Chiến dịch này giữ nhịp liên lạc, ' +
      'đưa thêm lý do để khách quyết định, và bàn giao cho Sale đúng lúc.',
    whenToUse: [
      'Vừa gửi báo giá xong, khách chưa trả lời',
      'Khách nói "để em xem lại" rồi im',
    ],
    endConditions: [
      'Khách mua hàng (đạt mục tiêu) → gắn thẻ "Đã chốt", kết thúc. (Muốn tự chuyển sang "Chăm sóc sau bán hàng", chọn nó ở ô "Chiến dịch kế tiếp" trong trang chỉnh sửa.)',
      'Khách có tag "Không làm phiền"',
      'Sale đã gọi chốt đơn',
    ],
    expectedOutcome: 'Tăng tỉ lệ chốt sau báo giá, không để khách "nguội" vì quên follow.',
    config: { goalType: 'purchased', goalTagOnReach: 'Đã chốt', stopOnPurchase: false, stopOnTags: DND, maxMessages: 3, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Dạ {{name}} đã xem qua báo giá bên em chưa ạ? Nếu cần em điều chỉnh theo số lượng phòng hoặc đổi chất liệu, anh/chị cứ nhắn em nhé.', 'w1',
        'Nhắc nhẹ, mở đường cho khách nêu vướng mắc về giá/chất liệu'),
      W(2, 'w1', 2, 'day', 'c1', 'Chờ 2 ngày'),
      C(3, 'c1', 'not_replied', 's2', 'end', 'Khách đã trả lời → kết thúc, để Sale trao đổi trực tiếp'),
      S(4, 's2', 'Dạ bên em đang có ưu đãi cho đơn từ 20 phòng: tặng kèm 2 bộ ga trải và miễn phí vận chuyển. Em giữ mức giá này tới cuối tuần, anh/chị cân nhắc giúp em ạ.', 'w2',
        'Tạo lý do quyết định: ưu đãi có thời hạn'),
      W(5, 'w2', 3, 'day', 'c2', 'Chờ 3 ngày'),
      C(6, 'c2', 'not_replied', 't1', 'end', 'Hết cách qua tin nhắn → người thật vào cuộc'),
      T(7, 't1', 'Gọi chốt đơn sau báo giá', 'end', 'Sale gọi trực tiếp để gỡ nút thắt', 'Khách im sau 2 lần nhắc.'),
      END(8),
    ],
  },

  {
    key: 'viewed-not-bought',
    name: 'Khách đã xem nhưng chưa mua',
    category: 'Chốt đơn',
    tags: ['do dự', 'quan tâm', 'thuyết phục'],
    version: 1,
    type: 'care',
    goal: 'Khách phản hồi / yêu cầu báo giá lại',
    audience: 'Khách đã xem hàng mẫu hoặc hỏi giá nhưng chưa quyết định',
    shortDescription: 'Gỡ băn khoăn bằng bằng chứng: mẫu vải, chính sách đổi trả, khách đã dùng.',
    intro:
      'Khách quan tâm nhưng chưa mua thường vướng ở lòng tin (chất lượng, bảo hành) chứ không phải giá. ' +
      'Chiến dịch này đưa bằng chứng thay vì giảm giá.',
    whenToUse: ['Khách đã nhận mẫu vải', 'Khách hỏi giá rồi im', 'Khách so sánh với nhà cung cấp khác'],
    endConditions: ['Khách phản hồi', 'Khách mua hàng', 'Có tag "Không làm phiền"', 'Đã gửi hết 2 tin'],
    expectedOutcome: 'Chuyển khách do dự thành khách yêu cầu báo giá chính thức.',
    config: { goalType: 'replied', goalTagOnReach: 'Quan tâm trở lại', stopOnPurchase: true, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Dạ {{name}} còn băn khoăn điểm nào về đồ vải bên em không ạ? Bên em cho đổi trả trong 7 ngày nếu vải không đúng mô tả, và bảo hành đường may 6 tháng.', 'w1',
        'Gỡ rủi ro cảm nhận: đổi trả + bảo hành'),
      W(2, 'w1', 3, 'day', 'c1', 'Chờ 3 ngày'),
      C(3, 'c1', 'not_replied', 's2', 'end', 'Chưa phản hồi → đưa bằng chứng xã hội'),
      S(4, 's2', 'Dạ hiện có hơn 60 khách sạn và homestay ở Hà Nội đang dùng đồ vải Joliefam. Em gửi anh/chị vài hình ảnh phòng thực tế để tham khảo nhé?', 'end',
        'Bằng chứng xã hội + lời mời nhẹ nhàng'),
      END(5),
    ],
  },

  {
    key: 'old-customer-care',
    name: 'Chăm sóc khách cũ',
    category: 'Giữ chân',
    tags: ['khách cũ', 'giữ chân', 'quan hệ'],
    version: 1,
    type: 'care',
    goal: 'Khách phản hồi, duy trì quan hệ',
    audience: 'Khách đã mua ít nhất 1 lần, quan hệ còn tốt',
    shortDescription: 'Hỏi thăm định kỳ, chia sẻ mẹo bảo quản — không bán hàng.',
    intro:
      'Chiến dịch giữ ấm quan hệ, KHÔNG chào bán. Mục tiêu là để khách nhớ tới mình khi có nhu cầu. ' +
      'Vì khách đã mua, chiến dịch tắt điều kiện "dừng khi đã mua".',
    whenToUse: ['Sau khi chiến dịch chăm sóc sau bán kết thúc', 'Định kỳ với khách thân thiết'],
    endConditions: ['Khách phản hồi', 'Có tag "Không làm phiền"', 'Đã gửi hết 2 tin'],
    expectedOutcome: 'Khách nhớ thương hiệu, tăng khả năng quay lại và giới thiệu.',
    config: { goalType: 'replied', goalTagOnReach: 'Đã phản hồi', stopOnPurchase: false, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Chào {{name}}, bên em chia sẻ một mẹo nhỏ: đồ vải khách sạn nên chọn cotton tỉ trọng cao để chịu được giặt công nghiệp, tránh xù lông sau vài tháng. Anh/chị đang dùng chất liệu nào ạ?', 'w1',
        'Cho giá trị trước, hỏi mở để khách kể chuyện'),
      W(2, 'w1', 14, 'day', 's2', 'Chờ 2 tuần — không làm phiền'),
      S(3, 's2', 'Dạ Joliefam vừa cập nhật mẫu chăn ga mới cho mùa cao điểm, form dày dặn hơn mà giá giữ nguyên. Anh/chị cần em gửi mẫu vải tham khảo không ạ?', 'end',
        'Chạm nhẹ thứ hai, có thể mở ra đơn mới'),
      END(4),
    ],
  },

  {
    key: 'review-request',
    name: 'Xin đánh giá sau khi mua',
    category: 'Sau bán',
    tags: ['đánh giá', 'review', 'uy tín'],
    version: 2,
    type: 'post_sale',
    goal: 'Thu được đánh giá từ khách hài lòng',
    audience: 'Khách vừa nhận hàng và đã dùng được vài ngày',
    shortDescription: 'Hỏi cảm nhận trước, chỉ xin đánh giá khi khách hài lòng.',
    intro:
      'Không xin đánh giá ngay. Hỏi cảm nhận trước để lọc khách chưa hài lòng (tránh review xấu), ' +
      'rồi mới mời đánh giá. Khách đã mua nên tắt "dừng khi đã mua".',
    whenToUse: ['5–7 ngày sau khi giao hàng', 'Sau khi chiến dịch chăm sóc sau bán kết thúc'],
    endConditions: [
      'Khách KHÔNG phản hồi sau 3 ngày → kết thúc, không làm phiền thêm',
      'Khách có phản hồi → gửi lời xin đánh giá, gắn thẻ "Đã xin đánh giá", kết thúc',
      'Có tag "Không làm phiền"',
    ],
    expectedOutcome: 'Thu được đánh giá thật từ khách hài lòng, phát hiện sớm khách không hài lòng.',
    // KHÔNG đặt Goal='replied': engine kết thúc chiến dịch NGAY khi khách phản hồi ⇒ bước
    // xin đánh giá (chỉ chạy khi khách ĐÃ phản hồi) sẽ không bao giờ gửi được.
    config: { goalType: 'none', stopOnPurchase: false, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Dạ {{name}} dùng đồ vải bên em thấy ổn không ạ? Có điểm nào chưa ưng anh/chị nói giúp em để bên em hỗ trợ đổi hoặc bù ngay.', 'w1',
        'Hỏi cảm nhận — lọc khách chưa hài lòng TRƯỚC khi xin đánh giá'),
      W(2, 'w1', 3, 'day', 'c1', 'Chờ 3 ngày'),
      C(3, 'c1', 'replied', 's2', 'end', 'CHỈ khi khách đã phản hồi mới xin đánh giá. Im lặng → dừng, không làm phiền'),
      S(4, 's2', 'Dạ nếu anh/chị hài lòng, cho em xin một đánh giá ngắn để bên em có động lực làm tốt hơn ạ. Em cảm ơn anh/chị nhiều!', 'tg1',
        'Xin đánh giá đúng lúc khách đang có thiện cảm'),
      TAG(5, 'tg1', 'Đã xin đánh giá', 'end', 'Gắn thẻ để không xin lại lần sau'),
      END(6),
    ],
  },

  {
    key: 'reengage-cold',
    name: 'Khách lâu không tương tác',
    category: 'Đánh thức',
    tags: ['nguội', 'đánh thức', 'khách cũ'],
    version: 1,
    type: 'reengage',
    goal: 'Khách tương tác trở lại',
    audience: 'Khách im lặng nhiều tháng, có thể chưa là bạn Zalo',
    shortDescription: 'Kiểm tra quan hệ bạn bè trước; nếu chưa là bạn thì giao Sale kết bạn.',
    intro:
      'Khách nguội thường chưa là bạn Zalo → gửi tin sẽ thất bại. Chiến dịch chặn đầu bằng điều kiện ' +
      '"Đã là bạn". Nếu chưa, giao Sale kết bạn thay vì đốt tin nhắn.',
    whenToUse: ['Khách không tương tác > 60 ngày', 'Trước các đợt khuyến mại lớn'],
    endConditions: ['Khách phản hồi (đạt mục tiêu)', 'Chưa là bạn → giao Sale, kết thúc', 'Gắn tag "Nguội" nếu vẫn im'],
    expectedOutcome: 'Đánh thức được một phần khách nguội, phần còn lại được gắn tag để loại khỏi chiến dịch sau.',
    config: { goalType: 'replied', goalTagOnReach: 'Đã tương tác lại', stopOnPurchase: true, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('c0'),
      C(1, 'c0', 'is_friend', 's1', 't0', 'Chặn đầu: chưa là bạn Zalo thì không gửi được tin'),
      T(2, 't0', 'Kết bạn Zalo với khách trước khi chăm sóc', 'end', 'Giao Sale kết bạn — không đốt tin nhắn vô ích', 'Chưa là bạn nên không gửi tin được.'),
      S(3, 's1', 'Chào {{name}}, lâu rồi em chưa hỏi thăm ạ. Khách sạn/homestay của anh/chị dạo này thế nào? Bên em vừa ra mẫu khăn và đệm mới cho mùa cao điểm, em gửi anh/chị tham khảo nhé.', 'w1',
        'Hỏi thăm trước, chào hàng sau'),
      W(4, 'w1', 5, 'day', 'c1', 'Chờ 5 ngày'),
      C(5, 'c1', 'not_replied', 's2', 'end', 'Vẫn im → gửi tin chốt hạ lịch sự'),
      S(6, 's2', 'Dạ nếu hiện tại anh/chị chưa có nhu cầu, em xin phép không làm phiền thêm ạ. Khi nào cần đồ vải khách sạn, anh/chị cứ nhắn em nhé. Chúc anh/chị kinh doanh thuận lợi!', 'tg1',
        'Rút lui lịch sự — giữ thiện cảm cho lần sau'),
      TAG(7, 'tg1', 'Nguội', 'end', 'Gắn tag "Nguội" để loại khỏi các chiến dịch sau'),
      END(8),
    ],
  },

  {
    key: 'vip-care',
    name: 'Chăm sóc VIP',
    category: 'Giữ chân',
    tags: ['vip', 'ưu tiên', 'quan hệ'],
    version: 1,
    type: 'care',
    goal: 'Khách phản hồi, duy trì quan hệ ưu tiên',
    audience: 'Khách có tag "VIP" — mua nhiều hoặc chuỗi nhiều cơ sở',
    shortDescription: 'Chặn đầu bằng tag VIP; ưu đãi riêng và đường dây nóng.',
    intro:
      'Chỉ chạy cho khách được gắn tag "VIP". Nếu khách không có tag, chiến dịch kết thúc ngay ' +
      'mà không gửi gì — tránh tặng ưu đãi VIP nhầm người.',
    whenToUse: ['Khách chuỗi khách sạn', 'Khách mua lặp lại nhiều lần'],
    endConditions: ['Khách phản hồi', 'Không có tag "VIP" → kết thúc ngay', 'Có tag "Không làm phiền"'],
    expectedOutcome: 'Khách VIP cảm thấy được ưu tiên, tăng giá trị vòng đời.',
    config: { goalType: 'replied', goalTagOnReach: 'VIP đã phản hồi', stopOnPurchase: false, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('c0'),
      C(1, 'c0', 'has_tag', 's1', 'end', 'Chỉ chạy nếu khách có tag "VIP" — chặn tặng nhầm ưu đãi', 'VIP'),
      S(2, 's1', 'Chào {{name}}, cảm ơn anh/chị đã đồng hành cùng Joliefam. Bên em dành riêng cho khách thân thiết mức giá ưu tiên và giao hàng nhanh trong 48h. Anh/chị cần hỗ trợ gì cứ nhắn thẳng em nhé.', 'w1',
        'Khẳng định vị thế ưu tiên, cho kênh liên hệ trực tiếp'),
      W(3, 'w1', 7, 'day', 'c1', 'Chờ 1 tuần'),
      C(4, 'c1', 'not_replied', 's2', 'end', 'Chưa phản hồi → mời đặt lịch trao đổi'),
      S(5, 's2', 'Dạ em có thể sắp xếp gặp trực tiếp để tư vấn nâng cấp đồ vải cho mùa cao điểm. Anh/chị rảnh buổi nào trong tuần này ạ?', 'end',
        'Chuyển sang kênh gặp mặt — phù hợp giá trị đơn lớn'),
      END(6),
    ],
  },

  {
    key: 'payment-reminder',
    name: 'Nhắc thanh toán',
    category: 'Vận hành',
    tags: ['công nợ', 'thanh toán', 'nhắc nợ'],
    version: 1,
    type: 'custom',
    goal: 'Khách thanh toán / phản hồi về công nợ',
    audience: 'Khách đã nhận hàng, còn công nợ (gắn tag "Còn nợ")',
    shortDescription: 'Nhắc lịch sự 2 lần, sau đó giao Sale gọi điện. Không gửi tin thứ 3.',
    intro:
      'Nhắc nợ là việc nhạy cảm — chỉ nhắc tối đa 2 lần qua tin nhắn, sau đó bắt buộc chuyển người thật. ' +
      'Chặn đầu bằng tag "Còn nợ" để không nhắc nhầm khách đã trả.',
    whenToUse: ['Quá hạn thanh toán 3–7 ngày', 'Khách hứa chuyển khoản nhưng chưa thấy'],
    endConditions: ['Khách phản hồi', 'Không có tag "Còn nợ" → kết thúc ngay', 'Sale đã gọi điện'],
    expectedOutcome: 'Thu hồi công nợ mà không làm hỏng quan hệ.',
    config: { goalType: 'replied', goalTagOnReach: 'Đã phản hồi công nợ', stopOnPurchase: false, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('c0'),
      C(1, 'c0', 'has_tag', 's1', 'end', 'Chỉ chạy nếu khách thực sự còn nợ', 'Còn nợ'),
      S(2, 's1', 'Dạ em xin phép nhắc {{name}} về khoản thanh toán đơn đồ vải vừa rồi ạ. Nếu anh/chị đã chuyển khoản, bỏ qua giúp em tin này nhé.', 'w1',
        'Nhắc lần 1, luôn kèm câu "nếu đã chuyển thì bỏ qua" để lịch sự'),
      W(3, 'w1', 3, 'day', 'c1', 'Chờ 3 ngày'),
      C(4, 'c1', 'not_replied', 's2', 'end', 'Chưa phản hồi → nhắc lần cuối'),
      S(5, 's2', 'Dạ {{name}} cho em xin thông tin về lịch thanh toán để em báo lại kế toán ạ. Nếu có vướng mắc gì anh/chị nhắn em, mình cùng tìm cách nhé.', 'w2',
        'Nhắc lần 2, mở đường cho khách nêu khó khăn'),
      W(6, 'w2', 3, 'day', 'c2', 'Chờ thêm 3 ngày'),
      C(7, 'c2', 'not_replied', 't1', 'end', 'Hết 2 lần nhắc → BẮT BUỘC chuyển người thật, không nhắn thêm'),
      T(8, 't1', 'Gọi điện trao đổi công nợ', 'end', 'Sale gọi điện — tin nhắn không phải kênh xử lý công nợ', 'Đã nhắc 2 lần qua Zalo.'),
      END(9),
    ],
  },

  {
    key: 'birthday-greeting',
    name: 'Chúc mừng sinh nhật',
    category: 'Quan hệ',
    tags: ['sinh nhật', 'quan hệ', 'ưu đãi'],
    version: 2,
    type: 'birthday',
    goal: 'Khách phản hồi lời chúc',
    audience: 'Khách có ngày sinh trong hồ sơ, được Sale đưa vào đúng dịp',
    shortDescription: 'Một lời chúc, một ưu đãi nhỏ. Ngắn gọn, không bán hàng dai dẳng.',
    intro:
      'Chiến dịch ngắn nhất trong kho: 1 lời chúc + 1 ưu đãi. Không đeo bám. ' +
      'TỰ ĐỘNG: khi chiến dịch này ở trạng thái Kích hoạt, mỗi sáng 08:05 hệ thống tự đưa ' +
      'những khách có sinh nhật hôm nay vào chiến dịch (mỗi khách 1 lần/năm, chỉ khách đã là ' +
      'bạn Zalo, và bỏ qua khách đang chạy chiến dịch khác). Không kích hoạt thì không gửi gì.',
    whenToUse: [
      'Kích hoạt một lần rồi để chạy quanh năm — hệ thống tự quét mỗi ngày',
      'Khách phải có Ngày sinh trong hồ sơ và đã là bạn Zalo',
    ],
    endConditions: ['Khách phản hồi (đạt mục tiêu)', 'Có tag "Không làm phiền"', 'Đã gửi 1 tin'],
    expectedOutcome: 'Ghi điểm cảm xúc, mở lại kênh trò chuyện.',
    config: { goalType: 'replied', goalTagOnReach: 'Đã chúc sinh nhật', stopOnPurchase: false, stopOnTags: DND, maxMessages: 1, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Chúc mừng sinh nhật {{name}}! Joliefam chúc anh/chị thật nhiều sức khoẻ và công việc kinh doanh luôn thuận lợi. Bên em gửi anh/chị ưu đãi 10% cho đơn đồ vải trong tháng này như một món quà nhỏ ạ.', 'tg1',
        'Lời chúc chân thành + ưu đãi nhỏ, không kèm điều kiện phức tạp'),
      TAG(2, 'tg1', 'Đã chúc sinh nhật', 'end', 'Gắn tag để năm sau không gửi trùng'),
      END(3),
    ],
  },

  {
    key: 'post-sale-care',
    name: 'Chăm sóc sau bán hàng',
    category: 'Sau bán',
    tags: ['sau bán', 'hướng dẫn', 'phản hồi'],
    version: 1,
    type: 'post_sale',
    goal: 'Không đặt mục tiêu — chạy hết luồng để chăm sóc',
    audience: 'Khách vừa nhận hàng',
    shortDescription: 'Hướng dẫn bảo quản, thu phản hồi, kết thúc bằng gắn tag.',
    intro:
      'Chạy ngay sau khi giao hàng. Giảm khiếu nại (hướng dẫn giặt đúng cách) và phát hiện sớm vấn đề. ' +
      'Khách đã mua nên tắt "dừng khi đã mua" — nếu bật, chiến dịch sẽ dừng ngay ở bước đầu.',
    whenToUse: ['Ngay sau khi giao hàng thành công', 'Nối tiếp tự động sau chiến dịch "Follow-up sau báo giá"'],
    endConditions: ['Chạy hết luồng (~37 ngày)', 'Có tag "Không làm phiền"'],
    expectedOutcome: 'Giảm khiếu nại do giặt sai cách; thu được phản hồi thật; khách sẵn sàng mua lại.',
    config: { goalType: 'none', stopOnPurchase: false, stopOnTags: DND, maxMessages: 2, ...WINDOW },
    steps: [
      START('s1'),
      S(1, 's1', 'Cảm ơn {{name}} đã tin tưởng Joliefam ạ! Em gửi hướng dẫn bảo quản để giữ độ bền và màu vải: giặt nước dưới 40 độ C, không dùng chất tẩy mạnh, phơi tránh nắng gắt. Cần hỗ trợ gì anh/chị cứ nhắn em nhé.', 'w1',
        'Hướng dẫn bảo quản — giảm khiếu nại do giặt sai'),
      W(2, 'w1', 7, 'day', 's2', 'Chờ 1 tuần để khách dùng thử'),
      S(3, 's2', 'Dạ {{name}} dùng chăn ga bên em thấy ổn không ạ? Nếu có điểm nào chưa ưng, anh/chị phản hồi giúp em để bên em hỗ trợ đổi hoặc bù ngay ạ.', 'w2',
        'Thu phản hồi, xử lý vấn đề trước khi thành khiếu nại'),
      W(4, 'w2', 30, 'day', 'tg1', 'Chờ 1 tháng'),
      TAG(5, 'tg1', 'Đã chăm sóc sau bán', 'end', 'Gắn tag để chuyển sang nhóm khách cũ'),
      END(6),
    ],
  },
];

// ── Suy dẫn (không lưu cứng để khỏi lệch khi sửa steps) ─────────────────────
const WAIT_MS: Record<WaitUnit, number> = { hour: 1, day: 24, week: 24 * 7 };

/** Tổng thời gian chờ của luồng (tính theo ngày, làm tròn lên). */
export function estimateDurationDays(t: FollowupTemplate): number {
  const hours = t.steps
    .filter((s) => s.type === 'wait')
    .reduce((sum, s) => {
      const c = s.config as { amount?: number; unit?: WaitUnit } | undefined;
      return sum + (Number(c?.amount) || 0) * (WAIT_MS[c?.unit ?? 'day'] ?? 24);
    }, 0);
  return Math.max(1, Math.ceil(hours / 24));
}

/** Số bước Follow-up thực chất (bỏ start/end). */
export function countSteps(t: FollowupTemplate): number {
  return t.steps.filter((s) => s.type !== 'start' && s.type !== 'end').length;
}
export function countSendSteps(t: FollowupTemplate): number {
  return t.steps.filter((s) => s.type === 'send').length;
}

/** Bản tóm tắt cho lưới thẻ (không kèm steps → payload nhẹ). */
export function templateSummary(t: FollowupTemplate) {
  return {
    key: t.key, name: t.name, category: t.category, tags: t.tags, version: t.version,
    goal: t.goal, audience: t.audience, shortDescription: t.shortDescription,
    estimatedDays: estimateDurationDays(t),
    stepCount: countSteps(t),
    sendCount: countSendSteps(t),
  };
}

export function listTemplates() {
  return FOLLOWUP_TEMPLATES.map(templateSummary);
}
export function listCategories(): string[] {
  return [...new Set(FOLLOWUP_TEMPLATES.map((t) => t.category))];
}
export function getTemplate(key: string): FollowupTemplate | undefined {
  return FOLLOWUP_TEMPLATES.find((t) => t.key === key);
}

/** Chi tiết đầy đủ cho dialog (kèm steps + giải thích + số liệu suy dẫn). */
export function templateDetail(t: FollowupTemplate) {
  return {
    ...templateSummary(t),
    intro: t.intro,
    whenToUse: t.whenToUse,
    endConditions: t.endConditions,
    expectedOutcome: t.expectedOutcome,
    config: t.config,
    steps: t.steps.map((s) => ({
      key: s.key, type: s.type, orderIndex: s.orderIndex,
      config: s.config, nextKey: s.nextKey ?? null,
      explain: s.explain, transition: s.transition ?? null,
    })),
  };
}

/**
 * Chuyển mẫu → payload tạo chiến dịch. Chiến dịch sinh ra là BẢN SAO độc lập:
 * sửa mẫu về sau KHÔNG ảnh hưởng chiến dịch đã tạo (PRD mục 6 & 8).
 * Trường `explain`/`transition` chỉ để hiển thị, KHÔNG ghi vào DB.
 */
export function templateToWorkflowInput(t: FollowupTemplate): WorkflowInput {
  return {
    name: t.name,
    description: t.shortDescription,
    type: t.type,
    goalType: t.config.goalType,
    goalTag: t.config.goalTag ?? null,
    goalTagOnReach: t.config.goalTagOnReach ?? null,
    stopOnPurchase: t.config.stopOnPurchase,
    stopOnTags: t.config.stopOnTags,
    maxMessages: t.config.maxMessages,
    sendWindowStart: t.config.sendWindowStart,
    sendWindowEnd: t.config.sendWindowEnd,
    minGapMinutes: t.config.minGapMinutes,
    steps: t.steps.map<StepInput>((s) => ({
      key: s.key, type: s.type, orderIndex: s.orderIndex,
      label: null, config: s.config ?? {}, nextKey: s.nextKey ?? null,
    })),
  };
}

/** Kiểm tra tính toàn vẹn: mọi nhánh trỏ tới bước có thật, có start/end, số tin ≤ trần. */
export function validateTemplate(t: FollowupTemplate): string[] {
  // Lỗi LOGIC (Goal kết thúc sớm, stop-tag tự dừng...) — bắt bằng bộ lint dùng chung.
  const lint = lintWorkflow({
    goalType: t.config.goalType, goalTag: t.config.goalTag ?? null,
    stopOnPurchase: t.config.stopOnPurchase, stopOnTags: t.config.stopOnTags,
    maxMessages: t.config.maxMessages,
    steps: t.steps.map((s) => ({ key: s.key, type: s.type, config: s.config, nextKey: s.nextKey ?? null })),
  }).filter((w) => w.level === 'error').map((w) => (w.stepKey ? `${w.stepKey}: ` : '') + w.message);
  const keys = new Set(t.steps.map((s) => s.key));
  const errs: string[] = [];
  if (!t.steps.some((s) => s.type === 'start')) errs.push('thiếu bước start');
  if (!t.steps.some((s) => s.type === 'end')) errs.push('thiếu bước end');
  if (countSendSteps(t) > t.config.maxMessages) {
    errs.push(`có ${countSendSteps(t)} bước gửi > trần ${t.config.maxMessages} tin`);
  }
  for (const s of t.steps) {
    if (s.nextKey && !keys.has(s.nextKey)) errs.push(`${s.key}.nextKey -> "${s.nextKey}" không tồn tại`);
    if (s.type === 'condition') {
      const c = (s.config ?? {}) as { check?: string; tag?: string; trueKey?: string; falseKey?: string };
      if (!c.trueKey || !keys.has(c.trueKey)) errs.push(`${s.key}.trueKey -> "${c.trueKey}" không tồn tại`);
      if (!c.falseKey || !keys.has(c.falseKey)) errs.push(`${s.key}.falseKey -> "${c.falseKey}" không tồn tại`);
      if ((c.check === 'has_tag' || c.check === 'no_tag') && !c.tag) errs.push(`${s.key}: check ${c.check} thiếu tag`);
    }
    if (s.type === 'send' && !(s.config as { content?: string })?.content?.trim()) errs.push(`${s.key}: nội dung tin rỗng`);
  }
  return [...lint, ...errs];
}

/** Validate toàn bộ kho (dùng ở seed + test). */
export function validateAllTemplates(): Record<string, string[]> {
  const bad: Record<string, string[]> = {};
  for (const t of FOLLOWUP_TEMPLATES) {
    const e = validateTemplate(t);
    if (e.length) bad[t.key] = e;
  }
  return bad;
}
