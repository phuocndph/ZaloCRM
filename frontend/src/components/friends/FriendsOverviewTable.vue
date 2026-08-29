<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="fo-wrap">
    <div class="fo-toolbar">
      <label class="fo-check">
        <input
          type="checkbox"
          :checked="multiNickOnly"
          @change="$emit('update:multi-nick-only', ($event.target as HTMLInputElement).checked)"
        />
        Chỉ khách kết bạn ở nhiều nick
      </label>
      <div class="fo-sort" aria-label="Sắp xếp danh sách tổng hợp">
        <button :class="{ on: sortBy === 'recent' }" @click="$emit('sort-by', 'recent')">Mới tương tác</button>
        <button :class="{ on: sortBy === 'nicks-desc' }" @click="$emit('sort-by', 'nicks-desc')">Nhiều nick</button>
        <button :class="{ on: sortBy === 'messages-desc' }" @click="$emit('sort-by', 'messages-desc')">Nhiều tin</button>
      </div>
    </div>

    <div class="fo-head" aria-hidden="true">
      <span></span>
      <span>Khách hàng</span>
      <span>Tài khoản / quan hệ</span>
      <span>Lượt chat</span>
      <span>Tag</span>
      <span>Gần nhất</span>
      <span></span>
    </div>

    <div v-if="loading" class="fo-empty">
      <Loader2Icon :size="24" class="spin" />
      <span>Đang tổng hợp bạn bè từ các tài khoản...</span>
    </div>

    <div v-else-if="!items.length" class="fo-empty">
      <UsersIcon :size="28" />
      <strong>Không có khách hàng phù hợp</strong>
      <span>Thử bỏ bộ lọc hoặc chuyển sang một tài khoản cụ thể.</span>
    </div>

    <article v-for="item in items" v-else :key="item.id" class="fo-item" :class="{ open: expanded.has(item.id) }">
      <div class="fo-main" @click="toggle(item.id)">
        <button class="fo-expand" :aria-label="expanded.has(item.id) ? 'Thu gọn' : 'Mở chi tiết từng nick'">
          <ChevronDownIcon v-if="expanded.has(item.id)" :size="16" />
          <ChevronRightIcon v-else :size="16" />
        </button>

        <div class="fo-customer">
          <div class="fo-avatar" :class="avatarClass(item.contactId)">
            <img
              v-if="item.primaryFriend.zaloAvatarUrl || item.contact?.avatarUrl"
              :src="item.primaryFriend.zaloAvatarUrl || item.contact?.avatarUrl || ''"
              :alt="displayName(item)"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="hideBrokenImage"
            />
            <span>{{ initials(displayName(item)) }}</span>
          </div>
          <div class="fo-customer-info">
            <strong>{{ displayName(item) }}</strong>
            <small>
              <span v-if="item.contact?.phone">{{ item.contact.phone }}</span>
              <span v-if="item.pairCount > item.nickCount"> · {{ item.pairCount }} định danh</span>
            </small>
          </div>
        </div>

        <div class="fo-nicks">
          <div class="fo-nick-avatars">
            <span
              v-for="account in item.accounts.slice(0, 4)"
              :key="account.zaloAccountId"
              class="fo-nick-avatar"
              :class="accountAvatarClass(account.zaloAccountId)"
              :title="account.account?.displayName || 'Nick Zalo'"
            >{{ initials(account.account?.displayName || 'Nick') }}</span>
          </div>
          <div>
            <strong v-if="item.friendNickCount > 0">{{ item.friendNickCount }} nick đã kết bạn</strong>
            <strong v-else>{{ item.nickCount }} tài khoản có liên hệ</strong>
            <small v-if="item.isMultiNickFriend" class="fo-duplicate">Khách trùng nhiều nick</small>
            <small v-else-if="item.friendNickCount > 0">{{ item.nickCount }} tài khoản có dữ liệu</small>
            <small v-else>Chưa kết bạn trên tài khoản nào</small>
          </div>
        </div>

        <div class="fo-messages">
          <strong>{{ item.totalMessages.toLocaleString('vi') }}</strong>
          <small>{{ item.totalInbound.toLocaleString('vi') }} KH · {{ item.totalOutbound.toLocaleString('vi') }} sale</small>
        </div>

        <div class="fo-tags">
          <span
            v-for="tag in item.tags.slice(0, 4)"
            :key="`${tag.scope}:${tag.name}`"
            class="fo-tag"
            :class="tag.scope"
            :style="tagStyle(tag.color)"
            :title="tag.scope === 'crm' ? 'Tag CRM chung' : 'Tag theo nick'"
          >{{ tag.name }}</span>
          <span v-if="item.tags.length > 4" class="fo-tag-more">+{{ item.tags.length - 4 }}</span>
          <span v-if="!item.tags.length" class="fo-dim">Chưa có tag</span>
        </div>

        <div class="fo-last">
          <strong>{{ relativeDate(item.lastInteractionAt) }}</strong>
          <small>{{ exactDate(item.lastInteractionAt) }}</small>
        </div>

        <button class="fo-profile" title="Mở hồ sơ khách hàng" @click.stop="$emit('open-contact', item.primaryFriend)">
          <UserIcon :size="16" />
        </button>
      </div>

      <div v-if="expanded.has(item.id)" class="fo-details">
        <div class="fo-detail-head">
          <span>Tài khoản</span>
          <span>Quan hệ</span>
          <span>Tin nhắn</span>
          <span>Tag theo nick</span>
          <span>Tương tác cuối</span>
          <span></span>
        </div>
        <div v-for="account in item.accounts" :key="account.zaloAccountId" class="fo-account-row">
          <div class="fo-account">
            <span class="fo-account-avatar" :class="accountAvatarClass(account.zaloAccountId)">
              {{ initials(account.account?.displayName || 'Nick') }}
            </span>
            <div>
              <strong>{{ account.account?.displayName || 'Nick chưa đặt tên' }}</strong>
              <small>{{ account.account?.phone || account.zaloAccountId }}</small>
            </div>
          </div>
          <div>
            <span class="fo-relation" :class="account.relationshipKind">{{ relationLabel(account.relationshipKind) }}</span>
            <small v-if="account.identityCount > 1" class="fo-identity">{{ account.identityCount }} định danh</small>
          </div>
          <div class="fo-account-messages">
            <strong>{{ account.totalMessages.toLocaleString('vi') }} tin</strong>
            <small>{{ account.totalInbound }} KH · {{ account.totalOutbound }} sale</small>
          </div>
          <div class="fo-account-tags">
            <span
              v-for="tag in account.tags.slice(0, 5)"
              :key="`${tag.scope}:${tag.name}`"
              class="fo-tag"
              :class="tag.scope"
              :style="tagStyle(tag.color)"
            >{{ tag.name }}</span>
            <span v-if="account.tags.length > 5" class="fo-tag-more">+{{ account.tags.length - 5 }}</span>
            <span v-if="!account.tags.length" class="fo-dim">Chưa có tag riêng</span>
          </div>
          <div class="fo-account-last">
            <strong>{{ relativeDate(account.lastInteractionAt) }}</strong>
            <small>{{ exactDate(account.lastInteractionAt) }}</small>
          </div>
          <div class="fo-account-actions">
            <button title="Mở chat bằng nick này" @click="$emit('open-chat', account.friend)"><MessageCircleIcon :size="15" /></button>
            <button title="Mở hồ sơ tại nick này" @click="$emit('open-contact', account.friend)"><UserIcon :size="15" /></button>
          </div>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  Loader2 as Loader2Icon,
  MessageCircle as MessageCircleIcon,
  User as UserIcon,
  Users as UsersIcon,
} from 'lucide-vue-next';
import type { DbFriend, FriendOverviewItem } from '@/composables/use-friends';

