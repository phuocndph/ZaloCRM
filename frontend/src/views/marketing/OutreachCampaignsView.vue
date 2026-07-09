<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="oc-page">
    <div class="oc-head">
      <div>
        <h1>Chiến dịch kết bạn &amp; nhắn tin</h1>
        <p class="oc-sub">Tự động kết bạn + nhắn tin cho tệp khách hàng đã đồng ý. Chỉ dùng cho khách đã cho phép liên hệ.</p>
      </div>
      <button class="oc-btn primary" @click="showCreate = !showCreate">
        {{ showCreate ? '× Đóng' : '+ Tạo chiến dịch' }}
      </button>
    </div>

    <!-- ════ FORM TẠO CHIẾN DỊCH ════ -->
    <div v-if="showCreate" class="oc-card oc-form">
      <!-- Bước 1: nguồn + tên -->
      <section class="oc-step">
        <h3>1. Chọn danh sách &amp; nick</h3>
        <div class="oc-grid2">
          <label>Tệp khách hàng *
            <select v-model="form.customerListId" :class="{ 'oc-err': errors.customerListId }">
              <option :value="''" disabled>— Chọn tệp —</option>
              <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }} ({{ l.totalEntries ?? l.validEntries ?? 0 }} SĐT)</option>
            </select>
            <span v-if="errors.customerListId" class="oc-errtxt">{{ errors.customerListId }}</span>
          </label>
          <label>Nick Zalo gửi *
            <select v-model="form.zaloAccountId" :class="{ 'oc-err': errors.zaloAccountId }">
              <option :value="''" disabled>— Chọn nick —</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.displayName || a.phone || a.id }}</option>
            </select>
            <span v-if="errors.zaloAccountId" class="oc-errtxt">{{ errors.zaloAccountId }}</span>
          </label>
        </div>
        <label>Tên chiến dịch *
          <input v-model="form.name" placeholder="VD: Chăm khách TokyoHome tháng 7" :class="{ 'oc-err': errors.name }" />
          <span v-if="errors.name" class="oc-errtxt">{{ errors.name }}</span>
        </label>
        <label>Mô tả (tuỳ chọn) <input v-model="form.description" placeholder="Ghi chú nội bộ" /></label>
      </section>

      <!-- Bước 2: kết bạn -->
      <section class="oc-step">
        <h3>2. Cấu hình kết bạn</h3>
        <label class="oc-check"><input type="checkbox" v-model="form.enableAutoAdd" /> Tự động gửi lời mời kết bạn</label>
        <template v-if="form.enableAutoAdd">
          <label>Lời mời kết bạn *
            <textarea v-model="form.addFriendMessage" rows="2" placeholder="Chào bạn, mình là… có thông tin gửi bạn nhé" :class="{ 'oc-err': errors.addFriendMessage }" />
            <span v-if="errors.addFriendMessage" class="oc-errtxt">{{ errors.addFriendMessage }}</span>
          </label>
          <div class="oc-grid3">
            <label>Delay tối thiểu (giây) <input type="number" v-model.number="addMinS" min="1" max="60" :class="{ 'oc-err': errors.addDelay }" /></label>
            <label>Delay tối đa (giây) <input type="number" v-model.number="addMaxS" min="1" max="60" :class="{ 'oc-err': errors.addDelay }" /></label>
            <label>Tối đa/ngày <input type="number" v-model.number="form.maxAddPerDay" min="1" /></label>
          </div>
          <span v-if="errors.addDelay" class="oc-errtxt">{{ errors.addDelay }}</span>
        </template>
      </section>

      <!-- Bước 3: template nhắn tin -->
      <section class="oc-step">
        <h3>3. Nội dung tin nhắn (chọn ngẫu nhiên theo tỷ lệ) *</h3>
        <span v-if="errors.templates" class="oc-errtxt oc-errtxt-block">{{ errors.templates }}</span>
        <div v-for="(t, i) in form.templates" :key="i" class="oc-tpl">
          <div class="oc-tpl-head">
            <span>Mẫu {{ i + 1 }} · tỷ lệ {{ t.weight }} ({{ weightPct(t.weight) }}%)</span>
            <button class="oc-link danger" @click="form.templates.splice(i, 1)" v-if="form.templates.length > 1">Xoá</button>
          </div>
          <textarea
            v-model="t.content" rows="2"
            placeholder="Nội dung tin — dùng biến ở dưới để chèn tên/SĐT khách"
            :class="{ 'oc-err': errors['tpl' + i] }"
          />
          <span v-if="errors['tpl' + i]" class="oc-errtxt">{{ errors['tpl' + i] }}</span>
          <div class="oc-tpl-vars">Biến có sẵn: <code v-pre>{{name}}</code> <code v-pre>{{phone}}</code></div>
          <div class="oc-tpl-row">
            <label class="oc-weight">Tỷ lệ <input type="number" v-model.number="t.weight" min="1" max="10" /></label>
            <div class="oc-imgs">
              <span class="oc-imgs-label">Ảnh kèm (random 1):</span>
              <span v-for="id in t.imageAssetIds" :key="id" class="oc-imgchip">
                <img v-if="imgById(id)?.thumbnailUrl" :src="imgById(id)!.thumbnailUrl!" :alt="imgById(id)?.name" referrerpolicy="no-referrer" />
                <span class="oc-imgchip-name">{{ imgById(id)?.name || id.slice(0, 6) }}</span>
                <button class="oc-imgchip-x" @click="removeImg(t, id)" title="Bỏ ảnh">×</button>
              </span>
              <button class="oc-link" @click="openPicker(i)">+ Thêm ảnh từ Kho Media</button>
            </div>
          </div>
        </div>
        <button class="oc-link" @click="addTemplate">+ Thêm mẫu tin</button>
      </section>

      <!-- Bước 4: Điều kiện gửi (audience filter) -->
      <section class="oc-step">
        <h3>4. Điều kiện gửi <span class="oc-optional">(tùy chọn — để trống sẽ gửi tất cả)</span></h3>
        <p class="oc-filter-intro">Lọc trước khi gửi để đúng khách, tránh làm phiền. Bỏ trống mọi điều kiện thì chiến dịch chạy như bình thường.</p>

        <div class="oc-filters">
          <!-- Filter 1: chỉ gửi cho KH có tag -->
          <div class="oc-fcard">
            <div class="oc-fcard-head">
              <span class="oc-fcard-title">Chỉ gửi cho khách hàng có Tag</span>
              <span class="oc-fcard-desc">Chỉ khách có ít nhất một trong các Tag được chọn mới nhận chiến dịch.</span>
            </div>
            <select class="oc-tagpick" :value="''" @change="addTag('require', ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
              <option value="" disabled>+ Thêm Tag…</option>
              <option v-for="t in availableTags(filters.requireTags)" :key="t.name" :value="t.name">{{ t.name }}</option>
            </select>
            <div class="oc-badges" v-if="filters.requireTags.length">
              <span v-for="name in filters.requireTags" :key="name" class="oc-badge-tag" :style="tagStyle(name)">
                {{ name }}<button class="oc-badge-x" @click="removeTag('require', name)">×</button>
              </span>
            </div>
            <span v-else class="oc-fcard-empty">Chưa chọn — không lọc theo điều kiện này.</span>
          </div>

          <!-- Filter 2: không gửi cho KH có tag -->
          <div class="oc-fcard">
            <div class="oc-fcard-head">
              <span class="oc-fcard-title">Không gửi cho khách hàng có Tag</span>
              <span class="oc-fcard-desc">Khách có bất kỳ Tag nào dưới đây sẽ bị loại khỏi chiến dịch.</span>
            </div>
            <select class="oc-tagpick" :value="''" @change="addTag('exclude', ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
              <option value="" disabled>+ Thêm Tag…</option>
              <option v-for="t in availableTags(filters.excludeTags)" :key="t.name" :value="t.name">{{ t.name }}</option>
            </select>
            <div class="oc-badges" v-if="filters.excludeTags.length">
              <span v-for="name in filters.excludeTags" :key="name" class="oc-badge-tag oc-badge-excl" :style="tagStyle(name)">
                {{ name }}<button class="oc-badge-x" @click="removeTag('exclude', name)">×</button>
              </span>
            </div>
            <span v-else class="oc-fcard-empty">Chưa chọn — không lọc theo điều kiện này.</span>
          </div>

          <!-- Filter 3: không gửi nếu đã chat trong N ngày -->
          <div class="oc-fcard">
            <div class="oc-fcard-head">
              <span class="oc-fcard-title">Không gửi nếu đã chat trong</span>
              <span class="oc-fcard-desc">Bỏ qua khách vừa trò chuyện gần đây để tránh làm phiền.</span>
            </div>
            <div class="oc-chatdays">
              <select class="oc-tagpick" v-model="chatDaysPreset">
                <option value="">Không giới hạn (tắt)</option>
                <option value="1">1 ngày</option>
                <option value="3">3 ngày</option>
                <option value="7">7 ngày</option>
                <option value="15">15 ngày</option>
                <option value="30">30 ngày</option>
                <option value="custom">Tùy chỉnh số ngày…</option>
              </select>
              <input v-if="chatDaysPreset === 'custom'" type="number" min="1" max="3650" v-model.number="chatDaysCustom" class="oc-chatdays-input" placeholder="Số ngày" />
            </div>
          </div>

          <!-- Filter 4: quan hệ bạn bè -->
          <div class="oc-fcard">
            <div class="oc-fcard-head">
              <span class="oc-fcard-title">Quan hệ bạn bè</span>
              <span class="oc-fcard-desc">Lọc theo việc khách đã là bạn của nick gửi hay chưa.</span>
            </div>
            <div class="oc-radios">
              <label class="oc-radio"><input type="radio" value="any" v-model="filters.friendRelation" /> Không quan tâm</label>
              <label class="oc-radio"><input type="radio" value="friend_only" v-model="filters.friendRelation" /> Chỉ gửi người đã là bạn</label>
              <label class="oc-radio"><input type="radio" value="non_friend_only" v-model="filters.friendRelation" /> Chỉ gửi người chưa là bạn</label>
            </div>
          </div>
        </div>

        <!-- Tóm tắt: tổng / đủ điều kiện / không đủ -->
        <div class="oc-audience" v-if="form.customerListId && form.zaloAccountId">
          <div class="oc-aud-cards">
            <div class="oc-aud"><span class="oc-aud-n">{{ previewLoading ? '…' : audience.total.toLocaleString('vi') }}</span><span class="oc-aud-l">Tổng khách hàng</span></div>
            <div class="oc-aud ok"><span class="oc-aud-n">{{ previewLoading ? '…' : audience.eligible.toLocaleString('vi') }}</span><span class="oc-aud-l">Đủ điều kiện gửi</span></div>
            <div class="oc-aud no"><span class="oc-aud-n">{{ previewLoading ? '…' : audience.skipped.toLocaleString('vi') }}</span><span class="oc-aud-l">Không đủ điều kiện</span></div>
          </div>
          <button class="oc-link" @click="openPreview">Xem danh sách →</button>
        </div>
        <p v-else class="oc-fcard-empty">Chọn Tệp khách hàng và Nick Zalo (Bước 1) để xem số lượng đủ điều kiện.</p>
      </section>

      <!-- Bước 5: thời gian nhắn -->
      <section class="oc-step">
        <h3>5. Cấu hình nhắn tin</h3>
        <label class="oc-check"><input type="checkbox" v-model="form.enableAutoMessage" /> Tự động nhắn tin sau khi kết bạn</label>
        <template v-if="form.enableAutoMessage">
          <div class="oc-grid3">
            <label>Chờ sau kết bạn — min (giây) <input type="number" v-model.number="waitMinS" min="0" :class="{ 'oc-err': errors.waitDelay }" /></label>
            <label>Chờ sau kết bạn — max (giây) <input type="number" v-model.number="waitMaxS" min="0" :class="{ 'oc-err': errors.waitDelay }" /></label>
            <label>Tối đa tin/ngày <input type="number" v-model.number="form.maxMsgPerDay" min="1" /></label>
          </div>
          <span v-if="errors.waitDelay" class="oc-errtxt">{{ errors.waitDelay }}</span>
          <div class="oc-grid2">
            <label>Delay giữa tin — min (giây) <input type="number" v-model.number="msgMinS" min="1" max="60" :class="{ 'oc-err': errors.msgDelay }" /></label>
            <label>Delay giữa tin — max (giây) <input type="number" v-model.number="msgMaxS" min="1" max="60" :class="{ 'oc-err': errors.msgDelay }" /></label>
          </div>
          <span v-if="errors.msgDelay" class="oc-errtxt">{{ errors.msgDelay }}</span>
        </template>
      </section>

      <div class="oc-note">
        ⚠ Automation Zalo có rủi ro giới hạn/khoá nick. Nên bật <code>AUTOMATION_STUB_MODE=true</code> để chạy thử an toàn trước, và chỉ dùng cho khách đã đồng ý.
      </div>

      <div class="oc-form-foot">
        <button class="oc-btn" :disabled="submitting" @click="submit(false)">Lưu nháp</button>
        <button class="oc-btn primary" :disabled="submitting" @click="submit(true)">
          {{ submitting ? 'Đang tạo…' : 'Tạo & Chạy' }}
        </button>
      </div>
    </div>

    <!-- ════ DANH SÁCH CHIẾN DỊCH ════ -->
    <div class="oc-card">
      <table class="oc-table">
        <thead>
          <tr><th>Tên</th><th>Trạng thái</th><th>Tiến độ</th><th>Kết bạn</th><th>Tin gửi</th><th>Tạo lúc</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in campaigns" :key="c.id" @click="goProgress(c.id)">
            <td class="oc-name">{{ c.name }}</td>
            <td><span class="oc-badge" :class="c.state">{{ stateLabel(c.state) }}</span></td>
            <td>{{ processed(c) }}/{{ c.totalTarget }}</td>
            <td>{{ c.totalAdded }}<span v-if="c.totalAddFailed" class="oc-fail"> · {{ c.totalAddFailed }} lỗi</span></td>
            <td>{{ c.totalMsgSent }}<span v-if="c.totalMsgFailed" class="oc-fail"> · {{ c.totalMsgFailed }} lỗi</span></td>
            <td class="oc-dim">{{ fmtDate(c.createdAt) }}</td>
            <td class="oc-actions">
              <button class="oc-link" @click.stop="goProgress(c.id)">Xem →</button>
              <button
                v-if="['completed','cancelled'].includes(c.state)"
                class="oc-link danger" @click.stop="askDelete(c)"
              >Xoá</button>
            </td>
          </tr>
          <tr v-if="!campaigns.length"><td colspan="7" class="oc-empty">Chưa có chiến dịch nào.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ════ MODAL CHỌN ẢNH TỪ KHO MEDIA ════ -->
    <div v-if="picker.open" class="oc-modal-overlay" @click.self="closePicker">
      <div class="oc-modal">
        <div class="oc-modal-head">
          <h3>Chọn ảnh từ Kho Media</h3>
          <button class="oc-modal-x" @click="closePicker">×</button>
        </div>
        <div class="oc-modal-body">
          <input v-model="picker.search" class="oc-modal-search" placeholder="Tìm ảnh theo tên…" @input="picker.page = 1" />
          <div v-if="!imageAssets.length" class="oc-hint" style="padding:16px">Kho ảnh trống — tải ảnh lên ở menu Kho ảnh trước.</div>
          <table v-else class="oc-modal-table">
            <thead><tr><th></th><th>Ảnh</th><th>Tên</th><th>Kích cỡ</th><th>Ngày</th></tr></thead>
            <tbody>
              <tr v-for="img in pickerPaged" :key="img.id" @click="toggleModalImg(img.id)" :class="{ sel: picker.selected.has(img.id) }">
                <td><input type="checkbox" :checked="picker.selected.has(img.id)" @click.stop="toggleModalImg(img.id)" /></td>
                <td><img v-if="img.thumbnailUrl" :src="img.thumbnailUrl" class="oc-modal-thumb" referrerpolicy="no-referrer" /></td>
                <td class="oc-modal-name">{{ img.name }}</td>
                <td class="oc-dim">{{ img.sizeBytes ? Math.round(img.sizeBytes / 1024) + ' KB' : '—' }}</td>
                <td class="oc-dim">{{ img.createdAt ? fmtDate(img.createdAt) : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="pickerTotalPages > 1" class="oc-modal-pag">
            <span>Trang {{ picker.page }}/{{ pickerTotalPages }}</span>
            <button :disabled="picker.page === 1" @click="picker.page--">← Trước</button>
            <button :disabled="picker.page >= pickerTotalPages" @click="picker.page++">Sau →</button>
          </div>
        </div>
        <div class="oc-modal-foot">
          <button class="oc-btn" @click="closePicker">Huỷ</button>
          <button class="oc-btn primary" @click="confirmPicker">Xác nhận ({{ picker.selected.size }} ảnh)</button>
        </div>
      </div>
    </div>

    <!-- ════ MODAL XÁC NHẬN XOÁ ════ -->
    <div v-if="delTarget" class="oc-modal-overlay" @click.self="delTarget = null">
      <div class="oc-modal oc-modal-sm">
        <div class="oc-modal-head"><h3>Xác nhận xoá chiến dịch</h3></div>
        <div class="oc-modal-body">
          <p class="oc-del-msg">Bạn sắp xoá vĩnh viễn chiến dịch <b>“{{ delTarget.name }}”</b>.</p>
          <p class="oc-del-msg">Toàn bộ lịch sử chạy, trạng thái từng số và nhật ký của chiến dịch sẽ bị xoá và <b>không thể khôi phục</b>.</p>
          <p class="oc-del-msg">Bạn có chắc chắn muốn tiếp tục không?</p>
        </div>
        <div class="oc-modal-foot">
          <button class="oc-btn" :disabled="deleting" @click="delTarget = null">Huỷ</button>
          <button class="oc-btn danger" :disabled="deleting" @click="doDelete">{{ deleting ? 'Đang xoá…' : 'Xoá chiến dịch' }}</button>
        </div>
      </div>
    </div>

    <!-- ════ MODAL XEM DANH SÁCH ĐIỀU KIỆN GỬI ════ -->
    <div v-if="preview.open" class="oc-modal-overlay" @click.self="preview.open = false">
      <div class="oc-modal oc-modal-lg">
        <div class="oc-modal-head">
          <h3>Danh sách khách hàng theo điều kiện</h3>
          <button class="oc-modal-x" @click="preview.open = false">×</button>
        </div>
        <div class="oc-modal-body">
          <div class="oc-prev-bar">
            <input v-model="preview.search" class="oc-modal-search" placeholder="Tìm theo tên hoặc SĐT…" @input="debouncedPreviewList" style="margin-bottom:0" />
            <span class="oc-prev-counts">
              <span class="oc-prev-ok">Được gửi: {{ audience.eligible.toLocaleString('vi') }}</span> ·
              <span class="oc-prev-no">Bỏ qua: {{ audience.skipped.toLocaleString('vi') }}</span>
            </span>
          </div>
          <div v-if="preview.loading" class="oc-hint" style="padding:16px">Đang tải…</div>
          <table v-else class="oc-modal-table">
            <thead><tr><th>Tên khách hàng</th><th>SĐT</th><th>Tag</th><th>Kết quả</th><th>Lý do</th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in preview.items" :key="i">
                <td class="oc-modal-name">{{ row.name || '—' }}</td>
                <td class="oc-mono">{{ row.phone || '—' }}</td>
                <td>
                  <span v-for="t in row.tags.slice(0, 3)" :key="t" class="oc-badge-tag oc-badge-mini" :style="tagStyle(t)">{{ t }}</span>
                  <span v-if="!row.tags.length" class="oc-dim">—</span>
                  <span v-if="row.tags.length > 3" class="oc-dim"> +{{ row.tags.length - 3 }}</span>
                </td>
                <td><span class="oc-result" :class="row.eligible ? 'ok' : 'no'">{{ row.eligible ? 'Được gửi' : 'Bỏ qua' }}</span></td>
                <td class="oc-dim">{{ row.reason || (row.eligible ? '—' : '') }}</td>
              </tr>
              <tr v-if="!preview.items.length"><td colspan="5" class="oc-empty">Không có khách hàng nào khớp.</td></tr>
            </tbody>
          </table>
          <p v-if="preview.items.length >= 300" class="oc-hint" style="margin-top:10px">Chỉ hiển thị 300 kết quả đầu — dùng ô tìm kiếm để thu hẹp.</p>
        </div>
        <div class="oc-modal-foot">
          <button class="oc-btn primary" @click="preview.open = false">Đóng</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useOutreach, useOutreachSocket, type OutreachTemplate, type ImageAsset, type OutreachCampaign, type AudiencePreviewItem } from '@/composables/use-outreach';
import { useCustomerLists } from '@/composables/use-customer-lists';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useToast } from '@/composables/use-toast';
import { useCrmTagDefs } from '@/composables/use-crm-tag-defs';

