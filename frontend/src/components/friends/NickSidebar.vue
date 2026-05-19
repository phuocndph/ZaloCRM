<template>
  <aside class="nick-sidebar">
    <div class="head">
      <div class="title">
        <span>Nick Zalo của bạn</span>
        <span class="total">{{ accounts.length }}</span>
      </div>
      <input
        v-model="searchQuery"
        class="search"
        placeholder="🔍 Tìm nick..."
      />
    </div>

    <div
      class="all-row"
      :class="{ active: selectedNickId === 'all' }"
      @click="$emit('select', 'all')"
    >
      <div class="av">∑</div>
      <div>
        <div>Tất cả nick</div>
        <div class="sub">Tổng hợp {{ accounts.length }} nick</div>
      </div>
      <span class="count">{{ totalFriendsAll }}</span>
    </div>

    <div class="nick-list">
      <div
        v-for="acc in filteredAccounts"
        :key="acc.id"
        class="nick-pill"
        :class="{ active: selectedNickId === acc.id }"
        @click="$emit('select', acc.id)"
      >
        <div class="av" :class="[saleClass(acc.id), { offline: !isOnline(acc) }]">
          {{ initials(acc.displayName) }}
        </div>
        <div class="info">
          <div class="name">{{ acc.displayName || 'Nick chưa đặt tên' }}</div>
          <div class="meta">{{ acc.phone || acc.zaloUid || '—' }}</div>
        </div>
        <span class="count">{{ countByNick[acc.id] ?? '—' }}</span>
      </div>
      <div v-if="!filteredAccounts.length" class="empty-nick">
        Không tìm thấy nick "{{ searchQuery }}"
      </div>
    </div>

    <div class="footer">
      <span class="dot" />
      <span>{{ onlineCount }}/{{ accounts.length }} online · Auto-sync</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';

const props = defineProps<{
  accounts: ZaloAccount[];
  selectedNickId: string | null;
  countByNick: Record<string, number>;
  totalFriendsAll: number;
}>();

defineEmits<{
  (e: 'select', nickId: string): void;
}>();

const searchQuery = ref('');

const filteredAccounts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return props.accounts;
  return props.accounts.filter(a => {
    const hay = `${a.displayName || ''} ${a.phone || ''} ${a.zaloUid || ''}`.toLowerCase();
    return hay.includes(q);
  });
});

function isOnline(acc: ZaloAccount): boolean {
  return acc.liveStatus === 'online' || acc.status === 'connected';
}

const onlineCount = computed(() => props.accounts.filter(isOnline).length);

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

// 7-color palette hashed by account id (matches mockup avatars)
const PALETTE = ['av-c1', 'av-c2', 'av-c3', 'av-c4', 'av-c5', 'av-c6', 'av-c7'];
function saleClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
</script>

<style scoped>
.nick-sidebar {
  background: #fff;
  border-right: 1px solid #e4e8ef;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.head {
  padding: 14px 16px 10px;
  border-bottom: 1px solid #e4e8ef;
}
.head .title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #8d96a4;
  font-weight: 700;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head .title .total {
  background: #e8f0fe;
  color: #2f6ee5;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
}
.head .search {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #e4e8ef;
  border-radius: 6px;
  font-size: 12px;
  background: #f9fafc;
  font-family: inherit;
  box-sizing: border-box;
}
.head .search:focus { outline: none; background: #fff; border-color: #2f6ee5; }

.all-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px;
  cursor: pointer; border: 1px dashed #cdd4df;
  margin: 8px;
  font-weight: 600; font-size: 13px; color: #5b6573;
}
.all-row:hover { background: #e8f0fe; color: #2f6ee5; border-color: #2f6ee5; }
.all-row.active { background: #2f6ee5; color: #fff; border-color: #2f6ee5; border-style: solid; }
.all-row .av {
  width: 28px; height: 28px; border-radius: 6px;
  background: linear-gradient(135deg, #94a3b8, #64748b);
  display: grid; place-items: center; color: #fff; font-size: 12px;
  flex-shrink: 0;
}
.all-row.active .av { background: rgba(255,255,255,.18); }
.all-row .sub { font-size: 10px; opacity: .7; font-weight: 400; }
.all-row .count {
  margin-left: auto; font-size: 11px;
  padding: 2px 8px; border-radius: 10px;
  background: #f9fafc; color: #5b6573;
}
.all-row.active .count { background: rgba(255,255,255,.2); color: #fff; }

.nick-list { padding: 6px 8px; overflow-y: auto; flex: 1; }

.nick-pill {
  display: grid; grid-template-columns: 32px 1fr auto; gap: 8px; align-items: center;
  padding: 8px 10px; border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.nick-pill:hover { background: #f9fafc; }
.nick-pill.active {
  background: #e8f0fe;
  border-color: #2f6ee5;
  box-shadow: 0 1px 2px rgba(47,110,229,.1);
}
.nick-pill .av {
  width: 32px; height: 32px; border-radius: 50%;
  color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 11px;
  position: relative;
  flex-shrink: 0;
}
.nick-pill .av::after {
  content: ""; position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #16a34a; border: 2px solid #fff;
}
.nick-pill .av.offline::after { background: #9ca3af; }
.nick-pill .info { min-width: 0; }
.nick-pill .info .name {
  font-weight: 600; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nick-pill .info .meta { font-size: 11px; color: #8d96a4; }
.nick-pill .count {
  font-size: 11px; font-weight: 700;
  background: #f9fafc; color: #5b6573;
  padding: 2px 8px; border-radius: 10px;
}
.nick-pill.active .count { background: #2f6ee5; color: #fff; }

.empty-nick {
  text-align: center;
  font-size: 12px;
  color: #8d96a4;
  padding: 20px 10px;
}

.footer {
  padding: 10px 14px;
  border-top: 1px solid #e4e8ef;
  font-size: 11px;
  color: #8d96a4;
  display: flex; align-items: center; gap: 6px;
}
.footer .dot { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; }

/* Sale color palette — đồng nhất qua hash account.id */
.av-c1 { background: linear-gradient(135deg, #2f6ee5, #1d4ed8); }
.av-c2 { background: linear-gradient(135deg, #16a34a, #15803d); }
.av-c3 { background: linear-gradient(135deg, #d97706, #b45309); }
.av-c4 { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.av-c5 { background: linear-gradient(135deg, #db2777, #be185d); }
.av-c6 { background: linear-gradient(135deg, #0891b2, #0e7490); }
.av-c7 { background: linear-gradient(135deg, #ea580c, #c2410c); }
</style>
