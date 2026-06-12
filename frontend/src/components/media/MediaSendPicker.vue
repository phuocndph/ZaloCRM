<template>
  <div class="sp-overlay" @click.self="$emit('close')">
    <div class="sp-box">
      <header class="sp-head">
        <b>Gửi "{{ assetName }}" vào hội thoại</b>
        <button class="sp-x" @click="$emit('close')">✕</button>
      </header>

      <!-- Chip lọc theo nick (chỉ nick của sale — scope owner) -->
      <div v-if="nicks.length > 1" class="sp-nicks">
        <button class="sp-chip" :class="{ on: nickFilter === '' }" @click="setNick('')">Tất cả nick</button>
        <button
          v-for="n in nicks"
          :key="n.id"
          class="sp-chip"
          :class="{ on: nickFilter === n.id, main: n.privacyMode === 'main' }"
          @click="setNick(n.id)"
        >
          {{ n.displayName || 'Nick' }}<span v-if="n.privacyMode === 'main'" class="sp-maintag">chính</span>
        </button>
      </div>

      <div class="sp-search">
        <span class="i">🔍</span>
        <input v-model="q" placeholder="Tìm khách / hội thoại…" @input="debouncedReload" />
      </div>

      <div v-if="loading" class="sp-empty">Đang tải hội thoại…</div>
      <div v-else-if="convs.length === 0" class="sp-empty">Không có hội thoại 1-1 nào.</div>
      <ul v-else class="sp-list">
        <li v-for="c in convs" :key="c.id">
          <button class="sp-row" :disabled="sending === c.id" @click="send(c)">
            <img v-if="c.contact?.avatar" :src="c.contact.avatar" class="sp-av" alt="" />
            <span v-else class="sp-av ph">{{ initials(c) }}</span>
            <span class="sp-name">{{ c.contact?.displayName || c.title || 'Khách' }}</span>
            <!-- Nhãn nick: rõ khách này thuộc nick nào (chống gửi nhầm khi 1 sale có 5 nick) -->
            <span v-if="c.zaloAccount?.displayName" class="sp-nick" :class="{ main: c.zaloAccount.privacyMode === 'main' }">
              {{ c.zaloAccount.displayName }}
            </span>
            <span v-if="sending === c.id" class="sp-sending">Đang gửi…</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { sendMediaToConversation } from '@/api/media';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ assetId: string; assetName: string; watermarkUrl?: string | null }>();
const emit = defineEmits<{ close: []; sent: [] }>();
const toast = useToast();

interface NickRow { id: string; displayName?: string; privacyMode?: 'main' | 'sub' }
interface ConvRow {
  id: string;
  title?: string;
  threadType?: string;
  contact?: { displayName?: string; avatar?: string };
  zaloAccount?: { id?: string; displayName?: string; privacyMode?: 'main' | 'sub' };
}

const nicks = ref<NickRow[]>([]);
const convs = ref<ConvRow[]>([]);
const loading = ref(false);
const q = ref('');
const nickFilter = ref<string>(''); // '' = tất cả nick của sale
const sending = ref<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() { if (timer) clearTimeout(timer); timer = setTimeout(reload, 300); }
function setNick(id: string) { nickFilter.value = id; reload(); }

function initials(c: ConvRow): string {
  const n = c.contact?.displayName || c.title || '?';
  return n.trim().charAt(0).toUpperCase();
}