const router = useRouter();
const toast = useToast();
const { campaigns, fetchCampaigns, createCampaign, control, remove, previewAudience, fetchImageAssets } = useOutreach();
const { lists, fetchLists } = useCustomerLists();
const { accounts, fetchAccounts } = useZaloAccounts();
const { tagDefs, loadTagDefs, tagColor } = useCrmTagDefs();

const showCreate = ref(false);
const submitting = ref(false);
const imageAssets = ref<ImageAsset[]>([]);
const errors = reactive<Record<string, string>>({});

// giây (UI) ↔ ms (API)
const addMinS = ref(2), addMaxS = ref(5), waitMinS = ref(60), waitMaxS = ref(120), msgMinS = ref(3), msgMaxS = ref(8);

const form = reactive({
  customerListId: '', zaloAccountId: '', name: '', description: '',
  enableAutoAdd: true, addFriendMessage: 'Chào bạn, cảm ơn bạn đã tin tưởng shop. Mình kết bạn để tiện hỗ trợ nhé!',
  maxAddPerDay: 100,
  enableAutoMessage: true, maxMsgPerDay: 500,
  templates: [{ content: 'Chào {{name}}! Cảm ơn bạn đã mua hàng. Shop có ưu đãi mới gửi bạn tham khảo nhé.', weight: 1, imageAssetIds: [] }] as OutreachTemplate[],
});

