// Module dùng chung: render biến template trong nội dung Khối.
// 2026-06-07 — tách từ engine/action-handlers/send-message.ts để CẢ engine handler
// LẪN endpoint chat "gửi Khối vào hội thoại" dùng CHUNG một logic render, không lệch.
//
// 8 BIẾN (anh chốt 2026-06-15 — mở rộng từ 3 biến cũ {gender}{name}{sale}):
//   {gender}    — "Anh"/"Chị"/"Anh Chị" lấy từ Contact.gender (fallback "Anh Chị")
//   {name}      — last word của Contact.fullName (VN convention)  [GIỮ TƯƠNG THÍCH]
//   {name_full} — full Contact.fullName
//   {crm_full}  — tên gợi nhớ PER-NICK = Friend.aliasInNick (2-way sync Zalo) → fallback fullName
//   {crm_first} — first word của aliasInNick → fallback first word fullName
//   {crm_last}  — last word của aliasInNick → fallback last word fullName
//   {sale}      — last word của user.fullName (chủ nick được assigned)  [GIỮ TƯƠNG THÍCH]
//   {sale_full} — full user.fullName
//
// LƯU Ý per-nick: {crm_*} lấy từ Friend (cặp KH × nick) → KHÁC nhau theo nick đang chat.
// EVO Sport đặt "Thành Phạm Chí", sale B đặt "Phạm Chí Thành" → mỗi nick 1 giá trị riêng.

import { prisma } from '../../../shared/database/prisma-client.js';

export interface TemplateVarValues {
  gender: string;
  name: string;
  name_full: string;
  crm_full: string;
  crm_first: string;
  crm_last: string;
  sale: string;
  sale_full: string;
}

const TOKEN_ORDER: Array<keyof TemplateVarValues> = [
  'gender', 'name', 'name_full', 'crm_full', 'crm_first', 'crm_last', 'sale', 'sale_full',
];

const firstWord = (s: string) => s.trim().split(/\s+/)[0] ?? '';
const lastWord = (s: string) => { const w = s.trim().split(/\s+/); return w[w.length - 1] ?? ''; };

/**
 * Query DB + tính 8 giá trị biến. DÙNG CHUNG cho renderTemplate + renderTemplateDetailed (DRY).
 * @param contactId      Contact → fullName/gender + tên gợi nhớ fallback
 * @param assignedNickId ZaloAccount.id — chủ nick → {sale}; + xác định Friend row per-nick → {crm_*}
 */
async function resolveVars(contactId: string, assignedNickId: string): Promise<TemplateVarValues> {
  const [contact, ownerUser, friend] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { fullName: true, gender: true } }),
    prisma.user.findFirst({ where: { zaloAccounts: { some: { id: assignedNickId } } }, select: { fullName: true } }),
    // Tên gợi nhớ PER-NICK: Friend row của cặp (contactId × nick đang chat).
    prisma.friend.findFirst({
      where: { contactId, zaloAccountId: assignedNickId },
      select: { aliasInNick: true },
    }),
  ]);

  const fullName = (contact?.fullName ?? '').trim();
  const saleFull = (ownerUser?.fullName ?? 'em').trim();
  // Tên gợi nhớ: ưu tiên aliasInNick per-nick; trống → fallback tên thật KH (anh chốt).
  const crmFull = ((friend?.aliasInNick ?? '').trim()) || fullName;

  return {
    gender: contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị',
    name: lastWord(fullName) || 'Anh Chị',
    name_full: fullName || 'Anh Chị',
    crm_full: crmFull || 'Anh Chị',
    crm_first: firstWord(crmFull) || 'Anh Chị',
    crm_last: lastWord(crmFull) || 'Anh Chị',
    sale: lastWord(saleFull) || 'em',
    sale_full: saleFull || 'em',
  };
}

/** Thay 8 token {key} bằng giá trị. Thứ tự cố định (TOKEN_ORDER) cho shiftStylesForRender khớp. */
function applyVars(raw: string, v: TemplateVarValues): string {
  let out = raw;
  for (const k of TOKEN_ORDER) out = out.replaceAll(`{${k}}`, v[k]);
  return out;
}

/**
 * Render 8 biến template trong chuỗi.
 * @param raw            chuỗi gốc (có thể chứa các token {gender}/{name}/{crm_full}/...)
 * @param contactId      Contact để lấy fullName + gender + tên gợi nhớ fallback
 * @param assignedNickId ZaloAccount.id — chủ nick → {sale*}; xác định Friend per-nick → {crm_*}
 */
