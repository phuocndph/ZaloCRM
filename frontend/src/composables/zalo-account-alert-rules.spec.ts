// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, expect, it } from 'vitest';
import {
  accountAlertFingerprint,
  accountAlertMessage,
  isZaloAccountOut,
  type AccountAlertNotification,
} from './zalo-account-alert-rules';

const alert: AccountAlertNotification = {
  id: 'zalo-acc-1',
  type: 'error',
  title: 'Tài khoản Zalo "Sale Hà Nội" đã bị out',
  detail: 'Tài khoản đã bị out, cần kết nối lại',
  priority: 'high',
  accountId: 'acc-1',
  accountName: 'Sale Hà Nội',
  createdAt: '2026-07-30T08:00:00.000Z',
  incidentKey: 'acc-1:2026-07-30T08:00:00.000Z',
};

describe('zalo account alert rules', () => {
  it('nhận diện đúng cảnh báo nick Zalo bị out', () => {
    expect(isZaloAccountOut(alert)).toBe(true);
    expect(isZaloAccountOut({ ...alert, id: 'apt-1' })).toBe(false);
  });

  it('hiển thị đúng tên nick và yêu cầu kết nối lại', () => {
    expect(accountAlertMessage(alert)).toBe('Tài khoản Zalo "Sale Hà Nội" đã bị out, cần kết nối lại.');
  });

  it('fingerprint ổn định trong cùng một lần out để chống spam', () => {
    expect(accountAlertFingerprint(alert)).toBe('acc-1:2026-07-30T08:00:00.000Z');
    expect(accountAlertFingerprint({ ...alert, title: 'Nội dung khác' })).toBe(accountAlertFingerprint(alert));
  });
});