// ── Điều kiện gửi (audience filter) ──
const filters = reactive({
  requireTags: [] as string[],
  excludeTags: [] as string[],
  friendRelation: 'any' as 'any' | 'friend_only' | 'non_friend_only',
});
const chatDaysPreset = ref<'' | '1' | '3' | '7' | '15' | '30' | 'custom'>('');
const chatDaysCustom = ref<number | null>(null);
const audience = reactive({ total: 0, eligible: 0, skipped: 0 });
const previewLoading = ref(false);
const preview = reactive({ open: false, loading: false, search: '', items: [] as AudiencePreviewItem[] });

// Số ngày chat hiệu lực (null = tắt).
const chatDays = computed<number | null>(() => {
  if (chatDaysPreset.value === '') return null;
  if (chatDaysPreset.value === 'custom') return chatDaysCustom.value && chatDaysCustom.value > 0 ? Math.floor(chatDaysCustom.value) : null;
  return Number(chatDaysPreset.value);
});

function availableTags(exclude: string[]) {
  const taken = new Set(exclude);
  return tagDefs.value.filter(t => !taken.has(t.name));
}
function addTag(kind: 'require' | 'exclude', name: string) {
  if (!name) return;
  const arr = kind === 'require' ? filters.requireTags : filters.excludeTags;
  if (!arr.includes(name)) arr.push(name);
}
function removeTag(kind: 'require' | 'exclude', name: string) {
  const arr = kind === 'require' ? filters.requireTags : filters.excludeTags;
  const i = arr.indexOf(name); if (i >= 0) arr.splice(i, 1);
}
function tagStyle(name: string) {
  const c = tagColor(name);
  return { '--tag-c': c } as Record<string, string>;
}

