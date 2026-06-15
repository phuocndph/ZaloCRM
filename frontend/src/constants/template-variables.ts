/**
 * template-variables.ts — DANH SÁCH 8 BIẾN cá nhân hóa DÙNG CHUNG (anh chốt 2026-06-15).
 *
 * Nguồn chân lý DUY NHẤT cho mọi UI soạn thảo (Block editor, Mẫu tin nhắn, ô chat).
 * Trước đây biến định nghĩa rải rác (BlockEditorDialog + quick-template-popup...) → trùng
 * lặp, dễ lệch. Gom 1 chỗ.
 *
 * BE render (backend/.../blocks/render-template.ts) PHẢI khớp danh sách `code` này.
 *   {gender}    Giới tính (Anh/Chị/Anh Chị)
 *   {name}      Tên khách (last word fullName)          [GIỮ TƯƠNG THÍCH]
 *   {name_full} Tên khách đầy đủ (full fullName)
 *   {crm_full}  Tên gợi nhớ (per-nick = Friend.aliasInNick, 2-way Zalo) → fallback fullName
 *   {crm_first} Tên gợi nhớ - chữ đầu
 *   {crm_last}  Tên gợi nhớ - chữ cuối
 *   {sale}      Tên sale (last word)                    [GIỮ TƯƠNG THÍCH]
 *   {sale_full} Tên sale đầy đủ
 */
export interface TemplateVariable {
  code: string;       // placeholder chèn vào text, vd '{crm_full}'
  label: string;      // tên hiển thị cho sale
  icon: string;       // mdi icon
  group: 'kh' | 'sale'; // nhóm: khách hàng / sale — để UI gom nhóm
  example: string;    // ví dụ giá trị (preview/tooltip)
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { code: '{gender}',    label: 'Giới tính (Anh/Chị)',   icon: 'mdi-human-male-female',  group: 'kh',   example: 'Anh' },
  { code: '{name}',      label: 'Tên khách',             icon: 'mdi-account-outline',    group: 'kh',   example: 'Lộc' },
  { code: '{name_full}', label: 'Tên khách đầy đủ',      icon: 'mdi-account',            group: 'kh',   example: 'Trần Văn Lộc' },
  { code: '{crm_full}',  label: 'Tên gợi nhớ (đầy đủ)',  icon: 'mdi-bookmark-outline',   group: 'kh',   example: 'Lộc Q7' },
  { code: '{crm_first}', label: 'Tên gợi nhớ (chữ đầu)', icon: 'mdi-bookmark',           group: 'kh',   example: 'Lộc' },
  { code: '{crm_last}',  label: 'Tên gợi nhớ (chữ cuối)',icon: 'mdi-bookmark',           group: 'kh',   example: 'Q7' },
  { code: '{sale}',      label: 'Tên sale',              icon: 'mdi-account-tie-outline',group: 'sale', example: 'Thành' },
  { code: '{sale_full}', label: 'Tên sale đầy đủ',       icon: 'mdi-account-tie',        group: 'sale', example: 'Phạm Chí Thành' },
];

/** Map code → ví dụ, để preview render nhanh trong UI (ô chat / popup). */
export const TEMPLATE_VAR_EXAMPLES: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.code, v.example]),
);
