// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * followup-lint.ts — soi lỗi LOGIC của chiến dịch (không phải lỗi cú pháp).
 *
 * Lý do tồn tại: engine kiểm Goal TRƯỚC khi chạy bước (advanceEnrollment). Nghĩa là
 * ngay khi đạt Goal, chiến dịch kết thúc — mọi bước phía sau không bao giờ chạy.
 * Hệ quả rất dễ mắc: đặt Goal = "Khách phản hồi" rồi lại dùng điều kiện "Đã phản hồi"
 * để rẽ nhánh ⇒ nhánh ĐÚNG là nhánh CHẾT, tin ở đó không bao giờ gửi.
 *
 * "Chạy thử" (simulateWorkflow) KHÔNG đánh giá Goal nên không phát hiện được loại này.
 * Bộ lint dưới đây bù đúng khoảng mù đó, dùng chung cho: kho mẫu + chiến dịch user tự tạo.
 */

export interface LintInput {
  goalType: string;
  goalTag?: string | null;
  stopOnPurchase: boolean;
  stopOnTags: string[];
  maxMessages: number;
  steps: Array<{ key: string; type: string; config?: unknown; nextKey?: string | null }>;
}

export interface LintWarning {
  level: 'error' | 'warning';
  stepKey?: string;
  message: string;
}

type Cond = { check?: string; tag?: string; trueKey?: string; falseKey?: string };

export function lintWorkflow(w: LintInput): LintWarning[] {
  const out: LintWarning[] = [];
  const conds = w.steps.filter((s) => s.type === 'condition');
  const sends = w.steps.filter((s) => s.type === 'send');

  // ── 1. Goal kết thúc sớm làm nhánh điều kiện thành nhánh chết ──
  for (const s of conds) {
    const c = (s.config ?? {}) as Cond;

    if (w.goalType === 'replied' && c.check === 'replied') {
      out.push({
        level: 'error', stepKey: s.key,
        message: 'Mục tiêu là "Khách phản hồi" nên chiến dịch kết thúc ngay khi khách trả lời. ' +
          'Nhánh ĐÚNG của điều kiện "Đã phản hồi" sẽ KHÔNG BAO GIỜ chạy. ' +
          'Hãy đổi Mục tiêu sang "Không đặt mục tiêu" nếu bạn cần gửi tin sau khi khách trả lời.',
      });
    }
    if (w.goalType === 'replied' && c.check === 'not_replied') {
      out.push({
        level: 'warning', stepKey: s.key,
        message: 'Mục tiêu "Khách phản hồi" đã dừng chiến dịch khi khách trả lời, nên điều kiện ' +
          '"Chưa phản hồi" hầu như luôn ĐÚNG — nhánh SAI là nhánh chết (vô hại).',
      });
    }
    if (w.goalType === 'purchased' && c.check === 'has_tag' && c.tag === 'Đã mua') {
      out.push({
        level: 'error', stepKey: s.key,
        message: 'Mục tiêu là "Khách đã mua" nên chiến dịch kết thúc ngay khi có thẻ "Đã mua". ' +
          'Nhánh ĐÚNG của điều kiện này không bao giờ chạy.',
      });
    }
    if (w.goalType === 'has_tag' && c.check === 'has_tag' && c.tag && c.tag === w.goalTag) {
      out.push({
        level: 'error', stepKey: s.key,
        message: `Mục tiêu là "có thẻ ${w.goalTag}" nên chiến dịch kết thúc ngay khi gắn thẻ đó. Nhánh ĐÚNG không bao giờ chạy.`,
      });
    }
  }

  // ── 2. Điều kiện dừng vô hiệu hoá chiến dịch ngay từ bước đầu ──
  //    Ví dụ: chiến dịch nhắm khách ĐÃ MUA nhưng lại bật "Dừng khi khách đã mua".
  if (w.stopOnPurchase) {
    const targetsBuyers =
      w.steps.some((s) => s.type === 'condition' && ((s.config ?? {}) as Cond).tag === 'Đã mua') ||
      w.goalType === 'purchased';
    if (targetsBuyers && w.goalType !== 'purchased') {
      out.push({
        level: 'error',
        message: 'Chiến dịch nhắm khách đã mua nhưng đang bật "Dừng khi khách đã mua" ' +
          '⇒ sẽ dừng ngay ở bước đầu, không gửi gì. Hãy tắt tuỳ chọn đó.',
      });
    }
  }
  for (const t of w.stopOnTags) {
    if (w.steps.some((s) => s.type === 'tag_add' && ((s.config ?? {}) as { tag?: string }).tag === t)) {
      out.push({
        level: 'warning',
        message: `Chiến dịch gắn thẻ "${t}" nhưng thẻ đó cũng nằm trong danh sách "Dừng nếu có thẻ" ⇒ tự dừng chính mình ngay sau khi gắn.`,
      });
    }
  }

  // ── 3. Trần số tin ──
  if (sends.length > w.maxMessages) {
    out.push({
      level: 'error',
      message: `Có ${sends.length} bước gửi nhưng trần chỉ ${w.maxMessages} tin ⇒ chiến dịch sẽ bị dừng giữa chừng.`,
    });
  }

  // ── 4. Bước không ai trỏ tới (chết) ──
  const referenced = new Set<string>();
  for (const s of w.steps) {
    if (s.nextKey) referenced.add(s.nextKey);
    if (s.type === 'condition') {
      const c = (s.config ?? {}) as Cond;
      if (c.trueKey) referenced.add(c.trueKey);
      if (c.falseKey) referenced.add(c.falseKey);
    }
  }
  for (const s of w.steps) {
    if (s.type === 'start') continue;
    if (!referenced.has(s.key)) {
      out.push({ level: 'warning', stepKey: s.key, message: 'Không có bước nào dẫn tới bước này — nó sẽ không bao giờ chạy.' });
    }
  }

  return out;
}

export function hasBlockingError(warnings: LintWarning[]): boolean {
  return warnings.some((w) => w.level === 'error');
}