function filterPayload(extra: { search?: string; limit?: number } = {}) {
  return {
    customerListId: form.customerListId, zaloAccountId: form.zaloAccountId,
    requireTags: filters.requireTags, excludeTags: filters.excludeTags,
    skipChattedDays: chatDays.value, friendRelation: filters.friendRelation,
    ...extra,
  };
}

// Đếm tóm tắt — debounced, tự chạy khi filter/list/nick đổi.
let previewTimer: ReturnType<typeof setTimeout> | null = null;
async function refreshAudienceCounts() {
  if (!form.customerListId || !form.zaloAccountId) { audience.total = 0; audience.eligible = 0; audience.skipped = 0; return; }
  previewLoading.value = true;
  try {
    const r = await previewAudience(filterPayload({ limit: 1 }));
    audience.total = r.total; audience.eligible = r.eligible; audience.skipped = r.skipped;
  } catch { /* im lặng — chỉ là số ước tính */ }
  finally { previewLoading.value = false; }
}
function scheduleRefresh() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshAudienceCounts, 500);
}

// Dialog "Xem danh sách".
async function loadPreviewList() {
  if (!form.customerListId || !form.zaloAccountId) return;
  preview.loading = true;
  try {
    const r = await previewAudience(filterPayload({ search: preview.search || undefined, limit: 300 }));
    preview.items = r.items;
    audience.total = r.total; audience.eligible = r.eligible; audience.skipped = r.skipped;
  } catch { toast.error('Không tải được danh sách'); }
  finally { preview.loading = false; }
}
function openPreview() { preview.open = true; preview.search = ''; loadPreviewList(); }
let previewListTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPreviewList() {
  if (previewListTimer) clearTimeout(previewListTimer);
  previewListTimer = setTimeout(loadPreviewList, 400);
}

