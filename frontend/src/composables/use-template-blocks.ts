// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-template-blocks.ts — mô hình BLOCK cho Mẫu tin nhắn nhiều bước (2026-07-11).
 *
 * Mẫu = danh sách block CÓ THỨ TỰ (text / image / image_album / video / file / delay).
 * Chọn mẫu KHÔNG gửi gì — chỉ dựng danh sách block để xem trước, sửa, sắp xếp rồi mới gửi
 * tuần tự khi bấm "Gửi toàn bộ".
 *
 * Logic THUẦN (không I/O) để unit-test: chuyển đổi tương thích ngược + chuẩn hoá + kế hoạch gửi.
 */

export type TemplateBlockType = 'text' | 'image' | 'image_album' | 'video' | 'file' | 'delay';
export type BlockStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled';

export interface BlockAttachment {
  kind: 'image' | 'video' | 'file';
  assetId?: string;
  url: string;
  name?: string;
  thumb?: string;
  mime?: string;
}

export interface TemplateBlock {
  id: string;
  type: TemplateBlockType;
  content?: string;
  attachments?: BlockAttachment[];
  delayMs?: number;
  enabled: boolean;
  required?: boolean;
  // Trạng thái runtime khi gửi (không lưu vào mẫu).
  status?: BlockStatus;
  error?: string | null;
}

let _seq = 0;
export function newBlockId(): string {
  _seq += 1;
  return `blk_${Date.now().toString(36)}_${_seq}`;
}

/** Mẫu (shape lưu) có thể có blocks tường minh HOẶC chỉ content + attachments (mẫu cũ). */
export interface TemplateLike {
  content?: string | null;
  contentRich?: { text: string; styles?: Array<{ st: string; start: number; len: number }> } | null;
  attachments?: BlockAttachment[] | null;
  blocks?: unknown;
}

function attKind(a: any): 'image' | 'video' | 'file' {
  return a?.kind === 'video' ? 'video' : a?.kind === 'file' ? 'file' : 'image';
}

/** Chuẩn hoá 1 mảng attachment thô → BlockAttachment[] (chỉ giữ item có url/assetId). */
export function sanitizeAttachments(raw: unknown): BlockAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === 'object' && (typeof (a as any).url === 'string' || typeof (a as any).assetId === 'string'))
    .map((a: any) => ({
      kind: attKind(a),
      assetId: typeof a.assetId === 'string' ? a.assetId : undefined,
      url: typeof a.url === 'string' ? a.url : '',
      name: typeof a.name === 'string' ? a.name : undefined,
      thumb: typeof a.thumb === 'string' ? a.thumb : undefined,
      mime: typeof a.mime === 'string' ? a.mime : undefined,
    }));
}

/** Chuẩn hoá mảng block thô (từ DB/JSON) → TemplateBlock[] hợp lệ, gán id + enabled mặc định. */
export function sanitizeBlocks(raw: unknown): TemplateBlock[] {
  if (!Array.isArray(raw)) return [];
  const types: TemplateBlockType[] = ['text', 'image', 'image_album', 'video', 'file', 'delay'];
  return raw
    .filter((b) => b && typeof b === 'object' && types.includes((b as any).type))
    .map((b: any) => {
      const type = b.type as TemplateBlockType;
      const block: TemplateBlock = {
        id: typeof b.id === 'string' && b.id ? b.id : newBlockId(),
        type,
        enabled: b.enabled !== false,
        required: b.required === true,
      };
      if (type === 'delay') {
        block.delayMs = Math.max(0, Math.min(10000, Number(b.delayMs) || 0));
      } else if (type === 'text') {
        block.content = typeof b.content === 'string' ? b.content : '';
      } else {
        block.attachments = sanitizeAttachments(b.attachments);
      }
      return block;
    })
    .filter((b) => b.type === 'delay' || b.type === 'text' || (b.attachments && b.attachments.length > 0));
}

/**
 * TƯƠNG THÍCH NGƯỢC (yêu cầu 12): mẫu cũ chỉ có content + attachments → chuyển thành
 *   [ block text (nếu có nội dung), block image_album/image (nếu có ảnh/file) ].
 * Mẫu mới có `blocks` → dùng thẳng. KHÔNG mất dữ liệu, KHÔNG tự gửi.
 */
export function templateToBlocks(tpl: TemplateLike): TemplateBlock[] {
  const explicit = sanitizeBlocks(tpl.blocks);
  if (explicit.length > 0) return explicit;

  const blocks: TemplateBlock[] = [];
  const text = (tpl.contentRich?.text ?? tpl.content ?? '').trim();
  if (text) blocks.push({ id: newBlockId(), type: 'text', content: tpl.contentRich?.text ?? tpl.content ?? '', enabled: true });

  const atts = sanitizeAttachments(tpl.attachments);
  if (atts.length > 0) {
    const images = atts.filter((a) => a.kind === 'image');
    const others = atts.filter((a) => a.kind !== 'image');
    if (images.length > 0) {
      blocks.push({ id: newBlockId(), type: images.length > 1 ? 'image_album' : 'image', attachments: images, enabled: true });
    }
    for (const o of others) {
      blocks.push({ id: newBlockId(), type: o.kind === 'video' ? 'video' : 'file', attachments: [o], enabled: true });
    }
  }
  return blocks;
}

/** Có phải mẫu "đơn giản" (đúng 1 block text, không đính kèm) → có thể chèn thẳng ô soạn. */
export function isSimpleTextTemplate(blocks: TemplateBlock[]): boolean {
  return blocks.length === 1 && blocks[0].type === 'text';
}

/** Kế hoạch gửi: các block ĐANG BẬT + có nội dung, theo thứ tự hiện tại (đã reorder). */
export function sendableBlocks(blocks: TemplateBlock[]): TemplateBlock[] {
  return blocks.filter((b) => {
    if (!b.enabled) return false;
    if (b.type === 'delay') return true;
    if (b.type === 'text') return !!(b.content && b.content.trim());
    return !!(b.attachments && b.attachments.length > 0);
  });
}

/** Tách 1 đoạn text thành nhiều block text theo DÒNG TRỐNG (yêu cầu 3 — chỉ khi user chủ động). */
export function splitTextByBlankLines(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
