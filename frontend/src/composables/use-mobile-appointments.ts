// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-mobile-appointments.ts — danh sách Lịch hẹn cho PWA Mobile (/m/appointments).
 * Tái dùng endpoint SẴN CÓ /appointments (+ /today, /upcoming) — quyền + timezone giữ ở
 * backend. Không thêm API, không đổi nghiệp vụ.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export type ApptSegment = 'today' | 'upcoming' | 'all';

export interface MAppointment {
  id: string;
  title?: string | null;
  type?: string;
  status?: string;
  appointmentDate: string;
  appointmentTime?: string | null;
  location?: string | null;
  emoji?: string | null;
  contactId?: string;
  contact?: { fullName?: string | null; phone?: string | null; avatarUrl?: string | null } | null;
  assignedUser?: { fullName?: string | null } | null;
  conversationId?: string | null;
  notes?: string | null;
  [k: string]: unknown;
}

export function useMobileAppointments() {
  const items = ref<MAppointment[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const segment = ref<ApptSegment>('today');

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      let data: any;
      if (segment.value === 'today') data = (await api.get('/appointments/today')).data;
      else if (segment.value === 'upcoming') data = (await api.get('/appointments/upcoming')).data;
      else data = (await api.get('/appointments')).data;
      items.value = data.appointments ?? data ?? [];
    } catch {
      error.value = 'Không tải được lịch hẹn';
    } finally {
      loading.value = false;
    }
  }

  function setSegment(s: ApptSegment) {
    if (segment.value === s) return;
    segment.value = s;
    void load();
  }

  return { items, loading, error, segment, load, setSegment };
}

/** Trạng thái → nhãn + biến thể màu (m-chip). Không rõ → 'Đã lên lịch'. */
export function apptStatusMeta(status?: string): { label: string; variant: string } {
  switch ((status || '').toLowerCase()) {
    case 'completed': case 'done': return { label: 'Đã xong', variant: 'success' };
    case 'cancelled': case 'canceled': return { label: 'Đã huỷ', variant: 'danger' };
    case 'missed': case 'overdue': case 'no_show': return { label: 'Quá hạn', variant: 'warning' };
    case 'confirmed': return { label: 'Đã xác nhận', variant: 'info' };
    default: return { label: 'Đã lên lịch', variant: 'brand' };
  }
}

/** Nhãn thời gian ngắn: "14:30 · 12/07". */
export function apptTimeLabel(a: MAppointment): string {
  const t = a.appointmentTime ? a.appointmentTime.slice(0, 5) : '';
  let d = '';
  try {
    const dt = new Date(a.appointmentDate);
    d = dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  } catch { /* keep */ }
  return [t, d].filter(Boolean).join(' · ');
}

export function apptCustomerName(a: MAppointment): string {
  return a.contact?.fullName || 'Khách hàng';
}