// Bất kỳ thay đổi nào ảnh hưởng eligibility → cập nhật đếm.
watch(
  () => [form.customerListId, form.zaloAccountId, filters.requireTags.length, filters.excludeTags.length, filters.friendRelation, chatDays.value],
  scheduleRefresh,
);

function addTemplate() { form.templates.push({ content: '', weight: 1, imageAssetIds: [] }); }
function removeImg(t: OutreachTemplate, id: string) {
  const i = t.imageAssetIds.indexOf(id); if (i >= 0) t.imageAssetIds.splice(i, 1);
}
function imgById(id: string) { return imageAssets.value.find(a => a.id === id); }
function weightPct(w: number) {
  const total = form.templates.reduce((s, t) => s + Math.max(1, t.weight || 1), 0);
  return total ? Math.round((Math.max(1, w || 1) / total) * 100) : 0;
}

// ── Modal chọn ảnh ──
const picker = reactive({ open: false, templateIndex: -1, search: '', page: 1, selected: new Set<string>() });
const PICKER_LIMIT = 8;
const pickerFiltered = computed(() => {
  const q = picker.search.trim().toLowerCase();
  return q ? imageAssets.value.filter(a => a.name.toLowerCase().includes(q)) : imageAssets.value;
});
const pickerTotalPages = computed(() => Math.max(1, Math.ceil(pickerFiltered.value.length / PICKER_LIMIT)));
const pickerPaged = computed(() => pickerFiltered.value.slice((picker.page - 1) * PICKER_LIMIT, picker.page * PICKER_LIMIT));
function openPicker(templateIndex: number) {
  picker.templateIndex = templateIndex;
  picker.selected = new Set(form.templates[templateIndex].imageAssetIds);
  picker.search = ''; picker.page = 1; picker.open = true;
}
function toggleModalImg(id: string) { picker.selected.has(id) ? picker.selected.delete(id) : picker.selected.add(id); }
function confirmPicker() {
  if (picker.templateIndex >= 0) form.templates[picker.templateIndex].imageAssetIds = [...picker.selected];
  picker.open = false;
}
function closePicker() { picker.open = false; }

