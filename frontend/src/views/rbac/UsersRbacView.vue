<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Nhân viên</h1>
        <p class="hero-sub">Quản lý người dùng tổ chức · Phân phòng ban · Gán nhóm quyền · Vô hiệu hóa khi nghỉ việc</p>
      </div>
    </header>

    <section class="stats-row" v-if="!loading && stats.total > 0">
      <div class="stat-card stat-primary">
        <div class="stat-label">Tổng nhân viên</div>
        <div class="stat-value">{{ stats.total }}</div>
      </div>
      <div class="stat-card stat-forest">
        <div class="stat-label">Đang hoạt động</div>
        <div class="stat-value">{{ stats.active }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-mustard">
        <div class="stat-label">Đã gán phòng ban</div>
        <div class="stat-value">{{ stats.withDept }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-cream">
        <div class="stat-label">Đã gán nhóm quyền</div>
        <div class="stat-value">{{ stats.withGroup }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
    </section>

    <!-- Toolbar -->
    <div class="toolbar" v-if="!loading && store.users.length > 0">
      <div class="toolbar-left">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input v-model="searchQ" placeholder="Tìm tên / email..." @input="applyFilter" />
          <button v-if="searchQ" class="search-clear" @click="searchQ = ''; applyFilter()">×</button>
        </div>
        <select class="filter-select" v-model="filterDept" @change="applyFilter">
          <option value="">🏢 Mọi phòng ban</option>
          <option v-for="d in flatDepts" :key="d.id" :value="d.id">
            {{ '— '.repeat(d._depth) }}{{ d.name }}
          </option>
        </select>
        <select class="filter-select" v-model="filterGroup" @change="applyFilter">
          <option value="">🛡 Mọi nhóm quyền</option>
          <option v-for="g in flatGroups" :key="g.id" :value="g.id">
            {{ '— '.repeat(g._depth) }}{{ g.name }}
          </option>
        </select>
        <select class="filter-select" v-model="filterActive" @change="applyFilter">
          <option value="all">Mọi trạng thái</option>
          <option value="active">🟢 Đang hoạt động</option>
          <option value="inactive">⚪ Đã vô hiệu</option>
        </select>
      </div>
      <div class="view-toggle">
        <button :class="{ active: viewMode === 'card' }" @click="viewMode = 'card'">
          🎴 Card
        </button>
        <button :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">
          📋 Bảng
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 4" :key="i"></div>
    </div>

    <div v-else-if="filteredUsers.length === 0 && store.users.length === 0" class="empty-state">
      <div class="empty-icon">👥</div>
      <h3>Chưa có nhân viên nào</h3>
      <p>Thêm nhân viên qua trang đăng ký hoặc dùng admin endpoint.</p>
    </div>

    <div v-else-if="filteredUsers.length === 0" class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>Không tìm thấy nhân viên phù hợp</h3>
      <p>Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm.</p>
    </div>

    <!-- CARD VIEW -->
    <section v-else-if="viewMode === 'card'" class="card-grid">
      <div
        v-for="(u, i) in filteredUsers"
        :key="u.id"
        class="dept-card dept-card-with-avatar"
        :style="{ '--accent': accentByIndex(i) }"
        @click="openPanel(u)"
      >
        <div class="dept-card-accent"></div>
        <span class="card-avatar-lg" :style="{ background: avatarColor(u.fullName || u.email) }">
          {{ initials(u.fullName || u.email) }}
        </span>
        <div class="dept-card-body" style="flex: 1; padding: 0;">
          <div class="dept-card-head">
            <div class="dept-name-wrap">
              <span class="dept-name">{{ u.fullName || '(chưa đặt tên)' }}</span>
              <span v-if="!u.isActive" class="dept-depth-tag tag-inactive">Vô hiệu</span>
              <span v-else-if="u.role === 'owner'" class="dept-depth-tag tag-owner">Chủ tổ chức</span>
              <span v-else-if="u.role === 'admin'" class="dept-depth-tag tag-admin">Quản trị</span>
            </div>
            <div class="dept-quick-actions">
              <button
                class="btn-quick btn-quick-edit"
                title="Chi tiết"
                @click.stop="openPanel(u)"
              >✎ Chi tiết</button>
            </div>
          </div>
          <div class="dept-rows">
            <div class="dept-info-row">
              <span class="info-ico">🏢</span>
              <span class="info-label">Phòng ban:</span>
              <template v-if="u.departmentMember">
                <span class="info-name">{{ u.departmentMember.department.name }}</span>
                <span v-if="u.departmentMember.deptRole === 'leader'" class="role-tag role-leader" style="margin-left: 6px;">👑 Trưởng</span>
                <span v-else-if="u.departmentMember.deptRole === 'deputy'" class="role-tag role-deputy" style="margin-left: 6px;">🎖️ Phó</span>
              </template>
              <span v-else class="info-empty">Chưa thuộc phòng</span>
            </div>
            <div class="dept-info-row dept-info-row-members">
              <span class="info-ico">🛡</span>
              <span class="info-label">Nhóm quyền:</span>
              <template v-if="u.permissionGroup">
                <span class="info-name">{{ u.permissionGroup.name }}</span>
                <span v-if="u.permissionGroup.isSystem" class="dept-depth-tag tag-system" style="margin-left: 6px;">Hệ thống</span>
              </template>
              <span v-else class="info-empty">Chưa gán</span>
            </div>
            <div class="dept-info-row">
              <span class="info-ico">📧</span>
              <span class="info-label">Email:</span>
              <span class="info-name email-mono">{{ u.email }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TABLE VIEW (compact for many users) -->
    <section v-else class="table-view">
      <table class="users-table-v2">
        <thead>
          <tr>
            <th>#</th>
            <th>Họ tên</th>
            <th>Email</th>
            <th>Phòng ban</th>
            <th>Nhóm quyền</th>
            <th>Trạng thái</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(u, i) in filteredUsers" :key="u.id" @click="openPanel(u)">
            <td class="cell-num">{{ i + 1 }}</td>
            <td class="cell-name">
              <span class="member-avatar" :style="{ background: avatarColor(u.fullName || u.email) }">
                {{ initials(u.fullName || u.email) }}
              </span>
              <span>{{ u.fullName || '(chưa đặt tên)' }}</span>
            </td>
            <td class="cell-email">{{ u.email }}</td>
            <td>
              <template v-if="u.departmentMember">
                {{ u.departmentMember.department.name }}
                <small v-if="u.departmentMember.deptRole !== 'member'" class="role-tag" :class="`role-${u.departmentMember.deptRole}`">
                  {{ u.departmentMember.deptRole === 'leader' ? '👑' : '🎖️' }}
                </small>
              </template>
              <span v-else class="info-empty">—</span>
            </td>
            <td>
              <span v-if="u.permissionGroup" class="info-name">{{ u.permissionGroup.name }}</span>
              <span v-else class="info-empty">—</span>
            </td>
            <td>
              <span class="role-tag" :class="u.isActive ? 'role-deputy' : 'role-empty-tag'">
                {{ u.isActive ? '🟢' : '⚪' }}
              </span>
            </td>
            <td>
              <button class="btn-quick btn-quick-edit" @click.stop="openPanel(u)">✎</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Side panel -->
    <UserEditPanel
      :open="panelOpen"
      :user="selectedUser"
      :current-user-id="currentUserId"
      :current-user-role="currentUserRole"
      @close="closePanel"
      @changed="onChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  useRbacStore,
  type RbacUser,
  type DepartmentNode,
  type PermissionGroupNode,
} from '@/stores/rbac';
import { useAuthStore } from '@/stores/auth';
import UserEditPanel from '@/components/rbac/UserEditPanel.vue';

const store = useRbacStore();
const authStore = useAuthStore();

const searchQ = ref('');
const filterDept = ref('');
const filterGroup = ref('');
const filterActive = ref<'all' | 'active' | 'inactive'>('all');
const viewMode = ref<'card' | 'table'>('card');

const panelOpen = ref(false);
const selectedUser = ref<RbacUser | null>(null);

const currentUserId = computed(() => authStore.user?.id ?? '');
const currentUserRole = computed(() => authStore.user?.role ?? 'member');

onMounted(async () => {
  await Promise.all([
    store.loadUsers(),
    store.loadDepartments(),
    store.loadPermissionGroups(),
  ]);
});

const flatDepts = computed(() => {
  const out: Array<DepartmentNode & { _depth: number }> = [];
  function walk(nodes: DepartmentNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.departments, 0);
  return out;
});
const flatGroups = computed(() => {
  const out: Array<PermissionGroupNode & { _depth: number }> = [];
  function walk(nodes: PermissionGroupNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.permissionGroups, 0);
  return out;
});

const filteredUsers = computed(() => {
  return store.users.filter((u) => {
    if (filterActive.value === 'active' && !u.isActive) return false;
    if (filterActive.value === 'inactive' && u.isActive) return false;
    return true;
  });
});

const stats = computed(() => {
  let total = store.users.length;
  let active = 0, withDept = 0, withGroup = 0;
  for (const u of store.users) {
    if (u.isActive) active++;
    if (u.departmentMember) withDept++;
    if (u.permissionGroupId) withGroup++;
  }
  return { total, active, withDept, withGroup };
});

const loading = computed(() => store.loading);

let debounceTimer: any;
function applyFilter() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    store.loadUsers({
      q: searchQ.value || undefined,
      departmentId: filterDept.value || undefined,
      permissionGroupId: filterGroup.value || undefined,
    });
  }, 300);
}

