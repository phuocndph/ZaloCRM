// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc

export interface AccountAlertNotification {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt?: string;
  accountId?: string;
  accountName?: string;
  status?: string;
  disconnectReason?: string | null;
  incidentKey?: string;
  actionUrl?: string;
  actionLabel?: string;
  shouldAlert?: boolean;
}

export function isZaloAccountOut(notification: AccountAlertNotification): boolean {
  return notification.id.startsWith('zalo-') && !!notification.accountId;
}

export function accountAlertFingerprint(notification: AccountAlertNotification): string {
  return notification.incidentKey
    || `${notification.accountId || notification.id}:${notification.createdAt || notification.status || 'out'}`;
}

export function accountAlertMessage(notification: AccountAlertNotification): string {
  const name = notification.accountName?.trim() || 'Không tên';
  return `Tài khoản Zalo "${name}" đã bị out, cần kết nối lại.`;
}