defineProps<{
  items: FriendOverviewItem[];
  loading: boolean;
  multiNickOnly: boolean;
  sortBy: string;
}>();

defineEmits<{
  (event: 'update:multi-nick-only', value: boolean): void;
  (event: 'sort-by', value: 'recent' | 'nicks-desc' | 'messages-desc'): void;
  (event: 'open-chat', friend: DbFriend): void;
  (event: 'open-contact', friend: DbFriend): void;
}>();

const expanded = ref(new Set<string>());

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expanded.value = next;
}

function displayName(item: FriendOverviewItem): string {
  return item.contact?.crmName
    || item.primaryFriend.zaloDisplayName
    || item.contact?.fullName
    || 'Khách chưa đặt tên';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[parts.length - 2]?.[0] || ''}${parts[parts.length - 1]?.[0] || ''}`.toUpperCase();
}

const PALETTE = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6', 'av-7'];
function hashClass(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
function avatarClass(id: string) { return hashClass(id); }
function accountAvatarClass(id: string) { return hashClass(id); }

function hideBrokenImage(event: Event) {
  (event.target as HTMLImageElement).style.display = 'none';
}

function relationLabel(kind: string): string {
  return ({
    friend: 'Đã kết bạn',
    pending_friend: 'Đang chờ',
    chatting_stranger: 'Đang nhắn lạ',
    ghost: 'Đã ngắt',
    none: 'Người lạ',
  } as Record<string, string>)[kind] || kind;
}

function relativeDate(value: string | null): string {
  if (!value) return 'Chưa nhắn';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hôm qua';
  if (days < 30) return `${days} ngày trước`;
  return `${Math.floor(days / 30)} tháng trước`;
}

function exactDate(value: string | null): string {
  if (!value) return 'Không có tương tác';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function tagStyle(color: string | null) {
  return color ? { '--fo-tag-color': color } : {};
}
</script>

<style scoped>
.fo-wrap { flex: 1; min-height: 0; overflow: auto; background: var(--surface); }
.fo-toolbar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.fo-check { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); cursor: pointer; }
.fo-check input { margin: 0; }
.fo-sort { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-2); }
.fo-sort button { min-height: 28px; padding: 4px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--ink-3); font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.fo-sort button.on { background: var(--surface); color: var(--brand-700); box-shadow: var(--sh-xs); }
.fo-head, .fo-main { display: grid; grid-template-columns: 32px minmax(210px, 1.4fr) minmax(160px, 1fr) 120px minmax(170px, 1fr) 130px 36px; align-items: center; gap: 10px; min-width: 980px; }
.fo-head { position: sticky; top: 50px; z-index: 3; padding: 8px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line); color: var(--ink-4); font-size: 10.5px; font-weight: 700; text-transform: uppercase; }
.fo-item { min-width: 980px; border-bottom: 1px solid var(--line-2); }
.fo-item.open { background: var(--brand-softer); }
.fo-main { padding: 10px 14px; cursor: pointer; transition: background .12s; }
.fo-main:hover { background: var(--brand-softer); }
.fo-expand, .fo-profile { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink-3); cursor: pointer; }
.fo-expand:hover, .fo-profile:hover { color: var(--brand); border-color: var(--brand); }
.fo-customer, .fo-nicks, .fo-account { display: flex; align-items: center; gap: 9px; min-width: 0; }
.fo-avatar { width: 38px; height: 38px; flex: none; overflow: hidden; display: grid; place-items: center; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 800; }
.fo-avatar img { grid-area: 1 / 1; width: 100%; height: 100%; object-fit: cover; }
.fo-avatar span { grid-area: 1 / 1; }
.fo-customer-info, .fo-nicks > div:last-child, .fo-account > div { min-width: 0; display: flex; flex-direction: column; }
.fo-customer strong, .fo-nicks strong, .fo-account strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 12.5px; }
.fo-customer small, .fo-nicks small, .fo-account small, .fo-messages small, .fo-last small, .fo-account-messages small, .fo-account-last small { color: var(--ink-4); font-size: 10.5px; }
.fo-nick-avatars { display: flex; padding-left: 7px; }
.fo-nick-avatar { width: 27px; height: 27px; display: grid; place-items: center; margin-left: -7px; border: 2px solid var(--surface); border-radius: 50%; color: #fff; font-size: 8.5px; font-weight: 800; }
.fo-duplicate { color: #b45309 !important; font-weight: 700; }
.fo-messages, .fo-last, .fo-account-messages, .fo-account-last { display: flex; flex-direction: column; }
.fo-messages strong { color: var(--ink); font-size: 16px; font-variant-numeric: tabular-nums; }
.fo-last strong, .fo-account-last strong, .fo-account-messages strong { color: var(--ink-2); font-size: 11.5px; }
.fo-tags, .fo-account-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.fo-tag { max-width: 105px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 7px; border: 1px solid color-mix(in srgb, var(--fo-tag-color, #64748b) 32%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--fo-tag-color, #64748b) 12%, var(--surface)); color: color-mix(in srgb, var(--fo-tag-color, #475569) 85%, #172033); font-size: 10px; font-weight: 600; }
.fo-tag.crm { border-style: solid; }
.fo-tag.friend { border-style: dashed; }
.fo-tag-more, .fo-dim { color: var(--ink-4); font-size: 10.5px; }
.fo-details { margin: 0 14px 12px 56px; overflow: hidden; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); }
.fo-detail-head, .fo-account-row { display: grid; grid-template-columns: minmax(180px, 1.1fr) 110px 110px minmax(180px, 1fr) 135px 68px; align-items: center; gap: 10px; }
.fo-detail-head { padding: 7px 12px; background: var(--surface-2); color: var(--ink-4); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.fo-account-row { padding: 9px 12px; border-top: 1px solid var(--line-2); }
.fo-account-avatar { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 50%; color: #fff; font-size: 9px; font-weight: 800; }
.fo-relation { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: var(--surface-3); color: var(--ink-2); font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.fo-relation.friend { background: var(--success-soft); color: #087443; }
.fo-relation.pending_friend { background: var(--warning-soft); color: #92400e; }
.fo-identity { display: block; margin-top: 3px; color: var(--ink-4); font-size: 10px; }
.fo-account-actions { display: flex; justify-content: flex-end; gap: 4px; }
.fo-account-actions button { width: 29px; height: 29px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink-3); cursor: pointer; }
.fo-account-actions button:hover { color: #fff; background: var(--brand); border-color: var(--brand); }
.fo-empty { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: var(--ink-4); text-align: center; }
.fo-empty strong { color: var(--ink); }
.spin { animation: fo-spin .8s linear infinite; }
@keyframes fo-spin { to { transform: rotate(360deg); } }
.av-1 { background: #2563eb; } .av-2 { background: #0f9f6e; } .av-3 { background: #d97706; }
.av-4 { background: #7c3aed; } .av-5 { background: #db2777; } .av-6 { background: #0891b2; } .av-7 { background: #dc2626; }

@media (max-width: 720px) {
  .fo-toolbar { position: static; align-items: stretch; flex-direction: column; }
  .fo-sort { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .fo-sort button { padding-inline: 4px; }
  .fo-head { display: none; }
  .fo-item { min-width: 0; margin: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
  .fo-main { min-width: 0; grid-template-columns: 30px minmax(0, 1fr) 32px; gap: 8px; padding: 12px; }
  .fo-customer { grid-column: 2; }
  .fo-profile { grid-column: 3; grid-row: 1; }
  .fo-nicks, .fo-messages, .fo-tags, .fo-last { grid-column: 2 / 4; padding-top: 8px; border-top: 1px solid var(--line-2); }
  .fo-messages, .fo-last { flex-direction: row; align-items: baseline; gap: 8px; }
  .fo-details { margin: 0; border: 0; border-top: 1px solid var(--line); border-radius: 0 0 8px 8px; }
  .fo-detail-head { display: none; }
  .fo-account-row { grid-template-columns: 1fr auto; gap: 9px; padding: 12px; }
  .fo-account { grid-column: 1; }
  .fo-account-row > div:nth-child(2) { grid-column: 2; grid-row: 1; text-align: right; }
  .fo-account-messages, .fo-account-tags, .fo-account-last { grid-column: 1 / -1; padding-top: 7px; border-top: 1px solid var(--line-2); }
  .fo-account-messages, .fo-account-last { flex-direction: row; gap: 8px; align-items: baseline; }
  .fo-account-actions { grid-column: 1 / -1; justify-content: flex-start; }
}
</style>