// Sắp nick: nick CHÍNH (main) trước, rồi theo tên. Dùng để default ưu tiên nick chính.
function sortNicks(list: NickRow[]): NickRow[] {
  return [...list].sort((a, b) => {
    const am = a.privacyMode === 'main' ? 0 : 1;
    const bm = b.privacyMode === 'main' ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
}

async function loadNicks() {
  try {
    const res = await api.get('/zalo-accounts');
    const list = (res.data ?? []).map((a: any) => ({
      id: a.id, displayName: a.displayName, privacyMode: a.privacyMode,
    })) as NickRow[];
    nicks.value = sortNicks(list);
  } catch { /* không có nick list cũng không sao — vẫn load hội thoại scope */ }
}

async function reload() {
  loading.value = true;
  try {
    // CHỈ hội thoại 1-1 (threadType='user'). Backend tự scope theo nick sale sở hữu
    // (getZaloScope) → không lẫn nick sale khác. accountId = lọc 1 nick cụ thể.
    const params: Record<string, string | number> = { threadType: 'user', limit: 60 };
    if (q.value) params.q = q.value;
    if (nickFilter.value) params.accountId = nickFilter.value;
    const res = await api.get('/conversations', { params });
    const list = (res.data.conversations ?? []).filter((c: ConvRow) => c.threadType !== 'group') as ConvRow[];
    // Default ưu tiên nick chính: hội thoại của nick main lên đầu (khi xem "Tất cả nick").
    convs.value = nickFilter.value ? list : sortConvByMainNick(list);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được hội thoại');
  } finally {
    loading.value = false;
  }
}

function sortConvByMainNick(list: ConvRow[]): ConvRow[] {
  return [...list].sort((a, b) => {
    const am = a.zaloAccount?.privacyMode === 'main' ? 0 : 1;
    const bm = b.zaloAccount?.privacyMode === 'main' ? 0 : 1;
    return am - bm; // main trước, giữ nguyên thứ tự còn lại (recent từ backend)
  });
}

async function send(c: ConvRow) {
  if (sending.value) return;
  sending.value = c.id;
  try {
    // Gửi qua đúng conversation → đúng nick (externalThreadId buộc nick).
    // Watermark BẬT → backend tự chọn variant watermark.
    await sendMediaToConversation(props.assetId, c.id);
    const nick = c.zaloAccount?.displayName ? ` (nick ${c.zaloAccount.displayName})` : '';
    toast.success(`Đã gửi cho ${c.contact?.displayName || 'khách'}${nick}`);
    emit('sent');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi thất bại');
  } finally {
    sending.value = null;
  }
}

onMounted(async () => { await loadNicks(); await reload(); });
</script>

<style scoped>
.sp-overlay { position:fixed; inset:0; z-index:120; background:rgba(15,23,42,.32); display:flex; align-items:center; justify-content:center; }
.sp-box {
  --ink:#181d26; --muted:#41454d; --hairline:#dddddd; --canvas:#fff; --soft:#f8fafc; --coral:#aa2d00; --forest:#006400;
  width:440px; max-width:94vw; max-height:74vh; background:var(--canvas); border:1px solid var(--hairline);
  border-radius:12px; box-shadow:0 16px 48px rgba(15,23,42,.22); display:flex; flex-direction:column; overflow:hidden;
}
.sp-head { padding:14px 18px; border-bottom:1px solid var(--hairline); display:flex; align-items:center; justify-content:space-between; color:var(--ink); font-size:14px; }
.sp-x { border:none; background:none; cursor:pointer; color:var(--muted); font-size:15px; }
.sp-nicks { display:flex; gap:6px; padding:10px 16px 4px; flex-wrap:wrap; }
.sp-chip { border:1px solid var(--hairline); background:var(--canvas); color:var(--muted); border-radius:9999px; padding:4px 12px; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
.sp-chip.on { background:var(--ink); color:#fff; border-color:var(--ink); }
.sp-chip.main:not(.on) { border-color:#bfe0bf; }
.sp-maintag { font-size:9.5px; background:var(--forest); color:#fff; border-radius:9999px; padding:1px 6px; }
.sp-chip.on .sp-maintag { background:rgba(255,255,255,.25); }
.sp-search { display:flex; align-items:center; gap:8px; padding:10px 16px; border-bottom:1px solid var(--hairline); background:var(--soft); }
.sp-search .i { color:var(--muted); }
.sp-search input { flex:1; border:none; background:none; outline:none; font-size:13px; color:var(--ink); }
.sp-list { list-style:none; margin:0; padding:6px 0; overflow:auto; }
.sp-row { display:flex; align-items:center; gap:10px; width:100%; padding:9px 16px; border:none; background:none; cursor:pointer; text-align:left; }
.sp-row:hover { background:var(--soft); }
.sp-row:disabled { opacity:.5; }
.sp-av { width:34px; height:34px; border-radius:9999px; object-fit:cover; flex-shrink:0; }
.sp-av.ph { display:flex; align-items:center; justify-content:center; background:#e0e2e6; color:var(--muted); font-size:14px; font-weight:600; }
.sp-name { flex:1; font-size:13.5px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sp-nick { font-size:11px; color:var(--muted); background:var(--soft); border:1px solid var(--hairline); border-radius:9999px; padding:2px 9px; white-space:nowrap; }
.sp-nick.main { color:var(--forest); border-color:#bfe0bf; background:#f0f7f0; }
.sp-sending { font-size:11px; color:var(--muted); }
.sp-empty { padding:28px 16px; text-align:center; font-size:13px; color:var(--muted); }
</style>
