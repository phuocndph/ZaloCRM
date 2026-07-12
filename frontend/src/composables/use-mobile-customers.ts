// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-mobile-customers.ts — danh sách Khách hàng cho PWA Mobile (/m/customers).
 *
 * Tái dùng endpoint SẴN CÓ `GET /contacts` (đã gate quyền contact:access ở backend +
 * scope theo phân quyền). KHÔNG thêm API, KHÔNG nhân bản nghiệp vụ desktop (use-contacts
 * kéo theo nhiều state của bảng desktop). Chỉ lấy field mobile cần + phân trang/tìm/lọc gọn.
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { customerName, customerStatus, type MCustomer } from './mobile-customer-format';

export { customerName, customerStatus, type MCustomer };

const PAGE_SIZE = 20;

export interface CustomerFilters {
  statusId?: string;
  source?: string;
  assignedUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useMobileCustomers() {
  const items = ref<MCustomer[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const page = ref(1);
  const total = ref(0);
  const search = ref('');
  const filters = ref<CustomerFilters>({});

  const hasMore = computed(() => items.value.length < total.value);
  const activeFilterCount = computed(
    () => Object.values(filters.value).filter((v) => v != null && v !== '').length,
  );

  function buildParams(p: number) {
    const q: Record<string, string | number> = { page: p, limit: PAGE_SIZE, threadType: 'user' };
    if (search.value.trim()) q.search = search.value.trim();
    const f = filters.value;
    if (f.statusId) q.statusId = f.statusId;
    if (f.source) q.source = f.source;
    if (f.assignedUserId) q.assignedUserId = f.assignedUserId;
    if (f.dateFrom) q.dateFrom = f.dateFrom;
    if (f.dateTo) q.dateTo = f.dateTo;
    return q;
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.get('/contacts', { params: buildParams(1) });
      items.value = data.contacts ?? data ?? [];
      total.value = data.total ?? items.value.length;
      page.value = 1;
    } catch {
      error.value = 'Không tải được danh sách khách hàng';
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value || loading.value) return;
    loadingMore.value = true;
    try {
      const next = page.value + 1;
      const { data } = await api.get('/contacts', { params: buildParams(next) });
      const more: MCustomer[] = data.contacts ?? data ?? [];
      // Dedup theo id (phòng trùng biên khi có tin mới chèn giữa các trang).
      const seen = new Set(items.value.map((c) => c.id));
      items.value.push(...more.filter((c) => !seen.has(c.id)));
      total.value = data.total ?? total.value;
      page.value = next;
    } catch {
      /* giữ danh sách hiện tại, không phá */
    } finally {
      loadingMore.value = false;
    }
  }

  function applyFilters(f: CustomerFilters) {
    filters.value = { ...f };
    void load();
  }
  function clearFilters() {
    filters.value = {};
    void load();
  }

  return {
    items, loading, loadingMore, error, search, filters, total,
    hasMore, activeFilterCount, load, loadMore, applyFilters, clearFilters,
  };
}
