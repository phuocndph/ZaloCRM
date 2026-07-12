// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * mobile-customer-format.ts — kiểu + format THUẦN cho Khách hàng mobile (không import
 * api/router) để unit-test không kéo theo @ee/alias. Composable re-export lại.
 */
export interface MCustomer {
  id: string;
  fullName?: string | null;
  crmName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  source?: string | null;
  status?: string | null;
  email?: string | null;
  statusRef?: { id: string; name: string; color: string | null } | null;
  displayStatus?: { id: string; name: string; color: string | null } | null;
  tags?: string[];
  assignedUser?: { fullName?: string | null } | null;
  nextAppointment?: string | null;
  lastMessageAt?: string | null;
  [k: string]: unknown;
}

/** Tên hiển thị KH: ưu tiên tên gợi nhớ CRM → tên đầy đủ → fallback. */
export function customerName(c: MCustomer): string {
  return c.crmName || c.fullName || 'Khách hàng';
}
/** Trạng thái bán hàng hiển thị: displayStatus → statusRef → null. */
export function customerStatus(c: MCustomer): { name: string; color: string | null } | null {
  const s = c.displayStatus || c.statusRef;
  return s ? { name: s.name, color: s.color } : null;
}