// ── Validation ──
function validate(): boolean {
  Object.keys(errors).forEach(k => delete errors[k]);
  if (!form.customerListId) errors.customerListId = 'Vui lòng chọn danh sách SĐT';
  if (!form.zaloAccountId) errors.zaloAccountId = 'Vui lòng chọn nick Zalo';
  const nm = form.name.trim();
  if (nm.length < 3) errors.name = 'Tên chiến dịch bắt buộc (tối thiểu 3 ký tự)';
  else if (nm.length > 100) errors.name = 'Tên chiến dịch tối đa 100 ký tự';
  if (form.enableAutoAdd) {
    const msg = (form.addFriendMessage || '').trim();
    if (msg.length < 5) errors.addFriendMessage = 'Lời mời kết bạn bắt buộc (tối thiểu 5 ký tự)';
    else if (msg.length > 500) errors.addFriendMessage = 'Lời mời tối đa 500 ký tự';
    if (addMinS.value < 1 || addMaxS.value > 60 || addMinS.value >= addMaxS.value)
      errors.addDelay = 'Delay kết bạn: 1–60 giây, tối thiểu phải < tối đa';
  }
  if (!form.templates.length) errors.templates = 'Cần ít nhất 1 mẫu tin nhắn';
  else {
    let anyValid = false;
    form.templates.forEach((t, i) => {
      if (!t.content.trim()) errors['tpl' + i] = 'Nội dung mẫu không được trống';
      else anyValid = true;
      if (!t.weight || t.weight <= 0) errors['tpl' + i] = 'Tỷ lệ phải > 0';
    });
    if (!anyValid) errors.templates = 'Cần ít nhất 1 mẫu tin có nội dung';
  }
  if (form.enableAutoMessage) {
    if (waitMaxS.value <= waitMinS.value || waitMinS.value < 0)
      errors.waitDelay = 'Thời gian chờ: max phải > min và ≥ 0';
    if (msgMinS.value < 1 || msgMaxS.value > 60 || msgMinS.value >= msgMaxS.value)
      errors.msgDelay = 'Delay giữa tin: 1–60 giây, tối thiểu phải < tối đa';
  }
  return Object.keys(errors).length === 0;
}

async function submit(runNow: boolean) {
  if (!validate()) { toast.warning('Vui lòng sửa các lỗi được đánh dấu.'); return; }
  submitting.value = true;
  try {
    const created = await createCampaign({
      name: form.name.trim(), description: form.description || undefined,
      customerListId: form.customerListId, zaloAccountId: form.zaloAccountId,
      enableAutoAdd: form.enableAutoAdd, addFriendMessage: form.addFriendMessage,
      addDelayMinMs: addMinS.value * 1000, addDelayMaxMs: addMaxS.value * 1000, maxAddPerDay: form.maxAddPerDay,
      enableAutoMessage: form.enableAutoMessage,
      waitAfterAddMinMs: waitMinS.value * 1000, waitAfterAddMaxMs: waitMaxS.value * 1000,
      msgDelayMinMs: msgMinS.value * 1000, msgDelayMaxMs: msgMaxS.value * 1000, maxMsgPerDay: form.maxMsgPerDay,
      filterRequireTags: filters.requireTags, filterExcludeTags: filters.excludeTags,
      filterSkipChattedDays: chatDays.value, filterFriendRelation: filters.friendRelation,
      templates: form.templates.filter(t => t.content.trim()),
    } as any);
    if (!created?.id) { toast.error('Tạo chiến dịch thất bại'); return; }
    if (runNow) { await control(created.id, 'start'); toast.success('Đã tạo và bắt đầu chạy'); }
    else toast.success('Đã lưu nháp');
    showCreate.value = false;
    await fetchCampaigns();
    if (runNow) router.push(`/marketing/campaigns/${created.id}`);
  } catch (e: any) {
    const srvErrors = e?.response?.data?.errors;
    if (srvErrors && typeof srvErrors === 'object') {
      Object.assign(errors, srvErrors);
      toast.error('Vui lòng sửa các lỗi được đánh dấu.', 5000);
    } else {
      toast.error(e?.response?.data?.error || 'Lỗi kết nối server, thử lại.', 5000);
    }
  } finally { submitting.value = false; }
}

// ── Xoá chiến dịch (chỉ completed/cancelled) ──
const delTarget = ref<OutreachCampaign | null>(null);
const deleting = ref(false);
function askDelete(c: OutreachCampaign) { delTarget.value = c; }
async function doDelete() {
  if (!delTarget.value) return;
  deleting.value = true;
  try {
    await remove(delTarget.value.id);
    toast.success('Đã xoá chiến dịch.');
    delTarget.value = null;
    await fetchCampaigns();
  } catch (e: any) {
    toast.error(e?.response?.data?.message || e?.response?.data?.error || 'Không xoá được chiến dịch', 5000);
  } finally { deleting.value = false; }
}