export async function renderTemplate(
  raw: string,
  contactId: string,
  assignedNickId: string,
): Promise<string> {
  if (!raw.includes('{')) return raw;
  const v = await resolveVars(contactId, assignedNickId);
  return applyVars(raw, v);
}

/**
 * Như renderTemplate nhưng TRẢ THÊM các giá trị biến đã resolve — để shiftStylesForRender (D6)
 * dịch offset format theo độ dài giá trị thật. values rỗng nếu raw không chứa biến.
 */
export async function renderTemplateDetailed(
  raw: string,
  contactId: string,
  assignedNickId: string,
): Promise<{ rendered: string; values: TemplateVarValues }> {
  const empty: TemplateVarValues = {
    gender: '', name: '', name_full: '', crm_full: '', crm_first: '', crm_last: '', sale: '', sale_full: '',
  };
  if (!raw.includes('{')) return { rendered: raw, values: empty };
  const v = await resolveVars(contactId, assignedNickId);
  return { rendered: applyVars(raw, v), values: v };
}

type Style = { st: string; start: number; len: number };

/**
 * GĐ Block-media (2026-06-13 D6): giữ ĐỊNH DẠNG (đậm/màu) khi text có biến {name}/{gender}/{sale}.
 *
 * Vấn đề: style {start,len} là offset ký tự trên text GỐC. Sau khi renderTemplate thay biến
 * (vd "{name}"→"Thành"), độ dài đổi → offset cũ lệch. Trước đây code BỎ HẾT style khi có '{'
 * (an toàn nhưng MẤT format).
 *
 * Cách AN TOÀN (KHÔNG đếm offset mù — bài học off-by-one tiếng Việt [[reference_ai_phrase_based_pattern]]):
 * tái chạy replace TỪNG token theo thứ tự, dịch start/len của style theo độ lệch độ dài THẬT của
 * biến tại vị trí token. Quy tắc dịch chuẩn:
 *   - token NẰM TRƯỚC style (token.end ≤ style.start): dịch CẢ start (start += delta).
 *   - token NẰM TRONG style (token nằm gọn trong [start, start+len)): MỞ RỘNG len (len += delta).
 *   - token CẮT NGANG ranh giới style: KHÔNG an toàn → trả null (caller fallback bỏ style).
 *   - token NẰM SAU style: không ảnh hưởng.
 * delta = (độ dài giá trị thật) − (độ dài token). Giá trị thật suy ngược từ rawText vs renderedText
 * KHÔNG đáng tin (trùng lặp), nên ta nhận map gender/name/sale value VÀO hàm.
 *
 * @returns styles đã dịch, HOẶC null nếu không an toàn (caller bỏ style — giữ hành vi cũ).
 */
export function shiftStylesForRender(
  rawText: string,
  styles: Style[],
  values: TemplateVarValues,
): Style[] | null {
  if (!styles.length) return styles;
  if (!rawText.includes('{')) return styles; // không có biến → offset giữ nguyên

  // 8 token (anh chốt 2026-06-15). Token DÀI để trước token NGẮN trong alternation để regex
  // không match nhầm phần đầu (vd {name_full} không bị {name} ăn mất) — JS regex alternation
  // ưu tiên nhánh đầu khớp, nên liệt kê *_full/*_first/*_last trước {name}/{sale} trần.
  const tokenRe = /\{(gender|name_full|name|crm_full|crm_first|crm_last|sale_full|sale)\}/g;
  const tokens: Array<{ start: number; end: number; delta: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rawText)) !== null) {
    const key = m[1] as keyof TemplateVarValues;
    const valueLen = [...values[key]].length;
    const tokenLen = m[0].length;
    tokens.push({ start: m.index, end: m.index + tokenLen, delta: valueLen - tokenLen });
  }
  if (tokens.length === 0) return styles;

  const out: Style[] = [];
  for (const s of styles) {
    let start = s.start;
    let len = s.len;
    const sEnd = s.start + s.len;
    for (const t of tokens) {
      if (t.end <= s.start) {
        start += t.delta;            // token đứng trước → dời cả vùng
      } else if (t.start >= s.start && t.end <= sEnd) {
        len += t.delta;              // token nằm gọn trong vùng → giãn/co len
      } else if (t.start < sEnd && t.end > s.start) {
        return null;                 // cắt ngang ranh giới → không an toàn
      }
      // token sau vùng (t.start ≥ sEnd) → bỏ qua
    }
    if (start < 0 || len <= 0) return null; // phòng lệch âm bất thường
    out.push({ st: s.st, start, len });
  }
  return out;
}