function openPanel(u: RbacUser) {
  selectedUser.value = u;
  panelOpen.value = true;
}
function closePanel() {
  panelOpen.value = false;
  selectedUser.value = null;
}
async function onChanged() {
  await store.loadUsers({
    q: searchQ.value || undefined,
    departmentId: filterDept.value || undefined,
    permissionGroupId: filterGroup.value || undefined,
  });
  // Refresh selected user from store
  if (selectedUser.value) {
    const updated = store.users.find((u) => u.id === selectedUser.value!.id);
    if (updated) selectedUser.value = updated;
  }
}

// ────────── Helpers ──────────
function accentByIndex(i: number): string {
  const colors = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'];
  return colors[i % colors.length];
}
function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style>
/* UsersRbacView — reuse .dept-page / .dept-card from rbac-page.css */

.email-mono {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 12px;
  color: #41454d;
}

.tag-inactive { background: #fbe6dc !important; color: #7a2000 !important; }
.tag-owner { background: #fdf3df !important; color: #7a5818 !important; }
.tag-admin { background: #e3ede4 !important; color: #0a2e0e !important; }
.tag-system { background: #fdf3df !important; color: #7a5818 !important; }

/* Table view (compact) */
.table-view {
  background: white;
  border: 1px solid #e0e2e6;
  border-radius: 12px;
  overflow: hidden;
}
.users-table-v2 {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.users-table-v2 thead th {
  background: #f8fafc;
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #41454d;
  border-bottom: 1px solid #e0e2e6;
}
.users-table-v2 tbody tr {
  cursor: pointer;
  transition: background 0.1s;
}
.users-table-v2 tbody tr:hover { background: #f8fafc; }
.users-table-v2 tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f1f3;
  vertical-align: middle;
}
.users-table-v2 tbody tr:last-child td { border-bottom: 0; }
.cell-num { color: #9297a0; font-size: 11px; width: 32px; }
.cell-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: #181d26;
}
.cell-email { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-size: 12px; color: #41454d; }
</style>