function goProgress(id: string) { router.push(`/marketing/campaigns/${id}`); }
function processed(c: any) { return c.totalAdded + c.totalAddFailed + c.totalSkipped; }
function stateLabel(s: string) {
  return ({ draft: 'Nháp', running: 'Đang chạy', paused: 'Tạm dừng', completed: 'Hoàn tất', cancelled: 'Đã huỷ', failed: 'Lỗi' } as any)[s] || s;
}
function fmtDate(iso: string) { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

// Realtime: cập nhật counter trong bảng danh sách
useOutreachSocket((p) => {
  const c = campaigns.value.find(x => x.id === p.campaignId);
  if (c) Object.assign(c, p);
});

onMounted(async () => {
  await Promise.all([fetchCampaigns(), fetchLists(), fetchAccounts(), loadTagDefs()]);
  imageAssets.value = await fetchImageAssets();
});
</script>

<style scoped>
.oc-page { padding: 20px 24px; max-width: 1080px; }
.oc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.oc-head h1 { margin: 0; font-size: 20px; font-weight: 800; color: var(--ink); }
.oc-sub { margin: 4px 0 0; font-size: 13px; color: var(--ink-3); max-width: 640px; }
.oc-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg, 14px); box-shadow: var(--sh-sm); margin-bottom: 18px; }
.oc-form { padding: 18px 20px; }
.oc-step { padding: 12px 0; border-bottom: 1px solid var(--line-2); }
.oc-step:last-of-type { border-bottom: none; }
.oc-step h3 { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: var(--ink); }
.oc-step label { display: block; font-size: 12.5px; color: var(--ink-2); margin-bottom: 10px; }
.oc-step input:not([type=checkbox]), .oc-step select, .oc-step textarea {
  display: block; width: 100%; margin-top: 4px; padding: 8px 10px;
  border: 1px solid var(--line); border-radius: var(--r-sm, 8px); font-family: inherit; font-size: 13px; color: var(--ink);
}
.oc-step textarea { resize: vertical; }
.oc-check { display: flex !important; align-items: center; gap: 8px; }
.oc-check input { width: auto !important; margin: 0 !important; }
.oc-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.oc-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.oc-tpl { border: 1px solid var(--line); border-radius: var(--r-sm, 8px); padding: 12px; margin-bottom: 10px; background: var(--surface-2); }
.oc-tpl-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.oc-tpl-row { display: flex; align-items: flex-start; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
.oc-weight { width: 90px; margin: 0 !important; }
.oc-weight input { width: 70px !important; }
.oc-imgs { flex: 1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.oc-imgs-label { font-size: 11.5px; color: var(--ink-4); }
.oc-img { width: 40px; height: 40px; border-radius: 6px; overflow: hidden; border: 2px solid var(--line); background: var(--surface-3); cursor: pointer; padding: 0; }
.oc-img.on { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft); }
.oc-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.oc-img-ph { font-size: 10px; color: var(--ink-4); display: grid; place-items: center; height: 100%; }
.oc-hint { font-size: 11.5px; color: var(--ink-4); }
.oc-note { margin: 12px 0; padding: 10px 12px; background: var(--warning-soft); color: #92400e; border-radius: var(--r-sm, 8px); font-size: 12px; }
.oc-note code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; }
.oc-form-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.oc-btn { padding: 8px 16px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); background: var(--surface); color: var(--ink-2); font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.oc-btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.oc-btn.danger { background: var(--error, #f04438); color: #fff; border-color: var(--error, #f04438); }
.oc-btn:disabled { opacity: .55; cursor: not-allowed; }
.oc-actions { display: flex; gap: 12px; white-space: nowrap; }
.oc-link { background: none; border: none; color: var(--brand-700); font-weight: 600; font-size: 12.5px; cursor: pointer; font-family: inherit; padding: 4px 0; }
.oc-link.danger { color: var(--error); }
.oc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.oc-table th { text-align: left; padding: 10px 14px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-4); border-bottom: 1px solid var(--line); }
.oc-table td { padding: 11px 14px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); }
.oc-table tbody tr { cursor: pointer; }
.oc-table tbody tr:hover { background: var(--brand-softer); }
.oc-name { font-weight: 600; color: var(--ink); }
.oc-dim { color: var(--ink-4); }
.oc-fail { color: var(--error); font-size: 11px; }
.oc-empty { text-align: center; color: var(--ink-4); padding: 28px; }
.oc-badge { display: inline-block; padding: 2px 9px; border-radius: var(--r-pill, 999px); font-size: 11px; font-weight: 600; background: var(--surface-3); color: var(--ink-2); }
.oc-badge.running { background: #dbeafe; color: #1e40af; }
.oc-badge.paused { background: #fef3c7; color: #92400e; }
.oc-badge.completed { background: #dcfce7; color: #166534; }
.oc-badge.cancelled, .oc-badge.failed { background: #fee2e2; color: #b91c1c; }

/* ── Validation ── */
.oc-err { border-color: var(--error, #f04438) !important; background: #fff5f5; }
.oc-errtxt { display: block; color: var(--error, #f04438); font-size: 11.5px; margin-top: 4px; }
.oc-errtxt-block { margin-bottom: 8px; }
.oc-tpl-vars { font-size: 11px; color: var(--ink-4); margin-top: 4px; }
.oc-tpl-vars code { background: var(--surface-3); padding: 1px 5px; border-radius: 4px; }

/* ── Image chips ── */
.oc-imgchip { display: inline-flex; align-items: center; gap: 5px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px 2px 2px; font-size: 11px; }
.oc-imgchip img { width: 24px; height: 24px; border-radius: 4px; object-fit: cover; display: block; }
.oc-imgchip-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
.oc-imgchip-x { border: none; background: none; color: var(--ink-4); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.oc-imgchip-x:hover { color: var(--error); }

/* ── Media picker modal ── */
.oc-modal-overlay { position: fixed; inset: 0; background: rgba(15,20,25,.4); z-index: 60; display: grid; place-items: center; }
.oc-modal { width: 640px; max-width: 94vw; max-height: 86vh; background: var(--surface); border-radius: var(--r-lg, 14px); box-shadow: var(--sh-pop, 0 16px 48px rgba(0,0,0,.25)); display: flex; flex-direction: column; }
.oc-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.oc-modal-head h3 { margin: 0; font-size: 15px; color: var(--ink); }
.oc-modal-x { border: none; background: none; font-size: 22px; color: var(--ink-4); cursor: pointer; line-height: 1; }
.oc-modal-body { padding: 14px 18px; overflow-y: auto; flex: 1; }
.oc-modal-search { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); font-size: 13px; margin-bottom: 12px; font-family: inherit; }
.oc-modal-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.oc-modal-table th { text-align: left; padding: 6px 8px; font-size: 10.5px; text-transform: uppercase; color: var(--ink-4); border-bottom: 1px solid var(--line); }
.oc-modal-table td { padding: 6px 8px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); vertical-align: middle; }
.oc-modal-table tbody tr { cursor: pointer; }
.oc-modal-table tbody tr:hover { background: var(--brand-softer); }
.oc-modal-table tbody tr.sel { background: var(--brand-soft); }
.oc-modal-thumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; display: block; }
.oc-modal-name { color: var(--ink); font-weight: 500; }
.oc-modal-pag { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 12px; color: var(--ink-3); }
.oc-modal-pag button { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); cursor: pointer; font-family: inherit; font-size: 12px; }
.oc-modal-pag button:disabled { opacity: .5; cursor: not-allowed; }
.oc-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line); }

/* ── Modal xác nhận xoá ── */
.oc-modal-sm { width: 440px; }
.oc-del-msg { margin: 0 0 8px; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.oc-del-msg b { color: var(--ink); }

/* ── Điều kiện gửi ── */
.oc-optional { font-size: 11.5px; font-weight: 500; color: var(--ink-4); }
.oc-filter-intro { font-size: 12px; color: var(--ink-3); margin: 0 0 12px; }
.oc-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.oc-fcard { border: 1px solid var(--line); border-radius: var(--r-md, 10px); padding: 12px 14px; background: var(--surface-2); }
.oc-fcard-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
.oc-fcard-title { font-size: 13px; font-weight: 700; color: var(--ink); }
.oc-fcard-desc { font-size: 11.5px; color: var(--ink-4); line-height: 1.4; }
.oc-fcard-empty { font-size: 11.5px; color: var(--ink-4); font-style: italic; }
.oc-tagpick { width: 100%; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); font-family: inherit; font-size: 13px; color: var(--ink); background: var(--surface); }
.oc-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.oc-badge-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; color: var(--tag-c, #6B7280); background: color-mix(in srgb, var(--tag-c, #6B7280) 14%, transparent); border: 1px solid color-mix(in srgb, var(--tag-c, #6B7280) 35%, transparent); }
.oc-badge-excl { text-decoration: none; }
.oc-badge-mini { padding: 1px 7px; margin-right: 3px; font-size: 10.5px; }
.oc-badge-x { border: none; background: none; color: currentColor; cursor: pointer; font-size: 14px; line-height: 1; padding: 0 1px; opacity: .7; }
.oc-badge-x:hover { opacity: 1; }
.oc-chatdays { display: flex; gap: 8px; align-items: center; }
.oc-chatdays-input { width: 110px !important; margin: 0 !important; }
.oc-radios { display: flex; flex-direction: column; gap: 8px; }
.oc-radio { display: flex !important; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); margin: 0 !important; cursor: pointer; }
.oc-radio input { width: auto !important; margin: 0 !important; }

/* ── Tóm tắt đủ điều kiện ── */
.oc-audience { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; flex-wrap: wrap; }
.oc-aud-cards { display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 10px; flex: 1; }
.oc-aud { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border: 1px solid var(--line); border-radius: var(--r-md, 10px); background: var(--surface); }
.oc-aud-n { font-size: 20px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.oc-aud-l { font-size: 11.5px; color: var(--ink-3); }
.oc-aud.ok .oc-aud-n { color: var(--success, #12b76a); }
.oc-aud.no .oc-aud-n { color: var(--error, #f04438); }

/* ── Modal xem danh sách ── */
.oc-modal-lg { width: 820px; }
.oc-prev-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.oc-prev-bar .oc-modal-search { flex: 1; min-width: 200px; }
.oc-prev-counts { font-size: 12px; color: var(--ink-3); }
.oc-prev-ok { color: var(--success, #12b76a); font-weight: 700; }
.oc-prev-no { color: var(--error, #f04438); font-weight: 700; }
.oc-mono { font-family: var(--mono, monospace); color: var(--ink); font-weight: 600; font-size: 12px; }
.oc-result { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.oc-result.ok { background: #dcfce7; color: #166534; }
.oc-result.no { background: #fee2e2; color: #b91c1c; }
@media (max-width: 720px) { .oc-filters { grid-template-columns: 1fr; } }
</style>
