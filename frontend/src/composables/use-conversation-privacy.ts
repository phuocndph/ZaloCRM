// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-conversation-privacy.ts — Riêng tư cấp HỘI THOẠI (2026-07-09).
 *
 * "Chỉ mình tôi xem cuộc hội thoại này" — khác hoàn toàn riêng tư cấp NICK
 * (`use-privacy-visibility.ts` + OTP). Ở đây KHÔNG có mở khoá: người bật là người duy
 * nhất xem được, mọi tài khoản khác (kể cả Admin) bị BE chặn từ tầng dữ liệu.
 *
 * Frontend chỉ hiển thị — KHÔNG được coi là hàng rào bảo mật (yêu cầu 5: BE kiểm quyền
 * trước khi trả dữ liệu; FE không bao giờ nhận nội dung thật để rồi che bằng CSS).
 */
import { api } from '@/api/index';

/** Mã lỗi BE trả khi người khác cố đọc/ghi hội thoại riêng tư. */
export const CONVERSATION_PRIVATE_CODE = 'CONVERSATION_PRIVATE';

/** Câu duy nhất hiển thị cho người không có quyền (yêu cầu 4). */
export const CONVERSATION_PRIVATE_MESSAGE = 'Cuộc hội thoại này đang ở chế độ riêng tư.';

export interface ConversationPrivacyStatus {
  conversationId: string;
  isPrivate: boolean;
  privateOwnerUserId: string | null;
  privateOwnerName: string | null;
  privateEnabledAt: string | null;
  privateDisabledAt: string | null;
  canView: boolean;
  canDisable: boolean;
  /** Admin gỡ được khi chủ bị khóa/xóa — gỡ KHÔNG cho xem nội dung ngay lúc đó. */
  canForceRelease: boolean;
}

/** Lỗi API bất kỳ có phải "hội thoại riêng tư" không? Dùng để đổi UI sang màn chặn. */
export function isConversationPrivateError(err: unknown): boolean {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return code === CONVERSATION_PRIVATE_CODE;
}

export async function fetchConversationPrivacy(conversationId: string): Promise<ConversationPrivacyStatus> {
  const res = await api.get<ConversationPrivacyStatus>(`/conversations/${conversationId}/privacy`);
  return res.data;
}

export async function enableConversationPrivacy(conversationId: string): Promise<ConversationPrivacyStatus> {
  const res = await api.post<ConversationPrivacyStatus>(`/conversations/${conversationId}/privacy`);
  return res.data;
}

export async function disableConversationPrivacy(conversationId: string): Promise<ConversationPrivacyStatus> {
  const res = await api.delete<ConversationPrivacyStatus>(`/conversations/${conversationId}/privacy`);
  return res.data;
}

/** Admin gỡ cờ khi chủ bị khóa/xóa/nghỉ việc (yêu cầu 10). */
export async function forceReleaseConversationPrivacy(
  conversationId: string,
): Promise<ConversationPrivacyStatus> {
  const res = await api.post<ConversationPrivacyStatus>(
    `/conversations/${conversationId}/privacy/force-release`,
  );
  return res.data;
}
