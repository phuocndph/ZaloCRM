// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { describe, it, expect } from 'vitest';
import { customerName, customerStatus, type MCustomer } from './mobile-customer-format';

const base: MCustomer = { id: 'c1' };

describe('customerName — ưu tiên tên gợi nhớ CRM', () => {
  it('crmName thắng fullName', () => {
    expect(customerName({ ...base, crmName: 'Anh Lộc Q7', fullName: 'Trần Văn Lộc' })).toBe('Anh Lộc Q7');
  });
  it('fallback fullName khi không có crmName', () => {
    expect(customerName({ ...base, fullName: 'Trần Văn Lộc' })).toBe('Trần Văn Lộc');
  });
  it('rỗng → "Khách hàng"', () => {
    expect(customerName(base)).toBe('Khách hàng');
  });
});

describe('customerStatus — displayStatus thắng statusRef', () => {
  it('lấy displayStatus khi có', () => {
    const c = { ...base, displayStatus: { id: 's1', name: 'Đã chốt', color: '#0a0' }, statusRef: { id: 's2', name: 'Mới', color: '#00a' } };
    expect(customerStatus(c)).toEqual({ name: 'Đã chốt', color: '#0a0' });
  });
  it('fallback statusRef', () => {
    expect(customerStatus({ ...base, statusRef: { id: 's2', name: 'Tiềm năng', color: null } })).toEqual({ name: 'Tiềm năng', color: null });
  });
  it('không có trạng thái → null', () => {
    expect(customerStatus(base)).toBeNull();
  });
});
